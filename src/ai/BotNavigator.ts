import { Direction, Position, TileType } from '../models/Types.js';
import { WorldMap } from '../models/WorldMap.js';
import { Player } from '../models/Player.js';
import { EnemyInstance } from '../models/Enemy.js';
import { Dragon } from '../models/Dragon.js';
import { Ghost } from '../models/Ghost.js';
import { ThreatEvaluator } from '../systems/ThreatEvaluator.js';
import { MagicSystem } from '../systems/MagicSystem.js';
import { MovementSystem } from '../systems/MovementSystem.js';
import { BotAction, BotPhase } from './BotTypes.js';
import { MapTacticalMetadata } from '../systems/generator/ThemeBlockTypes.js';

export interface NavigatorItemLockInfo {
  lockedChestPos?: Position | null;
  lockedItemPos?: Position | null;
  lockedItemType?: TileType;
  hysteresisBonus?: number;
  tacticalMetadata?: MapTacticalMetadata;
}

export interface BfsPathResult {
  dir: Direction;
  cost: number;
  steps: number;
}

export class BotNavigator {
  // 到達不能ターゲット・ブラックリスト（座標キー "x,y" => 残り除外ターン数）
  private unreachableTargets: Map<string, number> = new Map();
  public readonly DEFAULT_UNREACHABLE_TURNS: number = 30;

  // ワープ往復（ピンポン現象）防止用のワープタブーリスト
  private recentWarpTiles: { pos: Position; turnsRemaining: number }[] = [];

  // ピンポン往復防止用の直近訪問座標履歴（タブーリスト）
  public recentPositions: Position[] = [];
  public oscillationCount: number = 0;

  // 危険ゾーン退避タイルのタブー記憶
  public recentEvadedTile: Position | null = null;
  public recentEvadedTurns: number = 0;

  // 自走検証モード等での強制安全徘徊脱出フラグ
  public forceWanderNextTurn: boolean = false;

  // ==========================================================================
  // 到達不能ターゲット・ブラックリスト管理
  // ==========================================================================

  public isTargetUnreachable(pos: Position): boolean {
    const key = `${pos.x},${pos.y}`;
    const remaining = this.unreachableTargets.get(key);
    return remaining !== undefined && remaining > 0;
  }

  public markTargetUnreachable(pos: Position, turns: number = this.DEFAULT_UNREACHABLE_TURNS): void {
    const key = `${pos.x},${pos.y}`;
    this.unreachableTargets.set(key, turns);
  }

  public clearUnreachableTargets(): void {
    this.unreachableTargets.clear();
  }

  public getUnreachableCount(): number {
    return this.unreachableTargets.size;
  }

  public updateUnreachableTargets(): void {
    for (const [key, remaining] of this.unreachableTargets.entries()) {
      if (remaining <= 1) {
        this.unreachableTargets.delete(key);
      } else {
        this.unreachableTargets.set(key, remaining - 1);
      }
    }
  }

  // ==========================================================================
  // ワープタブー管理
  // ==========================================================================

