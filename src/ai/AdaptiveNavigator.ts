import { Direction, Position } from '../models/Types.js';
import { WorldMap } from '../models/WorldMap.js';
import { Player } from '../models/Player.js';
import { EnemyInstance } from '../models/Enemy.js';
import { Dragon } from '../models/Dragon.js';
import { Ghost } from '../models/Ghost.js';
import { ThreatEvaluator } from '../systems/ThreatEvaluator.js';
import { MagicSystem } from '../systems/MagicSystem.js';
import { MovementSystem } from '../systems/MovementSystem.js';
import { BotAction, DynamicBotParameters } from './BotTypes.js';
import type { TacticalContext } from './TacticalContext.js';
import type { MapTacticalMetadata } from '../systems/generator/ThemeBlockTypes.js';
import type { EpisodicMemory } from './perception/EpisodicMemory.js';
import { CostMinHeap } from './utils/MinHeap.js';

export interface PathResult {
  dir: Direction;
  cost: number;
  steps: number;
}

export interface CirclingContext {
  enemy: EnemyInstance;
  obstacleType: 'BLOCK' | 'GRAVE' | 'WALL';
  obstaclePos: Position;
}

/**
 * AdaptiveNavigator
 *
 * トポロジー適応型BFS探索と、一元化されたスタック・ピンポン・周回ループ追跡器。
 * 複数のカウンタやブラックリストを単一の追跡モデルに統合し、
 * 動的パラメータに基づいて最適な安全経路を算出する。
 */
export class AdaptiveNavigator {
  // 1. ワープ往復防止タブー
  private recentWarpTiles: { pos: Position; turnsRemaining: number }[] = [];

  // 2. 危険ゾーン退避タイル記憶
  public recentEvadedTile: Position | null = null;
  public recentEvadedTurns: number = 0;

  constructor(private readonly memory?: EpisodicMemory) {}

  // ==========================================================================
  // 状態追跡 & ターン更新
  // ==========================================================================

  /**
   * 毎ターンの開始時にワープ・退避タイマーを減衰させる
   * （位置・ヒートマップ・新規マス追跡は EpisodicMemory / MovementLedger に一元化済み）
   */
  public updateTurn(_playerPos?: Position): void {
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
  }

  // ==========================================================================
  // タブー操作
  // ==========================================================================

  public recordWarpEvent(fromPos: Position, _toPos: Position): void {
    this.recentWarpTiles.push({ pos: { ...fromPos }, turnsRemaining: 12 });
  }

  public isWarpTaboo(pos: Position): boolean {
    return this.recentWarpTiles.some(w => w.pos.x === pos.x && w.pos.y === pos.y);
  }

  // ==========================================================================
  // 訪問ヒートマップ参照 & 障害物周回カルーセル検知
  // ==========================================================================

  /**
   * 指定座標の訪問熱量を取得
   */
  public getHeat(pos: Position): number {
    return this.memory?.movement.getHeat(pos) ?? 0;
  }

  /**
   * 指定座標の周囲（radius）の総熱量を取得
   */
  public getNeighborhoodHeat(pos: Position, map: WorldMap, radius: number = 1): number {
    return this.memory?.movement.getNeighborhoodHeat(pos, map, radius) ?? 0;
  }

