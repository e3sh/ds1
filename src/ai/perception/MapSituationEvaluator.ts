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
import { DynamicBotParameters } from '../BotTypes.js';
import { AdaptiveNavigator } from '../AdaptiveNavigator.js';
import { EpisodicMemory } from './EpisodicMemory.js';
import type { TacticalSnapshot } from './TacticalSnapshot.js';
import type { SpatialKnowledge } from './SpatialKnowledge.js';

export type HomeBlockingCause = 'NONE' | 'DANGEROUS_ENEMY' | 'BLOCK' | 'SEALED';

export interface HomeReachabilitySummary {
  bestHomePos: Position;
  isAtHome: boolean;
  isNearRealHome: boolean;
  isNearSpawnHome: boolean;
  canReachWithCrown: boolean;
  canReachHandsFree: boolean;
  blockingCause: HomeBlockingCause;
  firstBlockingBlockPos: Position | null;
}

export interface CrownCandidate {
  pos: Position;
  dist: number;
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
  nearbyDangerousEnemies: EnemyInstance[];
  chebyshev1ActiveDangerousEnemies: EnemyInstance[];
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
   * マップ全体の状況を一括評価してサマリーを生成する
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

    const homeReachability = this.evaluateHomeReachability(
      player, map, enemies, dragon, ghosts, nav, resolvedParams
    );

    const items = this.evaluateItems(
      curPos, player, map, enemies, dragon, ghosts, nav, memory, resolvedParams, totalTurns, spatial
    );

    const surroundings = this.evaluateSurroundings(
      player, map, enemies, dragon, nav
    );