  public updateWarpTaboos(): void {
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

  public recordWarpEvent(fromPos: Position, toPos: Position): void {
    this.addWarpTaboo(fromPos, 12);
    this.addWarpTaboo(toPos, 8);
  }

  public addWarpTaboo(pos: Position, turns: number): void {
    const existing = this.recentWarpTiles.find(w => w.pos.x === pos.x && w.pos.y === pos.y);
    if (existing) {
      existing.turnsRemaining = Math.max(existing.turnsRemaining, turns);
    } else {
      this.recentWarpTiles.push({ pos: { ...pos }, turnsRemaining: turns });
    }
  }

  public isWarpTaboo(pos: Position): boolean {
    return this.recentWarpTiles.some(w => w.pos.x === pos.x && w.pos.y === pos.y);
  }

  // ==========================================================================
  // 位置履歴・ピンポン管理
  // ==========================================================================

  public recordPosition(pos: Position): void {
    this.recentPositions.push({ ...pos });
    if (this.recentPositions.length > 16) {
      this.recentPositions.shift();
    }
  }

  public clearPositionHistory(): void {
    this.recentPositions = [];
    this.oscillationCount = 0;
  }

  // ==========================================================================
  // 経路探索 (BFS)
  // ==========================================================================

  public findPath(
    from: Position,
    to: Position,
    map: WorldMap,
    player: Player,
    enemies: EnemyInstance[],
    allowDiagonal: boolean = false,
    dragon?: Dragon,
    extraBlocked?: Position[],
    currentPhase?: BotPhase,
    ghosts?: Ghost[]
  ): Direction | null {
    if (!from || !to) return null;

    // ブラックリストに登録された到達不能目標なら即座にスキップ（BFSコスト完全ゼロ）
    if (!extraBlocked && this.isTargetUnreachable(to)) return null;

    const canBreak = MagicSystem.canCast(player, 'BREAK').allowed;
    const canKick = MagicSystem.canCast(player, 'KICK').allowed;
    const canBreakOrKick = canBreak || (canKick && player.experience >= 3000);

    // 1. 通常の床のみで探索
    const normalResult = this.executeBfsDetailed(from, to, map, player, enemies, allowDiagonal, dragon, false, extraBlocked, currentPhase, ghosts);

    // 2. BREAK または KICK が可能なら、ブロック通過可能ルートも探索
    let breakResult: BfsPathResult | null = null;
    if (canBreakOrKick) {
      const manhattanDist = map.getTorusDistance(from, to).manhattan;
      // 通常経路がない場合は必ず探索。
      // 通常経路がある場合でも、直線距離に比べて8歩以上迂回している場合はBREAK探索を行って比較
      const isDetour = !normalResult || (normalResult.steps - manhattanDist >= 8);
      if (isDetour) {
        breakResult = this.executeBfsDetailed(from, to, map, player, enemies, allowDiagonal, dragon, true, extraBlocked, currentPhase, ghosts);
      }
    }

    // 3. 最適経路の選定
    if (!normalResult && breakResult) {
      return breakResult.dir;
    }

    if (normalResult && breakResult) {
      const manhattanDist = map.getTorusDistance(from, to).manhattan;
      // ショートカット判定: 通常経路がマンハッタン距離より8歩以上迂回しており、
      // かつ BREAK 経路の方がコストまたは歩数が大幅に短い場合、積極的に壁を掘る
      const isSignificantShortcut = (normalResult.steps - manhattanDist >= 8 || normalResult.steps >= breakResult.steps + 4) &&
                                    (breakResult.cost < normalResult.cost);
      if (isSignificantShortcut) {
        return breakResult.dir;
      }
      return normalResult.dir;
    }

    if (normalResult) return normalResult.dir;

    // 通常でもBREAKでも到達不能と判明した目標はブラックリストへ自動登録（特定迂回指定時を除く）
    if (!extraBlocked && map.getItem(to) !== 'CROWN') {
      this.markTargetUnreachable(to);
    }
    return null;
  }

  public executeBfs(
    from: Position,
    to: Position,
    map: WorldMap,
    player: Player,
    enemies: EnemyInstance[],
    allowDiagonal: boolean,
    dragon?: Dragon,
    allowBreak: boolean = false,
    extraBlocked?: Position[],
    currentPhase?: BotPhase,
    ghosts?: Ghost[]
  ): Direction | null {
    const res = this.executeBfsDetailed(from, to, map, player, enemies, allowDiagonal, dragon, allowBreak, extraBlocked, currentPhase, ghosts);
    return res ? res.dir : null;
  }

  public executeBfsDetailed(
    from: Position,
    to: Position,
    map: WorldMap,
    player: Player,
    enemies: EnemyInstance[],
    allowDiagonal: boolean,
    dragon?: Dragon,
    allowBreak: boolean = false,
    extraBlocked?: Position[],
    currentPhase?: BotPhase,
    ghosts?: Ghost[]
  ): BfsPathResult | null {
    if (!from || !to) return null;

    // 敵マスの高速判定マップ & 危険ゾーン（LETHAL/DANGER射程内）の事前セット化 (O(1) ルックアップ)
    const enemyTileMap = new Map<string, EnemyInstance>();
    const threatDangerZones = new Set<string>();
    const lethalOrthogonalZones = new Set<string>(); // マンハッタン距離1（敵の殴り射程）
    const lethalChebyshevZones = new Set<string>();  // 斜めマス
    const effectiveDef = Math.floor(player.experience * 1.0);

    for (const e of enemies) {
      if (!e.isAlive) continue;
      enemyTileMap.set(`${e.pos.x},${e.pos.y}`, e);

      if (!e.isPermanentlyFrozen) {
        // 目標地点がこの敵自身である場合、この敵の周囲を進入禁止にすると接近撃破できなくなるため除外
        if (to && e.pos.x === to.x && e.pos.y === to.y) {
          continue;
        }
        const rawDmg = Math.max(0, e.atk - effectiveDef);
        const isLethal = rawDmg >= player.hp || ThreatEvaluator.evaluateThreat(player, e) === 'LETHAL';
        const isDangerous = isLethal || rawDmg >= player.hp * 0.4 || rawDmg >= 10000 || (player.holdItem === 'CROWN' && rawDmg > 0);

        if (isLethal) {
          // 直角隣接4マス（敵の攻撃射程）
          const cardDeltas = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
          for (const cd of cardDeltas) {
            const p = map.wrapPosition({ x: e.pos.x + cd.dx, y: e.pos.y + cd.dy });
            lethalOrthogonalZones.add(`${p.x},${p.y}`);
          }
          // 斜め4マス
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

    const dirs = allowDiagonal && player.experience >= 12000 ? [...cardDirs, ...diagDirs] : cardDirs;

    let steps = 0;
    while (queue.length > 0 && steps < 4500) {
      steps++;
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

        // 通行不可判定 (静的外壁)
        if (map.getBaseTile(nextPos) === 'WALL_STATIC') continue;

        // 特定の迂回指定マス（例: 家を勝手に押さないための我が家座標）
        if (extraBlocked && extraBlocked.some(p => p.x === nextPos.x && p.y === nextPos.y && !(to.x === nextPos.x && to.y === nextPos.y))) {
          continue;
        }

        // 通行不可判定 (墓: GRAVE はオブジェクトがない場合進入不可)
        if (map.getBaseTile(nextPos) === 'GRAVE' && map.getObject(nextPos) === 'NONE') {
          continue;
        }

        // ワープゾーン (WARP) の判定
        let actualNextPos = nextPos;
        const isWarpTile = map.getBaseTile(nextPos) === 'WARP';
        if (isWarpTile) {
          if (!(nextPos.x === to.x && nextPos.y === to.y)) {
            const warpDest = map.getWarpDestination(nextPos);
            if (warpDest) {
              actualNextPos = warpDest;
            }
          }
        }
        const key = `${actualNextPos.x},${actualNextPos.y}`;

        // ブロック (BLOCK) の判定
        let stepCost = 1;

        if (isWarpTile && !(nextPos.x === to.x && nextPos.y === to.y)) {
          stepCost += 20;
          if (this.isWarpTaboo(nextPos) || this.isWarpTaboo(actualNextPos)) {
            stepCost += 500;
          }
        }
        const obj = map.getObject(nextPos);
        if (obj === 'BLOCK') {
          if (allowBreak) {
            stepCost = 3;
          } else if (player.holdItem === 'RING') {
            const pushDest = map.wrapPosition({
              x: nextPos.x + d.dx,
              y: nextPos.y + d.dy,
            });
            if (map.isPushDestinationValid(pushDest, enemies)) {
              stepCost = 3;
            } else {
              continue;
            }
          } else {
            continue;
          }
        }

        // ドラゴンの全盲点・全部位回避 (BODY, TAIL, 生存HEADすべて)
        if (dragon) {
          const part = dragon.getPartAt(nextPos);
          if (part) {
            continue;
          }
          const isOrthogonalToHead = dragon.heads.some(h => {
            if (!h.isAlive) return false;
            return map.getTorusDistance(nextPos, h.pos).manhattan === 1;
          });
          if (isOrthogonalToHead) {
            continue;
          }
          if (dragon.fireballs && dragon.fireballs.length > 0) {
            const willHitFireball = dragon.fireballs.some(fb => {
              if (!fb.isAlive) return false;
              if (fb.pos.x === nextPos.x && fb.pos.y === nextPos.y) return true;
              const nextFb = map.wrapPosition(MovementSystem.getNextPosition(fb.pos, fb.dir));
              return nextFb.x === nextPos.x && nextFb.y === nextPos.y;
            });
            if (willHitFireball) continue;
          }
          if (this.isDragonFireLine(nextPos, dragon, map)) {
            continue;
          }
        }

        // 敵がいるマスの通行判定
        const enemyOnTile = enemyTileMap.get(key);
        if (enemyOnTile) {
          if (player.holdItem === 'CROWN') {
            continue;
          }

          if (d.dir.includes('_')) {
            continue;
          }

          const threat = ThreatEvaluator.evaluateThreat(player, enemyOnTile);

          if (player.hp < player.maxHp * 0.5 && threat !== 'ONE_SHOT' && !(nextPos.x === to.x && nextPos.y === to.y)) {
            continue;
          }

          if (nextPos.x === to.x && nextPos.y === to.y) {
            if (threat !== 'ONE_SHOT' && threat !== 'SAFE') continue;
          } else {
            if (threat !== 'ONE_SHOT') continue;
          }
        }

        // 即死敵の直角隣接（即時殴打被弾マス）への自爆飛び込みは絶対に禁止！
        if (lethalOrthogonalZones.has(key) && !enemyTileMap.has(key) && !(nextPos.x === to.x && nextPos.y === to.y)) {
          const isCurInOrthogonal = lethalOrthogonalZones.has(`${from.x},${from.y}`);
          if (!isCurInOrthogonal) {
            continue; // 現在地が直角隣接マスでなければ絶対に飛び込まない！
          } else {
            stepCost += 5000;
          }
        }

        // 即死敵の斜め隣接マスへの迂回ペナルティ
        if (lethalChebyshevZones.has(key) && !enemyTileMap.has(key) && !(nextPos.x === to.x && nextPos.y === to.y)) {
          stepCost += 2000;
        }

        // 高危険度（DANGER）の敵の隣接マスへの迂回・進入禁止
        if (threatDangerZones.has(key) && !enemyTileMap.has(key) && !(nextPos.x === to.x && nextPos.y === to.y)) {
          if (current.firstDir === null) {
            const isCurInDanger = threatDangerZones.has(`${from.x},${from.y}`);
            if (!isCurInDanger) {
              if (currentPhase === 'CROWN_ESCAPE' || player.holdItem === 'CROWN') {
                stepCost += 1000;
              } else {
                continue;
              }
            } else {
              stepCost += 500;
            }
          } else {
            stepCost += (currentPhase === 'CROWN_ESCAPE' || player.holdItem === 'CROWN' ? 1000 : 300);
          }
        }

        // 直近の訪問マス（直前手）への逆戻りを抑制するペナルティ（ピンポン往復防止）
        if (ghosts && (currentPhase === 'CROWN_ESCAPE' || player.holdItem === 'CROWN')) {
          const isNearGhost = ghosts.some(g => {
            if (g.pos.x === nextPos.x && g.pos.y === nextPos.y) return true;
            const predX = (g.pos.x + g.vx + map.width) % map.width;
            const predY = (g.pos.y + g.vy + map.height) % map.height;
            return predX === nextPos.x && predY === nextPos.y;
          });
          if (isNearGhost) {
            stepCost += 5000;
          }
        }

        if (!(nextPos.x === to.x && nextPos.y === to.y) && current.firstDir === null) {
          const recentLen = this.recentPositions.length;
          if (recentLen > 0) {
            const lastPos = this.recentPositions[recentLen - 1];
            if (nextPos.x === lastPos.x && nextPos.y === lastPos.y) {
              stepCost += 100;
            }
            if (recentLen >= 2) {
              const last2Pos = this.recentPositions[recentLen - 2];
              if (nextPos.x === last2Pos.x && nextPos.y === last2Pos.y) {
                stepCost += 50;
              }
            }
          }
        }

        // 直前に危険回避で離脱した元の危険タイルに対する再進入ペナルティ（タブースコア）
        if (this.recentEvadedTile && nextPos.x === this.recentEvadedTile.x && nextPos.y === this.recentEvadedTile.y) {
          if (current.firstDir === null) {
            stepCost += (player.magic === 0 || player.hasDeath || player.holdItem === 'CROWN') ? 800 : 400;
          } else {
            stepCost += 300;
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
          if (insertIdx === -1) {
            queue.push(item);
          } else {
            queue.splice(insertIdx, 0, item);
          }
        }
      }
    }

    return null;
  }

  // ==========================================================================
  // 徘徊・回避行動
  // ==========================================================================

  public wanderSafe(player: Player, map: WorldMap, enemies: EnemyInstance[], dragon?: Dragon, turnsInPhase: number = 0): BotAction {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const diagDirs: Direction[] = ['UP_LEFT', 'UP_RIGHT', 'DOWN_LEFT', 'DOWN_RIGHT'];
    const dirs = player.canDiagonal ? [...cardDirs, ...diagDirs] : cardDirs;

    const validMoves: { dir: Direction; pos: Position; penalty: number }[] = [];

    for (const dir of dirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(player.pos, dir));

      if (map.getBaseTile(nextPos) === 'WALL_STATIC') continue;
      if (map.getBaseTile(nextPos) === 'GRAVE' && map.getObject(nextPos) === 'NONE') continue;
      const isBlock = map.getObject(nextPos) === 'BLOCK';
      const canBreak = MagicSystem.canCast(player, 'BREAK').allowed;
      const canKick = MagicSystem.canCast(player, 'KICK').allowed;
      if (isBlock && !canBreak && !canKick) continue;

      if (dragon) {
        const part = dragon.getPartAt(nextPos);
        if (part) continue;
        if (this.isDragonFireLine(nextPos, dragon, map)) continue;
        if (dragon.fireballs && dragon.fireballs.some(fb => fb.isAlive && fb.pos.x === nextPos.x && fb.pos.y === nextPos.y)) continue;
        if (dragon.heads.some(h => h.isAlive && map.getTorusDistance(nextPos, h.pos).manhattan === 1)) continue;
      }

      const enemy = enemies.find(e => e.pos.x === nextPos.x && e.pos.y === nextPos.y);
      if (enemy) {
        if (dir.includes('_')) continue;
        const threat = ThreatEvaluator.evaluateThreat(player, enemy);
        if (threat !== 'ONE_SHOT') continue;
      } else if (enemies.length > 0) {
        const isNearLethal = enemies.some(e => {
          if (!e.isAlive || e.isPermanentlyFrozen) return false;
          const dist = map.getTorusDistance(nextPos, e.pos).chebyshev;
          if (dist > 1) return false;
          const rawDmg = Math.max(0, e.atk - player.experience);
          return rawDmg >= player.hp * 0.4 || rawDmg >= 10000;
        });
        if (isNearLethal) continue;
      }

      let penalty = 0;
      if (isBlock) {
        penalty += 30; // 通常の安全な空床を優先するが、引き返すよりは岩を壊して前進
      }
      if (this.recentPositions.length > 0) {
        const lastPos = this.recentPositions[this.recentPositions.length - 1];
        if (lastPos.x === nextPos.x && lastPos.y === nextPos.y) {
          penalty += 80; // 直前マスへの逆戻り・ピンポン往復を強く抑止
        }
      }
      for (let i = 0; i < this.recentPositions.length; i++) {
        const rp = this.recentPositions[i];
        if (rp.x === nextPos.x && rp.y === nextPos.y) {
          penalty += (i + 1);
        }
      }

      if (this.recentEvadedTile && nextPos.x === this.recentEvadedTile.x && nextPos.y === this.recentEvadedTile.y) {
        penalty += 100;
      }

      if (map.getBaseTile(nextPos) === 'WARP') {
        penalty += 80;
        if (this.isWarpTaboo(nextPos)) {
          penalty += 300;
        }
      }

      if (dir === player.dir) {
        penalty -= 2;
      }

      validMoves.push({ dir, pos: nextPos, penalty });
    }

    if (validMoves.length === 0) {
      if (MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying) {
        return { type: 'MAGIC', magic: 'RETURN' };
      }
      if (MagicSystem.canCast(player, 'JUMP').allowed && !player.isFlying) {
        return { type: 'MAGIC', magic: 'JUMP' };
      }
      if (MagicSystem.canCast(player, 'FREEZE').allowed) {
        return { type: 'MAGIC', magic: 'FREEZE' };
      }
      if (MagicSystem.canCast(player, 'FLASH').allowed) {
        return { type: 'MAGIC', magic: 'FLASH' };
      }

      const survivableMoves: { dir: Direction; dmg: number; canDamage: boolean }[] = [];
      for (const dir of dirs) {
        const nextPos = map.wrapPosition(MovementSystem.getNextPosition(player.pos, dir));
        const enemy = enemies.find(e => e.isAlive && e.pos.x === nextPos.x && e.pos.y === nextPos.y);
        if (enemy) {
          const threat = ThreatEvaluator.evaluateThreat(player, enemy);
          if (threat !== 'LETHAL') {
            const rawDmg = Math.max(0, enemy.atk - Math.floor(player.experience * 1.0));
            const canDamage = player.hasSword && player.strength > enemy.def;
            survivableMoves.push({ dir, dmg: rawDmg, canDamage });
          }
        }
      }

      if (survivableMoves.length > 0) {
        survivableMoves.sort((a, b) => a.dmg - b.dmg);
        return { type: 'MOVE', dir: survivableMoves[0].dir };
      }

      return { type: 'MOVE', dir: dirs[turnsInPhase % dirs.length] };
    }

    validMoves.sort((a, b) => a.penalty - b.penalty);
    const minPenalty = validMoves[0].penalty;
    const bestCandidates = validMoves.filter(m => m.penalty === minPenalty);
    const choice = bestCandidates[turnsInPhase % bestCandidates.length];
    return { type: 'MOVE', dir: choice.dir };
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
    const dirs = player.canDiagonal ? [...cardDirs, ...diagDirs] : cardDirs;

    const nearbyLethals = enemies.filter(
      e => e.isAlive && !e.isPermanentlyFrozen && map.getTorusDistance(pos, e.pos).chebyshev <= 1 &&
           (ThreatEvaluator.evaluateThreat(player, e) === 'LETHAL' || e.atk >= 10000)
    );
    if (nearbyLethals.length === 0) return null;

    let bestDir: Direction | null = null;
    let bestScore = -Infinity;

    for (const dir of dirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(pos, dir));

      if (map.getBaseTile(nextPos) === 'WALL_STATIC') continue;
      if (map.getBaseTile(nextPos) === 'GRAVE' && map.getObject(nextPos) === 'NONE') continue;
      const isBlock = map.getObject(nextPos) === 'BLOCK';
      const canBreak = MagicSystem.canCast(player, 'BREAK').allowed;
      const canKick = MagicSystem.canCast(player, 'KICK').allowed;
      if (isBlock && !canBreak && !canKick) continue;
      if (dragon && dragon.getPartAt(nextPos)) continue;

      const onTile = enemies.find(e => e.isAlive && e.pos.x === nextPos.x && e.pos.y === nextPos.y);
      if (onTile) continue;

      let minDistToLethals = Infinity;
      let minManhattanToLethals = Infinity;
      for (const e of nearbyLethals) {
        const dist = map.getTorusDistance(nextPos, e.pos);
        if (dist.chebyshev < minDistToLethals) minDistToLethals = dist.chebyshev;
        if (dist.manhattan < minManhattanToLethals) minManhattanToLethals = dist.manhattan;
      }

      let score = minDistToLethals * 100 + minManhattanToLethals * 10;
      if (dir.includes('_')) score += 5;

      if (score > bestScore) {
        bestScore = score;
        bestDir = dir;
      }
    }

    if (bestDir) {
      this.recentEvadedTile = { ...pos };
      this.recentEvadedTurns = 6;
    }

    return bestDir;
  }

  // ==========================================================================
  // 空間認識・判定ヘルパー
  // ==========================================================================

  public isDragonFireLine(pos: Position, dragon: Dragon, map: WorldMap): boolean {
    for (const head of dragon.heads) {
      if (!head.isAlive) continue;
      if (dragon.canHeadSeePlayer(head, pos, map)) {
        return true;
      }
    }
    return false;
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

  public isSafeEmptyFloor(pos: Position, map: WorldMap, enemies: EnemyInstance[], dragon?: Dragon, player?: Player): boolean {
    if (map.getBaseTile(pos) === 'WALL_STATIC') return false;
    if (map.getBaseTile(pos) === 'GRAVE') return false;
    if (map.getBaseTile(pos) === 'HOME') return false;
    if (map.getObject(pos) !== 'NONE') return false;
    if (map.getItem(pos) !== 'NONE') return false;
    if (dragon && dragon.getPartAt(pos)) return false;

    const onTileEnemy = enemies.find(e => e.isAlive && e.pos.x === pos.x && e.pos.y === pos.y);
    if (onTileEnemy) return false;

    if (player) {
      const isNearLethal = enemies.some(e => {
        if (!e.isAlive || e.isPermanentlyFrozen) return false;
        const dist = map.getTorusDistance(pos, e.pos).chebyshev;
        if (dist > 1) return false;
        const rawDmg = Math.max(0, e.atk - player.experience);
        return rawDmg >= player.hp * 0.4 || rawDmg >= 10000;
      });
      if (isNearLethal) return false;
    }

    return true;
  }

  public findAdjacentSafeEmptyFloor(
    pos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon?: Dragon,
    player?: Player
  ): Direction | null {
    const dirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    for (const dir of dirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(pos, dir));
      if (this.isSafeEmptyFloor(nextPos, map, enemies, dragon, player)) {
        return dir;
      }
    }
    return null;
  }

  public findNearestSafeEmptyFloor(
    pos: Position,
    map: WorldMap,
    player: Player,
    enemies: EnemyInstance[],
    dragon?: Dragon
  ): Direction | null {
    for (let radius = 1; radius <= 5; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const dx = radius - Math.abs(dy);
        for (const sign of [-1, 1]) {
          const testPos = map.wrapPosition({ x: pos.x + dx * sign, y: pos.y + dy });
          if (this.isSafeEmptyFloor(testPos, map, enemies, dragon)) {
            const dir = this.findPath(pos, testPos, map, player, enemies, false, dragon);
            if (dir) return dir;
          }
        }
      }
    }
    return null;
  }

  public getAdjacentSafeFloors(
    pos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon?: Dragon
  ): Position[] {
    const results: Position[] = [];
    const dirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    for (const dir of dirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(pos, dir));
      if (this.isSafeEmptyFloor(nextPos, map, enemies, dragon)) {
        results.push(nextPos);
      }
    }
    return results;
  }

