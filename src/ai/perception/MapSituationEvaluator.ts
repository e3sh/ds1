import {
  AttackThreat,
  DefenseThreat,
  Direction,
  Position,
} from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { Player } from '../../models/Player.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { Dragon } from '../../models/Dragon.js';
import { Ghost } from '../../models/Ghost.js';
import { GameEngine } from '../../core/GameEngine.js';
import { ThreatEvaluator } from '../../systems/ThreatEvaluator.js';
import { MovementSystem } from '../../systems/MovementSystem.js';
import { MagicSystem } from '../../systems/MagicSystem.js';
import { DynamicBotParameters } from '../BotTypes.js';
import { AdaptiveNavigator } from '../AdaptiveNavigator.js';
import { EpisodicMemory } from './EpisodicMemory.js';
import type { TacticalSnapshot } from './TacticalSnapshot.js';
import type { SpatialKnowledge } from './SpatialKnowledge.js';
import { CostMinHeap } from '../utils/MinHeap.js';

export type HomeBlockingCause = 'NONE' | 'DANGEROUS_ENEMY' | 'BLOCK' | 'SEALED';

export interface HomeReachabilitySummary {
  bestHomePos: Position;
  isAtHome: boolean;
  isNearRealHome: boolean;
  isNearSpawnHome: boolean;
  /** 1-pass Dial BFS による、岩破壊なしの静的到達可否（BFS追加発火なし） */
  canReachStaticallyWithCrown: boolean;
  canReachWithCrown: boolean;
  canReachHandsFree: boolean;
  blockingCause: HomeBlockingCause;
  firstBlockingBlockPos: Position | null;
}

export interface CrownCandidate {
  pos: Position;
  dist: number;
  /** 1-pass Dial BFS による静的到達可否（BFS追加発火なし） */
  isStaticallyReachable: boolean;
  /** 1-pass Dial BFS による岩破壊なし静的到達可否 */
  isReachableWithoutBreak: boolean;
  isReachable: boolean;
  firstDir: Direction | null;
  canReturnHomeWithCrown?: boolean;
}

export interface CrownItemsSummary {
  allFloorCrowns: CrownCandidate[];
  reachableCrown: CrownCandidate | null;
  nearestCrown: CrownCandidate | null;
  ghostCarryingCrownPos: Position | null;
}

export interface OpportunisticItemCandidate {
  pos: Position;
  type: 'POTION' | 'COIN';
  dist: number;
}

export interface ItemReachabilitySummary {
  crowns: CrownItemsSummary;
  swords: Position[];
  nearestSword: Position | null;
  keys: Position[];
  nearestKey: Position | null;
  potions: Position[];
  nearestPotion: Position | null;
  nearbyPotionCountWithin15: number;
  coins: Position[];
  nearestCoin: Position | null;
  nearbyCoinCountWithin15: number;
  powerStones: Position[];
  nearestPowerStone: Position | null;
  rings: Position[];
  nearestRing: Position | null;
  deaths: Position[];
  nearestDeath: Position | null;
  chests: Position[];
  nearestChest: Position | null;
  totalActualChests: number;
  hasChestWithin2To8: boolean;
  nearbyChestCountWithin8: number;
  nearbyPowerStoneCountWithin8: number;
  activeTreasureZoneId: string | null;
  activeZoneRemainingChests: number;
  projectedStrFromNearbyStones: number;
  shouldContinueChestChain: boolean;
  bestOpportunisticItem: OpportunisticItemCandidate | null;
  getReachableChestsInZone: (zoneBounds: { x1: number; y1: number; x2: number; y2: number }) => Position[];
  getNoBreakDist: (pos: Position) => number;
  getReachableDist: (pos: Position) => number;
  readonly isEarlySwordTrapped: boolean;
}

export interface ExplorationSummary {
  /** 未訪問または最も訪問が古い到達可能マスの候補（現在地・周回重心から遠い順、最大8件） */
  readonly frontierTargets: Position[];
  /** 最も近い破壊可能な岩（BLOCK）の座標（保護された墓ブロックは除外） */
  readonly nearestBreakableBlock: Position | null;
}

export interface AdjacentBlockInfo {
  dir: Direction;
  pos: Position;
}

export interface AdjacentEnemyInfo {
  dir: Direction;
  enemy: EnemyInstance;
  attackThreat: AttackThreat;
  defenseThreat: DefenseThreat;
  damageToPlayer: number;
  hasDrain: boolean;
}

export interface NearbyEnemyThreatInfo {
  enemy: EnemyInstance;
  manhattan: number;
  chebyshev: number;
  attackThreat: AttackThreat;
  defenseThreat: DefenseThreat;
  damageToPlayer: number;
  damageRatio: number;
  hasDrain: boolean;
}

export interface AdjacentHomeEnemyInfo {
  dir: Direction;
  enemy: EnemyInstance;
}

export interface LocalSurroundingsSummary {
  floorItem: string;
  adjacentBlocks: AdjacentBlockInfo[];
  adjacentActiveEnemies: AdjacentEnemyInfo[];
  adjacentAllEnemies: AdjacentEnemyInfo[];
  adjacentHomeEnemies: AdjacentHomeEnemyInfo[];
  nearbyDangerousEnemies: NearbyEnemyThreatInfo[];
  chebyshev1ActiveDangerousEnemies: NearbyEnemyThreatInfo[];
  canSafelyFreezeAdjacent: boolean;
  approachingLethalEnemies: EnemyInstance[];
  approachingLethalChebyshev3: EnemyInstance[];
  hasActiveDangerousEnemyOnFloor: boolean;
  enemyNearSpawnHome: EnemyInstance | null;
  safeEvadeDir: Direction | null;
  desperateEscapeAction: { dir: Direction; reason: string } | null;
}

export interface MapSituationSummary {
  homeReachability: HomeReachabilitySummary;
  items: ItemReachabilitySummary;
  exploration: ExplorationSummary;
  surroundings: LocalSurroundingsSummary;
  _stateKey: string;
}

/**
 * MapSituationEvaluator (認知層 P層: マップ状況一括要約ユニット)
 *
 * 毎ターン開始時、拠点（我が家）への実到達性・閉塞原因・アイテム到達可能性・
 * 周辺脅威と退避候補を単一の客観的スナップショットサマリーとして生成する。
 * 戦略層（S層）や戦術層（T層）が生マップ走査や独自BFSを行うことを防ぐ。
 */
export class MapSituationEvaluator {
  private static readonly CARD_DIRS: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
  private static readonly ALL_DIRS: Direction[] = [
    'UP', 'RIGHT', 'DOWN', 'LEFT',
    'UP_LEFT', 'UP_RIGHT', 'DOWN_LEFT', 'DOWN_RIGHT',
  ];
  private static fallbackNav: AdaptiveNavigator | null = null;
  private static blockingVisitedBuf: Float64Array = new Float64Array(0);
  private static blockingFirstBlockBuf: Int32Array = new Int32Array(0);
  private static readonly blockingHeap = new CostMinHeap<number>();
  private static readonly scratchPos: Position = { x: 0, y: 0 };

  /**
   * 現在の状況サマリーを取得する。
   * snapshot.situation が最新状態と一致していればキャッシュを返し、
   * 未生成または状態変化（テストでの手動ミューテーション等）時は再評価して返す。
   */
  public static get(
    snapshot: TacticalSnapshot,
    engine?: GameEngine,
    nav?: AdaptiveNavigator
  ): MapSituationSummary {
    const map = snapshot.map;
    const enemies = snapshot.livingEnemies;
    const stateKey = this.buildStateKey(snapshot.player, map, enemies, snapshot.totalTurns);

    if (snapshot.situation && snapshot.situation._stateKey === stateKey) {
      return snapshot.situation;
    }

    const playerObj = this.buildPlayerInstance(snapshot, engine);
    const dragon = engine?.getDragon();
    const ghosts: Ghost[] = engine?.getGhosts ? engine.getGhosts() : [];
    if (!nav) {
      if (!this.fallbackNav) this.fallbackNav = new AdaptiveNavigator();
      nav = this.fallbackNav;
    }

    return this.evaluate(
      playerObj,
      map,
      enemies,
      dragon,
      ghosts,
      nav,
      snapshot.memory,
      snapshot.params,
      snapshot.totalTurns,
      stateKey,
      snapshot.spatial
    );
  }

