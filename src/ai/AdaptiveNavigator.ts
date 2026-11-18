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
  private static readonly BFS_ALL_DIRS: {
    dir: Direction;
    dirIdx: number;
    dx: number;
    dy: number;
    isDiag: boolean;
  }[] = [
    { dir: 'UP', dirIdx: 0, dx: 0, dy: -1, isDiag: false },
    { dir: 'DOWN', dirIdx: 1, dx: 0, dy: 1, isDiag: false },
    { dir: 'LEFT', dirIdx: 2, dx: -1, dy: 0, isDiag: false },
    { dir: 'RIGHT', dirIdx: 3, dx: 1, dy: 0, isDiag: false },
    { dir: 'UP_LEFT', dirIdx: 4, dx: -1, dy: -1, isDiag: true },
    { dir: 'UP_RIGHT', dirIdx: 5, dx: 1, dy: -1, isDiag: true },
    { dir: 'DOWN_LEFT', dirIdx: 6, dx: -1, dy: 1, isDiag: true },
    { dir: 'DOWN_RIGHT', dirIdx: 7, dx: 1, dy: 1, isDiag: true },
  ];

  private static readonly ZONE_LETHAL_ADJ = 1;
  private static readonly ZONE_LETHAL_CHEB2 = 2;
  private static readonly ZONE_EXTRA_BLOCKED = 4;
  private static readonly ZONE_WARP_TABOO = 8;
  private static readonly ZONE_GHOST_HAZARD = 16;
  private static readonly ZONE_DRAGON_BLOCKED = 32;
  private static readonly ZONE_DRAGON_FIRELINE = 64;

  // 再利用可能な BFS バッファ (GC負荷ゼロ化用)
  private visitedCostBuf: Float64Array = new Float64Array(0);
  private firstDirIdxBuf: Int8Array = new Int8Array(0);
  private stepsBuf: Int16Array = new Int16Array(0);
  private enemyIdxBuf: Int16Array = new Int16Array(0);
  private dangerCostBuf: Int32Array = new Int32Array(0);
  private zoneFlagsBuf: Uint8Array = new Uint8Array(0);
  private readonly bfsHeap = new CostMinHeap<number>();
  private readonly scratchPos: Position = { x: 0, y: 0 };

  // 1. ワープ往復防止タブー
  private recentWarpTiles: { pos: Position; turnsRemaining: number }[] = [];

  // 2. 危険ゾーン退避タイル記憶
  public recentEvadedTile: Position | null = null;
  public recentEvadedTurns: number = 0;

  constructor(private readonly memory?: EpisodicMemory) {}

  private ensureBfsBuffers(size: number): void {
    if (this.visitedCostBuf.length < size) {
      this.visitedCostBuf = new Float64Array(size);
      this.firstDirIdxBuf = new Int8Array(size);
      this.stepsBuf = new Int16Array(size);
      this.enemyIdxBuf = new Int16Array(size);
      this.dangerCostBuf = new Int32Array(size);
      this.zoneFlagsBuf = new Uint8Array(size);
    }
  }

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
      enemyZocRadius?: number;
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
      enemyZocRadius?: number;
    }
  ): PathResult | null {
    if (!from || !to) return null;

    const mapW = map.width;
    const mapH = map.height;
    const totalCells = mapW * mapH;
    const sx = ((from.x % mapW) + mapW) % mapW;
    const sy = ((from.y % mapH) + mapH) % mapH;
    const tx = ((to.x % mapW) + mapW) % mapW;
    const ty = ((to.y % mapH) + mapH) % mapH;
    const startIdx = sy * mapW + sx;
    const targetIdx = ty * mapW + tx;

    if (startIdx === targetIdx) return null;

    const dragon = options?.dragon;
    const isEscapePhase = options?.isEscapePhase ?? false;
    const ghosts = options?.ghosts;
    const zocRadius = options?.enemyZocRadius ?? Infinity;
    const effectiveDef = Math.floor(player.experience * 1.0);
    const dangerHpRatio = params.dangerHpRatio ?? 0.3;
    const emergencyHpRatio = params.emergencyHpRatio ?? 0.4;
    const maxBfsSteps = params.maxBfsSteps ?? 6000;
    const warpAvoidanceCost = params.warpAvoidanceCost ?? 20;
    const breakCostMultiplier = params.breakCostMultiplier ?? 1.5;

    this.ensureBfsBuffers(totalCells);
    const visitedCost = this.visitedCostBuf;
    const firstDirIdxBuf = this.firstDirIdxBuf;
    const stepsBuf = this.stepsBuf;
    const enemyIdxBuf = this.enemyIdxBuf;
    const dangerCostBuf = this.dangerCostBuf;
    const zoneFlagsBuf = this.zoneFlagsBuf;

    visitedCost.fill(Infinity, 0, totalCells);
    firstDirIdxBuf.fill(-1, 0, totalCells);
    stepsBuf.fill(0, 0, totalCells);
    enemyIdxBuf.fill(-1, 0, totalCells);
    dangerCostBuf.fill(0, 0, totalCells);
    zoneFlagsBuf.fill(0, 0, totalCells);

    // extraBlocked を事前フラグ化
    const extraBlocked = options?.extraBlocked;
    if (extraBlocked) {
      for (let i = 0; i < extraBlocked.length; i++) {
        const bp: Position = extraBlocked[i];
        const bx = ((bp.x % mapW) + mapW) % mapW;
        const by = ((bp.y % mapH) + mapH) % mapH;
        const bIdx = by * mapW + bx;
        if (bIdx !== targetIdx) {
          zoneFlagsBuf[bIdx] |= AdaptiveNavigator.ZONE_EXTRA_BLOCKED;
        }
      }
    }

    // ワープタブーを事前フラグ化
    for (let i = 0; i < this.recentWarpTiles.length; i++) {
      const wp = this.recentWarpTiles[i].pos;
      const wx = ((wp.x % mapW) + mapW) % mapW;
      const wy = ((wp.y % mapH) + mapH) % mapH;
      zoneFlagsBuf[wy * mapW + wx] |= AdaptiveNavigator.ZONE_WARP_TABOO;
    }

    // ゴースト危険帯を事前フラグ化 (脱出時)
    if (ghosts && isEscapePhase) {
      for (let i = 0; i < ghosts.length; i++) {
        const g = ghosts[i];
        const gx = ((g.pos.x % mapW) + mapW) % mapW;
        const gy = ((g.pos.y % mapH) + mapH) % mapH;
        zoneFlagsBuf[gy * mapW + gx] |= AdaptiveNavigator.ZONE_GHOST_HAZARD;
        const px = (((g.pos.x + g.vx) % mapW) + mapW) % mapW;
        const py = (((g.pos.y + g.vy) % mapH) + mapH) % mapH;
        zoneFlagsBuf[py * mapW + px] |= AdaptiveNavigator.ZONE_GHOST_HAZARD;
      }
    }

    // ドラゴン部位・ファイアボール・ブレス射線を事前フラグ化
    if (dragon) {
      const bx = ((dragon.body.pos.x % mapW) + mapW) % mapW;
      const by = ((dragon.body.pos.y % mapH) + mapH) % mapH;
      zoneFlagsBuf[by * mapW + bx] |= AdaptiveNavigator.ZONE_DRAGON_BLOCKED;

      const tailX = ((dragon.tail.pos.x % mapW) + mapW) % mapW;
      const tailY = ((dragon.tail.pos.y % mapH) + mapH) % mapH;
      zoneFlagsBuf[tailY * mapW + tailX] |= AdaptiveNavigator.ZONE_DRAGON_BLOCKED;

      for (let i = 0; i < dragon.heads.length; i++) {
        const h = dragon.heads[i];
        if (!h.isAlive) continue;
        const hx = ((h.pos.x % mapW) + mapW) % mapW;
        const hy = ((h.pos.y % mapH) + mapH) % mapH;
        zoneFlagsBuf[hy * mapW + hx] |= AdaptiveNavigator.ZONE_DRAGON_BLOCKED;

        // 首への直角隣接 (マンハッタン距離1) は進入禁止
        for (let di = 0; di < 4; di++) {
          const d = AdaptiveNavigator.BFS_ALL_DIRS[di];
          const ax = (hx + d.dx + mapW) % mapW;
          const ay = (hy + d.dy + mapH) % mapH;
          zoneFlagsBuf[ay * mapW + ax] |= AdaptiveNavigator.ZONE_DRAGON_BLOCKED;
        }

        // 首正面射線 (UP / LEFT / RIGHT, 視界最大12マス)
        let fdx = 0;
        let fdy = 0;
        if (h.facingDir === 'UP') fdy = -1;
        else if (h.facingDir === 'LEFT') fdx = -1;
        else if (h.facingDir === 'RIGHT') fdx = 1;

        if (fdx !== 0 || fdy !== 0) {
          let cx = h.pos.x + fdx;
          let cy = h.pos.y + fdy;
          for (let step = 1; step <= 12; step++) {
            if (cx < 0 || cx >= mapW || cy < 0 || cy >= mapH) break;
            const cIdx = cy * mapW + cx;
            if (step <= 2) {
              zoneFlagsBuf[cIdx] |= AdaptiveNavigator.ZONE_DRAGON_BLOCKED;
            } else {
              zoneFlagsBuf[cIdx] |= AdaptiveNavigator.ZONE_DRAGON_FIRELINE;
            }
            const tile = map.getTile(cx, cy);
            if (tile === 'WALL_STATIC' || tile === 'BLOCK') break;
            cx += fdx;
            cy += fdy;
          }
        }
      }

      if (dragon.fireballs && dragon.fireballs.length > 0) {
        for (let i = 0; i < dragon.fireballs.length; i++) {
          const fb = dragon.fireballs[i];
          if (!fb.isAlive) continue;
          const fx = ((fb.pos.x % mapW) + mapW) % mapW;
          const fy = ((fb.pos.y % mapH) + mapH) % mapH;
          zoneFlagsBuf[fy * mapW + fx] |= AdaptiveNavigator.ZONE_DRAGON_BLOCKED;

          let fdx = 0;
          let fdy = 0;
          if (fb.dir === 'UP') fdy = -1;
          else if (fb.dir === 'DOWN') fdy = 1;
          else if (fb.dir === 'LEFT') fdx = -1;
          else if (fb.dir === 'RIGHT') fdx = 1;
          const nfx = (fx + fdx + mapW) % mapW;
          const nfy = (fy + fdy + mapH) % mapH;
          zoneFlagsBuf[nfy * mapW + nfx] |= AdaptiveNavigator.ZONE_DRAGON_BLOCKED;
        }
      }
    }

    // 敵マスの高速判定バッファ & 段階的危険コスト算出 (始点近傍ZOCと遠方動的敵を分離)
    let fromAdjLethalCount = 0;
    let fromAdjLethalFirstIdx = -1;

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.isAlive) continue;

      const ex = ((e.pos.x % mapW) + mapW) % mapW;
      const ey = ((e.pos.y % mapH) + mapH) % mapH;
      const eIdx = ey * mapW + ex;

      // チェビシェフ距離のトーラス計算 (ゼロアロケーション)
      let fdx = Math.abs(ex - sx);
      if (fdx > mapW * 0.5) fdx = mapW - fdx;
      let fdy = Math.abs(ey - sy);
      if (fdy > mapH * 0.5) fdy = mapH - fdy;
      const distFromStartCheb = Math.max(fdx, fdy);
      const distFromStartManh = fdx + fdy;

      const isPermFrozen = e.isPermanentlyFrozen;
      const isFrozen = isPermFrozen || e.frozenTimer > 0;

      if (!isFrozen && distFromStartManh === 1) {
        const rawDmgFrom = Math.max(0, e.atk - effectiveDef);
        if (rawDmgFrom >= player.hp) {
          fromAdjLethalCount++;
          if (fromAdjLethalFirstIdx < 0) fromAdjLethalFirstIdx = i;
        }
      }

      const inZoc = distFromStartCheb <= zocRadius || isPermFrozen;
      if (!inZoc) {
        // 遠方の移動中敵は進入禁止にせず、中距離(zocRadius+1..zocRadius+4)の活動敵にのみソフト迂回コストを付与
        if (!isFrozen && eIdx !== targetIdx && distFromStartCheb <= zocRadius + 4) {
          dangerCostBuf[eIdx] += 60;
          for (let di = 0; di < 4; di++) {
            const d = AdaptiveNavigator.BFS_ALL_DIRS[di];
            const ax = (ex + d.dx + mapW) % mapW;
            const ay = (ey + d.dy + mapH) % mapH;
            dangerCostBuf[ay * mapW + ax] += 25;
          }
        }
        continue;
      }

      enemyIdxBuf[eIdx] = i;

      if (!isFrozen) {
        if (eIdx === targetIdx) continue;

        const details = ThreatEvaluator.evaluateThreatDetails(player, e);
        const rawDmg = details.damageToPlayer;
        const isTwoShotWithCrown = player.holdItem === 'CROWN' && rawDmg >= player.hp * 0.45;
        const isLethal = rawDmg >= player.hp || isTwoShotWithCrown || details.overallThreat === 'LETHAL';

        if (isLethal) {
          // 周囲8マス (直交4 + 斜め4) を進入禁止ゾーンとしてマーク
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const ax = (ex + dx + mapW) % mapW;
              const ay = (ey + dy + mapH) % mapH;
              zoneFlagsBuf[ay * mapW + ax] |= AdaptiveNavigator.ZONE_LETHAL_ADJ;
            }
          }
          // チェビシェフ距離2の外周16マス
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) {
                const cx = (ex + dx + mapW) % mapW;
                const cy = (ey + dy + mapH) % mapH;
                zoneFlagsBuf[cy * mapW + cx] |= AdaptiveNavigator.ZONE_LETHAL_CHEB2;
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
            hpRatio >= dangerHpRatio
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
          enemyZoneCost = isEscapePhase ? 80 : 120;
        }

        if (enemyZoneCost > 0) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const zx = (ex + dx + mapW) % mapW;
              const zy = (ey + dy + mapH) % mapH;
              dangerCostBuf[zy * mapW + zx] += enemyZoneCost;
            }
          }
        }
      }
    }

    const isHeadingToHome =
      map.getBaseTile(tx, ty) === 'HOME' ||
      (tx === map.realHomePos.x && ty === map.realHomePos.y);

    // 直前マスへの逆戻り抑制インデックスの事前算出
    let prev1Idx = -1;
    let prev2Idx = -1;
    if (this.memory) {
      const recentPositions = this.memory.movement.getRecentPositions(4);
      const rLen = recentPositions.length;
      if (rLen >= 2) {
        const p1 = recentPositions[rLen - 2];
        const idx1 = (((p1.y % mapH) + mapH) % mapH) * mapW + (((p1.x % mapW) + mapW) % mapW);
        if (idx1 !== targetIdx) prev1Idx = idx1;
      }
      if (rLen >= 3) {
        const p2 = recentPositions[rLen - 3];
        const idx2 = (((p2.y % mapH) + mapH) % mapH) * mapW + (((p2.x % mapW) + mapW) % mapW);
        if (idx2 !== targetIdx) prev2Idx = idx2;
      }
    }

    const canBreakSpell = Boolean(params.allowBreakAsRoad && MagicSystem.canCast(player, 'BREAK').allowed);
    const allowDiagonal = player.canDiagonal || player.experience >= 12000;
    const dirLimit = allowDiagonal ? 8 : 4;
    const contextMeta = options?.context?.metadata;
    const scratchPos = this.scratchPos;

    const queue = this.bfsHeap;
    queue.clear();
    visitedCost[startIdx] = 0;
    firstDirIdxBuf[startIdx] = -1;
    stepsBuf[startIdx] = 0;
    queue.push(startIdx, 0);

    let stepCount = 0;
    while (queue.length > 0 && stepCount < maxBfsSteps) {
      stepCount++;
      const curCost = queue.peekCost();
      const curIdx = queue.pop()!;
      if (curCost > visitedCost[curIdx]) continue;

      if (curIdx === targetIdx) {
        const fDirIdx = firstDirIdxBuf[curIdx];
        return {
          dir: fDirIdx >= 0 ? AdaptiveNavigator.BFS_ALL_DIRS[fDirIdx].dir : 'UP',
          cost: curCost,
          steps: stepsBuf[curIdx],
        };
      }

      const cx = curIdx % mapW;
      const cy = (curIdx - cx) / mapW;
      const curFirstDirIdx = firstDirIdxBuf[curIdx];
      const nextSteps = stepsBuf[curIdx] + 1;

      for (let di = 0; di < dirLimit; di++) {
        const d = AdaptiveNavigator.BFS_ALL_DIRS[di];
        const nx = (cx + d.dx + mapW) % mapW;
        const ny = (cy + d.dy + mapH) % mapH;
        const nextIdx = ny * mapW + nx;

        const base = map.getBaseTile(nx, ny);
        if (base === 'WALL_STATIC') continue;

        const nextFlags = zoneFlagsBuf[nextIdx];
        if ((nextFlags & AdaptiveNavigator.ZONE_EXTRA_BLOCKED) !== 0) continue;

        const obj = map.getObject(nx, ny);
        if (base === 'GRAVE' && obj === 'NONE') continue;

        let actualIdx = nextIdx;
        let stepCost = 1;
        const isWarpTile = base === 'WARP';

        if (isWarpTile && nextIdx !== targetIdx) {
          scratchPos.x = nx;
          scratchPos.y = ny;
          const warpDest = map.getWarpDestination(scratchPos);
          if (warpDest) {
            actualIdx = warpDest.y * mapW + warpDest.x;
          }
          stepCost += warpAvoidanceCost;
          if (
            (nextFlags & AdaptiveNavigator.ZONE_WARP_TABOO) !== 0 ||
            (zoneFlagsBuf[actualIdx] & AdaptiveNavigator.ZONE_WARP_TABOO) !== 0
          ) {
            stepCost += 500;
          }
        }

        if (obj === 'BLOCK') {
          scratchPos.x = nx;
          scratchPos.y = ny;
          if (AdaptiveNavigator.isProtectedGraveBlock(scratchPos, map, contextMeta)) {
            continue;
          }
          if (canBreakSpell) {
            stepCost = breakCostMultiplier;
          } else if (player.holdItem === 'RING') {
            scratchPos.x = (nx + d.dx + mapW) % mapW;
            scratchPos.y = (ny + d.dy + mapH) % mapH;
            if (map.isPushDestinationValid(scratchPos, enemies)) {
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
          if ((nextFlags & AdaptiveNavigator.ZONE_DRAGON_BLOCKED) !== 0) continue;
          if ((nextFlags & AdaptiveNavigator.ZONE_DRAGON_FIRELINE) !== 0) {
            stepCost += 10;
          }
        }

        // 敵マス進入判定 (ワープ経由時はワープ先を判定)
        const enemyIdx = enemyIdxBuf[actualIdx];
        if (enemyIdx >= 0) {
          if (player.holdItem === 'CROSS' || d.isDiag) continue;
          const enemyOnTile = enemies[enemyIdx];
          const threatDetails = ThreatEvaluator.evaluateThreatDetails(player, enemyOnTile);
          const threat = threatDetails.overallThreat;
          const isFrozenEnemy = enemyOnTile.isPermanentlyFrozen || (enemyOnTile.frozenTimer ?? 0) > 0;

          if (player.holdItem === 'CROWN' && threat !== 'ONE_SHOT') {
            if (isFrozenEnemy && isHeadingToHome) {
              stepCost += 10;
            } else {
              continue;
            }
          }
          if (curFirstDirIdx < 0) {
            const hasOtherLethalAtFrom =
              fromAdjLethalCount > 1 ||
              (fromAdjLethalCount === 1 && fromAdjLethalFirstIdx !== enemyIdx);
            if (hasOtherLethalAtFrom) continue;
          }
          if (player.hp < player.maxHp * emergencyHpRatio && threat !== 'ONE_SHOT' && nextIdx !== targetIdx) {
            if (!(isFrozenEnemy && isHeadingToHome)) continue;
          }

          const canBreakthrough =
            (threatDetails.defenseThreat === 'NO_DAMAGE' && threatDetails.turnsToKill <= 8) ||
            (isFrozenEnemy && isHeadingToHome);

          if (nextIdx === targetIdx) {
            if (threat !== 'ONE_SHOT' && threat !== 'SAFE' && !canBreakthrough && threatDetails.defenseThreat !== 'NO_DAMAGE') {
              continue;
            }
          } else {
            if (threat !== 'ONE_SHOT' && !canBreakthrough) continue;
          }

          if (canBreakthrough && threat !== 'ONE_SHOT') {
            stepCost += (threatDetails.turnsToKill ?? 1) * 5;
          }
        }

        const actualFlags = actualIdx === nextIdx ? nextFlags : zoneFlagsBuf[actualIdx];
        const actualEnemyIdx = actualIdx === nextIdx ? enemyIdx : enemyIdxBuf[actualIdx];
        const isTargetHome = isHeadingToHome && nextIdx === targetIdx;

        // 即死敵の周囲8マス進入禁止
        if ((actualFlags & AdaptiveNavigator.ZONE_LETHAL_ADJ) !== 0 && actualEnemyIdx < 0 && !isTargetHome) {
          continue;
        }

        if ((actualFlags & AdaptiveNavigator.ZONE_LETHAL_CHEB2) !== 0 && actualEnemyIdx < 0 && !isTargetHome) {
          stepCost += (player.holdItem === 'CROWN' || isEscapePhase) ? 50000 : 5000;
        }

        const dangerZoneCost = dangerCostBuf[actualIdx];
        if (dangerZoneCost > 0 && actualEnemyIdx < 0 && nextIdx !== targetIdx) {
          stepCost += dangerZoneCost;
        }

        if ((nextFlags & AdaptiveNavigator.ZONE_GHOST_HAZARD) !== 0) {
          stepCost += 5000;
        }

        // 直前マスへの逆戻り抑制
        if (curFirstDirIdx < 0 && nextIdx !== targetIdx) {
          if (nextIdx === prev1Idx) {
            stepCost += 100;
          } else if (nextIdx === prev2Idx) {
            stepCost += 50;
          }
        }

        const newCost = curCost + stepCost;
        if (visitedCost[actualIdx] <= newCost) continue;

        visitedCost[actualIdx] = newCost;
        firstDirIdxBuf[actualIdx] = curFirstDirIdx >= 0 ? curFirstDirIdx : d.dirIdx;
        stepsBuf[actualIdx] = nextSteps;
        queue.push(actualIdx, newCost);
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

    // 1. 墓（GRAVE）の周囲8マス判定 (トーラス循環考慮・ゼロアロケーション)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (map.getBaseTile(pos.x + dx, pos.y + dy) === 'GRAVE') {
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
