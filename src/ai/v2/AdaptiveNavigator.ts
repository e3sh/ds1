import { Direction, Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { Player } from '../../models/Player.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { Dragon } from '../../models/Dragon.js';
import { Ghost } from '../../models/Ghost.js';
import { ThreatEvaluator } from '../../systems/ThreatEvaluator.js';
import { MagicSystem } from '../../systems/MagicSystem.js';
import { MovementSystem } from '../../systems/MovementSystem.js';
import { BotActionV2, DynamicBotParameters } from './BotTypesV2.js';
import type { TacticalContext } from './TacticalContext.js';

export interface PathResult {
  dir: Direction;
  cost: number;
  steps: number;
}

/**
 * AdaptiveNavigator
 *
 * トポロジー適応型BFS探索と、一元化されたスタック・ピンポン・周回ループ追跡器。
 * 複数のカウンタやブラックリストを単一の追跡モデルに統合し、
 * 動的パラメータに基づいて最適な安全経路を算出する。
 */
export class AdaptiveNavigator {
  // 1. 直近訪問座標履歴 (ピンポン・周回検知用)
  private recentPositions: Position[] = [];
  private readonly MAX_HISTORY_LEN: number = 16;

  // 2. 統合振動・停滞カウンタ
  public oscillationCount: number = 0;
  public pingPongCount: number = 0;

  // 3. 到達不能ターゲット・ブラックリスト (座標キー "x,y" => 残り除外ターン数)
  private unreachableTargets: Map<string, number> = new Map();

  // 4. ワープ往復防止タブー
  private recentWarpTiles: { pos: Position; turnsRemaining: number }[] = [];

  // 5. 危険ゾーン退避タイル記憶
  public recentEvadedTile: Position | null = null;
  public recentEvadedTurns: number = 0;

  // 6. 強制安全徘徊フラグ (スタック救出時)
  public forceWanderTurns: number = 0;

  // ==========================================================================
  // 状態追跡 & ターン更新
  // ==========================================================================

  /**
   * 毎ターンの開始時にプレイヤーの現在地を記録し、停滞やピンポンを検知
   */
  public updateTurn(playerPos: Position): void {
    // A. 訪問履歴記録
    this.recentPositions.push({ ...playerPos });
    if (this.recentPositions.length > this.MAX_HISTORY_LEN) {
      this.recentPositions.shift();
    }

    // B. ピンポン往復 (A -> B -> A) および狭小ループの厳格検知
    const rLen = this.recentPositions.length;
    let isPingPong = false;
    let isLooping = false;

    const prev1 = rLen >= 2 ? this.recentPositions[rLen - 2] : null;
    const isStationary = prev1 !== null && playerPos.x === prev1.x && playerPos.y === prev1.y;

    if (!isStationary) {
      if (rLen >= 3) {
        const prev2 = this.recentPositions[rLen - 3];
        if (playerPos.x === prev2.x && playerPos.y === prev2.y) {
          isPingPong = true;
        }
      }

      if (!isPingPong && rLen >= 4) {
        const prev3 = this.recentPositions[rLen - 4];
        if (playerPos.x === prev3.x && playerPos.y === prev3.y) {
          isLooping = true;
        }
      }
    }

    if (isPingPong) {
      this.pingPongCount++;
      this.oscillationCount++;
    } else if (isLooping) {
      this.oscillationCount++;
    } else {
      this.pingPongCount = Math.max(0, this.pingPongCount - 1);
      this.oscillationCount = Math.max(0, this.oscillationCount - 1);
    }

    // C. ブラックリスト・タイマーの減衰
    for (const [key, turns] of this.unreachableTargets.entries()) {
      if (turns <= 1) {
        this.unreachableTargets.delete(key);
      } else {
        this.unreachableTargets.set(key, turns - 1);
      }
    }

    for (let i = this.recentWarpTiles.length - 1; i >= 0; i--) {
      this.recentWarpTiles[i].turnsRemaining--;
      if (this.recentWarpTiles[i].turnsRemaining <= 0) {
        this.recentWarpTiles.splice(i, 1);
      }
    }

    if (this.recentEvadedTurns > 0) {
      this.recentEvadedTurns--;
      if (this.recentEvadedTurns <= 0) {
        this.recentEvadedTile = null;
      }
    }

    if (this.forceWanderTurns > 0) {
      this.forceWanderTurns--;
    }
  }

  // ==========================================================================
  // ブラックリスト＆タブー操作
  // ==========================================================================

  public markTargetUnreachable(pos: Position, turns: number = 30): void {
    this.unreachableTargets.set(`${pos.x},${pos.y}`, turns);
  }

  public isTargetUnreachable(pos: Position): boolean {
    const remaining = this.unreachableTargets.get(`${pos.x},${pos.y}`);
    return remaining !== undefined && remaining > 0;
  }

  public clearUnreachableTargets(): void {
    this.unreachableTargets.clear();
  }

  public recordWarpEvent(fromPos: Position, _toPos: Position): void {
    this.recentWarpTiles.push({ pos: { ...fromPos }, turnsRemaining: 12 });
  }

  public isWarpTaboo(pos: Position): boolean {
    return this.recentWarpTiles.some(w => w.pos.x === pos.x && w.pos.y === pos.y);
  }

  public triggerRescue(turns: number = 4): void {
    this.forceWanderTurns = turns;
    this.oscillationCount = 0;
    this.pingPongCount = 0;
  }

  /**
   * 8歩周期調整や意図的待機によるピンポン誤検知をリセット
   */
  public resetPingPong(): void {
    this.oscillationCount = 0;
    this.pingPongCount = 0;
  }

  // ==========================================================================
  // トポロジー適応型 BFS 経路探索
  // ==========================================================================

  /**
   * 始点から終点への最適行動方向を探索
   */
  public findPath(
    from: Position,
    to: Position,
    map: WorldMap,
    player: Player,
    enemies: EnemyInstance[],
    params: DynamicBotParameters,
    options?: {
      dragon?: Dragon;
      extraBlocked?: Position[];
      isEscapePhase?: boolean;
      ghosts?: Ghost[];
    }
  ): Direction | null {
    const result = this.executeBfs(from, to, map, player, enemies, params, options);
    return result ? result.dir : null;
  }

  public executeBfs(
    from: Position,
    to: Position,
    map: WorldMap,
    player: Player,
    enemies: EnemyInstance[],
    params: DynamicBotParameters,
    options?: {
      dragon?: Dragon;
      extraBlocked?: Position[];
      isEscapePhase?: boolean;
      ghosts?: Ghost[];
    }
  ): PathResult | null {
    if (!from || !to) return null;
    if (from.x === to.x && from.y === to.y) return null;

    const dragon = options?.dragon;
    const isEscapePhase = options?.isEscapePhase ?? false;
    const ghosts = options?.ghosts;

    // 敵マスの高速判定マップ & 危険ゾーンの事前セット化 (O(1) ルックアップ)
    const enemyTileMap = new Map<string, EnemyInstance>();
    const threatDangerZones = new Set<string>();
    const lethalOrthogonalZones = new Set<string>();
    const lethalChebyshevZones = new Set<string>();
    const effectiveDef = Math.floor(player.experience * 1.0);

    for (const e of enemies) {
      if (!e.isAlive) continue;
      enemyTileMap.set(`${e.pos.x},${e.pos.y}`, e);

      if (!e.isPermanentlyFrozen) {
        if (to && e.pos.x === to.x && e.pos.y === to.y) continue;

        const rawDmg = Math.max(0, e.atk - effectiveDef);
        const isLethal = rawDmg >= player.hp || ThreatEvaluator.evaluateThreat(player, e) === 'LETHAL';
        const isDangerous = isLethal || rawDmg >= player.hp * params.dangerHpRatio || rawDmg >= 10000 || (player.holdItem === 'CROWN' && rawDmg > 0);

        if (isLethal) {
          const cardDeltas = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
          for (const cd of cardDeltas) {
            const p = map.wrapPosition({ x: e.pos.x + cd.dx, y: e.pos.y + cd.dy });
            lethalOrthogonalZones.add(`${p.x},${p.y}`);
          }
          const diagDeltas = [{ dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 }];
          for (const dd of diagDeltas) {
            const p = map.wrapPosition({ x: e.pos.x + dd.dx, y: e.pos.y + dd.dy });
            lethalChebyshevZones.add(`${p.x},${p.y}`);
          }
        }

        if (isDangerous) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const p = map.wrapPosition({ x: e.pos.x + dx, y: e.pos.y + dy });
              threatDangerZones.add(`${p.x},${p.y}`);
            }
          }
        }
      }
    }

    const queue: { pos: Position; firstDir: Direction | null; cost: number; steps: number }[] = [
      { pos: from, firstDir: null, cost: 0, steps: 0 },
    ];
    const visited = new Map<string, number>();
    visited.set(`${from.x},${from.y}`, 0);

    const cardDirs: { dir: Direction; dx: number; dy: number }[] = [
      { dir: 'UP', dx: 0, dy: -1 },
      { dir: 'DOWN', dx: 0, dy: 1 },
      { dir: 'LEFT', dx: -1, dy: 0 },
      { dir: 'RIGHT', dx: 1, dy: 0 },
    ];
    const diagDirs: { dir: Direction; dx: number; dy: number }[] = [
      { dir: 'UP_LEFT', dx: -1, dy: -1 },
      { dir: 'UP_RIGHT', dx: 1, dy: -1 },
      { dir: 'DOWN_LEFT', dx: -1, dy: 1 },
      { dir: 'DOWN_RIGHT', dx: 1, dy: 1 },
    ];

    const allowDiagonal = player.canDiagonal || player.experience >= 12000;
    const dirs = allowDiagonal ? [...cardDirs, ...diagDirs] : cardDirs;

    let stepCount = 0;
    while (queue.length > 0 && stepCount < params.maxBfsSteps) {
      stepCount++;
      const current = queue.shift()!;
      if (current.pos.x === to.x && current.pos.y === to.y) {
        return {
          dir: current.firstDir!,
          cost: current.cost,
          steps: current.steps,
        };
      }

      for (const d of dirs) {
        const nextPos = map.wrapPosition({
          x: current.pos.x + d.dx,
          y: current.pos.y + d.dy,
        });

        if (map.getBaseTile(nextPos) === 'WALL_STATIC') continue;

        if (options?.extraBlocked && options.extraBlocked.some(p => p.x === nextPos.x && p.y === nextPos.y && !(to.x === nextPos.x && to.y === nextPos.y))) {
          continue;
        }

        if (map.getBaseTile(nextPos) === 'GRAVE' && map.getObject(nextPos) === 'NONE') {
          continue;
        }

        let actualNextPos = nextPos;
        const isWarpTile = map.getBaseTile(nextPos) === 'WARP';
        if (isWarpTile && !(nextPos.x === to.x && nextPos.y === to.y)) {
          const warpDest = map.getWarpDestination(nextPos);
          if (warpDest) actualNextPos = warpDest;
        }
        const key = `${actualNextPos.x},${actualNextPos.y}`;

        let stepCost = 1;

        if (isWarpTile && !(nextPos.x === to.x && nextPos.y === to.y)) {
          stepCost += params.warpAvoidanceCost;
          if (this.isWarpTaboo(nextPos) || this.isWarpTaboo(actualNextPos)) {
            stepCost += 500;
          }
        }

        const obj = map.getObject(nextPos);
        if (obj === 'BLOCK') {
          if (params.allowBreakAsRoad && MagicSystem.canCast(player, 'BREAK').allowed) {
            stepCost = params.breakCostMultiplier;
          } else if (player.holdItem === 'RING') {
            const pushDest = map.wrapPosition({ x: nextPos.x + d.dx, y: nextPos.y + d.dy });
            if (map.isPushDestinationValid(pushDest, enemies)) {
              stepCost = 3;
            } else {
              continue;
            }
          } else {
            continue;
          }
        }

        // ドラゴン部位・ブレス射線回避
        if (dragon) {
          if (dragon.getPartAt(nextPos)) continue;
          if (dragon.heads.some(h => h.isAlive && map.getTorusDistance(nextPos, h.pos).manhattan === 1)) continue;
          if (dragon.fireballs && dragon.fireballs.some(fb => fb.isAlive && (fb.pos.x === nextPos.x && fb.pos.y === nextPos.y))) continue;
          if (this.isDragonFireLine(nextPos, dragon, map)) continue;
        }

        // 敵マス進入判定
        const enemyOnTile = enemyTileMap.get(key);
        if (enemyOnTile) {
          if (player.holdItem === 'CROWN' || d.dir.includes('_')) continue;
          const threat = ThreatEvaluator.evaluateThreat(player, enemyOnTile);
          if (player.hp < player.maxHp * params.emergencyHpRatio && threat !== 'ONE_SHOT' && !(nextPos.x === to.x && nextPos.y === to.y)) {
            continue;
          }
          if (nextPos.x === to.x && nextPos.y === to.y) {
            if (threat !== 'ONE_SHOT' && threat !== 'SAFE') continue;
          } else {
            if (threat !== 'ONE_SHOT') continue;
          }
        }

        // 即死敵の直角隣接への飛び込み禁止（我が家への帰還時のみ入室許可）
        const isTargetHome = to && to.x === map.realHomePos.x && to.y === map.realHomePos.y && nextPos.x === to.x && nextPos.y === to.y;
        if (lethalOrthogonalZones.has(key) && !enemyTileMap.has(key) && !isTargetHome) {
          const isCurInOrthogonal = lethalOrthogonalZones.has(`${from.x},${from.y}`);
          if (!isCurInOrthogonal) continue;
          else stepCost += 5000;
        }

        if (lethalChebyshevZones.has(key) && !enemyTileMap.has(key) && !isTargetHome) {
          stepCost += 2000;
        }

        if (threatDangerZones.has(key) && !enemyTileMap.has(key) && !(nextPos.x === to.x && nextPos.y === to.y)) {
          stepCost += isEscapePhase ? 1000 : 400;
        }

        // ゴースト接近回避 (脱出時)
        if (ghosts && isEscapePhase) {
          const isNearGhost = ghosts.some(g => {
            if (g.pos.x === nextPos.x && g.pos.y === nextPos.y) return true;
            const predX = (g.pos.x + g.vx + map.width) % map.width;
            const predY = (g.pos.y + g.vy + map.height) % map.height;
            return predX === nextPos.x && predY === nextPos.y;
          });
          if (isNearGhost) stepCost += 5000;
        }

        // 直前マスへの逆戻り抑制
        if (!(nextPos.x === to.x && nextPos.y === to.y) && current.firstDir === null && this.recentPositions.length > 0) {
          const lastPos = this.recentPositions[this.recentPositions.length - 1];
          if (nextPos.x === lastPos.x && nextPos.y === lastPos.y) {
            stepCost += 100;
          }
        }

        const newCost = current.cost + stepCost;
        const prevCost = visited.get(key);
        if (prevCost !== undefined && prevCost <= newCost) continue;

        visited.set(key, newCost);
        const item = {
          pos: actualNextPos,
          firstDir: current.firstDir ?? d.dir,
          cost: newCost,
          steps: current.steps + 1,
        };

        if (stepCost > 1) {
          queue.push(item);
        } else {
          const insertIdx = queue.findIndex(q => q.cost > newCost);
          if (insertIdx === -1) queue.push(item);
          else queue.splice(insertIdx, 0, item);
        }
      }
    }

    return null;
  }

  // ==========================================================================
  // 安全徘徊 & 緊急回避
  // ==========================================================================

  public wanderSafe(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon?: Dragon
  ): BotActionV2 {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const diagDirs: Direction[] = ['UP_LEFT', 'UP_RIGHT', 'DOWN_LEFT', 'DOWN_RIGHT'];
    const dirs = (player.canDiagonal || player.experience >= 12000) ? [...cardDirs, ...diagDirs] : cardDirs;

    const validMoves: { dir: Direction; penalty: number }[] = [];

    for (const dir of dirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(player.pos, dir));
      if (map.getBaseTile(nextPos) === 'WALL_STATIC') continue;
      if (map.getBaseTile(nextPos) === 'GRAVE' && map.getObject(nextPos) === 'NONE') continue;

      const isBlock = map.getObject(nextPos) === 'BLOCK';
      const canBreak = MagicSystem.canCast(player, 'BREAK').allowed;
      if (isBlock && !canBreak) continue;

      if (dragon) {
        if (dragon.getPartAt(nextPos)) continue;
        if (this.isDragonFireLine(nextPos, dragon, map)) continue;
        if (dragon.heads.some(h => h.isAlive && map.getTorusDistance(nextPos, h.pos).manhattan === 1)) continue;
      }

      const enemy = enemies.find(e => e.isAlive && e.pos.x === nextPos.x && e.pos.y === nextPos.y);
      if (enemy) {
        if (dir.includes('_')) continue;
        if (ThreatEvaluator.evaluateThreat(player, enemy) !== 'ONE_SHOT') continue;
      }

      // 即死敵の直角隣接マスへの飛び込み禁止
      const hasAdjacentLethalEnemy = enemies.some(e => {
        if (!e.isAlive || e.isPermanentlyFrozen) return false;
        const d = map.getTorusDistance(nextPos, e.pos).manhattan;
        if (d !== 1) return false;
        const rawDmg = Math.max(0, e.atk - player.experience);
        return rawDmg >= player.hp || ThreatEvaluator.evaluateThreat(player, e) === 'LETHAL';
      });
      if (hasAdjacentLethalEnemy) continue;

      let penalty = 0;
      if (isBlock) penalty += 30;

      // 直近訪問履歴に対する段階的再訪ペナルティ
      // this.recentPositions の末尾 (length - 1) は現在地 player.pos
      const rLen = this.recentPositions.length;
      if (rLen >= 2) {
        // 1ターン前 (直前マス): 180度Uターン・往復を強力に抑止
        const p1 = this.recentPositions[rLen - 2];
        if (p1.x === nextPos.x && p1.y === nextPos.y) {
          penalty += 140;
        }
      }
      if (rLen >= 3) {
        // 2ターン前
        const p2 = this.recentPositions[rLen - 3];
        if (p2.x === nextPos.x && p2.y === nextPos.y) {
          penalty += 70;
        }
      }
      if (rLen >= 4) {
        // 3ターン前
        const p3 = this.recentPositions[rLen - 4];
        if (p3.x === nextPos.x && p3.y === nextPos.y) {
          penalty += 35;
        }
      }
      if (rLen >= 5) {
        // 4ターン前
        const p4 = this.recentPositions[rLen - 5];
        if (p4.x === nextPos.x && p4.y === nextPos.y) {
          penalty += 15;
        }
      }

      // 現在の進行方向と真逆（180度反転）へのUターン抑止ペナルティ
      if (player.dir && this.isOppositeDirection(player.dir, dir)) {
        penalty += 50;
      }

      if (this.recentEvadedTile && nextPos.x === this.recentEvadedTile.x && nextPos.y === this.recentEvadedTile.y) {
        penalty += 100;
      }

      if (map.getBaseTile(nextPos) === 'WARP') {
        penalty += 80;
        if (this.isWarpTaboo(nextPos)) penalty += 300;
      }

      if (dir === player.dir) penalty -= 2; // 直進バイアス

      validMoves.push({ dir, penalty });
    }

    if (validMoves.length === 0) {
      if (MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying) {
        return { type: 'MAGIC', magic: 'RETURN' };
      }
      if (MagicSystem.canCast(player, 'FREEZE').allowed) {
        return { type: 'MAGIC', magic: 'FREEZE' };
      }
      return { type: 'WAIT' };
    }

    validMoves.sort((a, b) => a.penalty - b.penalty);
    return { type: 'MOVE', dir: validMoves[0].dir };
  }

  public findEvadeDirection(
    pos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    player: Player,
    dragon?: Dragon
  ): Direction | null {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const diagDirs: Direction[] = ['UP_LEFT', 'UP_RIGHT', 'DOWN_LEFT', 'DOWN_RIGHT'];
    const dirs = (player.canDiagonal || player.experience >= 12000) ? [...cardDirs, ...diagDirs] : cardDirs;

    const candidates: { dir: Direction; penalty: number }[] = [];

    for (const dir of dirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(pos, dir));
      if (map.getBaseTile(nextPos) === 'WALL_STATIC') continue;
      if (map.getObject(nextPos) !== 'NONE') continue;
      if (map.getBaseTile(nextPos) === 'GRAVE') continue;

      // 敵がいるマスは退避先にならない（体当たり攻撃になってその場に留まるため）
      const enemyOnTile = enemies.find(e => e.isAlive && e.pos.x === nextPos.x && e.pos.y === nextPos.y);
      if (enemyOnTile) continue;

      if (dragon && (dragon.getPartAt(nextPos) || this.isDragonFireLine(nextPos, dragon, map))) {
        continue;
      }

      const hasAdjacentEnemy = enemies.some(e => {
        if (!e.isAlive || e.isPermanentlyFrozen) return false;
        return map.getTorusDistance(nextPos, e.pos).manhattan === 1;
      });
      if (hasAdjacentEnemy) continue;

      let penalty = 0;
      // 直前マスへの逆戻り（ピンポン）抑止
      const rLen = this.recentPositions.length;
      if (rLen >= 2) {
        const lastP = this.recentPositions[rLen - 2];
        if (nextPos.x === lastP.x && nextPos.y === lastP.y) {
          penalty += 200;
        }
      }
      if (rLen >= 3) {
        const p2 = this.recentPositions[rLen - 3];
        if (nextPos.x === p2.x && nextPos.y === p2.y) {
          penalty += 100;
        }
      }

      candidates.push({ dir, penalty });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.penalty - b.penalty);
    return candidates[0].dir;
  }

  public isDragonFireLine(pos: Position, dragon: Dragon, map: WorldMap): boolean {
    for (const head of dragon.heads) {
      if (!head.isAlive) continue;
      if (dragon.canHeadSeePlayer(head, pos, map)) {
        return true;
      }
    }
    return false;
  }

  public isOppositeDirection(d1: Direction, d2: Direction): boolean {
    if ((d1 === 'UP' && d2 === 'DOWN') || (d1 === 'DOWN' && d2 === 'UP')) return true;
    if ((d1 === 'LEFT' && d2 === 'RIGHT') || (d1 === 'RIGHT' && d2 === 'LEFT')) return true;
    if ((d1 === 'UP_LEFT' && d2 === 'DOWN_RIGHT') || (d1 === 'DOWN_RIGHT' && d2 === 'UP_LEFT')) return true;
    if ((d1 === 'UP_RIGHT' && d2 === 'DOWN_LEFT') || (d1 === 'DOWN_LEFT' && d2 === 'UP_RIGHT')) return true;
    return false;
  }

  /**
   * 指定アイテムの距離順上位候補を取得（ヒステリシスボーナス対応）
   */
  public findNearestItemCandidates(
    from: Position,
    itemType: string,
    map: WorldMap,
    enemies?: EnemyInstance[],
    player?: Player,
    limit: number = 8,
    lockedPos?: Position | null
  ): Position[] {
    const candidates: { pos: Position; score: number }[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (this.isTargetUnreachable(p)) continue;
        if (map.getItem(p) === itemType) {
          if (enemies && player) {
            const enemy = enemies.find(e => e.isAlive && e.pos.x === x && e.pos.y === y);
            if (enemy) {
              const threat = ThreatEvaluator.evaluateThreat(player, enemy);
              if (threat !== 'ONE_SHOT' && threat !== 'SAFE') continue;
            }
          }
          const dist = map.getTorusDistance(from, p).manhattan;
          let score = dist;
          if (lockedPos && lockedPos.x === x && lockedPos.y === y) {
            score = Math.max(0, dist - 3); // ヒステリシスボーナス
          }
          candidates.push({ pos: p, score });
        }
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates.slice(0, limit).map(c => c.pos);
  }

  /**
   * 宝箱の距離順上位候補を取得（最適ゾーンボーナス＆ヒステリシス対応）
   */
  public findNearestChestCandidates(
    from: Position,
    map: WorldMap,
    context?: TacticalContext,
    enemies?: EnemyInstance[],
    player?: Player,
    limit: number = 8,
    lockedPos?: Position | null
  ): Position[] {
    const candidates: { pos: Position; score: number }[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (this.isTargetUnreachable(p)) continue;
        if (map.getObject(p) === 'CHEST') {
          if (enemies && player) {
            const enemy = enemies.find(e => e.isAlive && e.pos.x === x && e.pos.y === y);
            if (enemy) {
              const threat = ThreatEvaluator.evaluateThreat(player, enemy);
              if (threat !== 'ONE_SHOT' && threat !== 'SAFE') continue;
            }
          }
          const dist = map.getTorusDistance(from, p).manhattan;
          let score = dist;
          if (context && context.isInOptimalTreasureZone(p)) {
            score = Math.max(0, score - 6);
          }
          if (lockedPos && lockedPos.x === x && lockedPos.y === y) {
            score = Math.max(0, score - 3); // ヒステリシスボーナス
          }
          candidates.push({ pos: p, score });
        }
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates.slice(0, limit).map(c => c.pos);
  }
}