  /**
   * マップ全体の状況を一括評価してサマリーを生成する（パッシブスキャン: 軽量・複数王冠BFSなし）
   */
  public static evaluate(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    ghosts: Ghost[],
    nav: AdaptiveNavigator,
    memory: EpisodicMemory,
    params: DynamicBotParameters,
    totalTurns: number,
    precomputedStateKey?: string,
    spatial?: SpatialKnowledge
  ): MapSituationSummary {
    const resolvedParams = this.normalizeParams(params, player);
    const curPos = player.pos;
    const stateKey = precomputedStateKey ?? this.buildStateKey(player, map, enemies, totalTurns);

    const { items, exploration, homeNoBreakReachable } = this.evaluateItems(
      curPos, player, map, enemies, dragon, ghosts, nav, memory, resolvedParams, totalTurns, spatial
    );

    const homeReachability = this.evaluateHomeReachability(
      player, map, enemies, dragon, ghosts, nav, resolvedParams, homeNoBreakReachable
    );

    const surroundings = this.evaluateSurroundings(
      player, map, enemies, dragon, nav
    );

    return {
      homeReachability,
      items,
      exploration,
      surroundings,
      _stateKey: stateKey,
    };
  }

  /**
   * アクティブスキャン（オンデマンド明示呼び出し）:
   * 複数王冠の到達性と帰還開通性を精査し、最良の王冠ターゲットを1つ選定する。
   * CrownEscapeMission がターゲット未ロック時・再選定時のみ呼び出す。
   */
  public static selectBestCrownTarget(
    snapshot: TacticalSnapshot,
    engine?: GameEngine,
    excludePos?: Position
  ): CrownCandidate | null {
    const summary = this.get(snapshot, engine);
    const candidates = summary.items.crowns.allFloorCrowns.filter(
      c => !excludePos || c.pos.x !== excludePos.x || c.pos.y !== excludePos.y
    );
    if (candidates.length === 0) return null;

    let bestReachable: CrownCandidate | null = null;
    for (const c of candidates) {
      if (!c.isReachable) continue;
      if (c.canReturnHomeWithCrown) {
        return c;
      }
      if (!bestReachable) {
        bestReachable = c;
      }
    }
    return bestReachable ?? candidates[0];
  }

  /**
   * アクティブスキャン（オンデマンド明示呼び出し）:
   * 現在地以外の床王冠から、安全に拾えてそのまま我が家へ帰還開通済みの代替王冠を探す。
   */
  public static findAlternativeOpenCrown(
    snapshot: TacticalSnapshot,
    curPos: Position,
    engine?: GameEngine
  ): CrownCandidate | null {
    const summary = this.get(snapshot, engine);
    for (const c of summary.items.crowns.allFloorCrowns) {
      if (c.pos.x === curPos.x && c.pos.y === curPos.y) continue;
      if (c.isReachable && c.canReturnHomeWithCrown) {
        return c;
      }
    }
    return null;
  }

  /**
   * 拠点（我が家）への到達可能性・閉塞原因・最初の開削岩を評価
   *
   * 計算コストの高い BFS フィールド（canReachWithCrown / canReachHandsFree / blockingCause / firstBlockingBlockPos）は
   * getter による遅延評価・メモ化を行い、実際に参照されたターンでのみ計算する。
   */
  private static evaluateHomeReachability(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    ghosts: Ghost[],
    nav: AdaptiveNavigator,
    params: DynamicBotParameters,
    precomputedStaticNoBreakReachable?: boolean
  ): HomeReachabilitySummary {
    const curPos = { ...player.pos };
    const bestHomePos = { ...map.realHomePos };
    const allHomes = map.getAllHomePositions();

    const isAtHome =
      map.getBaseTile(curPos) === 'HOME' ||
      allHomes.some(h => h.x === curPos.x && h.y === curPos.y);
    const isNearRealHome = map.getTorusDistance(curPos, bestHomePos).chebyshev <= 2;
    const isNearSpawnHome = map.spawnHomePos
      ? map.getTorusDistance(curPos, map.spawnHomePos).chebyshev <= 3
      : false;
    const canReachStaticallyWithCrown = isAtHome || (precomputedStaticNoBreakReachable ?? true);

    if (isAtHome) {
      return {
        bestHomePos,
        isAtHome: true,
        isNearRealHome,
        isNearSpawnHome,
        canReachStaticallyWithCrown: true,
        canReachWithCrown: true,
        canReachHandsFree: true,
        blockingCause: 'NONE',
        firstBlockingBlockPos: null,
      };
    }

    let crownEvaluated = false;
    let cachedStatsStaticWithCrown: { cost: number; steps: number } | null = null;
    let cachedCanReachWithCrown = false;

    const ensureCrownReachability = () => {
      if (crownEvaluated) return;
      crownEvaluated = true;

      // 1-pass Dial法 BFS により岩破壊なしで静的到達不能と確定している場合は BFS をスキップ
      if (precomputedStaticNoBreakReachable === false) {
        cachedStatsStaticWithCrown = null;
        cachedCanReachWithCrown = false;
        return;
      }

      const playerWithCrown = this.clonePlayerWithHold(player, 'CROWN');
      const hasLivingDragon = Boolean(dragon && !dragon.isAllHeadsDefeated);
      const hasNearDynamicHazards =
        hasLivingDragon ||
        (ghosts && ghosts.length > 0) ||
        enemies.some(e => {
          if (!e.isAlive || e.isPermanentlyFrozen) return false;
          if (e.frozenTimer > 0) return true;
          return map.getTorusDistance(curPos, e.pos).chebyshev <= 6;
        });

      // 近傍6マスに敵もゴーストも生存ドラゴンもおらず静的開通が保証されていれば高速確定
      if (precomputedStaticNoBreakReachable === true && !hasNearDynamicHazards) {
        cachedCanReachWithCrown = true;
        return;
      }

      const statsWithCrown = nav.executeBfs(
        curPos,
        bestHomePos,
        map,
        playerWithCrown,
        enemies,
        params,
        { dragon, isEscapePhase: true, ghosts }
      );

      if (!statsWithCrown || statsWithCrown.cost >= 5000) {
        if (precomputedStaticNoBreakReachable === true && !hasLivingDragon) {
          // 静的地形で到達可能なので敵を除外した追加BFSなしで原因を切り分けられる
          cachedStatsStaticWithCrown = { cost: 1, steps: 1 };
        } else {
          cachedStatsStaticWithCrown = nav.executeBfs(
            curPos,
            bestHomePos,
            map,
            playerWithCrown,
            [],
            params,
            { dragon, isEscapePhase: true }
          );
        }
        cachedCanReachWithCrown = false;
        return;
      }

      cachedStatsStaticWithCrown = nav.executeBfs(
        curPos,
        bestHomePos,
        map,
        playerWithCrown,
        [],
        params,
        { isEscapePhase: true }
      );
      cachedCanReachWithCrown = this.isReasonableCrownRoute(statsWithCrown, cachedStatsStaticWithCrown);
    };

    let handsFreeEvaluated = false;
    let cachedCanReachHandsFree = false;

    const ensureHandsFreeReachability = () => {
      if (handsFreeEvaluated) return;
      handsFreeEvaluated = true;
      const playerHandsFree = this.clonePlayerWithHold(player, 'NONE');
      const canBreakHandsFree =
        !playerHandsFree.hasDeath &&
        playerHandsFree.magic >= 1 &&
        playerHandsFree.experience >= 4000;
      const handsFreeParams: DynamicBotParameters = {
        ...params,
        allowBreakAsRoad: canBreakHandsFree,
      };
      const dirHandsFree = nav.findPath(
        curPos,
        bestHomePos,
        map,
        playerHandsFree,
        enemies,
        handsFreeParams,
        { dragon, isEscapePhase: true, ghosts }
      );
      cachedCanReachHandsFree = dirHandsFree !== null;
    };

    let blockingEvaluated = false;
    let cachedBlockingCause: HomeBlockingCause = 'NONE';
    let cachedFirstBlockingBlockPos: Position | null = null;

    const ensureBlockingInfo = () => {
      if (blockingEvaluated) return;
      blockingEvaluated = true;
      ensureCrownReachability();
      if (cachedCanReachWithCrown) {
        cachedBlockingCause = 'NONE';
        cachedFirstBlockingBlockPos = null;
        return;
      }
      // 敵を除外した状態で王冠持ちで帰還できるか確認し、原因を切り分ける
      if (cachedStatsStaticWithCrown !== null) {
        cachedBlockingCause = 'DANGEROUS_ENEMY';
      } else {
        cachedFirstBlockingBlockPos = this.findFirstBlockingBlockOnPath(
          curPos,
          bestHomePos,
          map,
          player,
          params.maxBfsSteps
        );
        if (cachedFirstBlockingBlockPos !== null) {
          cachedBlockingCause = 'BLOCK';
        } else {
          ensureHandsFreeReachability();
          cachedBlockingCause = cachedCanReachHandsFree ? 'BLOCK' : 'SEALED';
        }
      }
    };

    return {
      bestHomePos,
      isAtHome,
      isNearRealHome,
      isNearSpawnHome,
      canReachStaticallyWithCrown,
      get canReachWithCrown(): boolean {
        ensureCrownReachability();
        return cachedCanReachWithCrown;
      },
      get canReachHandsFree(): boolean {
        ensureHandsFreeReachability();
        return cachedCanReachHandsFree;
      },
      get blockingCause(): HomeBlockingCause {
        ensureBlockingInfo();
        return cachedBlockingCause;
      },
      get firstBlockingBlockPos(): Position | null {
        ensureBlockingInfo();
        return cachedFirstBlockingBlockPos;
      },
    };
  }