  /**
   * 訪問ヒートマップと敵・障害物配置に基づくカルーセル（周回ループ）状態の検知
   *
   * 条件:
   * 1. プレイヤー現在地の熱量 >= 12 かつ 周辺8マスの総熱量 >= 35 (同一局所エリアの連続周回)
   * 2. プレイヤーの直角隣接（距離1）に障害物（BLOCK または GRAVE）が存在する
   * 3. その障害物の周囲（距離1〜2以内、かつプレイヤーから距離1〜3）に未凍結の生存敵が存在する
   */
  public detectObstacleCircling(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[]
  ): CirclingContext | null {
    const curPos = player.pos;
    const curHeat = this.getHeat(curPos);
    const neighborhoodHeat = this.getNeighborhoodHeat(curPos, map, 1);

    // 熱量閾値チェック
    if (curHeat < 12 || neighborhoodHeat < 35) {
      return null;
    }

    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

    // 直角隣接する障害物（BLOCK または GRAVE）を探す
    for (const dir of cardDirs) {
      const obsPos = map.wrapPosition(MovementSystem.getNextPosition(curPos, dir));
      const obj = map.getObject(obsPos);
      const isBlock = obj === 'BLOCK';
      const isGrave = obj === 'GRAVE';

      if (!isBlock && !isGrave) continue;

      // その障害物の周囲にいる未凍結・未スタンの生存敵を探す
      for (const enemy of enemies) {
        if (!enemy.isAlive || enemy.isPermanentlyFrozen || enemy.frozenTimer > 0) continue;
        const distFromObs = map.getTorusDistance(obsPos, enemy.pos).manhattan;
        const distFromPlayer = map.getTorusDistance(curPos, enemy.pos).manhattan;

        if (distFromObs <= 2 && distFromPlayer >= 1 && distFromPlayer <= 3) {
          return {
            enemy,
            obstacleType: isBlock ? 'BLOCK' : 'GRAVE',
            obstaclePos: obsPos,
          };
        }
      }
    }

    return null;
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
      context?: TacticalContext;
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
      context?: TacticalContext;
    }
  ): PathResult | null {
    if (!from || !to) return null;
    if (from.x === to.x && from.y === to.y) return null;

    const dragon = options?.dragon;
    const isEscapePhase = options?.isEscapePhase ?? false;
    const ghosts = options?.ghosts;

    // 敵マスの高速判定マップ & 段階的危険コストマップ (O(1) ルックアップ)
    const enemyTileMap = new Map<string, EnemyInstance>();
    const threatDangerCosts = new Map<string, number>();
    const lethalOrthogonalZones = new Set<string>();
    const lethalAdjacentDiagZones = new Set<string>();
    const lethalChebyshevZones = new Set<string>();
    const effectiveDef = Math.floor(player.experience * 1.0);

    for (const e of enemies) {
      if (!e.isAlive) continue;
      enemyTileMap.set(`${e.pos.x},${e.pos.y}`, e);

      if (!e.isPermanentlyFrozen && e.frozenTimer <= 0) {
        if (to && e.pos.x === to.x && e.pos.y === to.y) continue;

        const details = ThreatEvaluator.evaluateThreatDetails(player, e);
        const rawDmg = details.damageToPlayer;
        const isTwoShotWithCrown = player.holdItem === 'CROWN' && rawDmg >= player.hp * 0.45;
        const isLethal = rawDmg >= player.hp || isTwoShotWithCrown || details.overallThreat === 'LETHAL';

        if (isLethal) {
          const cardDeltas = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
          for (const cd of cardDeltas) {
            const p = map.wrapPosition({ x: e.pos.x + cd.dx, y: e.pos.y + cd.dy });
            lethalOrthogonalZones.add(`${p.x},${p.y}`);
          }
          const diagAdjacentDeltas = [
            { dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
          ];
          for (const dd of diagAdjacentDeltas) {
            const p = map.wrapPosition({ x: e.pos.x + dd.dx, y: e.pos.y + dd.dy });
            lethalAdjacentDiagZones.add(`${p.x},${p.y}`);
          }
          // チェビシェフ距離2の外周16マス（敵が1歩動いて直角隣接になりうる危険マス）
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) {
                const p = map.wrapPosition({ x: e.pos.x + dx, y: e.pos.y + dy });
                lethalChebyshevZones.add(`${p.x},${p.y}`);
              }
            }
          }
          continue;
        }

        // 非致死敵の周囲8マスに対する段階的・連続的な脅威コスト算出
        let enemyZoneCost = 0;
        const cannotDefeat = details.overallThreat === 'STALEMATE' || details.turnsToKill > 8;
        if (rawDmg > 0 || details.hasDrain) {
          const hpRatio = player.hp > 0 ? Math.min(1, rawDmg / player.hp) : 1;
          const baseScale = isEscapePhase ? 1200 : 800;
          const dangerBonus =
            hpRatio >= params.dangerHpRatio
              ? (isEscapePhase ? 300 : 250)
              : 0;
          const drainBonus = details.hasDrain ? 100 : 0;
          const cannotDefeatBonus = (!isEscapePhase && cannotDefeat) ? 100 : 0;
          const minCost = isEscapePhase ? 25 : 15;
          enemyZoneCost = Math.max(
            minCost,
            Math.round(hpRatio * baseScale) + dangerBonus + drainBonus + cannotDefeatBonus
          );
        } else if (cannotDefeat) {
          // 被ダメ0だが硬くて倒しにくい敵は、進路妨害・中盤スタックを避けるため迂回コストを付与
          enemyZoneCost = isEscapePhase ? 80 : 120;
        }

        if (enemyZoneCost > 0) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const p = map.wrapPosition({ x: e.pos.x + dx, y: e.pos.y + dy });
              const zoneKey = `${p.x},${p.y}`;
              threatDangerCosts.set(zoneKey, (threatDangerCosts.get(zoneKey) ?? 0) + enemyZoneCost);
            }
          }
        }
      }
    }

    const queue = new CostMinHeap<{ pos: Position; firstDir: Direction | null; cost: number; steps: number }>();
    queue.push({ pos: from, firstDir: null, cost: 0, steps: 0 }, 0);
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
      const current = queue.pop()!;
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
          // 墓封鎖ブロックは BREAK による破壊および一般通行から保護（通過不可）
          if (AdaptiveNavigator.isProtectedGraveBlock(nextPos, map, options?.context?.metadata)) {
            continue;
          }

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

        // ドラゴン部位・ファイアボール・ブレス射線回避
        if (dragon) {
          if (dragon.getPartAt(nextPos)) continue;
          if (dragon.heads.some(h => h.isAlive && map.getTorusDistance(nextPos, h.pos).manhattan === 1)) continue;
          if (dragon.fireballs && dragon.fireballs.length > 0) {
            const willHitFireball = dragon.fireballs.some(fb => {
              if (!fb.isAlive) return false;
              if (fb.pos.x === nextPos.x && fb.pos.y === nextPos.y) return true;
              const nextFb = map.wrapPosition(MovementSystem.getNextPosition(fb.pos, fb.dir));
              return nextFb.x === nextPos.x && nextFb.y === nextPos.y;
            });
            if (willHitFireball) continue;
          }
          // 首の正面至近（2マス以内）は発射と同時に被弾するため完全進入禁止
          if (this.isDragonFireLineClose(nextPos, dragon, map, 2)) continue;

          // それ以外の遠距離射線は完全進入禁止ではなくソフトペナルティ（迂回優先だが横切りを許容）
          if (this.isDragonFireLine(nextPos, dragon, map)) {
            stepCost += 10;
          }
        }

        // 敵マス進入判定
        const enemyOnTile = enemyTileMap.get(key);
        if (enemyOnTile) {
          if (player.holdItem === 'CROSS' || d.dir.includes('_')) continue;
          const threatDetails = ThreatEvaluator.evaluateThreatDetails(player, enemyOnTile);
          const threat = threatDetails.overallThreat;
          const isFrozenEnemy = enemyOnTile.isPermanentlyFrozen || (enemyOnTile.frozenTimer ?? 0) > 0;
          const isHeadingToHome = to && (map.getBaseTile(to) === 'HOME' || (to.x === map.realHomePos.x && to.y === map.realHomePos.y));

          if (player.holdItem === 'CROWN' && threat !== 'ONE_SHOT') {
            // 我が家への帰還進路上、または我が家マスの上にいる凍結敵は反撃ダメージ0のため攻撃突破を特別許可
            if (isFrozenEnemy && isHeadingToHome) {
              stepCost += 10;
            } else {
              continue;
            }
          }
          // 初手で敵を撃破する場合、プレイヤーはその場に留まるため他に即死敵が隣接していたら攻撃不可
          if (current.firstDir === null) {
            const hasOtherLethalAtFrom = enemies.some(e => {
              if (!e.isAlive || e.isPermanentlyFrozen || e.frozenTimer > 0 || e.id === enemyOnTile.id) return false;
              if (map.getTorusDistance(from, e.pos).manhattan !== 1) return false;
              return Math.max(0, e.atk - effectiveDef) >= player.hp;
            });
            if (hasOtherLethalAtFrom) continue;
          }
          if (player.hp < player.maxHp * params.emergencyHpRatio && threat !== 'ONE_SHOT' && !(nextPos.x === to.x && nextPos.y === to.y)) {
            if (!(isFrozenEnemy && isHeadingToHome)) continue;
          }

          // 安全撃破可能敵（被ダメ0 かつ 短手数で撃破可能）の突破判定
          const canBreakthrough = (threatDetails.defenseThreat === 'NO_DAMAGE' && threatDetails.turnsToKill <= 8) || (isFrozenEnemy && isHeadingToHome);

          if (nextPos.x === to.x && nextPos.y === to.y) {
            if (threat !== 'ONE_SHOT' && threat !== 'SAFE' && !canBreakthrough && threatDetails.defenseThreat !== 'NO_DAMAGE') continue;
          } else {
            if (threat !== 'ONE_SHOT' && !canBreakthrough) continue;
          }

          if (canBreakthrough && threat !== 'ONE_SHOT') {
            stepCost += (threatDetails.turnsToKill ?? 1) * 5;
          }
        }

        // 即死敵の周囲（直角隣接および斜め隣接＝周囲8マス）への飛び込み禁止（敵の追尾攻撃による即死を防ぐ）
        const isTargetHome = to && (map.getBaseTile(to) === 'HOME' || (to.x === map.realHomePos.x && to.y === map.realHomePos.y)) && nextPos.x === to.x && nextPos.y === to.y;
        if ((lethalOrthogonalZones.has(key) || lethalAdjacentDiagZones.has(key)) && !enemyTileMap.has(key) && !isTargetHome) {
          continue;
        }

        if (lethalChebyshevZones.has(key) && !enemyTileMap.has(key) && !isTargetHome) {
          stepCost += (player.holdItem === 'CROWN' || isEscapePhase) ? 50000 : 5000;
        }

        const dangerZoneCost = threatDangerCosts.get(key);
        if (dangerZoneCost !== undefined && !enemyTileMap.has(key) && !(nextPos.x === to.x && nextPos.y === to.y)) {
          stepCost += dangerZoneCost;
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

        // 直前マスへの逆戻り抑制:
        // recentPositions の末尾 (rLen - 1) は現在地 player.pos
        // 1手前の座標 (rLen - 2) への逆戻りには +100、2手前の座標 (rLen - 3) には +50 のペナルティ
        if (!(nextPos.x === to.x && nextPos.y === to.y) && current.firstDir === null) {
          const recentPositions = this.memory?.movement.getRecentPositions(4) ?? [];
          const rLen = recentPositions.length;
          if (rLen >= 2) {
            const prev1 = recentPositions[rLen - 2];
            if (nextPos.x === prev1.x && nextPos.y === prev1.y) {
              stepCost += 100;
            }
          }
          if (rLen >= 3) {
            const prev2 = recentPositions[rLen - 3];
            if (nextPos.x === prev2.x && nextPos.y === prev2.y) {
              stepCost += 50;
            }
          }
        }

        // 訪問ヒートマップによる反発は最短経路探索を歪めて大回りを引き起こすため、
        // 移動ナビゲーションの findPath では加算せず、停滞・周回検知（認知層）のみで利用する

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

        queue.push(item, newCost);
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
  ): BotAction {
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
        if (dragon.heads.some(h => h.isAlive && map.getTorusDistance(nextPos, h.pos).manhattan === 1)) continue;
        if (this.isDragonFireLineClose(nextPos, dragon, map, 2)) continue;
        if (dragon.fireballs && dragon.fireballs.length > 0) {
          const willHit = dragon.fireballs.some(fb => {
            if (!fb.isAlive) return false;
            if (fb.pos.x === nextPos.x && fb.pos.y === nextPos.y) return true;
            const nextFb = map.wrapPosition(MovementSystem.getNextPosition(fb.pos, fb.dir));
            return nextFb.x === nextPos.x && nextFb.y === nextPos.y;
          });
          if (willHit) continue;
        }
      }

      const enemy = enemies.find(e => e.isAlive && e.pos.x === nextPos.x && e.pos.y === nextPos.y);
      if (enemy) {
        if (dir.includes('_')) continue;
        if (ThreatEvaluator.evaluateThreat(player, enemy) !== 'ONE_SHOT') continue;
      }

      // 即死敵の直角隣接マスへの飛び込み禁止（スタン・永久凍結中は行動不能のため除外）
      const hasAdjacentLethalEnemy = enemies.some(e => {
        if (!e.isAlive || e.isPermanentlyFrozen || e.frozenTimer > 0) return false;
        const d = map.getTorusDistance(nextPos, e.pos).manhattan;
        if (d !== 1) return false;
        const rawDmg = Math.max(0, e.atk - player.experience);
        return rawDmg >= player.hp || ThreatEvaluator.evaluateThreat(player, e) === 'LETHAL';
      });
      if (hasAdjacentLethalEnemy) continue;

      let penalty = 0;
      if (isBlock) penalty += 30;
      if (dragon && this.isDragonFireLine(nextPos, dragon, map)) penalty += 80;

      // 直近訪問履歴に対する段階的再訪ペナルティ
      const recentPositions = this.memory?.movement.getRecentPositions(6) ?? [];
      const rLen = recentPositions.length;
      if (rLen >= 2) {
        // 1ターン前 (直前マス): 180度Uターン・往復を強力に抑止
        const p1 = recentPositions[rLen - 2];
        if (p1.x === nextPos.x && p1.y === nextPos.y) {
          penalty += 140;
        }
      }
      if (rLen >= 3) {
        // 2ターン前
        const p2 = recentPositions[rLen - 3];
        if (p2.x === nextPos.x && p2.y === nextPos.y) {
          penalty += 70;
        }
      }
      if (rLen >= 4) {
        // 3ターン前
        const p3 = recentPositions[rLen - 4];
        if (p3.x === nextPos.x && p3.y === nextPos.y) {
          penalty += 35;
        }
      }
      if (rLen >= 5) {
        // 4ターン前
        const p4 = recentPositions[rLen - 5];
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
      if (MagicSystem.canCast(player, 'JUMP').allowed) {
        return { type: 'MAGIC', magic: 'JUMP' };
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

      if (dragon) {
        if (dragon.getPartAt(nextPos)) continue;
        if (this.isDragonFireLineClose(nextPos, dragon, map, 2)) continue;
        if (dragon.fireballs && dragon.fireballs.length > 0) {
          const willHit = dragon.fireballs.some(fb => {
            if (!fb.isAlive) return false;
            if (fb.pos.x === nextPos.x && fb.pos.y === nextPos.y) return true;
            const nextFb = map.wrapPosition(MovementSystem.getNextPosition(fb.pos, fb.dir));
            return nextFb.x === nextPos.x && nextFb.y === nextPos.y;
          });
          if (willHit) continue;
        }
      }

      // 我が家（指輪非所持時）は絶対安全地帯なので最優先退避先
      if (map.getBaseTile(nextPos) === 'HOME' && player.holdItem !== 'RING') {
        return dir;
      }

      let hasLethalOrthogonal = false;
      let enemyPenalty = 0;

      for (const e of enemies) {
        if (!e.isAlive || e.isPermanentlyFrozen || e.frozenTimer > 0) continue;
        const dist = map.getTorusDistance(nextPos, e.pos);
        if (dist.chebyshev > 1) continue;
        const details = ThreatEvaluator.evaluateThreatDetails(player, e);
        const rawDmg = details.damageToPlayer;
        const isTwoShotWithCrown = player.holdItem === 'CROWN' && rawDmg >= player.hp * 0.45;
        const isLethal = rawDmg >= player.hp || isTwoShotWithCrown || details.overallThreat === 'LETHAL';

        if (dist.manhattan === 1) {
          if (isLethal) {
            hasLethalOrthogonal = true;
            break;
          }
          if (rawDmg === 0 && !details.hasDrain) {
            enemyPenalty += 30;
          } else {
            const hpRatio = player.hp > 0 ? Math.min(1, rawDmg / player.hp) : 1;
            const drainBonus = details.hasDrain ? 150 : 0;
            const dangerBonus = hpRatio >= 0.30 ? 200 : 30;
            enemyPenalty += Math.round(hpRatio * 1000) + drainBonus + dangerBonus;
          }
        } else if (dist.chebyshev === 1) {
          if (isLethal) {
            enemyPenalty += 400;
          } else if (rawDmg > 0 || details.hasDrain) {
            const hpRatio = player.hp > 0 ? Math.min(1, rawDmg / player.hp) : 1;
            const drainBonus = details.hasDrain ? 80 : 0;
            const dangerBonus = hpRatio >= 0.30 ? 100 : 0;
            enemyPenalty += Math.round(hpRatio * 500) + drainBonus + dangerBonus;
          }
        }
      }
      if (hasLethalOrthogonal) continue;
      if (dragon && this.isDragonFireLine(nextPos, dragon, map)) enemyPenalty += 60;

      let penalty = enemyPenalty;
      if (player.holdItem === 'CROWN') {
        penalty += map.getTorusDistance(nextPos, map.realHomePos).manhattan * 3;
      }
      // 直前マスへの逆戻り（ピンポン）抑止
      const recentPositions = this.memory?.movement.getRecentPositions(4) ?? [];
      const rLen = recentPositions.length;
      if (rLen >= 2) {
        const lastP = recentPositions[rLen - 2];
        if (nextPos.x === lastP.x && nextPos.y === lastP.y) {
          penalty += 200;
        }
      }
      if (rLen >= 3) {
        const p2 = recentPositions[rLen - 3];
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
    if (!dragon || !dragon.heads) return false;
    for (const head of dragon.heads) {
      if (!head.isAlive) continue;
      if (dragon.canHeadSeePlayer(head, pos, map)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 首の正面射線のうち、至近距離（maxRangeマス以内）にあるか判定（発射即被弾の危険ゾーン）
   */
  public isDragonFireLineClose(pos: Position, dragon: Dragon, map: WorldMap, maxRange: number = 2): boolean {
    if (!dragon || !dragon.heads) return false;
    for (const head of dragon.heads) {
      if (!head.isAlive) continue;
      const d = map.getTorusDistance(pos, head.pos).manhattan;
      if (d <= maxRange && dragon.canHeadSeePlayer(head, pos, map)) {
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
    lockedPos?: Position | null,
    memory?: EpisodicMemory,
    totalTurns: number = 0
  ): Position[] {
    const candidates: { pos: Position; score: number }[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (memory?.isTargetUnreachable(p, totalTurns)) continue;
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
            score = Math.max(0, dist - 20); // 強力なヒステリシスボーナス（渦巻き通路での浮気・ループ防止）
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
    lockedPos?: Position | null,
    memory?: EpisodicMemory,
    totalTurns: number = 0
  ): Position[] {
    const candidates: { pos: Position; score: number }[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (memory?.isTargetUnreachable(p, totalTurns)) continue;
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
            score = Math.max(0, score - 20); // 強力なヒステリシスボーナス（渦巻き通路での浮気・ループ防止）
          }
          candidates.push({ pos: p, score });
        }
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates.slice(0, limit).map(c => c.pos);
  }

  public clearPositionHistory(): void {
    this.memory?.clearPositionHistory();
  }

  public getAdjacentDirection(from: Position, to: Position, map: WorldMap): Direction | null {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    for (const dir of cardDirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(from, dir));
      if (nextPos.x === to.x && nextPos.y === to.y) {
        return dir;
      }
    }
    return null;
  }

  public get8WayAdjacentDirection(from: Position, to: Position, map: WorldMap): Direction | null {
    const allDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT', 'UP_LEFT', 'UP_RIGHT', 'DOWN_LEFT', 'DOWN_RIGHT'];
    for (const dir of allDirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(from, dir));
      if (nextPos.x === to.x && nextPos.y === to.y) {
        return dir;
      }
    }
    return null;
  }

  public getAdjacentEnemies(
    pos: Position,
    enemies: EnemyInstance[],
    map: WorldMap
  ): { enemy: EnemyInstance; dir: Direction }[] {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const results: { enemy: EnemyInstance; dir: Direction }[] = [];
    for (const d of cardDirs) {
      const nextP = map.wrapPosition(MovementSystem.getNextPosition(pos, d));
      const e = enemies.find(enemy => enemy.isAlive && enemy.pos.x === nextP.x && enemy.pos.y === nextP.y);
      if (e) {
        results.push({ enemy: e, dir: d });
      }
    }
    return results;
  }

  /**
   * 墓封鎖用ブロック（墓周囲8マス、またはメタデータの封鎖ターゲット／推奨岩押しブロック）か判定
   */
  public static isProtectedGraveBlock(
    pos: Position,
    map: WorldMap,
    metadata?: MapTacticalMetadata
  ): boolean {
    if (map.getObject(pos) !== 'BLOCK') {
      return false;
    }

    // 1. 墓（GRAVE）の周囲8マス判定 (トーラス循環考慮)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const neighbor = map.wrapPosition({ x: pos.x + dx, y: pos.y + dy });
        if (map.getBaseTile(neighbor) === 'GRAVE') {
          return true;
        }
      }
    }

    // 2. メタデータ (gravePuzzleHints) による保護判定
    const hints = metadata?.gravePuzzleHints ?? map.tacticalMetadata?.gravePuzzleHints;
    if (hints && hints.length > 0) {
      for (const hint of hints) {
        if (hint.sealTargetPositions) {
          for (const target of hint.sealTargetPositions) {
            if (pos.x === target.x && pos.y === target.y) {
              return true;
            }
          }
        }
        if (hint.recommendedPushes) {
          for (const push of hint.recommendedPushes) {
            if (
              (pos.x === push.blockPos.x && pos.y === push.blockPos.y) ||
              (pos.x === push.destinationPos.x && pos.y === push.destinationPos.y)
            ) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * 手持ちアイテムを安全に置くための隣接空きマスを探す
   */
  public findAdjacentDropTile(
    pos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon?: Dragon,
    player?: Player
  ): Direction | null {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    for (const d of cardDirs) {
      const p = map.wrapPosition(MovementSystem.getNextPosition(pos, d));
      if (map.getBaseTile(p) === 'WALL_STATIC') continue;
      if (map.getBaseTile(p) === 'GRAVE') continue;
      if (map.getBaseTile(p) === 'WARP') continue;
      if (map.getBaseTile(p) === 'HOME') continue;
      if (map.getObject(p) !== 'NONE') continue;
      if (map.getItem(p) !== 'NONE') continue;
      if (dragon && (dragon.getPartAt(p) || this.isDragonFireLine(p, dragon, map))) continue;

      const onEnemy = enemies.find(e => e.isAlive && e.pos.x === p.x && e.pos.y === p.y);
      if (onEnemy) continue;

      if (player) {
        const dangerousAdj = enemies.some(e => {
          if (!e.isAlive || e.isPermanentlyFrozen || e.frozenTimer > 0) return false;
          if (map.getTorusDistance(p, e.pos).chebyshev > 1) return false;
          const threat = ThreatEvaluator.evaluateThreat(player, e);
          return threat === 'LETHAL' || threat === 'DANGER';
        });
        if (dangerousAdj) continue;
      }

      return d;
    }
    return null;
  }
}
