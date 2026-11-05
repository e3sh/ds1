import { Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { Player } from '../../models/Player.js';
import { SeedRandom } from '../../core/SeedRandom.js';
import { TuningPresetResolver } from '../../config/TuningPresetResolver.js';
import {
  ProceduralMapGenerator,
  ProceduralMapOptions,
  MapSolvabilityReport,
} from '../ProceduralMapGenerator.js';
import {
  ThemeBlockTemplate,
  PlacedThemeBlock,
  CELL_SIZE_TILES,
  WORLD_SIZE_TILES,
} from './ThemeBlockTypes.js';
import { ThemeBlockAllocator } from './ThemeBlockAllocator.js';
import {
  ALL_THEME_BLOCKS,
  DRAGON_8x8_MAZE_LAIR,
  DRAGON_12x12_MAZE_LAIR,
  DRAGON_16x16_GRAND_HALL,
  HOME_4x4_COZY,
  HOME_8x8_ESTATE,
  GRAVE_16x16_NECROPOLIS,
  TREASURE_16x16_GRAND_VAULT,
  TREASURE_12x12_COMPLEX,
  MAZE_12x12_SPIRAL,
} from './blocks/index.js';

/**
 * Phase 14 マルチスケール・テーマブロック階層合成ジェネレータ
 *
 * 16×16 マクロセル（64×64トーラス空間）上で、大→中→小のブロックパッキング、
 * サブスロット・オーバーレイ、スロット予算アクティベーション、エッジポート接続、
 * ブートストラップ導線保証を行い、人間が設計したようなパズル性と構造美を持つダンジョンを生成する。
 */
export class HierarchicalThemeBlockGenerator {
  /**
   * 階層テーマブロック方式によるダンジョン生成メインエントリ
   */
  public static generate(
    map: WorldMap,
    options?: ProceduralMapOptions
  ): MapSolvabilityReport {
    const topology = options?.topology ?? 'STANDARD_ROOMS';
    const difficulty = options?.difficulty ?? 'NORMAL';
    const pacing = options?.pacing ?? 'STANDARD';
    const archetype = options?.archetype ?? 'BALANCED';

    const effectiveOverrides = {
      ...options?.tuningParams,
      progressionConfig: {
        ...options?.tuningParams?.progressionConfig,
        ...(options?.ruleMode ? { ruleMode: options.ruleMode } : {}),
      },
    };

    const tuningParams = TuningPresetResolver.resolve(
      topology,
      difficulty,
      pacing,
      effectiveOverrides,
      archetype
    );

    const seed = options?.seed ?? Math.floor(Math.random() * 0x7fffffff) + 1;
    const targetChests = options?.chestCount ?? tuningParams.resourceCapConfig.chestCount ?? 100;
    const targetGraves = options?.graveCount ?? tuningParams.resourceCapConfig.graveCount ?? 20;

    const rng = new SeedRandom(seed);

    // 1. マップのクリア
    this.clearMap(map);

    // 2. テーマブロックの選定
    const {
      dragonTemplate,
      homeTemplate,
      largeTemplates,
      mediumTemplates,
      smallTemplates,
      subSlotSmallTemplates,
      subSlotMediumTemplates,
      maxInstancesPerBlock,
    } = this.selectTemplatesForConfiguration(topology, options, rng);

    // 3. 16×16 マクロセル階層アロケーションの実行
    const allocator = new ThemeBlockAllocator(seed);
    const placedBlocks = allocator.allocate({
      seed,
      dragonTemplate,
      homeTemplate,
      landmarkMinDistanceTiles: 20,
      largeTemplates,
      mediumTemplates,
      smallTemplates,
      subSlotSmallTemplates,
      subSlotMediumTemplates,
      maxInstancesPerBlock,
    });

    // 4. WorldMap へのスタンプ展開 & MapTacticalMetadata 集計
    allocator.applyToWorldMap(map, placedBlocks, { activateChestSlots: false });

    // 5. ドラゴン中心座標と我が家座標の確定・同期（明示指定がある場合は指定座標を最優先）
    this.syncDragonAndHomePositions(map, placedBlocks, options, rng);

    // 6. エッジポート接続（通路開通処理）
    this.connectEdgePorts(map, placedBlocks, rng);

    // 7. スロット予算アクティベーション（目標宝箱数・墓数調整）
    this.activateBudgets(map, targetChests, targetGraves, rng);

    // 8. 難易度別ブートストラップ導線保証（剣・鍵・指輪・十字架・壺・パワーストーン）
    this.ensureBootstrapRequirements(map, difficulty, pacing, archetype, rng);

    // 9. ワープゾーンネットワークの配置
    this.setupWarpNetwork(map, archetype, rng);

    // 10. 最終セーフティクリーンアップ（ドラゴン要塞・王冠4マス・プレイヤー初期位置・火炎弾射線）
    this.enforceCriticalClearance(map, map.homePos, map.dragonCenter);
    ProceduralMapGenerator.ensureDragonFireballClearance(map, map.dragonCenter);

    // 11. 解法性診断レポートの生成
    return this.validateSolvability(map, map.dragonCenter, seed, tuningParams);
  }

  /**
   * マップ全体の初期化
   */
  private static clearMap(map: WorldMap): void {
    map.clearWarpPairs();
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        map.setBaseTile({ x, y }, 'EMPTY');
        map.setObject({ x, y }, 'NONE');
        map.setItem({ x, y }, 'NONE');
      }
    }
  }

  /**
   * トポロジー・オプションに応じたブロックテンプレート群の選定
   */
  private static selectTemplatesForConfiguration(
    topology: string,
    options: ProceduralMapOptions | undefined,
    rng: SeedRandom
  ) {
    // 1. ドラゴンブロック選定
    let dragonTemplate: ThemeBlockTemplate;
    if (options?.dragonPrefab === 'FORTRESS_7x7' || topology === 'FORTRESS_ARENA' || topology === 'GRAND_HALL') {
      dragonTemplate = DRAGON_16x16_GRAND_HALL;
    } else if (topology === 'NARROW_MAZE') {
      dragonTemplate = rng.chance(0.5) ? DRAGON_8x8_MAZE_LAIR : DRAGON_12x12_MAZE_LAIR;
    } else {
      const candidates = [DRAGON_16x16_GRAND_HALL, DRAGON_12x12_MAZE_LAIR, DRAGON_8x8_MAZE_LAIR];
      dragonTemplate = candidates[rng.nextInt(0, candidates.length - 1)];
    }

    // 2. 我が家ブロック選定
    const homeTemplate = (options?.homePrefab === 'COZY_5x5' || rng.chance(0.5))
      ? HOME_8x8_ESTATE
      : HOME_4x4_COZY;

    // 3. 広域・準広域ブロック (16x16, 12x12)
    let largePool: ThemeBlockTemplate[] = [
      GRAVE_16x16_NECROPOLIS,
      TREASURE_16x16_GRAND_VAULT,
      TREASURE_12x12_COMPLEX,
      MAZE_12x12_SPIRAL,
    ];
    // トポロジーによる重み付け・優先順序付け
    if (topology === 'SPIRAL_LABYRINTH') {
      largePool = [MAZE_12x12_SPIRAL, TREASURE_12x12_COMPLEX, GRAVE_16x16_NECROPOLIS, TREASURE_16x16_GRAND_VAULT];
    } else if (topology === 'STANDARD_ROOMS') {
      largePool = [TREASURE_16x16_GRAND_VAULT, TREASURE_12x12_COMPLEX, GRAVE_16x16_NECROPOLIS, MAZE_12x12_SPIRAL];
    } else if (topology === 'FORTRESS_ARENA') {
      largePool = [TREASURE_16x16_GRAND_VAULT, GRAVE_16x16_NECROPOLIS, TREASURE_12x12_COMPLEX, MAZE_12x12_SPIRAL];
    } else if (topology === 'NARROW_MAZE') {
      largePool = [MAZE_12x12_SPIRAL, TREASURE_12x12_COMPLEX, GRAVE_16x16_NECROPOLIS, TREASURE_16x16_GRAND_VAULT];
    }
    const largeTemplates = rng.shuffle([...largePool]);

    // トポロジーに応じた特定ブロックの配置上限（導線遮断・窒息の徹底防止）
    const maxInstancesPerBlock: Record<string, number> = {
      enclosed_4x4_solid: 2,
      enclosed_4x4_box: 3,
      enclosed_8x8_vault: 1,
    };
    if (topology === 'STANDARD_ROOMS' || topology === 'PILLAR_GRID') {
      maxInstancesPerBlock.enclosed_4x4_solid = 1;
      maxInstancesPerBlock.enclosed_4x4_box = 2;
    }

    // 4. 中規模ブロック (8x8)
    const mediumPool = ALL_THEME_BLOCKS
      .filter(b => b.size === '8x8' && b.category !== 'DRAGON' && b.category !== 'HOME')
      .map(b => {
        let weight = b.weight ?? 1;
        if (topology === 'PILLAR_GRID' && b.id === 'open_8x8_pillars') weight *= 3;
        if (topology === 'STANDARD_ROOMS' && (b.id === 'open_8x8_courtyard' || b.id === 'treasure_8x8_gallery')) weight *= 2;
        if (topology === 'SPIRAL_LABYRINTH' && b.id === 'maze_8x8_winding') weight *= 2;
        return { ...b, weight };
      });
    const mediumTemplates = rng.shuffle([...mediumPool]);

    // 5. 小ブロック (4x4)
    const smallPool = ALL_THEME_BLOCKS
      .filter(b => b.size === '4x4' && b.category !== 'HOME')
      .map(b => {
        let weight = b.weight ?? 1;
        // 補給所 (SUPPLY_*) は物資循環のため高ウェイト
        if (b.id.startsWith('supply_')) weight = 5;
        if (topology === 'STANDARD_ROOMS' && b.id.startsWith('open_')) weight *= 2;
        if (topology === 'NARROW_MAZE' && b.id.startsWith('maze_')) weight *= 2;
        return { ...b, weight };
      });
    const smallTemplates = rng.shuffle([...smallPool]);

    // 6. サブスロット用ブロック (4x4, 8x8: 墓・宝物庫・空き地・密閉部屋・補給所など多彩に充填)
    const subSlotSmallTemplates = smallPool;
    const subSlotMediumTemplates = mediumPool;

    return {
      dragonTemplate,
      homeTemplate,
      largeTemplates,
      mediumTemplates,
      smallTemplates,
      subSlotSmallTemplates,
      subSlotMediumTemplates,
      maxInstancesPerBlock,
    };
  }

  /**
   * ドラゴンおよび我が家の中心座標の確定
   */
  private static syncDragonAndHomePositions(
    map: WorldMap,
    placedBlocks: PlacedThemeBlock[],
    options?: ProceduralMapOptions,
    rng?: SeedRandom
  ): void {
    if (options?.dragonCenter) {
      map.dragonCenter = { ...options.dragonCenter };
      const prefab = options.dragonPrefab ?? 'FORTRESS_7x7';
      ProceduralMapGenerator.applyDragonPrefab(map, map.dragonCenter, prefab, rng as any);
    } else {
      const dragonBlock = placedBlocks.find(b => b.template.category === 'DRAGON');
      if (dragonBlock) {
        let coreLocalOffset = { x: 3, y: 3 };
        let prefab: 'COMPACT_5x5' | 'FORTRESS_7x7' = 'COMPACT_5x5';
        if (dragonBlock.template.size === '12x12') coreLocalOffset = { x: 5, y: 5 };
        else if (dragonBlock.template.size === '16x16') {
          coreLocalOffset = { x: 7, y: 7 };
          prefab = 'FORTRESS_7x7';
        } else if (dragonBlock.template.size === '24x24') {
          coreLocalOffset = { x: 11, y: 11 };
          prefab = 'FORTRESS_7x7';
        }

        const originX = dragonBlock.cellX * CELL_SIZE_TILES;
        const originY = dragonBlock.cellY * CELL_SIZE_TILES;
        const cx = (originX + coreLocalOffset.x) % WORLD_SIZE_TILES;
        const cy = (originY + coreLocalOffset.y) % WORLD_SIZE_TILES;
        map.dragonCenter = { x: cx, y: cy };
        ProceduralMapGenerator.applyDragonPrefab(map, map.dragonCenter, prefab, rng as any);
      }
    }

    if (options?.homePos) {
      map.homePos = { ...options.homePos };
      map.initialHomePos = { ...options.homePos };
      map.spawnHomePos = { ...options.homePos };
      map.setBaseTile(map.homePos, 'HOME');
      map.setObject(map.homePos, 'NONE');
      map.setItem(map.homePos, 'NONE');
    } else {
      const homeBlock = placedBlocks.find(b => b.template.category === 'HOME');
      if (homeBlock) {
        let localH = { x: 1, y: 1 };
        if (homeBlock.template.size === '8x8') localH = { x: 3, y: 2 };

        const originX = homeBlock.cellX * CELL_SIZE_TILES;
        const originY = homeBlock.cellY * CELL_SIZE_TILES;
        const hx = (originX + localH.x) % WORLD_SIZE_TILES;
        const hy = (originY + localH.y) % WORLD_SIZE_TILES;
        map.homePos = { x: hx, y: hy };
        map.initialHomePos = { x: hx, y: hy };
        map.spawnHomePos = { x: hx, y: hy };
      }
    }
  }

  /**
   * ブロック境界のエッジポート接続（通路開通処理）
   * 4x4境界のポート位置を空床(EMPTY)で開通させ、ブロック間の通路を自然に繋げる
   */
  private static connectEdgePorts(
    map: WorldMap,
    placedBlocks: PlacedThemeBlock[],
    _rng: SeedRandom
  ): void {
    for (const block of placedBlocks) {
      if (!block.template.edgePorts || block.template.edgePorts.length === 0) continue;

      const originX = block.cellX * CELL_SIZE_TILES;
      const originY = block.cellY * CELL_SIZE_TILES;

      for (const port of block.template.edgePorts) {
        let lx = 0;
        let ly = 0;
        const sizeTiles = block.template.layout.length;

        switch (port.direction) {
          case 'NORTH':
            lx = port.cellIndex * 4 + port.offsetInCell;
            ly = 0;
            break;
          case 'SOUTH':
            lx = port.cellIndex * 4 + port.offsetInCell;
            ly = sizeTiles - 1;
            break;
          case 'WEST':
            lx = 0;
            ly = port.cellIndex * 4 + port.offsetInCell;
            break;
          case 'EAST':
            lx = sizeTiles - 1;
            ly = port.cellIndex * 4 + port.offsetInCell;
            break;
        }

        const wx = (originX + lx) % WORLD_SIZE_TILES;
        const wy = (originY + ly) % WORLD_SIZE_TILES;

        // ポートマス自体が壁の場合、通行可能にする
        if (map.getObject({ x: wx, y: wy }) === 'BLOCK') {
          map.setObject({ x: wx, y: wy }, 'NONE');
        }
      }
    }
  }

  /**
   * スロット予算アクティベーション（目標宝箱数・墓数調整）
   */
  private static activateBudgets(
    map: WorldMap,
    targetChests: number,
    targetGraves: number,
    rng: SeedRandom
  ): void {
    // 1. 現在の宝箱数をカウント
    let currentChests = 0;
    const freeFloorPositions: Position[] = [];

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const pos = { x, y };
        const obj = map.getObject(pos);
        if (obj === 'CHEST') {
          currentChests++;
        } else if (
          map.getBaseTile(pos) === 'EMPTY' &&
          obj === 'NONE' &&
          map.getItem(pos) === 'NONE'
        ) {
          // ドラゴン要塞至近および我が家至近は除外
          const dDist = map.getTorusDistance(pos, map.dragonCenter).chebyshev;
          const hDist = map.getTorusDistance(pos, map.homePos).chebyshev;
          if (dDist > 3 && hDist > 2) {
            freeFloorPositions.push(pos);
          }
        }
      }
    }

    // 2. 目標宝箱数までの不足分を配置
    const neededChests = Math.max(0, targetChests - currentChests);
    if (neededChests > 0 && freeFloorPositions.length > 0) {
      const shuffledFloors = rng.shuffle(freeFloorPositions);
      const toPlace = Math.min(neededChests, shuffledFloors.length);
      for (let i = 0; i < toPlace; i++) {
        map.setObject(shuffledFloors[i], 'CHEST');
      }
    }

    // 3. 墓（GRAVE）の調整
    let currentGraves = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.getBaseTile({ x, y }) === 'GRAVE') {
          currentGraves++;
        }
      }
    }

    // 墓が目標墓数に満たない場合、安全な空き床に墓＋隣接ブロックを配置
    const neededGraves = Math.max(0, targetGraves - currentGraves);
    if (neededGraves > 0) {
      const remainingFloors = rng.shuffle(
        freeFloorPositions.filter(p => map.getObject(p) === 'NONE')
      );
      let placedGrave = 0;
      for (const fp of remainingFloors) {
        if (placedGrave >= neededGraves) break;
        if (this.isCompletelyFree(map, fp.x, fp.y)) {
          map.setBaseTile(fp, 'GRAVE');
          placedGrave++;
          // 隣接1マスにブロックを配置
          const adjPos = map.wrapPosition({ x: fp.x + 1, y: fp.y });
          if (this.isCompletelyFree(map, adjPos.x, adjPos.y)) {
            map.setObject(adjPos, 'BLOCK');
          }
        }
      }
    }
  }

  /**
   * 難易度・ペーシング・アーキタイプ別ブートストラップ導線保証
   */
  private static ensureBootstrapRequirements(
    map: WorldMap,
    difficulty: string,
    pacing: string,
    archetype: string,
    rng: SeedRandom
  ): void {
    // 既存の重要アイテム位置をクリアして、難易度ごとの厳密な距離設計に再配置
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const item = map.getItem({ x, y });
        if (item === 'SWORD' || item === 'KEY' || item === 'RING') {
          map.setItem({ x, y }, 'NONE');
        }
      }
    }

    // 我が家から岩破壊・斜め移動なしで到達可能な床タイルをBFSで計算
    const reachableFromHome = new Set<string>();
    const queue: Position[] = [map.homePos];
    reachableFromHome.add(`${map.homePos.x},${map.homePos.y}`);
    const cardDirs = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
    ];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const d of cardDirs) {
        const next = map.wrapPosition({ x: cur.x + d.dx, y: cur.y + d.dy });
        const key = `${next.x},${next.y}`;
        if (reachableFromHome.has(key)) continue;
        if (map.getBaseTile(next) === 'WALL_STATIC') continue;
        if (map.getObject(next) === 'BLOCK') continue;
        if (map.getObject(next) === 'CHEST') continue;
        if (map.getObject(next) === 'CHEST_DRAGON') continue;
        reachableFromHome.add(key);
        queue.push(next);
      }
    }

    const placeItemAtDistance = (itemType: any, minD: number, maxD: number) => {
      const candidates: Position[] = [];
      const reachableFallback: Position[] = [];

      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const pos = { x, y };
          if (!this.isCompletelyFree(map, x, y)) continue;
          if (map.getTorusDistance(pos, map.dragonCenter).chebyshev <= 3) continue;

          const isReachable = reachableFromHome.has(`${x},${y}`);
          const dist = map.getTorusDistance(pos, map.homePos).manhattan;

          if (isReachable) {
            reachableFallback.push(pos);
            if (dist >= minD && dist <= maxD) {
              candidates.push(pos);
            }
          }
        }
      }

      if (candidates.length > 0) {
        const chosen = candidates[rng.nextInt(0, candidates.length - 1)];
        map.setItem(chosen, itemType);
      } else if (reachableFallback.length > 0) {
        // 到達可能マスの中で、目標距離 minD に最も近いものを選択
        reachableFallback.sort((a, b) => {
          const da = Math.abs(map.getTorusDistance(a, map.homePos).manhattan - minD);
          const db = Math.abs(map.getTorusDistance(b, map.homePos).manhattan - minD);
          return da - db;
        });
        const chosen = reachableFallback[0];
        map.setItem(chosen, itemType);
      } else {
        // 全体フォールバック: 距離制約を緩めて空きマスに配置
        for (let y = 0; y < map.height; y++) {
          for (let x = 0; x < map.width; x++) {
            if (this.isCompletelyFree(map, x, y) && map.getTorusDistance({ x, y }, map.homePos).manhattan >= minD) {
              map.setItem({ x, y }, itemType);
              return;
            }
          }
        }
      }
    };

    if (difficulty === 'EASY') {
      placeItemAtDistance('RING', 1, 3);
      placeItemAtDistance('SWORD', 1, 3);
      placeItemAtDistance('KEY', 1, 4);
    } else if (difficulty === 'HARD') {
      placeItemAtDistance('RING', 8, 16);
      placeItemAtDistance('KEY', 15, 26);
      if (pacing === 'BLITZ') {
        placeItemAtDistance('SWORD', 20, 24);
      } else if (pacing === 'MARATHON') {
        placeItemAtDistance('SWORD', 26, 36);
      } else {
        placeItemAtDistance('SWORD', 22, 34);
      }
    } else {
      // NORMAL またはデフォルト
      placeItemAtDistance('RING', 1, 3);
      placeItemAtDistance('KEY', 6, 14);

      // シードによる自然な分散揺らぎ (NORMALでも時々チャレンジシードやイージーシードが出現)
      const roll = rng.nextInt(0, 99);
      if (roll < 15) {
        // チャレンジシード (遠方の剣)
        placeItemAtDistance('SWORD', 22, 32);
      } else if (roll < 30) {
        // イージー寄り (近めの剣)
        placeItemAtDistance('SWORD', 6, 12);
      } else {
        // 標準
        placeItemAtDistance('SWORD', 10, 20);
      }
    }

    // アーキタイプ固有の追加配置
    if (archetype === 'ARMORY') {
      // 予備の剣を遠方に2〜3本配置
      placeItemAtDistance('SWORD', 15, 28);
      placeItemAtDistance('SWORD', 18, 30);
    }

    // 十字架・壺・パワーストーンのカウントと不足分補充
    let crosses = 0;
    let potions = 0;
    let powerStones = 0;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const item = map.getItem({ x, y });
        if (item === 'CROSS') crosses++;
        if (item === 'POTION') potions++;
        if (item === 'POWER_STONE') powerStones++;
      }
    }

    const minCrosses = archetype === 'SANCTUARY' ? 4 : 1;
    while (crosses < minCrosses) {
      placeItemAtDistance('CROSS', 2, 20);
      crosses++;
    }

    while (potions < 2) {
      placeItemAtDistance('POTION', 2, 10);
      potions++;
    }

    while (powerStones < 8) {
      placeItemAtDistance('POWER_STONE', 3, 25);
      powerStones++;
    }
  }

  /**
   * ワープゾーンネットワークの配置
   */
  private static setupWarpNetwork(
    map: WorldMap,
    archetype: string,
    rng: SeedRandom
  ): void {
    const isWarpNexus = archetype === 'WARP_NEXUS';
    const pairCount = isWarpNexus ? 14 : 2;

    const freePositions: Position[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (this.isCompletelyFree(map, x, y)) {
          // ドラゴンコア至近および我が家至近は避ける
          const dDist = map.getTorusDistance({ x, y }, map.dragonCenter).chebyshev;
          const hDist = map.getTorusDistance({ x, y }, map.homePos).chebyshev;
          if (dDist > 3 && hDist > 2) {
            freePositions.push({ x, y });
          }
        }
      }
    }

    const shuffled = rng.shuffle(freePositions);
    let pairsAdded = 0;
    for (let i = 0; i + 1 < shuffled.length && pairsAdded < pairCount; i += 2) {
      const pA = shuffled[i];
      const pB = shuffled[i + 1];
      if (pA.x !== pB.x || pA.y !== pB.y) {
        map.addWarpPair(pA, pB);
        pairsAdded++;
      }
    }
  }

  /**
   * 重要座標（我が家・プレイヤー初期位置・ドラゴン要塞・王冠4マス）の完全保護
   */
  private static enforceCriticalClearance(
    map: WorldMap,
    homePos: Position,
    dragonCenter: Position
  ): void {
    // 1. 我が家とプレイヤー初期位置 (homePos.x + 1, homePos.y + 1)
    map.setBaseTile(homePos, 'HOME');
    map.setObject(homePos, 'NONE');
    map.setItem(homePos, 'NONE');

    const playerStart = map.wrapPosition({ x: homePos.x + 1, y: homePos.y + 1 });
    map.setBaseTile(playerStart, 'EMPTY');
    map.setObject(playerStart, 'NONE');

    // 2. ドラゴン中心5×5コアの保護
    const cx = dragonCenter.x;
    const cy = dragonCenter.y;
    const reservedTiles: Position[] = [
      // 十字5部位
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx, y: cy - 1 },
      { x: cx + 1, y: cy },
      { x: cx, y: cy + 1 },
      // 斜め安全攻撃マス 4箇所
      { x: cx - 1, y: cy - 1 },
      { x: cx + 1, y: cy - 1 },
      { x: cx - 1, y: cy + 1 },
      { x: cx + 1, y: cy + 1 },
      // 王冠出現マス 4箇所 (cx±2, cy±2)
      { x: cx - 2, y: cy - 2 },
      { x: cx + 2, y: cy - 2 },
      { x: cx - 2, y: cy + 2 },
      { x: cx + 2, y: cy + 2 },
    ];

    for (const p of reservedTiles) {
      const wp = map.wrapPosition(p);
      map.setBaseTile(wp, 'EMPTY');
      map.setObject(wp, 'NONE');
      map.setItem(wp, 'NONE');
    }

    // 王冠宝箱 (CHEST_DRAGON) 4箇所の配置
    const crownChests: Position[] = [
      { x: cx - 1, y: cy - 1 },
      { x: cx + 1, y: cy - 1 },
      { x: cx - 1, y: cy + 1 },
      { x: cx + 1, y: cy + 1 },
    ];
    for (const cp of crownChests) {
      map.setObject(map.wrapPosition(cp), 'CHEST_DRAGON');
    }
  }

  /**
   * 解法性診断（validateSolvability）
   */
  public static validateSolvability(
    map: WorldMap,
    dragonCenter: Position,
    seed: number,
    tuningParams: any
  ): MapSolvabilityReport {
    const issues: string[] = [];
    let overlaps = 0;
    let internalStaticWalls = 0;

    const counts = {
      chests: 0,
      graves: 0,
      openGraves: 0,
      blocks: 0,
      swords: 0,
      keys: 0,
      rings: 0,
      potions: 0,
      crosses: 0,
      floorPowerStones: 0,
      warps: 0,
    };

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const pos = { x, y };
        const base = map.getBaseTile(pos);
        const obj = map.getObject(pos);
        const item = map.getItem(pos);

        if (item !== 'NONE' && obj !== 'NONE') {
          overlaps++;
        }
        if ((item !== 'NONE' || obj !== 'NONE') && (base === 'WALL_STATIC' || base === 'HOME')) {
          overlaps++;
        }
        if (base === 'WALL_STATIC') {
          internalStaticWalls++;
        }

        if (obj === 'CHEST') counts.chests++;
        if (obj === 'BLOCK') counts.blocks++;
        if (base === 'WARP') counts.warps++;
        if (base === 'GRAVE') {
          counts.graves++;
          if (obj === 'NONE') {
            const adj = [
              { x: x + 1, y },
              { x: x - 1, y },
              { x, y: y + 1 },
              { x, y: y - 1 },
            ];
            if (adj.some(a => map.isPassableByEnemy(a))) {
              counts.openGraves++;
            }
          }
        }

        if (item === 'SWORD') counts.swords++;
        if (item === 'KEY') counts.keys++;
        if (item === 'RING') counts.rings++;
        if (item === 'POTION') counts.potions++;
        if (item === 'CROSS') counts.crosses++;
        if (item === 'POWER_STONE') counts.floorPowerStones++;
      }
    }

    const hasZeroOverlaps = overlaps === 0;
    if (!hasZeroOverlaps) {
      issues.push(`タイル重複が ${overlaps} 箇所検出されました`);
    }

    const internalWallsAreBlocks = internalStaticWalls === 0;
    if (!internalWallsAreBlocks) {
      issues.push(`破壊不能な WALL_STATIC が ${internalStaticWalls} 箇所存在します`);
    }

    const cx = dragonCenter.x;
    const cy = dragonCenter.y;
    const criticalDragonPositions: Position[] = [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx, y: cy - 1 },
      { x: cx + 1, y: cy },
      { x: cx, y: cy + 1 },
      { x: cx - 1, y: cy - 1 },
      { x: cx + 1, y: cy - 1 },
      { x: cx - 1, y: cy + 1 },
      { x: cx + 1, y: cy + 1 },
      { x: cx - 2, y: cy - 2 },
      { x: cx + 2, y: cy - 2 },
      { x: cx - 2, y: cy + 2 },
      { x: cx + 2, y: cy + 2 },
    ];
    const dragonArenaValid = criticalDragonPositions.every(p => {
      const isCrownPos =
        (p.x === cx - 1 && p.y === cy - 1) ||
        (p.x === cx + 1 && p.y === cy - 1) ||
        (p.x === cx - 1 && p.y === cy + 1) ||
        (p.x === cx + 1 && p.y === cy + 1);
      const isCornerPos =
        (p.x === cx - 2 && p.y === cy - 2) ||
        (p.x === cx + 2 && p.y === cy - 2) ||
        (p.x === cx - 2 && p.y === cy + 2) ||
        (p.x === cx + 2 && p.y === cy + 2);
      const obj = map.getObject(p);
      const expectedObj = isCrownPos ? 'CHEST_DRAGON' : 'NONE';
      return (
        map.getBaseTile(p) === 'EMPTY' &&
        (obj === expectedObj || (isCornerPos && (obj === 'NONE' || obj === 'CHEST')))
      );
    });
    if (!dragonArenaValid) {
      issues.push('ドラゴン要塞の部位・斜め安全地帯・王冠出現マスに障害物が存在します');
    }

    const bootstrapValid =
      map.getBaseTile(map.homePos) === 'HOME' &&
      counts.swords >= 1 &&
      counts.keys >= 1 &&
      counts.rings >= 1 &&
      counts.potions >= 2 &&
      counts.crosses >= 1 &&
      counts.openGraves >= 5;
    if (!bootstrapValid) {
      issues.push('初期必須アイテムまたは開いた墓が不足しています');
    }

    const achievableStones = counts.floorPowerStones + Math.floor(counts.chests / 8);
    let simulatedStr = 10;
    for (let i = 0; i < achievableStones; i++) {
      simulatedStr += Player.calculatePowerStoneGain(simulatedStr, tuningParams?.progressionConfig);
    }

    const requiredDefRatio = tuningParams?.progressionConfig?.dragonDefRatio ?? 1.0;
    const requiredStr = Math.floor(450000 * requiredDefRatio);
    const minChests = tuningParams?.resourceCapConfig?.chestCount
      ? Math.floor(tuningParams.resourceCapConfig.chestCount * 0.75)
      : 75;

    const resourceSufficient = counts.chests >= minChests && simulatedStr >= requiredStr;
    if (!resourceSufficient) {
      issues.push(
        `資源不足: 宝箱=${counts.chests}個, 想定STR=${simulatedStr} (必要: 宝箱>=${minChests}, STR>=${requiredStr})`
      );
    }

    return {
      isSolvable:
        hasZeroOverlaps &&
        internalWallsAreBlocks &&
        dragonArenaValid &&
        bootstrapValid &&
        resourceSufficient,
      seed,
      hasZeroOverlaps,
      internalWallsAreBlocks,
      dragonArenaValid,
      bootstrapValid,
      resourceSufficient,
      counts,
      estimatedMaxStr: simulatedStr,
      issues,
    };
  }

  private static isCompletelyFree(map: WorldMap, x: number, y: number): boolean {
    if (!map.isInside({ x, y })) return false;
    return (
      map.getBaseTile({ x, y }) === 'EMPTY' &&
      map.getObject({ x, y }) === 'NONE' &&
      map.getItem({ x, y }) === 'NONE'
    );
  }
}