  /**
   * 敵による即死危険帯踏破（+50000）や強敵密集による高危険ルート、極端な大回りを除外した合理的な王冠帰還ルートか判定する
   */
  private static isReasonableCrownRoute(
    withEnemies: { cost: number; steps: number } | null,
    staticOnly: { cost: number; steps: number } | null
  ): boolean {
    if (!withEnemies) return false;
    if (withEnemies.cost >= 5000) return false;
    if (staticOnly !== null && withEnemies.steps > staticOnly.steps + 24) return false;
    return true;
  }

  /**
   * curPos から homePos への最短開削ルート上で最初に遭遇する破壊可能 BLOCK の座標を返す
   */
  private static findFirstBlockingBlockOnPath(
    from: Position,
    to: Position,
    map: WorldMap,
    player: Player,
    maxBfsSteps: number
  ): Position | null {
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

    const allowDiagonal = player.canDiagonal || player.experience >= 12000;
    const dirs: { dx: number; dy: number; isDiag: boolean }[] = allowDiagonal
      ? [
          { dx: 0, dy: -1, isDiag: false },
          { dx: 0, dy: 1, isDiag: false },
          { dx: -1, dy: 0, isDiag: false },
          { dx: 1, dy: 0, isDiag: false },
          { dx: -1, dy: -1, isDiag: true },
          { dx: 1, dy: -1, isDiag: true },
          { dx: -1, dy: 1, isDiag: true },
          { dx: 1, dy: 1, isDiag: true },
        ]
      : [
          { dx: 0, dy: -1, isDiag: false },
          { dx: 0, dy: 1, isDiag: false },
          { dx: -1, dy: 0, isDiag: false },
          { dx: 1, dy: 0, isDiag: false },
        ];

    if (this.blockingVisitedBuf.length < totalCells) {
      this.blockingVisitedBuf = new Float64Array(totalCells);
      this.blockingFirstBlockBuf = new Int32Array(totalCells);
    }
    const visited = this.blockingVisitedBuf;
    const firstBlockIdxBuf = this.blockingFirstBlockBuf;
    visited.fill(Infinity, 0, totalCells);
    firstBlockIdxBuf.fill(-1, 0, totalCells);

    const queue = this.blockingHeap;
    queue.clear();
    visited[startIdx] = 0;
    queue.push(startIdx, 0);

    const scratch = this.scratchPos;
    let stepCount = 0;
    while (queue.length > 0 && stepCount < maxBfsSteps) {
      stepCount++;
      const curCost = queue.peekCost();
      const curIdx = queue.pop()!;
      if (curCost > visited[curIdx]) continue;

      if (curIdx === targetIdx) {
        const fbIdx = firstBlockIdxBuf[curIdx];
        if (fbIdx < 0) return null;
        return { x: fbIdx % mapW, y: Math.floor(fbIdx / mapW) };
      }

      const cx = curIdx % mapW;
      const cy = (curIdx - cx) / mapW;
      const curFirstBlock = firstBlockIdxBuf[curIdx];

      for (let i = 0; i < dirs.length; i++) {
        const d = dirs[i];
        const nx = (cx + d.dx + mapW) % mapW;
        const ny = (cy + d.dy + mapH) % mapH;
        const nextIdx = ny * mapW + nx;

        const base = map.getBaseTile(nx, ny);
        const obj = map.getObject(nx, ny);

        if (base === 'WALL_STATIC') continue;
        if (base === 'GRAVE' && obj === 'NONE') continue;

        let stepCost = 1;
        let nextFirstBlock = curFirstBlock;

        if (obj === 'BLOCK') {
          // 岩破壊（BREAK）は直交4方向からのみ行うため、斜め進入は除外
          if (d.isDiag) continue;
          scratch.x = nx;
          scratch.y = ny;
          if (AdaptiveNavigator.isProtectedGraveBlock(scratch, map)) continue;
          stepCost = 100;
          if (nextFirstBlock < 0) {
            nextFirstBlock = nextIdx;
          }
        }

        let actualIdx = nextIdx;
        if (base === 'WARP' && nextIdx !== targetIdx) {
          scratch.x = nx;
          scratch.y = ny;
          const warpDest = map.getWarpDestination(scratch);
          if (warpDest) actualIdx = warpDest.y * mapW + warpDest.x;
          stepCost += 20;
        }

        const newCost = curCost + stepCost;
        if (visited[actualIdx] <= newCost) continue;

        visited[actualIdx] = newCost;
        firstBlockIdxBuf[actualIdx] = nextFirstBlock;
        queue.push(actualIdx, newCost);
      }
    }

    return null;
  }

