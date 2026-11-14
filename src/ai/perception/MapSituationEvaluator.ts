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
}

export interface CrownItemsSummary {
  allFloorCrowns: CrownCandidate[];
  reachableCrown: CrownCandidate | null;
  nearestCrown: CrownCandidate | null;
  ghostCarryingCrownPos: Position | null;
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
  powerStones: Position[];
  nearestPowerStone: Position | null;
  rings: Position[];
  nearestRing: Position | null;
  chests: Position[];
  nearestChest: Position | null;
  hasChestWithin2To8: boolean;
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
      stateKey
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
    precomputedStateKey?: string
  ): MapSituationSummary {
    const resolvedParams = this.normalizeParams(params, player);
    const curPos = player.pos;
    const stateKey = precomputedStateKey ?? this.buildStateKey(player, map, enemies, totalTurns);

    const homeReachability = this.evaluateHomeReachability(
      player, map, enemies, dragon, ghosts, nav, resolvedParams
    );

    const items = this.evaluateItems(
      curPos, player, map, enemies, dragon, ghosts, nav, memory, resolvedParams, totalTurns
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
    const dirWithCrown = nav.findPath(
      curPos,
      bestHomePos,
      map,
      playerWithCrown,
      enemies,
      params,
      { dragon, isEscapePhase: true, ghosts }
    );
    const canReachWithCrown = dirWithCrown !== null;

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
      const dirStaticWithCrown = nav.findPath(
        curPos,
        bestHomePos,
        map,
        playerWithCrown,
        [],
        params,
        { isEscapePhase: true }
      );
      if (dirStaticWithCrown !== null) {
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
    totalTurns: number
  ): ItemReachabilitySummary {
    const rawCrowns: { pos: Position; dist: number }[] = [];
    const swordsWithDist: { pos: Position; dist: number }[] = [];
    const keysWithDist: { pos: Position; dist: number }[] = [];
    const potionsWithDist: { pos: Position; dist: number }[] = [];
    const stonesWithDist: { pos: Position; dist: number }[] = [];
    const ringsWithDist: { pos: Position; dist: number }[] = [];
    const chestsWithDist: { pos: Position; dist: number }[] = [];

    let nearbyPotionCountWithin15 = 0;
    let hasChestWithin2To8 = false;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p: Position = { x, y };
        const obj = map.getObject(p);
        const item = map.getItem(p);

        const isUnreachable = memory.isTargetUnreachable(p, totalTurns);

        if (obj === 'CHEST' && !isUnreachable) {
          const d = map.getTorusDistance(curPos, p).manhattan;
          chestsWithDist.push({ pos: p, dist: d });
          if (d >= 2 && d <= 8) {
            hasChestWithin2To8 = true;
          }
        }

        if (item === 'NONE') continue;

        const d = map.getTorusDistance(curPos, p).manhattan;

        if (item === 'SWORD') {
          // 剣は序盤必須のため、ブラックリスト状態でも候補に含める（近い順）
          swordsWithDist.push({ pos: p, dist: d });
          continue;
        }

        if (isUnreachable) continue;

        switch (item) {
          case 'CROWN':
            rawCrowns.push({ pos: p, dist: d });
            break;
          case 'KEY':
            keysWithDist.push({ pos: p, dist: d });
            break;
          case 'POTION':
            potionsWithDist.push({ pos: p, dist: d });
            if (d <= 15) nearbyPotionCountWithin15++;
            break;
          case 'POWER_STONE':
            stonesWithDist.push({ pos: p, dist: d });
            break;
          case 'RING':
            ringsWithDist.push({ pos: p, dist: d });
            break;
        }
      }
    }

    const sortByDist = <T extends { dist: number }>(arr: T[]): T[] =>
      arr.sort((a, b) => a.dist - b.dist);

    sortByDist(rawCrowns);
    sortByDist(swordsWithDist);
    sortByDist(keysWithDist);
    sortByDist(potionsWithDist);
    sortByDist(stonesWithDist);
    sortByDist(ringsWithDist);
    sortByDist(chestsWithDist);

    // 王冠候補の実経路評価（上位8候補または全王冠に対して実施）
    const crownCandidates: CrownCandidate[] = rawCrowns.map(rc => {
      if (rc.dist === 0) {
        return { pos: rc.pos, dist: 0, isReachable: true, firstDir: null };
      }
      const firstDir = nav.findPath(
        curPos,
        rc.pos,
        map,
        player,
        enemies,
        params,
        { dragon, isEscapePhase: true, ghosts }
      );
      return {
        pos: rc.pos,
        dist: rc.dist,
        isReachable: firstDir !== null,
        firstDir,
      };
    });

    // 到達可能（isReachable === true）を優先しつつ距離順
    crownCandidates.sort((a, b) => {
      if (a.isReachable !== b.isReachable) return a.isReachable ? -1 : 1;
      return a.dist - b.dist;
    });

    const reachableCrown = crownCandidates.find(c => c.isReachable) ?? null;
    const nearestCrown = crownCandidates[0] ?? null;
    const crownGhost = ghosts.find(g => g.carriedItem === 'CROWN');
    const ghostCarryingCrownPos = crownGhost ? { ...crownGhost.pos } : null;

    const swords = swordsWithDist.map(s => s.pos);
    const keys = keysWithDist.map(k => k.pos);
    const potions = potionsWithDist.map(p => p.pos);
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
      powerStones,
      nearestPowerStone: powerStones[0] ?? null,
      rings,
      nearestRing: rings[0] ?? null,
      chests,
      nearestChest: chests[0] ?? null,
      hasChestWithin2To8,
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

      const isDangerOrLethal =
        details.defenseThreat === 'LETHAL' || details.damageToPlayer >= player.hp * 0.40;
      if (
        dist.chebyshev <= 2 &&
        dist.manhattan >= 2 &&
        dist.manhattan <= 3 &&
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

    const safeEvadeDir = nav.findEvadeDirection(curPos, map, enemies, player, dragon);
    const desperateEscapeAction = this.findDesperateEscapeDir(curPos, map, enemies, player, dragon);

    return {
      floorItem,
      adjacentBlocks,
      adjacentActiveEnemies,
      adjacentAllEnemies,
      adjacentHomeEnemies,
      nearbyDangerousEnemies,
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
    player: { pos: Position; holdItem: string; magic: number; hp: number; strength: number; experience: number; hasDeath: boolean; hasSword: boolean },
    map: WorldMap,
    enemies: EnemyInstance[],
    totalTurns: number
  ): string {
    const enemySig = enemies
      .map(e => `${e.id}:${e.pos.x},${e.pos.y}:${e.isAlive ? 1 : 0}:${e.isPermanentlyFrozen ? 1 : 0}:${e.frozenTimer ?? 0}`)
      .join(';');
    return `${totalTurns}|${player.pos.x},${player.pos.y}|${player.holdItem}|${player.magic}|${player.hp}|${player.strength}|${player.experience}|${player.hasDeath ? 1 : 0}|${player.hasSword ? 1 : 0}|${map.realHomePos.x},${map.realHomePos.y}|${map.getItem(player.pos)}|${enemySig}`;
  }
}