    return {
      homeReachability,
      items,
      surroundings,
      _stateKey: stateKey,
    };
  }

  /**
   * 拠点（我が家）への到達可能性・閉塞原因・最初の開削岩を評価
   */
  private static evaluateHomeReachability(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    ghosts: Ghost[],
    nav: AdaptiveNavigator,
    params: DynamicBotParameters
  ): HomeReachabilitySummary {
    const curPos = player.pos;
    const bestHomePos = { ...map.realHomePos };
    const allHomes = map.getAllHomePositions();

    const isAtHome =
      map.getBaseTile(curPos) === 'HOME' ||
      allHomes.some(h => h.x === curPos.x && h.y === curPos.y);
    const isNearRealHome = map.getTorusDistance(curPos, bestHomePos).chebyshev <= 2;
    const isNearSpawnHome = map.spawnHomePos
      ? map.getTorusDistance(curPos, map.spawnHomePos).chebyshev <= 3
      : false;

    if (isAtHome) {
      return {
        bestHomePos,
        isAtHome: true,
        isNearRealHome,
        isNearSpawnHome,
        canReachWithCrown: true,
        canReachHandsFree: true,
        blockingCause: 'NONE',
        firstBlockingBlockPos: null,
      };
    }

    const playerWithCrown = this.clonePlayerWithHold(player, 'CROWN');
    const statsWithCrown = nav.executeBfs(
      curPos,
      bestHomePos,
      map,
      playerWithCrown,
      enemies,
      params,
      { dragon, isEscapePhase: true, ghosts }
    );
    const statsStaticWithCrown = nav.executeBfs(
      curPos,
      bestHomePos,
      map,
      playerWithCrown,
      [],
      params,
      { isEscapePhase: true }
    );
    const canReachWithCrown = this.isReasonableCrownRoute(statsWithCrown, statsStaticWithCrown);

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
    const canReachHandsFree = dirHandsFree !== null;

    let blockingCause: HomeBlockingCause = 'NONE';
    let firstBlockingBlockPos: Position | null = null;

    if (!canReachWithCrown) {
      // 敵を除外した状態で王冠持ちで帰還できるか確認し、原因を切り分ける
      if (statsStaticWithCrown !== null) {
        blockingCause = 'DANGEROUS_ENEMY';
      } else {
        firstBlockingBlockPos = this.findFirstBlockingBlockOnPath(
          curPos,
          bestHomePos,
          map,
          player,
          params.maxBfsSteps
        );
        if (firstBlockingBlockPos !== null || canReachHandsFree) {
          blockingCause = 'BLOCK';
        } else {
          blockingCause = 'SEALED';
        }
      }
    }

    return {
      bestHomePos,
      isAtHome,
      isNearRealHome,
      isNearSpawnHome,
      canReachWithCrown,
      canReachHandsFree,
      blockingCause,
      firstBlockingBlockPos,
    };
  }

  /**
   * 敵による即死危険帯踏破や極端な大回りを除外した合理的な王冠帰還ルートか判定する
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
    if (from.x === to.x && from.y === to.y) return null;

    const allowDiagonal = player.canDiagonal || player.experience >= 12000;
    const cardDeltas: { dir: Direction; dx: number; dy: number }[] = [
      { dir: 'UP', dx: 0, dy: -1 },
      { dir: 'DOWN', dx: 0, dy: 1 },
      { dir: 'LEFT', dx: -1, dy: 0 },
      { dir: 'RIGHT', dx: 1, dy: 0 },
    ];
    const diagDeltas: { dir: Direction; dx: number; dy: number }[] = [
      { dir: 'UP_LEFT', dx: -1, dy: -1 },
      { dir: 'UP_RIGHT', dx: 1, dy: -1 },
      { dir: 'DOWN_LEFT', dx: -1, dy: 1 },
      { dir: 'DOWN_RIGHT', dx: 1, dy: 1 },
    ];
    const dirs = allowDiagonal ? [...cardDeltas, ...diagDeltas] : cardDeltas;

    interface Node {
      pos: Position;
      cost: number;
      firstBlock: Position | null;
    }

    const queue: Node[] = [{ pos: { ...from }, cost: 0, firstBlock: null }];
    const visited = new Map<string, number>();
    visited.set(`${from.x},${from.y}`, 0);

    let stepCount = 0;
    while (queue.length > 0 && stepCount < maxBfsSteps) {
      stepCount++;
      const current = queue.shift()!;
      if (current.pos.x === to.x && current.pos.y === to.y) {
        return current.firstBlock;
      }

      for (const d of dirs) {
        const nextPos = map.wrapPosition({
          x: current.pos.x + d.dx,
          y: current.pos.y + d.dy,
        });

        const base = map.getBaseTile(nextPos);
        const obj = map.getObject(nextPos);

        if (base === 'WALL_STATIC') continue;
        if (base === 'GRAVE' && obj === 'NONE') continue;

        let stepCost = 1;
        let nextFirstBlock = current.firstBlock;

        if (obj === 'BLOCK') {
          // 岩破壊（BREAK）は直交4方向からのみ行うため、斜め進入は除外
          if (d.dir.includes('_')) continue;
          if (AdaptiveNavigator.isProtectedGraveBlock(nextPos, map)) continue;
          stepCost = 100;
          if (!nextFirstBlock) {
            nextFirstBlock = { ...nextPos };
          }
        }

        let actualNextPos = nextPos;
        if (base === 'WARP' && !(nextPos.x === to.x && nextPos.y === to.y)) {
          const warpDest = map.getWarpDestination(nextPos);
          if (warpDest) actualNextPos = warpDest;
          stepCost += 20;
        }

        const key = `${actualNextPos.x},${actualNextPos.y}`;
        const newCost = current.cost + stepCost;
        const prevCost = visited.get(key);
        if (prevCost !== undefined && prevCost <= newCost) continue;

        visited.set(key, newCost);
        const node: Node = {
          pos: actualNextPos,
          cost: newCost,
          firstBlock: nextFirstBlock,
        };
        const insertIdx = queue.findIndex(q => q.cost > newCost);
        if (insertIdx === -1) queue.push(node);
        else queue.splice(insertIdx, 0, node);
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
  ): ItemReachabilitySummary {
    const rawCrowns: { pos: Position; dist: number }[] = [];
    const swordsWithDist: { pos: Position; dist: number }[] = [];
    const fallbackSwordsWithDist: { pos: Position; dist: number }[] = [];
    const keysWithDist: { pos: Position; dist: number }[] = [];
    const potionsWithDist: { pos: Position; dist: number }[] = [];
    const stonesWithDist: { pos: Position; dist: number }[] = [];
    const ringsWithDist: { pos: Position; dist: number }[] = [];
    const chestsWithDist: { pos: Position; dist: number }[] = [];
    const coinsForOpportunistic: { pos: Position; dist: number }[] = [];

    let nearbyPotionCountWithin15 = 0;
    let nearbyCoinCountWithin15 = 0;
    let nearbyChestCountWithin8 = 0;
    let nearbyPowerStoneCountWithin8 = 0;
    let totalActualChests = 0;

    // 1-pass Dial法 BFS で現在位置から物理的に到達可能な実歩行距離を計算
    // (!canBreak 時に BLOCK 壁奥を除外し、壁越しの近い金貨・壺へ大回りループするのを防止)
    const canBreakNow = !player.hasDeath && player.experience >= 4000 && player.magic >= 1;
    const canDiagNow = player.canDiagonal || player.experience >= 12000;
    const bfsDist = new Int16Array(map.width * map.height);
    bfsDist.fill(-1);
    const bfsDirs: { dx: number; dy: number }[] = canDiagNow
      ? [
          { dx: 0, dy: -1 },
          { dx: 1, dy: 0 },
          { dx: 0, dy: 1 },
          { dx: -1, dy: 0 },
          { dx: 1, dy: -1 },
          { dx: 1, dy: 1 },
          { dx: -1, dy: 1 },
          { dx: -1, dy: -1 },
        ]
      : [
          { dx: 0, dy: -1 },
          { dx: 1, dy: 0 },
          { dx: 0, dy: 1 },
          { dx: -1, dy: 0 },
        ];
    const startIdx = curPos.y * map.width + curPos.x;
    if (startIdx >= 0 && startIdx < bfsDist.length) {
      bfsDist[startIdx] = 0;
      const buckets: Position[][] = [[{ x: curPos.x, y: curPos.y }]];
      for (let dist = 0; dist < buckets.length; dist++) {
        const bucket = buckets[dist];
        if (!bucket || bucket.length === 0) continue;
        for (let i = 0; i < bucket.length; i++) {
          const cur = bucket[i];
          const curIdx = cur.y * map.width + cur.x;
          if (bfsDist[curIdx] < dist) continue;
          for (const d of bfsDirs) {
            const nextPos = map.wrapPosition({ x: cur.x + d.dx, y: cur.y + d.dy });
            const nextIdx = nextPos.y * map.width + nextPos.x;

            const base = map.getBaseTile(nextPos);
            const obj = map.getObject(nextPos);
            if (base === 'WALL_STATIC') continue;
            if (base === 'GRAVE' && obj === 'NONE') continue;
            if (obj === 'BLOCK') {
              if (!canBreakNow || (d.dx !== 0 && d.dy !== 0) || AdaptiveNavigator.isProtectedGraveBlock(nextPos, map)) {
                continue;
              }
            }

            const stepCost = obj === 'BLOCK' ? 4 : 1;
            const nextCost = dist + stepCost;
            if (bfsDist[nextIdx] >= 0 && bfsDist[nextIdx] <= nextCost) continue;
            bfsDist[nextIdx] = nextCost;

            if (base === 'WARP') {
              const warpDest = map.getWarpDestination(nextPos);
              if (warpDest) {
                const wIdx = warpDest.y * map.width + warpDest.x;
                const wCost = dist + 2;
                if (bfsDist[wIdx] < 0 || wCost < bfsDist[wIdx]) {
                  bfsDist[wIdx] = wCost;
                  if (!buckets[wCost]) buckets[wCost] = [];
                  buckets[wCost].push({ x: warpDest.x, y: warpDest.y });
                }
              } else {
                if (!buckets[nextCost]) buckets[nextCost] = [];
                buckets[nextCost].push(nextPos);
              }
            } else {
              if (!buckets[nextCost]) buckets[nextCost] = [];
              buckets[nextCost].push(nextPos);
            }
          }
        }
      }
    }

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p: Position = { x, y };
        const obj = map.getObject(p);
        const item = map.getItem(p);

        const isUnreachable = memory.isTargetUnreachable(p, totalTurns);
        const tileBfsDist = bfsDist[y * map.width + x];
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
            rawCrowns.push({ pos: p, dist: d });
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
        }
      }
    }

    const effectiveSwordsWithDist = swordsWithDist.length > 0 ? swordsWithDist : fallbackSwordsWithDist;
    const sortByDist = <T extends { dist: number }>(arr: T[]): T[] =>
      arr.sort((a, b) => a.dist - b.dist);

    sortByDist(rawCrowns);
    sortByDist(effectiveSwordsWithDist);
    sortByDist(keysWithDist);
    sortByDist(potionsWithDist);
    sortByDist(stonesWithDist);
    sortByDist(ringsWithDist);
    sortByDist(chestsWithDist);
    sortByDist(coinsForOpportunistic);

    // 王冠候補の実経路評価（全王冠に対して到達性および王冠持帰り帰還可能性を評価）
    const playerWithCrown = rawCrowns.length > 0 ? this.clonePlayerWithHold(player, 'CROWN') : player;
    const homeTarget = { ...map.realHomePos };
    const crownCandidates: CrownCandidate[] = rawCrowns.map(rc => {
      const firstDir = rc.dist === 0
        ? null
        : nav.findPath(
            curPos,
            rc.pos,
            map,
            player,
            enemies,
            params,
            { dragon, isEscapePhase: true, ghosts }
          );
      const isReachable = rc.dist === 0 || firstDir !== null;
      let canReturnHomeWithCrown = false;
      if (isReachable && rawCrowns.length <= 6) {
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
        canReturnHomeWithCrown = this.isReasonableCrownRoute(crownStats, staticCrownStats);
      }
      return {
        pos: rc.pos,
        dist: rc.dist,
        isReachable,
        firstDir,
        canReturnHomeWithCrown,
      };
    });

    // 到達可能を最優先。双方到達可能かつ（MP/能力不足で自力開拓不可、または距離差4以内）のときのみ帰還開通（canReturnHomeWithCrown）を優先し、距離差5以上なら近傍王冠を優先
    const canClearReturnPath = !player.hasDeath && player.magic >= 2;
    crownCandidates.sort((a, b) => {
      if (a.isReachable !== b.isReachable) return a.isReachable ? -1 : 1;
      if (a.isReachable && b.isReachable && a.canReturnHomeWithCrown !== b.canReturnHomeWithCrown) {
        if (!canClearReturnPath || Math.abs(a.dist - b.dist) <= 4) {
          return a.canReturnHomeWithCrown ? -1 : 1;
        }
      }
      return a.dist - b.dist;
    });

    const reachableCrown = crownCandidates.find(c => c.isReachable) ?? null;
    const nearestCrown = crownCandidates[0] ?? null;
    const crownGhost = ghosts.find(g => g.carriedItem === 'CROWN');
    const ghostCarryingCrownPos = crownGhost ? { ...crownGhost.pos } : null;

    const swords = effectiveSwordsWithDist.map(s => s.pos);
    const keys = keysWithDist.map(k => k.pos);
    const potions = potionsWithDist.map(p => p.pos);
    const coins = coinsForOpportunistic.map(c => c.pos);
    const powerStones = stonesWithDist.map(s => s.pos);
    const rings = ringsWithDist.map(r => r.pos);
    const chests = chestsWithDist.map(c => c.pos);

    const mapW = map.width;
    const mapH = map.height;

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
        const score = dist - (type === 'POTION' ? 0.5 : 0);
        if (score < bestScore) {
          bestScore = score;
          bestOpportunisticItem = { pos, type, dist };
        }
      };
      for (const p of potionsWithDist) checkCandidate(p.pos, 'POTION', p.dist);
      for (const c of coinsForOpportunistic) checkCandidate(c.pos, 'COIN', c.dist);
    }

    return {
      crowns: {
        allFloorCrowns: crownCandidates,
        reachableCrown,
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
    };
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

    const nearbyDangerousEnemies: EnemyInstance[] = [];
    const chebyshev1ActiveDangerousEnemies: EnemyInstance[] = [];
    const approachingLethalEnemies: EnemyInstance[] = [];
    const approachingLethalChebyshev3: EnemyInstance[] = [];
    let hasActiveDangerousEnemyOnFloor = false;
    let enemyNearSpawnHome: EnemyInstance | null = null;

    for (const e of enemies) {
      if (!e.isAlive || e.isPermanentlyFrozen || (e.frozenTimer ?? 0) > 0) continue;

      const dist = map.getTorusDistance(curPos, e.pos);
      const details = ThreatEvaluator.evaluateThreatDetails(player, e);

      if (dist.manhattan <= 2 && details.defenseThreat !== 'NO_DAMAGE') {
        nearbyDangerousEnemies.push(e);
      }

      if (
        dist.chebyshev <= 1 &&
        (details.defenseThreat === 'LETHAL' ||
          (details.defenseThreat === 'TAKES_DAMAGE' &&
            (details.damageToPlayer >= player.hp * 0.35 || details.attackThreat !== 'ONE_SHOT')))
      ) {
        chebyshev1ActiveDangerousEnemies.push(e);
      }

      const isDangerOrLethal =
        details.defenseThreat === 'LETHAL' || details.damageToPlayer >= player.hp * 0.40;
      if (
        dist.chebyshev <= 2 &&
        dist.manhattan >= 2 &&
        dist.manhattan <= 2 &&
        isDangerOrLethal &&
        details.attackThreat !== 'ONE_SHOT'
      ) {
        approachingLethalEnemies.push(e);
      }

      if (dist.chebyshev >= 2 && dist.chebyshev <= 3 && details.overallThreat === 'LETHAL') {
        approachingLethalChebyshev3.push(e);
      }

      if (details.defenseThreat === 'LETHAL' || details.damageToPlayer >= player.hp * 0.35) {
        hasActiveDangerousEnemyOnFloor = true;
      }

      if (
        !enemyNearSpawnHome &&
        map.spawnHomePos &&
        map.getTorusDistance(e.pos, map.spawnHomePos).chebyshev <= 2
      ) {
        enemyNearSpawnHome = e;
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
        const rawDmg = Math.max(0, enemyOnTile.atk - effectiveDef);
        candidates.push({ dir: d, damage: rawDmg, reason: `敵マス突破 (${enemyOnTile.name})` });
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