  /**
   * マップ全体を1回走査し、各アイテム・宝箱の距離順＆到達可能性を要約する
   */
  private static evaluateItems(
    curPos: Position,
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    ghosts: Ghost[],
    nav: AdaptiveNavigator,
    memory: EpisodicMemory,
    params: DynamicBotParameters,
    totalTurns: number,
    spatial?: SpatialKnowledge
  ): { items: ItemReachabilitySummary; exploration: ExplorationSummary; homeNoBreakReachable: boolean } {
    const rawCrowns: { pos: Position; dist: number; isStaticallyReachable: boolean; isReachableWithoutBreak: boolean; staticDist: number }[] = [];
    const swordsWithDist: { pos: Position; dist: number }[] = [];
    const fallbackSwordsWithDist: { pos: Position; dist: number }[] = [];
    const keysWithDist: { pos: Position; dist: number }[] = [];
    const potionsWithDist: { pos: Position; dist: number }[] = [];
    const stonesWithDist: { pos: Position; dist: number }[] = [];
    const ringsWithDist: { pos: Position; dist: number }[] = [];
    const deathsWithDist: { pos: Position; dist: number }[] = [];
    const chestsWithDist: { pos: Position; dist: number }[] = [];
    const coinsForOpportunistic: { pos: Position; dist: number }[] = [];

    let nearbyPotionCountWithin15 = 0;
    let nearbyCoinCountWithin15 = 0;
    let nearbyChestCountWithin8 = 0;
    let nearbyPowerStoneCountWithin8 = 0;
    let totalActualChests = 0;

    // 1-pass Dial法 BFS で現在位置から物理的に到達可能な実歩行距離と「岩破壊なし到達性」を同時計算
    // (state = (idx << 1) | usedBreak により、配列・オブジェクト生成なしで厳密に判定)
    const canBreakNow = !player.hasDeath && player.experience >= 4000 && player.magic >= 1;
    const canDiagNow = player.canDiagonal || player.experience >= 12000;
    const mapW = map.width;
    const mapH = map.height;
    const totalCells = mapW * mapH;
    const bfsDist = new Int16Array(totalCells);
    const bfsNoBreakDist = new Int16Array(totalCells);
    bfsDist.fill(-1);
    bfsNoBreakDist.fill(-1);
    const bfsDirs: { dx: number; dy: number; isDiag: boolean }[] = canDiagNow
      ? [
          { dx: 0, dy: -1, isDiag: false },
          { dx: 1, dy: 0, isDiag: false },
          { dx: 0, dy: 1, isDiag: false },
          { dx: -1, dy: 0, isDiag: false },
          { dx: 1, dy: -1, isDiag: true },
          { dx: 1, dy: 1, isDiag: true },
          { dx: -1, dy: 1, isDiag: true },
          { dx: -1, dy: -1, isDiag: true },
        ]
      : [
          { dx: 0, dy: -1, isDiag: false },
          { dx: 1, dy: 0, isDiag: false },
          { dx: 0, dy: 1, isDiag: false },
          { dx: -1, dy: 0, isDiag: false },
        ];

    const sx = ((curPos.x % mapW) + mapW) % mapW;
    const sy = ((curPos.y % mapH) + mapH) % mapH;
    const startIdx = sy * mapW + sx;
    const scratch = this.scratchPos;

    if (startIdx >= 0 && startIdx < totalCells) {
      bfsDist[startIdx] = 0;
      bfsNoBreakDist[startIdx] = 0;
      const buckets: number[][] = [[startIdx << 1]];

      for (let dist = 0; dist < buckets.length; dist++) {
        const bucket = buckets[dist];
        if (!bucket || bucket.length === 0) continue;
        for (let i = 0; i < bucket.length; i++) {
          const state = bucket[i];
          const curIdx = state >> 1;
          const curUsedBreak = state & 1;

          if (curUsedBreak === 0) {
            if (bfsNoBreakDist[curIdx] < dist) continue;
          } else {
            if (bfsDist[curIdx] < dist) continue;
          }

          const cx = curIdx % mapW;
          const cy = (curIdx - cx) / mapW;

          for (let di = 0; di < bfsDirs.length; di++) {
            const d = bfsDirs[di];
            const nx = (cx + d.dx + mapW) % mapW;
            const ny = (cy + d.dy + mapH) % mapH;
            const nextIdx = ny * mapW + nx;

            const base = map.getBaseTile(nx, ny);
            if (base === 'WALL_STATIC') continue;

            const obj = map.getObject(nx, ny);
            if (base === 'GRAVE' && obj === 'NONE') continue;

            let isBlock = false;
            if (obj === 'BLOCK') {
              if (!canBreakNow || d.isDiag) continue;
              scratch.x = nx;
              scratch.y = ny;
              if (AdaptiveNavigator.isProtectedGraveBlock(scratch, map)) continue;
              isBlock = true;
            }

            const nextUsedBreak = (curUsedBreak === 1 || isBlock) ? 1 : 0;
            const stepCost = isBlock ? 4 : 1;
            const nextCost = dist + stepCost;

            if (nextUsedBreak === 0) {
              if (bfsNoBreakDist[nextIdx] >= 0 && bfsNoBreakDist[nextIdx] <= nextCost) continue;
              bfsNoBreakDist[nextIdx] = nextCost;
              if (bfsDist[nextIdx] < 0 || nextCost < bfsDist[nextIdx]) {
                bfsDist[nextIdx] = nextCost;
              }
            } else {
              if (bfsDist[nextIdx] >= 0 && bfsDist[nextIdx] <= nextCost) continue;
              bfsDist[nextIdx] = nextCost;
            }

            if (base === 'WARP') {
              scratch.x = nx;
              scratch.y = ny;
              const warpDest = map.getWarpDestination(scratch);
              if (warpDest) {
                const wIdx = warpDest.y * mapW + warpDest.x;
                const wCost = dist + 2;
                if (nextUsedBreak === 0) {
                  if (bfsNoBreakDist[wIdx] < 0 || wCost < bfsNoBreakDist[wIdx]) {
                    bfsNoBreakDist[wIdx] = wCost;
                    if (bfsDist[wIdx] < 0 || wCost < bfsDist[wIdx]) {
                      bfsDist[wIdx] = wCost;
                    }
                    if (!buckets[wCost]) buckets[wCost] = [];
                    buckets[wCost].push(wIdx << 1);
                  }
                } else {
                  if (bfsDist[wIdx] < 0 || wCost < bfsDist[wIdx]) {
                    bfsDist[wIdx] = wCost;
                    if (!buckets[wCost]) buckets[wCost] = [];
                    buckets[wCost].push((wIdx << 1) | 1);
                  }
                }
              } else {
                if (!buckets[nextCost]) buckets[nextCost] = [];
                buckets[nextCost].push((nextIdx << 1) | nextUsedBreak);
              }
            } else {
              if (!buckets[nextCost]) buckets[nextCost] = [];
              buckets[nextCost].push((nextIdx << 1) | nextUsedBreak);
            }
          }
        }
      }
    }

    const homeX = ((map.realHomePos.x % mapW) + mapW) % mapW;
    const homeY = ((map.realHomePos.y % mapH) + mapH) % mapH;
    const homeNoBreakReachable = bfsNoBreakDist[homeY * mapW + homeX] >= 0;

    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < mapW; x++) {
        const obj = map.getObject(x, y);
        const item = map.getItem(x, y);
        if (obj !== 'CHEST' && item === 'NONE') continue;

        const p: Position = { x, y };
        const isUnreachable = memory.isTargetUnreachable(p, totalTurns);
        const cellIdx = y * mapW + x;
        const tileBfsDist = bfsDist[cellIdx];
        const tileNoBreakDist = bfsNoBreakDist[cellIdx];
        const isTileReachable = tileBfsDist >= 0;

        if (obj === 'CHEST') {
          totalActualChests++;
          if (!isUnreachable && isTileReachable) {
            const d = map.getTorusDistance(curPos, p).manhattan;
            chestsWithDist.push({ pos: p, dist: d });
            if (d >= 1 && d <= 8) {
              nearbyChestCountWithin8++;
            }
          }
        }

        if (item === 'NONE') continue;

        const d = map.getTorusDistance(curPos, p).manhattan;

        if (item === 'SWORD') {
          // 剣は到達可能候補を優先しつつ、到達可能剣が皆無な特殊配置に備えてフォールバックも保持
          fallbackSwordsWithDist.push({ pos: p, dist: d });
          if (isTileReachable) {
            swordsWithDist.push({ pos: p, dist: tileBfsDist });
          }
          continue;
        }

        if (item === 'CROWN') {
          if (!isUnreachable) {
            rawCrowns.push({
              pos: p,
              dist: d,
              isStaticallyReachable: isTileReachable,
              isReachableWithoutBreak: tileNoBreakDist >= 0,
              staticDist: tileNoBreakDist >= 0 ? tileNoBreakDist : (isTileReachable ? tileBfsDist : Infinity),
            });
          }
          continue;
        }

        if (isUnreachable || !isTileReachable) continue;

        switch (item) {
          case 'KEY':
            keysWithDist.push({ pos: p, dist: tileBfsDist });
            break;
          case 'POTION':
            potionsWithDist.push({ pos: p, dist: tileBfsDist });
            if (tileBfsDist <= 15) nearbyPotionCountWithin15++;
            break;
          case 'POWER_STONE':
            stonesWithDist.push({ pos: p, dist: tileBfsDist });
            if (d <= 8) nearbyPowerStoneCountWithin8++;
            break;
          case 'COIN':
            coinsForOpportunistic.push({ pos: p, dist: tileBfsDist });
            if (tileBfsDist <= 15) nearbyCoinCountWithin15++;
            break;
          case 'RING':
            ringsWithDist.push({ pos: p, dist: tileBfsDist });
            break;
          case 'DEATH':
            deathsWithDist.push({ pos: p, dist: tileBfsDist });
            break;
        }
      }
    }

    const effectiveSwordsWithDist = swordsWithDist.length > 0 ? swordsWithDist : fallbackSwordsWithDist;
    const sortByDist = <T extends { dist: number }>(arr: T[]): T[] =>
      arr.sort((a, b) => a.dist - b.dist);

    // パッシブスキャン: 王冠候補は BFS を発火させず、岩破壊なし到達性 -> 静的到達性 -> 実距離 -> マンハッタン距離順で整列
    rawCrowns.sort((a, b) => {
      if (a.isReachableWithoutBreak !== b.isReachableWithoutBreak) {
        return a.isReachableWithoutBreak ? -1 : 1;
      }
      if (a.isStaticallyReachable !== b.isStaticallyReachable) {
        return a.isStaticallyReachable ? -1 : 1;
      }
      if (a.staticDist !== b.staticDist) return a.staticDist - b.staticDist;
      return a.dist - b.dist;
    });
    sortByDist(effectiveSwordsWithDist);
    sortByDist(keysWithDist);
    sortByDist(potionsWithDist);
    sortByDist(stonesWithDist);
    sortByDist(ringsWithDist);
    sortByDist(deathsWithDist);
    sortByDist(chestsWithDist);
    sortByDist(coinsForOpportunistic);

    // 王冠候補の実経路評価（アクティブスキャン時のみ遅延評価＆メモ化で発火）
    const playerWithCrown = rawCrowns.length > 0 ? this.clonePlayerWithHold(player, 'CROWN') : player;
    const homeTarget = { ...map.realHomePos };
    const crownCandidates: CrownCandidate[] = rawCrowns.map(rc => {
      let pathEvaluated = rc.dist === 0 || !rc.isStaticallyReachable;
      let cachedFirstDir: Direction | null = null;
      let cachedIsReachable = rc.dist === 0;

      const ensurePathToCrown = () => {
        if (pathEvaluated) return;
        pathEvaluated = true;
        cachedFirstDir = nav.findPath(
          curPos,
          rc.pos,
          map,
          player,
          enemies,
          params,
          { dragon, isEscapePhase: true, ghosts }
        );
        cachedIsReachable = cachedFirstDir !== null;
      };

      let returnEvaluated = false;
      let cachedCanReturnHomeWithCrown = false;

      const ensureReturnHomeWithCrown = () => {
        if (returnEvaluated) return;
        returnEvaluated = true;
        ensurePathToCrown();
        if (!cachedIsReachable || rawCrowns.length > 6) {
          cachedCanReturnHomeWithCrown = false;
          return;
        }
        const crownStats = nav.executeBfs(
          rc.pos,
          homeTarget,
          map,
          playerWithCrown,
          enemies,
          params,
          { dragon, isEscapePhase: true, ghosts }
        );
        const staticCrownStats = crownStats
          ? nav.executeBfs(rc.pos, homeTarget, map, playerWithCrown, [], params, { isEscapePhase: true })
          : null;
        cachedCanReturnHomeWithCrown = this.isReasonableCrownRoute(crownStats, staticCrownStats);
      };

      return {
        pos: rc.pos,
        dist: rc.dist,
        isStaticallyReachable: rc.isStaticallyReachable,
        isReachableWithoutBreak: rc.isReachableWithoutBreak,
        get isReachable(): boolean {
          ensurePathToCrown();
          return cachedIsReachable;
        },
        get firstDir(): Direction | null {
          ensurePathToCrown();
          return cachedFirstDir;
        },
        get canReturnHomeWithCrown(): boolean {
          ensureReturnHomeWithCrown();
          return cachedCanReturnHomeWithCrown;
        },
      };
    });

    const nearestCrown = crownCandidates[0] ?? null;
    const crownGhost = ghosts.find(g => g.carriedItem === 'CROWN');
    const ghostCarryingCrownPos = crownGhost ? { ...crownGhost.pos } : null;

    const swords = effectiveSwordsWithDist.map(s => s.pos);
    const keys = keysWithDist.map(k => k.pos);
    const potions = potionsWithDist.map(p => p.pos);
    const coins = coinsForOpportunistic.map(c => c.pos);
    const powerStones = stonesWithDist.map(s => s.pos);
    const rings = ringsWithDist.map(r => r.pos);
    const deaths = deathsWithDist.map(d => d.pos);
    const chests = chestsWithDist.map(c => c.pos);

    const getNoBreakDist = (pos: Position): number => {
      const wx = ((pos.x % mapW) + mapW) % mapW;
      const wy = ((pos.y % mapH) + mapH) % mapH;
      const d = bfsNoBreakDist[wy * mapW + wx];
      return d >= 0 ? d : Infinity;
    };

    const getReachableDist = (pos: Position): number => {
      const wx = ((pos.x % mapW) + mapW) % mapW;
      const wy = ((pos.y % mapH) + mapH) % mapH;
      const d = bfsDist[wy * mapW + wx];
      return d >= 0 ? d : Infinity;
    };

    const getReachableChestsInZone = (zoneBounds: { x1: number; y1: number; x2: number; y2: number }): Position[] => {
      const minX = Math.min(zoneBounds.x1, zoneBounds.x2);
      const maxX = Math.max(zoneBounds.x1, zoneBounds.x2);
      const minY = Math.min(zoneBounds.y1, zoneBounds.y2);
      const maxY = Math.max(zoneBounds.y1, zoneBounds.y2);
      const spanX = maxX - minX;
      const spanY = maxY - minY;
      const normMinX = ((minX % mapW) + mapW) % mapW;
      const normMinY = ((minY % mapH) + mapH) % mapH;

      return chests.filter(c => {
        const dx = ((c.x - normMinX) % mapW + mapW) % mapW;
        const dy = ((c.y - normMinY) % mapH + mapH) % mapH;
        return dx <= spanX && dy <= spanY;
      });
    };

    // 宝物庫ゾーン知識（マップ生成時メタデータ）を用いた現在ゾーン・残存宝箱数評価
    let activeTreasureZoneId: string | null = null;
    let activeZoneRemainingChests = 0;
    let bestZoneDist = Infinity;
    const zoneCandidates: { id: string; bounds: { x1: number; y1: number; x2: number; y2: number } }[] = [];
    if (spatial) {
      for (const z of spatial.treasureZones.values()) {
        zoneCandidates.push({ id: z.id, bounds: z.bounds });
      }
    } else if (map.tacticalMetadata?.treasureZoneHints) {
      for (const z of map.tacticalMetadata.treasureZoneHints) {
        zoneCandidates.push({ id: z.id, bounds: z.bounds });
      }
    }
    for (const z of zoneCandidates) {
      const minX = Math.min(z.bounds.x1, z.bounds.x2);
      const maxX = Math.max(z.bounds.x1, z.bounds.x2);
      const minY = Math.min(z.bounds.y1, z.bounds.y2);
      const maxY = Math.max(z.bounds.y1, z.bounds.y2);
      const spanX = maxX - minX;
      const spanY = maxY - minY;
      const normMinX = ((minX % mapW) + mapW) % mapW;
      const normMinY = ((minY % mapH) + mapH) % mapH;
      const normMaxX = ((maxX % mapW) + mapW) % mapW;
      const normMaxY = ((maxY % mapH) + mapH) % mapH;
      const wrapDx = ((curPos.x - normMinX) % mapW + mapW) % mapW;
      const wrapDy = ((curPos.y - normMinY) % mapH + mapH) % mapH;
      const dx = wrapDx <= spanX
        ? 0
        : Math.min(
            map.getTorusDistance({ x: curPos.x, y: 0 }, { x: normMinX, y: 0 }).manhattan,
            map.getTorusDistance({ x: curPos.x, y: 0 }, { x: normMaxX, y: 0 }).manhattan
          );
      const dy = wrapDy <= spanY
        ? 0
        : Math.min(
            map.getTorusDistance({ x: 0, y: curPos.y }, { x: 0, y: normMinY }).manhattan,
            map.getTorusDistance({ x: 0, y: curPos.y }, { x: 0, y: normMaxY }).manhattan
          );
      const zoneDist = dx + dy;
      if (zoneDist <= 2) {
        const rem = getReachableChestsInZone(z.bounds).length;
        if (rem > 0 && (zoneDist < bestZoneDist || rem > activeZoneRemainingChests)) {
          bestZoneDist = zoneDist;
          activeTreasureZoneId = z.id;
          activeZoneRemainingChests = rem;
        } else if (!activeTreasureZoneId && zoneDist < bestZoneDist) {
          bestZoneDist = zoneDist;
          activeTreasureZoneId = z.id;
          activeZoneRemainingChests = rem;
        }
      }
    }

    const hasChestWithin2To8 = nearbyChestCountWithin8 > 0;
    let projectedStrFromNearbyStones = player.strength;
    const stoneCountToProject = Math.min(20, stonesWithDist.length);
    const progConfig = (player as Player).activeProgressionConfig;
    for (let i = 0; i < stoneCountToProject; i++) {
      projectedStrFromNearbyStones += Player.calculatePowerStoneGain(
        projectedStrFromNearbyStones,
        progConfig
      );
    }
    const shouldContinueChestChain =
      player.holdItem === 'KEY' &&
      (nearbyChestCountWithin8 > 0 || activeZoneRemainingChests > 0) &&
      projectedStrFromNearbyStones < params.targetStr &&
      (player.stepCountSinceStone <= 7 ||
        (player.stepCountSinceStone === 8 && map.getObject(curPos) === 'CHEST'));

    // 動線上のついで拾い最良候補（S層の dy/dx 走査ループを廃し、P層で一括算出）
    const isExpFarming =
      (player.strength >= params.targetStr &&
        player.experience < (params.targetDefenseExp ?? 35000)) ||
      player.experience < 12000;
    const maxOpportunisticDist = isExpFarming ? 4 : 2;
    const isAdjacentLethal = enemies.some(e => {
      if (!e.isAlive || e.isPermanentlyFrozen || (e.frozenTimer ?? 0) > 0) return false;
      if (map.getTorusDistance(curPos, e.pos).manhattan !== 1) return false;
      return ThreatEvaluator.evaluateThreatDetails(player, e).defenseThreat === 'LETHAL';
    });
    let bestOpportunisticItem: OpportunisticItemCandidate | null = null;
    if (!isAdjacentLethal) {
      let bestScore = Infinity;
      const checkCandidate = (pos: Position, type: 'POTION' | 'COIN', dist: number): void => {
        if (dist < 1 || dist > maxOpportunisticDist) return;
        if (type === 'POTION' && player.magic >= params.maxTargetMagic) return;
        if (map.getBaseTile(pos) === 'WALL_STATIC' || map.getObject(pos) === 'BLOCK') return;
        const enemyOnSpot = enemies.some(e => e.isAlive && e.pos.x === pos.x && e.pos.y === pos.y);
        if (enemyOnSpot) return;
        const potionBonus = type === 'POTION' ? (player.magic === 0 ? 2.0 : 0.5) : 0;
        const score = dist - potionBonus;
        if (score < bestScore) {
          bestScore = score;
          bestOpportunisticItem = { pos, type, dist };
        }
      };
      for (const p of potionsWithDist) checkCandidate(p.pos, 'POTION', p.dist);
      for (const c of coinsForOpportunistic) checkCandidate(c.pos, 'COIN', c.dist);
    }

    let reachableCrownEvaluated = false;
    let cachedReachableCrown: CrownCandidate | null = null;
    let earlySwordTrappedEvaluated = false;
    let cachedEarlySwordTrapped = false;
    let frontierEvaluated = false;
    let cachedFrontierTargets: Position[] = [];
    let nearestBlockEvaluated = false;
    let cachedNearestBlock: Position | null = null;

    const itemsSummary: ItemReachabilitySummary = {
      crowns: {
        allFloorCrowns: crownCandidates,
        get reachableCrown(): CrownCandidate | null {
          if (!reachableCrownEvaluated) {
            reachableCrownEvaluated = true;
            cachedReachableCrown = crownCandidates.find(c => c.isReachable) ?? null;
          }
          return cachedReachableCrown;
        },
        nearestCrown,
        ghostCarryingCrownPos,
      },
      swords,
      nearestSword: swords[0] ?? null,
      keys,
      nearestKey: keys[0] ?? null,
      potions,
      nearestPotion: potions[0] ?? null,
      nearbyPotionCountWithin15,
      coins,
      nearestCoin: coins[0] ?? null,
      nearbyCoinCountWithin15,
      powerStones,
      nearestPowerStone: powerStones[0] ?? null,
      rings,
      nearestRing: rings[0] ?? null,
      deaths,
      nearestDeath: deaths[0] ?? null,
      chests,
      nearestChest: chests[0] ?? null,
      totalActualChests,
      hasChestWithin2To8,
      nearbyChestCountWithin8,
      nearbyPowerStoneCountWithin8,
      activeTreasureZoneId,
      activeZoneRemainingChests,
      projectedStrFromNearbyStones,
      shouldContinueChestChain,
      bestOpportunisticItem,
      getReachableChestsInZone,
      getNoBreakDist,
      getReachableDist,
      get isEarlySwordTrapped(): boolean {
        if (earlySwordTrappedEvaluated) return cachedEarlySwordTrapped;
        earlySwordTrappedEvaluated = true;
        if (
          player.hasSword ||
          map.getItem(curPos) === 'SWORD' ||
          MagicSystem.canCast(player, 'BREAK').allowed ||
          MagicSystem.canCast(player, 'JUMP').allowed ||
          MagicSystem.canCast(player, 'FLY').allowed ||
          swordsWithDist.length > 0
        ) {
          cachedEarlySwordTrapped = false;
          return false;
        }
        if (player.holdItem !== 'RING' && ringsWithDist.length > 0 && fallbackSwordsWithDist.length > 0) {
          const testPlayer = MapSituationEvaluator.clonePlayerWithHold(player, 'RING');
          for (const r of ringsWithDist) {
            for (const sw of fallbackSwordsWithDist) {
              if (nav.findPath(r.pos, sw.pos, map, testPlayer, enemies, params, { dragon }) !== null) {
                cachedEarlySwordTrapped = false;
                return false;
              }
            }
          }
        }
        cachedEarlySwordTrapped = true;
        return true;
      },
    };

    const explorationSummary: ExplorationSummary = {
      get frontierTargets(): Position[] {
        if (frontierEvaluated) return cachedFrontierTargets;
        frontierEvaluated = true;
        const unvisited: { pos: Position; dist: number }[] = [];
        const oldestVisited: { pos: Position; lastTurn: number; dist: number }[] = [];

        for (let y = 0; y < map.height; y++) {
          for (let x = 0; x < map.width; x++) {
            const tileDist = bfsDist[y * map.width + x];
            if (tileDist <= 0) continue;
            const p: Position = { x, y };
            if (memory.isTargetUnreachable(p, totalTurns)) continue;
            const base = map.getBaseTile(p);
            const obj = map.getObject(p);
            if (base === 'WALL_STATIC' || (base === 'GRAVE' && obj === 'NONE')) continue;
            if (obj === 'BLOCK' && !canBreakNow) continue;

            if (!memory.movement.hasVisitedEver(p)) {
              unvisited.push({ pos: p, dist: tileDist });
            } else {
              const lastTurn = memory.movement.getLastVisitedTurn(p) ?? 0;
              oldestVisited.push({ pos: p, lastTurn, dist: tileDist });
            }
          }
        }

        if (unvisited.length > 0) {
          unvisited.sort((a, b) => b.dist - a.dist);
          cachedFrontierTargets = unvisited.slice(0, 8).map(u => u.pos);
        } else {
          oldestVisited.sort((a, b) => a.lastTurn - b.lastTurn || b.dist - a.dist);
          cachedFrontierTargets = oldestVisited.slice(0, 8).map(o => o.pos);
        }
        return cachedFrontierTargets;
      },
      get nearestBreakableBlock(): Position | null {
        if (nearestBlockEvaluated) return cachedNearestBlock;
        nearestBlockEvaluated = true;
        let bestPos: Position | null = null;
        let bestDist = Infinity;
        for (let y = 0; y < map.height; y++) {
          for (let x = 0; x < map.width; x++) {
            const p: Position = { x, y };
            if (map.getObject(p) !== 'BLOCK') continue;
            if (memory.isTargetUnreachable(p, totalTurns)) continue;
            if (AdaptiveNavigator.isProtectedGraveBlock(p, map, map.tacticalMetadata)) continue;
            const d = map.getTorusDistance(curPos, p).manhattan;
            if (d < bestDist) {
              bestDist = d;
              bestPos = p;
            }
          }
        }
        cachedNearestBlock = bestPos;
        return cachedNearestBlock;
      },
    };

    return { items: itemsSummary, exploration: explorationSummary, homeNoBreakReachable };
  }

  /**
   * プレイヤー周辺の局所障害物・敵脅威・退避方向を要約
   */
  private static evaluateSurroundings(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    nav: AdaptiveNavigator
  ): LocalSurroundingsSummary {
    const curPos = player.pos;
    const floorItem = map.getItem(curPos);
    const allHomes = map.getAllHomePositions();
    const isNearRealHome = map.getTorusDistance(curPos, map.realHomePos).chebyshev <= 2;

    const adjacentBlocks: AdjacentBlockInfo[] = [];
    const adjacentActiveEnemies: AdjacentEnemyInfo[] = [];
    const adjacentAllEnemies: AdjacentEnemyInfo[] = [];
    const adjacentHomeEnemies: AdjacentHomeEnemyInfo[] = [];

    for (const d of this.CARD_DIRS) {
      const np = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));

      if (map.getObject(np) === 'BLOCK' && !AdaptiveNavigator.isProtectedGraveBlock(np, map)) {
        adjacentBlocks.push({ dir: d, pos: np });
      }

      const enemy = enemies.find(e => e.isAlive && e.pos.x === np.x && e.pos.y === np.y);
      if (enemy) {
        const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
        const info: AdjacentEnemyInfo = {
          dir: d,
          enemy,
          attackThreat: details.attackThreat,
          defenseThreat: details.defenseThreat,
          damageToPlayer: details.damageToPlayer,
          hasDrain: details.hasDrain,
        };
        adjacentAllEnemies.push(info);
        if (!enemy.isPermanentlyFrozen && (enemy.frozenTimer ?? 0) <= 0) {
          adjacentActiveEnemies.push(info);
        }

        const isAdjHome =
          map.getBaseTile(np) === 'HOME' ||
          allHomes.some(h => h.x === np.x && h.y === np.y);
        if (isAdjHome) {
          adjacentHomeEnemies.push({ dir: d, enemy });
        }
      }
    }

    const nearbyDangerousEnemies: NearbyEnemyThreatInfo[] = [];
    const chebyshev1ActiveDangerousEnemies: NearbyEnemyThreatInfo[] = [];
    const approachingLethalEnemies: EnemyInstance[] = [];
    const approachingLethalChebyshev3: EnemyInstance[] = [];
    let hasActiveDangerousEnemyOnFloor = false;
    let enemyNearSpawnHome: EnemyInstance | null = null;

    const chebyshev2DangerCandidates: {
      enemy: EnemyInstance;
      attackThreat: AttackThreat;
      defenseThreat: DefenseThreat;
    }[] = [];
    let chebyshev2OrLessDangerCount = 0;

    for (const e of enemies) {
      if (!e.isAlive || e.isPermanentlyFrozen || (e.frozenTimer ?? 0) > 0) continue;

      const dist = map.getTorusDistance(curPos, e.pos);
      const details = ThreatEvaluator.evaluateThreatDetails(player, e);
      const damageRatio = player.hp > 0 ? details.damageToPlayer / player.hp : 1;
      const isSignificantThreat =
        details.defenseThreat === 'LETHAL' ||
        damageRatio >= 0.35 ||
        (details.hasDrain && (details.damageToPlayer > 0 || player.magic > 0));

      if (dist.manhattan <= 2 && isSignificantThreat) {
        nearbyDangerousEnemies.push({
          enemy: e,
          manhattan: dist.manhattan,
          chebyshev: dist.chebyshev,
          attackThreat: details.attackThreat,
          defenseThreat: details.defenseThreat,
          damageToPlayer: details.damageToPlayer,
          damageRatio,
          hasDrain: details.hasDrain,
        });
      }

      if (dist.chebyshev <= 1 && isSignificantThreat) {
        chebyshev1ActiveDangerousEnemies.push({
          enemy: e,
          manhattan: dist.manhattan,
          chebyshev: dist.chebyshev,
          attackThreat: details.attackThreat,
          defenseThreat: details.defenseThreat,
          damageToPlayer: details.damageToPlayer,
          damageRatio,
          hasDrain: details.hasDrain,
        });
      }

      const isDangerOrLethal =
        details.defenseThreat === 'LETHAL' ||
        (player.holdItem === 'CROWN' && details.damageToPlayer >= player.hp * 0.40) ||
        details.damageToPlayer >= player.hp * 0.40;
      if (dist.chebyshev <= 2 && isDangerOrLethal) {
        chebyshev2OrLessDangerCount++;
        if (dist.chebyshev === 2) {
          chebyshev2DangerCandidates.push({
            enemy: e,
            attackThreat: details.attackThreat,
            defenseThreat: details.defenseThreat,
          });
        }
      }

      if (
        dist.chebyshev >= 2 &&
        dist.chebyshev <= 3 &&
        (details.overallThreat === 'LETHAL' || details.defenseThreat === 'LETHAL')
      ) {
        approachingLethalChebyshev3.push(e);
      }

      if (details.defenseThreat === 'LETHAL' || details.damageToPlayer >= player.hp * 0.35) {
        hasActiveDangerousEnemyOnFloor = true;
      }

      if (
        !enemyNearSpawnHome &&
        dist.chebyshev <= 1 &&
        map.spawnHomePos &&
        map.getTorusDistance(e.pos, map.spawnHomePos).chebyshev <= 2
      ) {
        enemyNearSpawnHome = e;
      }
    }

    const isHoldingCrown = player.holdItem === 'CROWN';
    for (const cand of chebyshev2DangerCandidates) {
      if (
        cand.attackThreat !== 'ONE_SHOT' ||
        chebyshev2OrLessDangerCount >= 2 ||
        (isHoldingCrown && cand.defenseThreat === 'LETHAL')
      ) {
        approachingLethalEnemies.push(cand.enemy);
      }
    }

    const canSafelyFreezeAdjacent = !isNearRealHome && chebyshev1ActiveDangerousEnemies.length > 0;
    const safeEvadeDir = nav.findEvadeDirection(curPos, map, enemies, player, dragon);
    const desperateEscapeAction = this.findDesperateEscapeDir(curPos, map, enemies, player, dragon);

    return {
      floorItem,
      adjacentBlocks,
      adjacentActiveEnemies,
      adjacentAllEnemies,
      adjacentHomeEnemies,
      nearbyDangerousEnemies,
      chebyshev1ActiveDangerousEnemies,
      canSafelyFreezeAdjacent,
      approachingLethalEnemies,
      approachingLethalChebyshev3,
      hasActiveDangerousEnemyOnFloor,
      enemyNearSpawnHome,
      safeEvadeDir,
      desperateEscapeAction,
    };
  }

  /**
   * 逃げ場がない（全周囲が危険）場合の強行突破・最小被ダメ退避方向を探索
   * 自殺ドロップ（SPACE待機）を絶対防止するための最終自衛手段。
   */
  private static findDesperateEscapeDir(
    curPos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    player: Player,
    dragon?: Dragon
  ): { dir: Direction; reason: string } | null {
    const canDiag = player.canDiagonal || player.experience >= 12000;
    const dirs = canDiag ? this.ALL_DIRS : this.CARD_DIRS;

    const candidates: { dir: Direction; damage: number; reason: string }[] = [];
    const effectiveDef = Math.floor(player.experience * 1.0);

    for (const d of dirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
      if (map.getBaseTile(nextPos) === 'WALL_STATIC') continue;
      if (map.getObject(nextPos) !== 'NONE') continue;
      if (map.getBaseTile(nextPos) === 'GRAVE') continue;
      if (dragon && dragon.getPartAt(nextPos)) continue;

      const enemyOnTile = enemies.find(e => e.isAlive && e.pos.x === nextPos.x && e.pos.y === nextPos.y);
      if (enemyOnTile) {
        if (d.includes('_')) continue;
        const details = ThreatEvaluator.evaluateThreatDetails(player, enemyOnTile);
        const isFrozenTarget = enemyOnTile.isPermanentlyFrozen || (enemyOnTile.frozenTimer ?? 0) > 0;
        let totalDmg =
          details.turnsToKill === 1 || isFrozenTarget
            ? 0
            : Math.max(0, enemyOnTile.atk - effectiveDef);
        for (const e of enemies) {
          if (e === enemyOnTile) continue;
          if (!e.isAlive || e.isPermanentlyFrozen || (e.frozenTimer ?? 0) > 0) continue;
          if (map.getTorusDistance(curPos, e.pos).manhattan === 1) {
            totalDmg += Math.max(0, e.atk - effectiveDef);
          }
        }
        candidates.push({ dir: d, damage: totalDmg, reason: `敵マス突破 (${enemyOnTile.name})` });
        continue;
      }

      let totalDmg = 0;
      for (const e of enemies) {
        if (!e.isAlive || e.isPermanentlyFrozen || (e.frozenTimer ?? 0) > 0) continue;
        if (map.getTorusDistance(nextPos, e.pos).manhattan === 1) {
          totalDmg += Math.max(0, e.atk - effectiveDef);
        }
      }
      candidates.push({ dir: d, damage: totalDmg, reason: '被ダメ最小マスへ移動' });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.damage - b.damage);
    return { dir: candidates[0].dir, reason: candidates[0].reason };
  }

  private static normalizeParams(params: DynamicBotParameters, player: Player): DynamicBotParameters {
    const canBreak = !player.hasDeath && player.magic >= 1 && player.experience >= 4000;
    return {
      ...params,
      emergencyHpRatio: params.emergencyHpRatio ?? 0.4,
      dangerHpRatio: params.dangerHpRatio ?? 0.3,
      allowBreakAsRoad: params.allowBreakAsRoad ?? canBreak,
      breakCostMultiplier: params.breakCostMultiplier ?? 1.5,
      warpAvoidanceCost: params.warpAvoidanceCost ?? 20,
      maxBfsSteps: params.maxBfsSteps ?? 6000,
    };
  }

  private static buildPlayerInstance(snapshot: TacticalSnapshot, engine?: GameEngine): Player {
    const sp = snapshot.player;
    const base = engine?.getPlayer();
    const effectiveAttack = sp.hasSword ? sp.strength : 10;

    if (base) {
      const cloned = Object.assign(Object.create(Object.getPrototypeOf(base)), base);
      cloned.pos = { ...sp.pos };
      cloned.hp = sp.hp;
      cloned.maxHp = sp.maxHp;
      cloned.strength = sp.strength;
      cloned.experience = sp.experience;
      cloned.magic = sp.magic;
      cloned.gold = sp.gold;
      cloned.holdItem = sp.holdItem as any;
      cloned.hasSword = sp.hasSword;
      cloned.isFlying = sp.isFlying;
      cloned.canDiagonal = sp.canDiagonal;
      cloned.hasDeath = sp.hasDeath;
      cloned.stepCountSinceStone = sp.stepCountSinceStone;
      return cloned;
    }

    return {
      ...sp,
      dir: 'DOWN',
      crowns: 0,
      totalKills: 0,
      flyTimer: 0,
      deathFollowerPos: null,
      isStageCleared: false,
      effectiveAttack,
      getEffectiveDefense: (ratio = 1.0) => Math.floor(sp.experience * ratio),
    } as unknown as Player;
  }

  private static clonePlayerWithHold(player: Player, holdItem: Player['holdItem']): Player {
    const cloned = Object.assign(Object.create(Object.getPrototypeOf(player)), player);
    cloned.holdItem = holdItem;
    if (!('effectiveAttack' in cloned)) {
      Object.defineProperty(cloned, 'effectiveAttack', {
        get() { return cloned.hasSword ? cloned.strength : 10; },
      });
    }
    return cloned;
  }

  /**
   * 前線基地移転用の安全なアンカー候補を認知層で抽出する。
   * spawnHomePos（初期ホーム）から十分離れた安全な空き床をスコア順に返す。
   */
  public static findSafeRelocateAnchorCandidates(
    snapshot: TacticalSnapshot,
    dragon?: Dragon,
    limit: number = 15
  ): Position[] {
    const map = snapshot.map;
    const spawnHome = map.initialHomePos;
    const realHome = map.realHomePos;
    const idealPos: Position = {
      x: (spawnHome.x + Math.floor(map.width / 2)) % map.width,
      y: (spawnHome.y + Math.floor(map.height / 2)) % map.height,
    };

    const graves: Position[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.baseTiles[y][x] === 'GRAVE') {
          graves.push({ x, y });
        }
      }
    }

    const recommendedSet = new Set<string>(
      snapshot.spatial.recommendedRelocateAnchors.map(p => `${p.x},${p.y}`)
    );

    const isFireLine = (p: Position): boolean => {
      if (!dragon) return false;
      for (const head of dragon.heads) {
        if (!head.isAlive) continue;
        if (dragon.canHeadSeePlayer(head, p, map)) return true;
      }
      return false;
    };

    const cardDirs = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
    ];

    const isSafeAnchorTile = (p: Position): { ok: boolean; emptyNeighbors: number } => {
      if (map.getBaseTile(p) !== 'EMPTY') return { ok: false, emptyNeighbors: 0 };
      if (map.getObject(p) !== 'NONE') return { ok: false, emptyNeighbors: 0 };
      if (map.getItem(p) !== 'NONE') return { ok: false, emptyNeighbors: 0 };
      if (dragon && (dragon.getPartAt(p) || isFireLine(p))) return { ok: false, emptyNeighbors: 0 };

      for (const g of graves) {
        if (map.getTorusDistance(p, g).chebyshev <= 2) {
          return { ok: false, emptyNeighbors: 0 };
        }
      }

      let passableDirs = 0;
      let emptyNeighbors = 0;
      for (const d of cardDirs) {
        const np = map.wrapPosition({ x: p.x + d.dx, y: p.y + d.dy });
        const b = map.getBaseTile(np);
        const o = map.getObject(np);
        if (b !== 'WALL_STATIC' && b !== 'GRAVE' && b !== 'WARP') {
          passableDirs++;
          if (o === 'NONE' && map.getItem(np) === 'NONE') {
            emptyNeighbors++;
          }
        }
      }
      if (passableDirs < 2 || emptyNeighbors < 1) {
        return { ok: false, emptyNeighbors };
      }
      return { ok: true, emptyNeighbors };
    };

    const minSpawnDistThresholds = [
      Math.floor((map.width + map.height) * 0.25),
      Math.floor((map.width + map.height) * 0.16),
      10,
    ];

    for (const minDist of minSpawnDistThresholds) {
      const candidates: { pos: Position; score: number }[] = [];

      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const p = { x, y };
          const distFromSpawn = map.getTorusDistance(spawnHome, p).manhattan;
          if (distFromSpawn < minDist) continue;

          const check = isSafeAnchorTile(p);
          if (!check.ok) continue;

          const distToIdeal = map.getTorusDistance(idealPos, p).manhattan;
          const distToRealHome = map.getTorusDistance(realHome, p).manhattan;
          const recBonus = recommendedSet.has(`${x},${y}`) ? 6 : 0;
          const dragonBonus = dragon
            ? Math.min(16, map.getTorusDistance(dragon.centerPos, p).manhattan) * 0.25
            : 0;

          const score =
            distFromSpawn * 1.5 -
            distToIdeal * 1.2 +
            check.emptyNeighbors * 4 -
            distToRealHome * 0.2 +
            recBonus +
            dragonBonus;

          candidates.push({ pos: p, score });
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        return candidates.slice(0, limit).map(c => c.pos);
      }
    }

    return [];
  }

  private static buildStateKey(
    player: { pos: Position; holdItem: string; magic: number; hp: number; strength: number; experience: number; hasDeath: boolean; hasSword: boolean; stepCountSinceStone?: number },
    map: WorldMap,
    enemies: EnemyInstance[],
    totalTurns: number
  ): string {
    const enemySig = enemies
      .map(e => `${e.id}:${e.pos.x},${e.pos.y}:${e.isAlive ? 1 : 0}:${e.isPermanentlyFrozen ? 1 : 0}:${e.frozenTimer ?? 0}`)
      .join(';');
    return `${totalTurns}|${player.pos.x},${player.pos.y}|${player.holdItem}|${player.magic}|${player.hp}|${player.strength}|${player.experience}|${player.hasDeath ? 1 : 0}|${player.hasSword ? 1 : 0}|${player.stepCountSinceStone ?? 0}|${map.realHomePos.x},${map.realHomePos.y}|${map.getItem(player.pos)}|${enemySig}`;
  }
}