  public findAnyItemOnMap(itemType: TileType, map: WorldMap): Position | null {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.getItem(x, y) === itemType) {
          return { x, y };
        }
      }
    }
    return null;
  }

  public isCrossSealingAnyGrave(pos: Position, map: WorldMap): boolean {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const testGrave = map.wrapPosition({ x: pos.x + dx, y: pos.y + dy });
        if (map.getBaseTile(testGrave) === 'GRAVE') {
          return true;
        }
      }
    }
    return false;
  }

  public findNearestItemCandidates(
    from: Position,
    itemType: TileType,
    map: WorldMap,
    enemies?: EnemyInstance[],
    player?: Player,
    limit: number = 5,
    lockInfo?: NavigatorItemLockInfo
  ): Position[] {
    const candidates: { pos: Position; effectiveDist: number }[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (itemType !== 'CROWN' && this.isTargetUnreachable(p)) continue;
        if (map.getItem(p) === itemType) {
          if (itemType === 'CROSS' && this.isCrossSealingAnyGrave(p, map)) continue;

          if (enemies && player) {
            const enemy = enemies.find(e => e.isAlive && e.pos.x === x && e.pos.y === y);
            if (enemy) {
              const threat = ThreatEvaluator.evaluateThreat(player, enemy);
              if (threat !== 'ONE_SHOT' && threat !== 'SAFE') continue;
            }
          }
          const dist = map.getTorusDistance(from, p).manhattan;
          let effectiveDist = dist;
          if (
            lockInfo?.lockedItemPos &&
            lockInfo.lockedItemType === itemType &&
            lockInfo.lockedItemPos.x === x &&
            lockInfo.lockedItemPos.y === y
          ) {
            effectiveDist = Math.max(0, dist - (lockInfo.hysteresisBonus ?? 3));
          }
          candidates.push({ pos: p, effectiveDist });
        }
      }
    }
    candidates.sort((a, b) => a.effectiveDist - b.effectiveDist);
    return candidates.slice(0, limit).map(c => c.pos);
  }

  public findNearestItem(
    from: Position,
    itemType: TileType,
    map: WorldMap,
    enemies?: EnemyInstance[],
    player?: Player,
    lockInfo?: NavigatorItemLockInfo
  ): Position | null {
    return this.findNearestItemCandidates(from, itemType, map, enemies, player, 1, lockInfo)[0] ?? null;
  }

  public findNearestChestCandidates(
    from: Position,
    map: WorldMap,
    enemies?: EnemyInstance[],
    player?: Player,
    limit: number = 5,
    lockInfo?: NavigatorItemLockInfo
  ): Position[] {
    const candidates: { pos: Position; effectiveDist: number }[] = [];
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
          let effectiveDist = dist;
          if (
            lockInfo?.lockedChestPos &&
            lockInfo.lockedChestPos.x === x &&
            lockInfo.lockedChestPos.y === y
          ) {
            effectiveDist = Math.max(0, dist - (lockInfo.hysteresisBonus ?? 3));
          } else if (!lockInfo?.lockedChestPos && lockInfo?.tacticalMetadata?.treasureZoneHints) {
            // 未ロック時: 8歩周期最適ゾーン（isEightStepOptimal）内の宝箱を優先選定
            const isInOptimalZone = lockInfo.tacticalMetadata.treasureZoneHints.some(
              zone => zone.isEightStepOptimal &&
                      p.x >= zone.bounds.x1 && p.x <= zone.bounds.x2 &&
                      p.y >= zone.bounds.y1 && p.y <= zone.bounds.y2
            );
            if (isInOptimalZone) {
              effectiveDist = Math.max(0, effectiveDist - 6);
            }
          }

          candidates.push({ pos: p, effectiveDist });
        }
      }
    }
    candidates.sort((a, b) => a.effectiveDist - b.effectiveDist);
    return candidates.slice(0, limit).map(c => c.pos);
  }

  public findNearestChest(
    from: Position,
    map: WorldMap,
    enemies?: EnemyInstance[],
    player?: Player,
    lockInfo?: NavigatorItemLockInfo
  ): Position | null {
    return this.findNearestChestCandidates(from, map, enemies, player, 1, lockInfo)[0] ?? null;
  }

  public findNearestOpenGrave(from: Position, map: WorldMap): Position | null {
    let nearest: Position | null = null;
    let minDist = Infinity;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (this.isTargetUnreachable(p)) continue;
        if (map.getBaseTile(p) === 'GRAVE' && map.getItem(p) !== 'CROSS') {
          const dist = map.getTorusDistance(from, p).manhattan;
          if (dist < minDist) {
            minDist = dist;
            nearest = p;
          }
        }
      }
    }
    return nearest;
  }

  public findNearestSafeEnemyCandidates(
    player: Player,
    enemies: EnemyInstance[],
    map: WorldMap,
    limit: number = 15
  ): EnemyInstance[] {
    const candidates: { enemy: EnemyInstance; dist: number }[] = [];
    for (const enemy of enemies) {
      if (!enemy.isAlive || enemy.isPermanentlyFrozen) continue;
      const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
      if ((details.overallThreat === 'ONE_SHOT' || details.overallThreat === 'SAFE') && !details.isLethalOneShot) {
        const dist = map.getTorusDistance(player.pos, enemy.pos).manhattan;
        candidates.push({ enemy, dist });
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);
    return candidates.slice(0, limit).map(c => c.enemy);
  }

  public findNearestSafeEnemy(player: Player, enemies: EnemyInstance[], map: WorldMap): EnemyInstance | null {
    return this.findNearestSafeEnemyCandidates(player, enemies, map, 1)[0] ?? null;
  }

  public getAdjacentEnemies(pos: Position, enemies: EnemyInstance[], map: WorldMap): { enemy: EnemyInstance; dir: Direction }[] {
    const results: { enemy: EnemyInstance; dir: Direction }[] = [];
    const dirs: { dir: Direction; dx: number; dy: number }[] = [
      { dir: 'UP', dx: 0, dy: -1 },
      { dir: 'DOWN', dx: 0, dy: 1 },
      { dir: 'LEFT', dx: -1, dy: 0 },
      { dir: 'RIGHT', dx: 1, dy: 0 },
    ];
    for (const d of dirs) {
      const p = map.wrapPosition({ x: pos.x + d.dx, y: pos.y + d.dy });
      const enemy = enemies.find(e => e.isAlive && !e.isPermanentlyFrozen && e.pos.x === p.x && e.pos.y === p.y);
      if (enemy) {
        results.push({ enemy, dir: d.dir });
      }
    }
    return results;
  }

  public getTorusDelta(from: Position, to: Position, width: number, height: number): { dx: number; dy: number } {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    if (dx > width / 2) dx -= width;
    if (dx < -width / 2) dx += width;
    if (dy > height / 2) dy -= height;
    if (dy < -height / 2) dy += height;
    return { dx, dy };
  }

  public getDirectionFromDelta(dx: number, dy: number): Direction | null {
    if (dx === 1 && dy === 0) return 'RIGHT';
    if (dx === -1 && dy === 0) return 'LEFT';
    if (dx === 0 && dy === 1) return 'DOWN';
    if (dx === 0 && dy === -1) return 'UP';
    if (dx === 1 && dy === 1) return 'DOWN_RIGHT';
    if (dx === -1 && dy === 1) return 'DOWN_LEFT';
    if (dx === 1 && dy === -1) return 'UP_RIGHT';
    if (dx === -1 && dy === -1) return 'UP_LEFT';
    return null;
  }
}
