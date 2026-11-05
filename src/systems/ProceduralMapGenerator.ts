import {
  Position,
  TileType,
  MapDifficulty,
  PlayPacingMode,
  DungeonTopology,
  DungeonArchetype,
  DungeonTuningParams,
  ResolvedDungeonTuningParams,
  RuleMode,
} from '../models/Types.js';
import { WorldMap } from '../models/WorldMap.js';
import { Player } from '../models/Player.js';
import { TuningPresetResolver } from '../config/TuningPresetResolver.js';
import { SeedRandom } from '../core/SeedRandom.js';

export const SeededRandom = SeedRandom;
export type SeededRandom = SeedRandom;
export type { SeedRandom };
export type { MapDifficulty, DungeonArchetype };

export type DragonPrefabType = 'COMPACT_5x5' | 'FORTRESS_7x7';
export type HomePrefabType = 'COMPACT_3x3' | 'COZY_5x5';

export interface ProceduralMapOptions {
  seed?: number;
  difficulty?: MapDifficulty;
  pacing?: PlayPacingMode;
  topology?: DungeonTopology;
  archetype?: DungeonArchetype;
  ruleMode?: RuleMode;
  chestCount?: number;
  graveCount?: number;
  dragonCenter?: Position;
  dragonPrefab?: DragonPrefabType;
  homePos?: Position;
  homePrefab?: HomePrefabType;
  tuningParams?: DungeonTuningParams;
}

export interface MapSolvabilityReport {
  isSolvable: boolean;
  seed: number;
  hasZeroOverlaps: boolean;
  internalWallsAreBlocks: boolean;
  dragonArenaValid: boolean;
  bootstrapValid: boolean;
  resourceSufficient: boolean;
  counts: {
    chests: number;
    graves: number;
    openGraves: number;
    blocks: number;
    swords: number;
    keys: number;
    rings: number;
    potions: number;
    crosses: number;
    floorPowerStones: number;
    warps: number;
  };
  estimatedMaxStr: number;
  issues: string[];
}

// SeedRandom (SeededRandom) は src/core/SeedRandom.ts から export済み

export interface SectorBounds {
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type SectorTypology =
  | 'STANDARD_ROOM'
  | 'GRAND_HALL'
  | 'LONG_CORRIDOR'
  | 'CRANK_CHAMBER'
  | 'ALCOVE_CELL'
  | 'PILLAR_GRID'
  | 'NARROW_MAZE'
  | 'SPIRAL_LABYRINTH';

export interface DynamicSector extends SectorBounds {
  typology?: SectorTypology;
}

/**
 * プロシージャル（自動）マップ生成器
 * 原作の「内部壁はすべて破壊・移動可能なブロック(BLOCK)であり、資源と初期導線が適切であればクリア可能」
 * という性質に基づき、64x64のスタンダードなパズルダンジョンを生成・検証する。
 */
export class ProceduralMapGenerator {
  /**
   * 不規則・可変セクター分割アルゴリズム (Dynamic Sector & Organic Layout)
   * 64x64全域を3x3（計9セクター＋ジッター揺らぎ）に有機分割し、
   * アスペクト比や面積に応じて有機的なセクタータイポロジーを割り当てる。
   */
  public static generateDynamicSectors(rng: SeededRandom): DynamicSector[] {
    // 境界ジッター（±2〜3マスの揺らぎ）
    const jX1 = rng.nextInt(-2, 2);
    const jX2 = rng.nextInt(-2, 2);
    const jY1 = rng.nextInt(-2, 2);
    const jY2 = rng.nextInt(-2, 2);

    const splitX1 = Math.max(18, Math.min(24, 21 + jX1));
    const splitX2 = Math.max(39, Math.min(45, 42 + jX2));
    const splitY1 = Math.max(18, Math.min(24, 21 + jY1));
    const splitY2 = Math.max(39, Math.min(45, 42 + jY2));

    const sectors: DynamicSector[] = [
      // 行 0 (NORTH)
      {
        name: 'NORTH_WEST',
        x1: 2,
        y1: 2,
        x2: splitX1,
        y2: splitY1,
      },
      {
        name: 'NORTH_CENTER',
        x1: splitX1 + 1,
        y1: 2,
        x2: splitX2,
        y2: splitY1,
      },
      {
        name: 'NORTH_EAST',
        x1: splitX2 + 1,
        y1: 2,
        x2: 61,
        y2: splitY1,
      },
      // 行 1 (CENTER)
      {
        name: 'WEST_CENTER',
        x1: 2,
        y1: splitY1 + 1,
        x2: splitX1,
        y2: splitY2,
      },
      {
        name: 'CENTER',
        x1: splitX1 + 1,
        y1: splitY1 + 1,
        x2: splitX2,
        y2: splitY2,
      },
      {
        name: 'EAST_CENTER',
        x1: splitX2 + 1,
        y1: splitY1 + 1,
        x2: 61,
        y2: splitY2,
      },
      // 行 2 (SOUTH)
      {
        name: 'SOUTH_WEST',
        x1: 2,
        y1: splitY2 + 1,
        x2: splitX1,
        y2: 61,
      },
      {
        name: 'SOUTH_CENTER',
        x1: splitX1 + 1,
        y1: splitY2 + 1,
        x2: splitX2,
        y2: 61,
      },
      {
        name: 'SOUTH_EAST',
        x1: splitX2 + 1,
        y1: splitY2 + 1,
        x2: 61,
        y2: 61,
      },
    ];

    // アスペクト比と位置に応じたタイポロジーの割り当て
    const availableTypologies: SectorTypology[] = [
      'GRAND_HALL',
      'CRANK_CHAMBER',
      'LONG_CORRIDOR',
      'PILLAR_GRID',
      'NARROW_MAZE',
      'SPIRAL_LABYRINTH',
      'STANDARD_ROOM',
    ];
    const shuffled = rng.shuffle([...availableTypologies]);

    for (let i = 0; i < sectors.length; i++) {
      const s = sectors[i];
      const w = s.x2 - s.x1;
      const h = s.y2 - s.y1;
      const aspect = w / Math.max(1, h);

      if (aspect > 1.8 || aspect < 0.55) {
        s.typology = 'LONG_CORRIDOR';
      } else if (w >= 16 && h >= 16 && (i === 4 || i === 0 || i === 8)) {
        s.typology = 'GRAND_HALL';
      } else {
        s.typology = shuffled[i % shuffled.length];
      }
    }

    return sectors;
  }
  /**
   * スタンダードなプロシージャル64x64マップを生成して map に適用する（旧互換用エイリアス）
   */
  public static generateStandardDungeon(
    map: WorldMap,
    options?: ProceduralMapOptions
  ): MapSolvabilityReport {
    return this.generateDungeon(map, {
      topology: 'STANDARD_ROOMS',
      dragonCenter: options?.dragonCenter ?? { x: 32, y: 32 },
      homePos: options?.homePos ?? { x: 7, y: 7 },
      ...options,
    });
  }

  /**
   * トポロジー・難易度・プレイ時間パラメータ連動のプロシージャル64x64ダンジョンを生成する
   */
  public static generateDungeon(
    map: WorldMap,
    options?: ProceduralMapOptions
  ): MapSolvabilityReport {
    const topology: DungeonTopology = options?.topology ?? 'STANDARD_ROOMS';
    const difficulty: MapDifficulty = options?.difficulty ?? 'NORMAL';
    const pacing: PlayPacingMode = options?.pacing ?? 'STANDARD';
    const archetype: DungeonArchetype = options?.archetype ?? 'BALANCED';
    const effectiveOverrides: DungeonTuningParams = {
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

    const rng = new SeededRandom(seed);

    // 1. マップ全レイヤーの初期化（トーラス構造のため外周壁は設置せず全面EMPTY）
    this.clearAndBuildOuterBorder(map);

    // 2. 64x64全域9セクター分割 (Dynamic Sector & Organic Layout)
    const sectors: DynamicSector[] = this.generateDynamicSectors(rng);

    // 3. 我が家セクターとアンカー位置の選定 & プレハブ埋め込み
    let homeSector: DynamicSector;
    let homePos: Position;
    if (options?.homePos) {
      homePos = { ...options.homePos };
      homeSector = sectors.find(
        s => homePos.x >= s.x1 && homePos.x <= s.x2 && homePos.y >= s.y1 && homePos.y <= s.y2
      ) ?? sectors[0];
    } else {
      // 9セクターの中からシード値に基づき完全ランダムに選定（北、南、東、西、中央のどこからでも開始可能）
      const homeSectorIdx = rng.nextInt(0, sectors.length - 1);
      homeSector = sectors[homeSectorIdx];
      homePos = {
        x: rng.nextInt(homeSector.x1 + 3, Math.max(homeSector.x1 + 3, homeSector.x2 - 3)),
        y: rng.nextInt(homeSector.y1 + 3, Math.max(homeSector.y1 + 3, homeSector.y2 - 3)),
      };
    }

    const homePrefab = options?.homePrefab ?? 'COMPACT_3x3';
    const { homePos: actualHomePos } = this.applyHomePrefab(
      map,
      homePos,
      homePrefab,
      difficulty,
      pacing,
      rng
    );
    homePos = actualHomePos;

    // 4. ドラゴンセクターとアンカー位置の選定 & プレハブ埋め込み
    let dragonCenter: Position;
    let dragonSector: DynamicSector;
    if (options?.dragonCenter) {
      dragonCenter = { ...options.dragonCenter };
      dragonSector = sectors.find(
        s => dragonCenter.x >= s.x1 && dragonCenter.x <= s.x2 && dragonCenter.y >= s.y1 && dragonCenter.y <= s.y2
      ) ?? sectors[4];
    } else {
      // 我が家からトーラス距離が十分離れたセクター群（マンハッタン距離 >= 20）からランダム選定
      const sectorDistances = sectors
        .filter(s => s !== homeSector)
        .map(s => {
          const centerS = { x: Math.floor((s.x1 + s.x2) / 2), y: Math.floor((s.y1 + s.y2) / 2) };
          return { sector: s, dist: map.getTorusDistance(homePos, centerS).manhattan };
        });
      sectorDistances.sort((a, b) => b.dist - a.dist);
      const topCandidates = sectorDistances.slice(0, Math.min(3, sectorDistances.length));
      dragonSector = topCandidates[rng.nextInt(0, topCandidates.length - 1)].sector;

      // タイポロジーに応じたドラゴンアンカー選定
      const sx1 = dragonSector.x1;
      const sx2 = dragonSector.x2;
      const sy1 = dragonSector.y1;
      const sy2 = dragonSector.y2;
      const scx = Math.floor((sx1 + sx2) / 2);
      const scy = Math.floor((sy1 + sy2) / 2);

      switch (dragonSector.typology) {
        case 'GRAND_HALL':
          // 大広間の中央に鎮座
          dragonCenter = { x: scx, y: scy };
          break;
        case 'LONG_CORRIDOR':
          // 回廊の最奥に巣食う
          dragonCenter = {
            x: sx2 - sx1 > sy2 - sy1 ? sx2 - 4 : scx,
            y: sy2 - sy1 > sx2 - sx1 ? sy2 - 4 : scy,
          };
          break;
        case 'CRANK_CHAMBER':
          // クランク奥の角に鎮座
          dragonCenter = { x: sx2 - 4, y: sy2 - 4 };
          break;
        case 'PILLAR_GRID':
        default:
          dragonCenter = { x: scx, y: scy };
          break;
      }
    }

    // ドラゴンプレハブ種類の選定（指定がなければセクター面積やオプションにより決定）
    const secW = dragonSector.x2 - dragonSector.x1;
    const secH = dragonSector.y2 - dragonSector.y1;
    const defaultDragonPrefab = options?.dragonCenter ? 'FORTRESS_7x7' : (secW >= 14 && secH >= 14 ? 'FORTRESS_7x7' : 'COMPACT_5x5');
    const dragonPrefab = options?.dragonPrefab ?? defaultDragonPrefab;

    this.applyDragonPrefab(map, dragonCenter, dragonPrefab, rng);
    this.ensureDragonFireballClearance(map, dragonCenter);

    // 5. スタートセクターの構築と難易度・ペーシング連動ブートストラップ配置
    this.buildProceduralStartSector(map, homePos, difficulty, pacing, sectors, rng);

    // 6. 周辺可変セクターの構造生成 (トポロジー別)
    if (topology === 'MULTI_SECTOR') {
      const topPool: (DungeonTopology | SectorTypology)[] = [
        'GRAND_HALL',
        'CRANK_CHAMBER',
        'LONG_CORRIDOR',
        'PILLAR_GRID',
        'NARROW_MAZE',
        'SPIRAL_LABYRINTH',
        'FORTRESS_ARENA',
      ];
      const shuffledTop = rng.shuffle([...topPool]);
      for (let i = 0; i < sectors.length; i++) {
        const top = sectors[i].typology ?? shuffledTop[i];
        this.buildSectorWithTypology(map, sectors[i], top, rng);
      }
    } else {
      for (const sector of sectors) {
        this.buildSectorTopology(map, sector, topology, rng);
      }
    }

    // プレハブ領域の再保護（セクター生成による上書きを修復）
    this.applyDragonPrefab(map, dragonCenter, dragonPrefab, rng);
    this.ensureDragonFireballClearance(map, dragonCenter);

    // 7. ギミック配置: 閉鎖された宝物庫 & パンドラの墓場
    // ドラゴンセクターと我が家セクター以外のセクターをギミック対象に選定
    const otherSectors = sectors.filter(s => s !== homeSector && s !== dragonSector);
    const vaultSector1 = otherSectors[0] ?? sectors[2];
    const vaultSector2 = otherSectors[1] ?? sectors[5];
    const pandoraSector = otherSectors[otherSectors.length - 1] ?? sectors[6];

    this.buildSealedTreasureVault(map, vaultSector1, rng);
    if (topology === 'MULTI_SECTOR' || topology === 'FORTRESS_ARENA' || topology === 'SPIRAL_LABYRINTH') {
      this.buildSealedTreasureVault(map, vaultSector2, rng);
    }
    const pandoraGraveCount = this.buildPandoraGraveyard(map, pandoraSector, rng);

    // 8. 有機的コリドー・連絡回廊の掘削（直線くり抜きを脱却し、脱格子感）
    this.carveDynamicCorridors(map, sectors, dragonCenter, rng);

    // MULTI_SECTOR 時のセクターゲート配置
    if (topology === 'MULTI_SECTOR') {
      this.placeSectorGates(map, dragonCenter);
    }

    // 8. 墓（GRAVE）と封鎖用パズル岩（BLOCK）の分散配置（パンドラ墓地分を差し引き）
    const remainingGraves = Math.max(0, targetGraves - pandoraGraveCount);
    this.placeGravesWithBlocks(map, sectors, remainingGraves, homePos, dragonCenter, rng);

    // 9. 原作風の「宝物地帯（Treasure Zones / 宝箱密集エリア）」を生成し、残りをマップ全域へ分散配置
    this.buildTreasureZones(map, sectors, homePos, dragonCenter, rng);
    this.placeChestsAcrossMap(map, sectors, targetChests, homePos, dragonCenter, rng);

    // 10. 広大すぎる空地（スカスカ空間）を検知し、適度な岩塊・ピラーを散布して密度を向上
    this.densifyOpenAreas(map, homePos, dragonCenter, rng);

    // 11. 床置きアイテム（追加パワーストーン、魔法の壺、コイン、予備装備）の配置
    this.placeFloorItemsAcrossMap(map, sectors, homePos, dragonCenter, rng, tuningParams, archetype);

    // 12. ワープゾーンネットワークの配置
    this.placeProceduralWarps(map, sectors, dragonCenter, rng, archetype);

    // 13. 最終セーフティクリーンアップ（ドラゴン部位・王冠4マス・プレイヤー初期位置(8,8)の保護）
    this.enforceCriticalClearance(map, homePos, dragonCenter);

    return this.validateSolvability(map, dragonCenter, seed, tuningParams);
  }

  /**
   * マップ全体を初期化（トーラス構造のため外周壁は設置せず全面EMPTY）
   */
  private static clearAndBuildOuterBorder(map: WorldMap): void {
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
   * ドラゴンエリア・プレハブ（スタンプ）配置
   * 任意の中心座標(center)に自己完結型の防衛構造コアを埋め込む。
   * - COMPACT_5x5: 最小25マスの中で3首正面バリア、火炎弾射線、王冠4箇所、進入路を完全成立。
   * - FORTRESS_7x7: 49マス中規模要塞。各首正面にPOTION+CHESTの2段バリアとコーナークランク開口部。
   */
  public static applyDragonPrefab(
    map: WorldMap,
    center: Position,
    type: DragonPrefabType = 'COMPACT_5x5',
    rng?: SeededRandom
  ): void {
    const cx = center.x;
    const cy = center.y;
    map.setDragonCenter(center);

    if (type === 'COMPACT_5x5') {
      // 5x5 ミニマル・ドラゴンコア (cx-2..cx+2, cy-2..cy+2)
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const p = map.wrapPosition({ x: cx + dx, y: cy + dy });
          map.setBaseTile(p, 'EMPTY');
          map.setObject(p, 'NONE');
          map.setItem(p, 'NONE');
        }
      }

      // 1. ドラゴン十字部位 (BODY, UP, LFT, RGT, DWN) は空床(EMPTY)
      // (cx, cy), (cx, cy-1), (cx-1, cy), (cx+1, cy), (cx, cy+1)

      // 2. 王冠出現マス 4箇所 (CHEST_DRAGON)
      const dragonChests: Position[] = [
        { x: cx - 1, y: cy - 1 },
        { x: cx + 1, y: cy - 1 },
        { x: cx - 1, y: cy + 1 },
        { x: cx + 1, y: cy + 1 },
      ];
      for (const pos of dragonChests) {
        map.setObject(map.wrapPosition(pos), 'CHEST_DRAGON');
      }

      // 3. 3首正面アンチ・ブロック押し込みバリア
      // 中首(UP: cx, cy-1)正面: (cx, cy-2) に POTION
      map.setItem(map.wrapPosition({ x: cx, y: cy - 2 }), 'POTION');
      // 左首(LFT: cx-1, cy)正面: (cx-2, cy) に CHEST
      map.setObject(map.wrapPosition({ x: cx - 2, y: cy }), 'CHEST');
      // 右首(RGT: cx+1, cy)正面: (cx+2, cy) に CHEST
      map.setObject(map.wrapPosition({ x: cx + 2, y: cy }), 'CHEST');

      // 4. BLOCK (#) による挟み込み & 進入路形成
      const blocks: Position[] = [
        // 北側バリア挟み込み
        { x: cx - 1, y: cy - 2 },
        { x: cx + 1, y: cy - 2 },
        // 西・東の首側壁
        { x: cx - 2, y: cy - 1 },
        { x: cx + 2, y: cy - 1 },
        { x: cx - 2, y: cy + 1 },
        { x: cx + 2, y: cy + 1 },
        // 南側進入路 (cx, cy+2) の左右挟み込み
        { x: cx - 1, y: cy + 2 },
        { x: cx + 1, y: cy + 2 },
      ];
      for (const pos of blocks) {
        map.setObject(map.wrapPosition(pos), 'BLOCK');
      }

      // 南側進入路 (cx, cy+2) は空床 (ENT: EMPTY)
      map.setBaseTile(map.wrapPosition({ x: cx, y: cy + 2 }), 'EMPTY');
      map.setObject(map.wrapPosition({ x: cx, y: cy + 2 }), 'NONE');
      map.setItem(map.wrapPosition({ x: cx, y: cy + 2 }), 'NONE');

      // 四隅 (cx±2, cy±2) は空床(EMPTY)のまま
    } else if (type === 'FORTRESS_7x7') {
      // 7x7 セミオープン要塞コア (cx-3..cx+3, cy-3..cy+3)
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const p = map.wrapPosition({ x: cx + dx, y: cy + dy });
          map.setBaseTile(p, 'EMPTY');
          map.setObject(p, 'NONE');
          map.setItem(p, 'NONE');
        }
      }

      // 1. ドラゴン十字部位 & 王冠出現マス 4箇所
      const dragonChests: Position[] = [
        { x: cx - 1, y: cy - 1 },
        { x: cx + 1, y: cy - 1 },
        { x: cx - 1, y: cy + 1 },
        { x: cx + 1, y: cy + 1 },
      ];
      for (const pos of dragonChests) {
        map.setObject(map.wrapPosition(pos), 'CHEST_DRAGON');
      }

      // 2. 各首正面の2段バリア (POTION + CHEST)
      // 中首(UP)正面:
      // (cx, cy-2): POTION, (cx, cy-3): CHEST
      map.setItem(map.wrapPosition({ x: cx, y: cy - 2 }), 'POTION');
      map.setObject(map.wrapPosition({ x: cx, y: cy - 3 }), 'CHEST');
      map.setObject(map.wrapPosition({ x: cx, y: cy - 4 }), 'BLOCK');
      // 側壁 BLOCK:
      map.setObject(map.wrapPosition({ x: cx - 1, y: cy - 2 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx + 1, y: cy - 2 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx - 1, y: cy - 3 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx + 1, y: cy - 3 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx - 2, y: cy - 3 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx + 2, y: cy - 3 }), 'BLOCK');

      // 左首(LFT)正面:
      // (cx-2, cy): CHEST, (cx-3, cy): POTION
      map.setObject(map.wrapPosition({ x: cx - 2, y: cy }), 'CHEST');
      map.setItem(map.wrapPosition({ x: cx - 3, y: cy }), 'POTION');
      // 側壁 BLOCK:
      map.setObject(map.wrapPosition({ x: cx - 2, y: cy - 1 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx - 2, y: cy + 1 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx - 3, y: cy - 1 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx - 3, y: cy + 1 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx - 3, y: cy - 2 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx - 3, y: cy + 2 }), 'BLOCK');

      // 右首(RGT)正面:
      // (cx+2, cy): CHEST, (cx+3, cy): POTION
      map.setObject(map.wrapPosition({ x: cx + 2, y: cy }), 'CHEST');
      map.setItem(map.wrapPosition({ x: cx + 3, y: cy }), 'POTION');
      // 側壁 BLOCK:
      map.setObject(map.wrapPosition({ x: cx + 2, y: cy - 1 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx + 2, y: cy + 1 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx + 3, y: cy - 1 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx + 3, y: cy + 1 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx + 3, y: cy - 2 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx + 3, y: cy + 2 }), 'BLOCK');

      // 南側進入路:
      // (cx, cy+2), (cx, cy+3) は EMPTY
      map.setObject(map.wrapPosition({ x: cx - 1, y: cy + 2 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx + 1, y: cy + 2 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx - 1, y: cy + 3 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx + 1, y: cy + 3 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx - 2, y: cy + 3 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: cx + 2, y: cy + 3 }), 'BLOCK');

      // 報酬宝箱 (四隅小部屋)
      const cornerChests: Position[] = [
        { x: cx - 2, y: cy - 2 },
        { x: cx + 2, y: cy - 2 },
        { x: cx - 2, y: cy + 2 },
        { x: cx + 2, y: cy + 2 },
      ];
      for (const pos of cornerChests) {
        if (!rng || rng.next() < 0.75) {
          map.setObject(map.wrapPosition(pos), 'CHEST');
        }
      }

      // 四隅 (cx±3, cy±3) は直角クランクの進入路として EMPTY を維持
    }
  }

  /**
   * 我が家（HOME）プレハブ（スタンプ）配置
   * HOMEタイルとプレイヤー初期位置playerStart、初期回復ポット・金貨・保護壁をコンパクトに配置。
   */
  public static applyHomePrefab(
    map: WorldMap,
    anchor: Position,
    type: HomePrefabType = 'COMPACT_3x3',
    difficulty: MapDifficulty = 'NORMAL',
    _pacing: PlayPacingMode = 'STANDARD',
    _rng?: SeededRandom
  ): { homePos: Position; playerStart: Position } {
    const ax = anchor.x;
    const ay = anchor.y;
    const homePos = { x: ax, y: ay };

    if (type === 'COMPACT_3x3') {
      const playerStart = map.wrapPosition({ x: ax + 1, y: ay });

      // 3x3 エリアのクリア
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const p = map.wrapPosition({ x: ax + dx, y: ay + dy });
          map.setBaseTile(p, 'EMPTY');
          map.setObject(p, 'NONE');
          map.setItem(p, 'NONE');
        }
      }

      // 我が家とプレイヤー初期位置
      map.setBaseTile(homePos, 'HOME');
      map.setInitialHomePos(homePos);
      map.setBaseTile(playerStart, 'EMPTY');

      // 保護ブロック
      map.setObject(map.wrapPosition({ x: ax - 1, y: ay }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: ax + 1, y: ay - 1 }), 'BLOCK');
      map.setObject(map.wrapPosition({ x: ax + 1, y: ay + 1 }), 'BLOCK');

      // 初期アイテム
      map.setItem(map.wrapPosition({ x: ax, y: ay - 1 }), 'POTION');
      map.setItem(map.wrapPosition({ x: ax, y: ay + 1 }), 'COIN');

      // EASY難易度なら近傍に SWORD, RING, KEY, CROSS を配置
      if (difficulty === 'EASY') {
        map.setItem(map.wrapPosition({ x: ax - 1, y: ay - 1 }), 'SWORD');
        map.setItem(map.wrapPosition({ x: ax - 1, y: ay + 1 }), 'RING');
        this.safePlaceItem(map, ax + 2, ay, 'KEY');
        this.safePlaceItem(map, ax, ay - 2, 'CROSS');
      }

      return { homePos, playerStart };
    } else {
      // COZY_5x5
      const playerStart = map.wrapPosition({ x: ax + 1, y: ay + 1 });

      // 5x5 エリアのクリア
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const p = map.wrapPosition({ x: ax + dx, y: ay + dy });
          map.setBaseTile(p, 'EMPTY');
          map.setObject(p, 'NONE');
          map.setItem(p, 'NONE');
        }
      }

      map.setBaseTile(homePos, 'HOME');
      map.setInitialHomePos(homePos);
      map.setBaseTile(playerStart, 'EMPTY');

      // 外周ブロック（出入口を北と東に開ける）
      for (let dx = -2; dx <= 2; dx++) {
        if (dx !== 0) map.setObject(map.wrapPosition({ x: ax + dx, y: ay - 2 }), 'BLOCK');
        map.setObject(map.wrapPosition({ x: ax + dx, y: ay + 2 }), 'BLOCK');
      }
      for (let dy = -2; dy <= 2; dy++) {
        map.setObject(map.wrapPosition({ x: ax - 2, y: ay + dy }), 'BLOCK');
        if (dy !== 0) map.setObject(map.wrapPosition({ x: ax + 2, y: ay + dy }), 'BLOCK');
      }

      // 内部アイテム
      map.setItem(map.wrapPosition({ x: ax - 1, y: ay - 1 }), 'POTION');
      map.setItem(map.wrapPosition({ x: ax + 1, y: ay - 1 }), 'COIN');
      map.setItem(map.wrapPosition({ x: ax - 1, y: ay + 1 }), 'COIN');

      if (difficulty === 'EASY') {
        map.setItem(map.wrapPosition({ x: ax, y: ay - 1 }), 'SWORD');
        map.setItem(map.wrapPosition({ x: ax, y: ay + 1 }), 'RING');
        map.setItem(map.wrapPosition({ x: ax - 1, y: ay }), 'KEY');
        map.setItem(map.wrapPosition({ x: ax + 1, y: ay }), 'CROSS');
      }

      return { homePos, playerStart };
    }
  }

  /**
   * ドラゴンの各首正面に最低3〜4マスの火炎弾射線クリアランス（EMPTY床）を確保する
   */
  public static ensureDragonFireballClearance(map: WorldMap, center: Position): void {
    const cx = center.x;
    const cy = center.y;

    // 1. 中首(UP) 正面: 北方向 (cy-5..cy-8)
    for (let dy = -5; dy >= -8; dy--) {
      const p = map.wrapPosition({ x: cx, y: cy + dy });
      if (map.getObject(p) === 'BLOCK') map.setObject(p, 'NONE');
      if (map.getBaseTile(p) === 'WALL_STATIC') map.setBaseTile(p, 'EMPTY');
    }

    // 2. 左首(LFT) 正面: 西方向 (cx-5..cx-8)
    for (let dx = -5; dx >= -8; dx--) {
      const p = map.wrapPosition({ x: cx + dx, y: cy });
      if (map.getObject(p) === 'BLOCK') map.setObject(p, 'NONE');
      if (map.getBaseTile(p) === 'WALL_STATIC') map.setBaseTile(p, 'EMPTY');
    }

    // 3. 右首(RGT) 正面: 東方向 (cx+5..cx+8)
    for (let dx = 5; dx <= 8; dx++) {
      const p = map.wrapPosition({ x: cx + dx, y: cy });
      if (map.getObject(p) === 'BLOCK') map.setObject(p, 'NONE');
      if (map.getBaseTile(p) === 'WALL_STATIC') map.setBaseTile(p, 'EMPTY');
    }
  }

  /**
   * 中央ドラゴン要塞構築（プレハブスタンプ互換ラッパー）
   */
  public static buildProceduralDragonFortress(
    map: WorldMap,
    center: Position,
    rng: SeededRandom
  ): void {
    this.applyDragonPrefab(map, center, 'FORTRESS_7x7', rng);
    this.ensureDragonFireballClearance(map, center);
  }

  /**
   * スタートセクター (2..21, 2..21) の構築と難易度別ブートストラップ配置
   */
  /**
   * スタートセクターの構築と難易度・ペーシング連動ブートストラップ配置
   * 【重要アイテムの導線距離スケーリング】:
   * - EASY: 我が家近傍で全重要アイテム（SWORD, RING, KEY, CROSS）を即回収可能。
   * - NORMAL: 我が家近傍に RING と 回復POTION。中距離に KEY。遠隔セクターに SWORD。
   * - HARD: 我が家内は完全素手（POTION 1個のみ）。RING は中距離、KEY は遠距離、
   *   SWORD はペーシング連動の最遠隔セクター、CROSS は深部に配置。
   */
  private static buildProceduralStartSector(
    map: WorldMap,
    homePos: Position,
    difficulty: MapDifficulty,
    pacing: PlayPacingMode,
    _sectors: DynamicSector[],
    rng: SeededRandom
  ): void {
    // 墓を我が家から適度な距離（4〜7マス）に1〜2基配置し、近くに封鎖用ブロックを置く
    const gravePos1 = this.findAccessibleSpotAround(map, homePos, 4, 7, rng);
    map.setBaseTile(gravePos1, 'GRAVE');
    const bPos1 = map.wrapPosition({ x: gravePos1.x, y: gravePos1.y - 1 });
    if (this.isTileCompletelyFree(map, bPos1.x, bPos1.y)) {
      this.safePlaceBlock(map, bPos1.x, bPos1.y);
    }

    const gravePos2 = this.findAccessibleSpotAround(map, homePos, 5, 8, rng);
    map.setBaseTile(gravePos2, 'GRAVE');
    const bPos2 = map.wrapPosition({ x: gravePos2.x + 1, y: gravePos2.y });
    if (this.isTileCompletelyFree(map, bPos2.x, bPos2.y)) {
      this.safePlaceBlock(map, bPos2.x, bPos2.y);
    }

    // ペーシングによる距離スケーリング係数 (BLITZ: 0.75, STANDARD: 1.0, MARATHON: 1.25)
    const distanceScale = pacing === 'BLITZ' ? 0.75 : pacing === 'MARATHON' ? 1.25 : 1.0;

    // 難易度別の必須ブートストラップアイテム配置
    if (difficulty === 'EASY') {
      // EASY: すべて我が家の至近（マンハッタン距離 1〜3）で即座に回収可能
      const swordPos = this.findAccessibleSpotAround(map, homePos, 1, 3, rng);
      this.safePlaceItem(map, swordPos.x, swordPos.y, 'SWORD');

      const ringPos = this.findAccessibleSpotAround(map, homePos, 1, 3, rng);
      this.safePlaceItem(map, ringPos.x, ringPos.y, 'RING');

      const keyPos = this.findAccessibleSpotAround(map, homePos, 1, 4, rng);
      this.safePlaceItem(map, keyPos.x, keyPos.y, 'KEY');

      const crossPos = this.findAccessibleSpotAround(map, homePos, 1, 3, rng);
      this.safePlaceItem(map, crossPos.x, crossPos.y, 'CROSS');

      const potionPos1 = this.findAccessibleSpotAround(map, homePos, 1, 3, rng);
      this.safePlaceItem(map, potionPos1.x, potionPos1.y, 'POTION');

      const potionPos2 = this.findAccessibleSpotAround(map, homePos, 1, 3, rng);
      this.safePlaceItem(map, potionPos2.x, potionPos2.y, 'POTION');

      const psPos = this.findAccessibleSpotAround(map, homePos, 1, 3, rng);
      this.safePlaceItem(map, psPos.x, psPos.y, 'POWER_STONE');

      const coinPos = this.findAccessibleSpotAround(map, homePos, 1, 3, rng);
      this.safePlaceItem(map, coinPos.x, coinPos.y, 'COIN');
    } else if (difficulty === 'NORMAL') {
      // NORMAL:
      // 我が家近傍（距離 1〜3）: RING, CROSS, POTION(x2), POWER_STONE, COIN
      const ringPos = this.findAccessibleSpotAround(map, homePos, 1, 3, rng);
      this.safePlaceItem(map, ringPos.x, ringPos.y, 'RING');

      const crossPos = this.findAccessibleSpotAround(map, homePos, 1, 4, rng);
      this.safePlaceItem(map, crossPos.x, crossPos.y, 'CROSS');

      const potPos1 = this.findAccessibleSpotAround(map, homePos, 1, 3, rng);
      this.safePlaceItem(map, potPos1.x, potPos1.y, 'POTION');

      const potPos2 = this.findAccessibleSpotAround(map, homePos, 2, 5, rng);
      this.safePlaceItem(map, potPos2.x, potPos2.y, 'POTION');

      const psPos = this.findAccessibleSpotAround(map, homePos, 1, 3, rng);
      this.safePlaceItem(map, psPos.x, psPos.y, 'POWER_STONE');

      const coinPos = this.findAccessibleSpotAround(map, homePos, 1, 3, rng);
      this.safePlaceItem(map, coinPos.x, coinPos.y, 'COIN');

      // KEY: 我が家から中距離（トーラス距離 6〜12）
      const keyPos = this.findAccessibleSpotAround(map, homePos, 6, 12, rng);
      this.safePlaceItem(map, keyPos.x, keyPos.y, 'KEY');

      // SWORD: 遠距離（トーラス距離 10〜16 * distanceScale）
      const swordMinDist = Math.floor(10 * distanceScale);
      const swordMaxDist = Math.floor(16 * distanceScale);
      const swordPos = this.findAccessibleSpotAround(map, homePos, swordMinDist, swordMaxDist, rng);
      this.safePlaceItem(map, swordPos.x, swordPos.y, 'SWORD');
    } else {
      // HARD: 完全素手・指輪なしステルス潜入スタート
      // 我が家近傍: 回復ポット 1個と金貨のみ
      const potPos = this.findAccessibleSpotAround(map, homePos, 1, 2, rng);
      this.safePlaceItem(map, potPos.x, potPos.y, 'POTION');

      const coinPos1 = this.findAccessibleSpotAround(map, homePos, 1, 2, rng);
      this.safePlaceItem(map, coinPos1.x, coinPos1.y, 'COIN');

      const coinPos2 = this.findAccessibleSpotAround(map, homePos, 1, 3, rng);
      this.safePlaceItem(map, coinPos2.x, coinPos2.y, 'COIN');

      // 1. RING: 我が家の外周（トーラス距離 8〜14）
      const ringPos = this.findAccessibleSpotAround(map, homePos, 8, 14, rng);
      this.safePlaceItem(map, ringPos.x, ringPos.y, 'RING');

      // 2. KEY: 中距離（トーラス距離 15〜22）
      const keyPos = this.findAccessibleSpotAround(map, homePos, 15, 22, rng);
      this.safePlaceItem(map, keyPos.x, keyPos.y, 'KEY');

      // 3. SWORD: ペーシングに応じた最遠部
      let swordMinDist = 24;
      let swordMaxDist = 36;
      if (pacing === 'BLITZ') {
        swordMinDist = 20;
        swordMaxDist = 26;
      } else if (pacing === 'MARATHON') {
        swordMinDist = 34;
        swordMaxDist = 58;
      }
      const swordPos = this.findAccessibleSpotAround(map, homePos, swordMinDist, swordMaxDist, rng);
      this.safePlaceItem(map, swordPos.x, swordPos.y, 'SWORD');

      // 4. CROSS: 深部（トーラス距離 20〜45）
      const crossPos = this.findAccessibleSpotAround(map, homePos, 20, 45, rng);
      this.safePlaceItem(map, crossPos.x, crossPos.y, 'CROSS');
    }

    // 我が家近傍の導入用宝箱（3個、距離 2〜5）
    for (let c = 0; c < 3; c++) {
      const chestPos = this.findAccessibleSpotAround(map, homePos, 2, 5, rng);
      this.safePlaceChest(map, chestPos.x, chestPos.y);
    }
  }

  /**
   * マップ全体から、我が家からのトーラス・マンハッタン距離が [minDist, maxDist] の通行可能な空床マスを探索
   */
  private static findAccessibleSpotAround(
    map: WorldMap,
    center: Position,
    minDist: number,
    maxDist: number,
    rng: SeededRandom
  ): Position {
    for (let tries = 0; tries < 250; tries++) {
      const angle = rng.next() * Math.PI * 2;
      const dist = rng.nextInt(minDist, maxDist);
      const x = Math.floor(center.x + Math.cos(angle) * dist);
      const y = Math.floor(center.y + Math.sin(angle) * dist);
      const pos = map.wrapPosition({ x, y });
      const mDist = map.getTorusDistance(center, pos).manhattan;
      if (mDist >= minDist && mDist <= maxDist && this.isTileCompletelyFree(map, pos.x, pos.y)) {
        return pos;
      }
    }
    // ランダム探索で見つからない場合の網羅探索
    let bestPos = map.wrapPosition({ x: center.x + minDist, y: center.y });
    let bestDiff = 9999;
    for (let y = 1; y < map.height - 1; y++) {
      for (let x = 1; x < map.width - 1; x++) {
        if (this.isTileCompletelyFree(map, x, y)) {
          const d = map.getTorusDistance(center, { x, y }).manhattan;
          if (d >= minDist && d <= maxDist) {
            return { x, y };
          }
          const diff = Math.abs(d - ((minDist + maxDist) / 2));
          if (diff < bestDiff) {
            bestDiff = diff;
            bestPos = { x, y };
          }
        }
      }
    }
    return bestPos;
  }

  /**
   * 各セクターにプロシージャルなブロック部屋と倉庫番ピラー（柱）を生成
   */
  private static buildSectorRoomAndPillars(
    map: WorldMap,
    sector: SectorBounds,
    rng: SeededRandom
  ): void {
    const rx1 = sector.x1 + 1;
    const ry1 = sector.y1 + 1;
    const rx2 = sector.x2 - 1;
    const ry2 = sector.y2 - 1;

    if (rx2 - rx1 < 6 || ry2 - ry1 < 6) return;

    const midX = Math.floor((rx1 + rx2) / 2);
    const midY = Math.floor((ry1 + ry2) / 2);

    // 部屋の外枠を BLOCK で描画（各辺の中央付近に幅2〜3の出入口を空ける）
    for (let x = rx1; x <= rx2; x++) {
      if (Math.abs(x - midX) > 1) {
        this.safePlaceBlock(map, x, ry1);
        this.safePlaceBlock(map, x, ry2);
      }
    }
    for (let y = ry1; y <= ry2; y++) {
      if (Math.abs(y - midY) > 1) {
        this.safePlaceBlock(map, rx1, y);
        this.safePlaceBlock(map, rx2, y);
      }
    }

    // 部屋の内部パターン（密度を向上）
    const style = rng.nextInt(0, 2);
    if (style === 0) {
      // 規則的な柱グリッド (2〜3マスおきに高密度配置)
      for (let y = ry1 + 2; y <= ry2 - 2; y += 2) {
        for (let x = rx1 + 2; x <= rx2 - 2; x += 2) {
          if (rng.next() < 0.8) {
            this.safePlaceBlock(map, x, y);
          }
        }
      }
    } else if (style === 1) {
      // 十字・L字の小間仕切り
      for (let x = rx1 + 2; x <= rx2 - 2; x++) {
        if (Math.abs(x - midX) > 2) {
          this.safePlaceBlock(map, x, midY);
        }
      }
      for (let y = ry1 + 2; y <= ry2 - 2; y++) {
        if (Math.abs(y - midY) > 2) {
          this.safePlaceBlock(map, midX, y);
        }
      }
    } else {
      // ランダム岩塊・家具クラスター
      const rockCount = rng.nextInt(12, 20);
      for (let i = 0; i < rockCount; i++) {
        const bx = rng.nextInt(rx1 + 2, rx2 - 2);
        const by = rng.nextInt(ry1 + 2, ry2 - 2);
        this.safePlaceBlock(map, bx, by);
      }
    }

    // 部屋内部のドア開口部脇に可動ブロックを配置（倉庫番パズル用）
    this.safePlaceBlock(map, midX + 2, ry1);
    this.safePlaceBlock(map, midX - 2, ry2);
  }

  /**
   * トポロジーに応じたセクター構造を構築
   */
  private static buildSectorTopology(
    map: WorldMap,
    sector: SectorBounds,
    topology: DungeonTopology,
    rng: SeededRandom
  ): void {
    switch (topology) {
      case 'PILLAR_GRID':
        this.buildSectorPillarGrid(map, sector, rng);
        break;
      case 'NARROW_MAZE':
        this.buildSectorNarrowMaze(map, sector, rng);
        break;
      case 'SPIRAL_LABYRINTH':
        this.buildSectorSpiralLabyrinth(map, sector, rng);
        break;
      case 'FORTRESS_ARENA':
        this.buildSectorFortressArena(map, sector, rng);
        break;
      case 'STANDARD_ROOMS':
      default:
        this.buildSectorRoomAndPillars(map, sector, rng);
        break;
    }
  }

  /**
   * 有機的タイポロジー (SectorTypology) またはダンジョントポロジーに応じた構造を構築
   */
  private static buildSectorWithTypology(
    map: WorldMap,
    sector: SectorBounds,
    typology: SectorTypology | DungeonTopology,
    rng: SeededRandom
  ): void {
    switch (typology) {
      case 'GRAND_HALL':
        this.buildSectorGrandHall(map, sector, rng);
        break;
      case 'LONG_CORRIDOR':
        this.buildSectorLongCorridor(map, sector, rng);
        break;
      case 'CRANK_CHAMBER':
        this.buildSectorCrankChamber(map, sector, rng);
        break;
      case 'PILLAR_GRID':
        this.buildSectorPillarGrid(map, sector, rng);
        break;
      case 'NARROW_MAZE':
        this.buildSectorNarrowMaze(map, sector, rng);
        break;
      case 'SPIRAL_LABYRINTH':
        this.buildSectorSpiralLabyrinth(map, sector, rng);
        break;
      case 'FORTRESS_ARENA':
        this.buildSectorFortressArena(map, sector, rng);
        break;
      case 'STANDARD_ROOM':
      case 'STANDARD_ROOMS':
      default:
        this.buildSectorRoomAndPillars(map, sector, rng);
        break;
    }
  }

  /**
   * 巨大広間型 (GRAND_HALL): 広い空間、四隅や島状のピラー群
   */
  private static buildSectorGrandHall(
    map: WorldMap,
    sector: SectorBounds,
    rng: SeededRandom
  ): void {
    const rx1 = sector.x1 + 1;
    const ry1 = sector.y1 + 1;
    const rx2 = sector.x2 - 1;
    const ry2 = sector.y2 - 1;
    if (rx2 - rx1 < 6 || ry2 - ry1 < 6) return;

    const midX = Math.floor((rx1 + rx2) / 2);
    const midY = Math.floor((ry1 + ry2) / 2);

    for (let x = rx1; x <= rx2; x++) {
      if (Math.abs(x - midX) > 2) {
        this.safePlaceBlock(map, x, ry1);
        this.safePlaceBlock(map, x, ry2);
      }
    }
    for (let y = ry1; y <= ry2; y++) {
      if (Math.abs(y - midY) > 2) {
        this.safePlaceBlock(map, rx1, y);
        this.safePlaceBlock(map, rx2, y);
      }
    }

    // 中央の 2x2 装飾島ピラー
    this.safePlaceBlock(map, midX - 1, midY - 1);
    this.safePlaceBlock(map, midX + 1, midY - 1);
    this.safePlaceBlock(map, midX - 1, midY + 1);
    this.safePlaceBlock(map, midX + 1, midY + 1);

    // まばらに散布されるピラー
    const count = rng.nextInt(6, 12);
    for (let i = 0; i < count; i++) {
      const px = rng.nextInt(rx1 + 3, rx2 - 3);
      const py = rng.nextInt(ry1 + 3, ry2 - 3);
      if (Math.abs(px - midX) > 2 || Math.abs(py - midY) > 2) {
        this.safePlaceBlock(map, px, py);
      }
    }
  }

  /**
   * 細長い連絡トンネル型 (LONG_CORRIDOR): 1〜2マス幅のジグザグ・クランク通路
   */
  private static buildSectorLongCorridor(
    map: WorldMap,
    sector: SectorBounds,
    _rng: SeededRandom
  ): void {
    const rx1 = sector.x1 + 1;
    const ry1 = sector.y1 + 1;
    const rx2 = sector.x2 - 1;
    const ry2 = sector.y2 - 1;
    const isHorizontal = (rx2 - rx1) >= (ry2 - ry1);

    if (isHorizontal) {
      const midY = Math.floor((ry1 + ry2) / 2);
      for (let x = rx1; x <= rx2; x++) {
        if (x % 3 !== 0) {
          this.safePlaceBlock(map, x, midY - 1);
          this.safePlaceBlock(map, x, midY + 1);
        }
      }
    } else {
      const midX = Math.floor((rx1 + rx2) / 2);
      for (let y = ry1; y <= ry2; y++) {
        if (y % 3 !== 0) {
          this.safePlaceBlock(map, midX - 1, y);
          this.safePlaceBlock(map, midX + 1, y);
        }
      }
    }
  }

  /**
   * クランク部屋型 (CRANK_CHAMBER): L字やクランク状に屈曲した壁で分割された部屋
   */
  private static buildSectorCrankChamber(
    map: WorldMap,
    sector: SectorBounds,
    rng: SeededRandom
  ): void {
    const rx1 = sector.x1 + 1;
    const ry1 = sector.y1 + 1;
    const rx2 = sector.x2 - 1;
    const ry2 = sector.y2 - 1;
    if (rx2 - rx1 < 6 || ry2 - ry1 < 6) return;

    const midX = Math.floor((rx1 + rx2) / 2);
    const midY = Math.floor((ry1 + ry2) / 2);

    for (let x = rx1; x <= rx2; x++) {
      if (Math.abs(x - midX) > 1) {
        this.safePlaceBlock(map, x, ry1);
        this.safePlaceBlock(map, x, ry2);
      }
    }
    for (let y = ry1; y <= ry2; y++) {
      if (Math.abs(y - midY) > 1) {
        this.safePlaceBlock(map, rx1, y);
        this.safePlaceBlock(map, rx2, y);
      }
    }

    const invert = rng.next() < 0.5;
    if (invert) {
      for (let x = rx1 + 2; x <= midX; x++) {
        this.safePlaceBlock(map, x, midY);
      }
      for (let y = midY; y <= ry2 - 2; y++) {
        this.safePlaceBlock(map, midX, y);
      }
    } else {
      for (let x = midX; x <= rx2 - 2; x++) {
        this.safePlaceBlock(map, x, midY);
      }
      for (let y = ry1 + 2; y <= midY; y++) {
        this.safePlaceBlock(map, midX, y);
      }
    }
  }

  /**
   * ピラー広場型 (PILLAR_GRID): 規則的な柱グリッドと岩押し退避路（高密度化）
   */
  private static buildSectorPillarGrid(
    map: WorldMap,
    sector: SectorBounds,
    rng: SeededRandom
  ): void {
    for (let y = sector.y1 + 1; y <= sector.y2 - 1; y++) {
      for (let x = sector.x1 + 1; x <= sector.x2 - 1; x++) {
        // 2マスおきを基本とし、適度な連結柱を生成
        if ((x - sector.x1) % 2 === 0 && (y - sector.y1) % 2 === 0) {
          if (rng.next() < 0.85) {
            this.safePlaceBlock(map, x, y);
            if (rng.next() < 0.35) {
              const dirs = [
                { dx: 1, dy: 0 },
                { dx: -1, dy: 0 },
                { dx: 0, dy: 1 },
                { dx: 0, dy: -1 },
              ];
              const d = dirs[rng.nextInt(0, 3)];
              this.safePlaceBlock(map, x + d.dx, y + d.dy);
            }
          }
        }
      }
    }
  }

  /**
   * 幅1マス迷路型 (NARROW_MAZE): 通路幅1マス・壁厚1マスのクラシック迷路
   * 約15%の壁を間引いてループ・T字路を形成し、BREAK魔法の掘削ショートカット性を最大化
   */
  private static buildSectorNarrowMaze(
    map: WorldMap,
    sector: SectorBounds,
    rng: SeededRandom
  ): void {
    for (let y = sector.y1 + 1; y <= sector.y2 - 1; y += 2) {
      for (let x = sector.x1 + 1; x <= sector.x2 - 1; x += 2) {
        this.safePlaceBlock(map, x, y);
        if (rng.next() < 0.15) continue; // 約15%スキップしてループ形成

        const dirs: [number, number][] = [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ];
        const [dx, dy] = dirs[rng.nextInt(0, 3)];
        this.safePlaceBlock(map, x + dx, y + dy);
      }
    }
  }

  /**
   * 渦巻き要塞型 (SPIRAL_LABYRINTH): 外周から中央へ向かう同心円・渦巻き状回廊
   * 1マス厚の壁で区切られており、BREAK魔法で壁1枚を消すと直通ショートカットとなる
   */
  private static buildSectorSpiralLabyrinth(
    map: WorldMap,
    sector: SectorBounds,
    rng: SeededRandom
  ): void {
    const rx1 = sector.x1 + 1;
    const ry1 = sector.y1 + 1;
    const rx2 = sector.x2 - 1;
    const ry2 = sector.y2 - 1;

    const layers = Math.min(4, Math.floor(Math.min(rx2 - rx1, ry2 - ry1) / 4));
    for (let l = 0; l < layers; l++) {
      const x1 = rx1 + l * 2;
      const y1 = ry1 + l * 2;
      const x2 = rx2 - l * 2;
      const y2 = ry2 - l * 2;
      if (x2 - x1 < 3 || y2 - y1 < 3) break;

      const doorSide = l % 4; // 0: 北, 1: 東, 2: 南, 3: 西
      const midX = Math.floor((x1 + x2) / 2);
      const midY = Math.floor((y1 + y2) / 2);

      // 上辺と下辺
      for (let x = x1; x <= x2; x++) {
        if (!(doorSide === 0 && Math.abs(x - midX) <= 1)) {
          this.safePlaceBlock(map, x, y1);
        }
        if (!(doorSide === 2 && Math.abs(x - midX) <= 1)) {
          this.safePlaceBlock(map, x, y2);
        }
      }
      // 左辺と右辺
      for (let y = y1; y <= y2; y++) {
        if (!(doorSide === 3 && Math.abs(y - midY) <= 1)) {
          this.safePlaceBlock(map, x1, y);
        }
        if (!(doorSide === 1 && Math.abs(y - midY) <= 1)) {
          this.safePlaceBlock(map, x2, y);
        }
      }

      // 回廊内部の障害ブロック
      if (l > 0 && rng.next() < 0.4) {
        this.safePlaceBlock(map, x1 + 1, y1 + 1);
      }
    }
  }

  /**
   * アリーナ要塞型 (FORTRESS_ARENA): 広大なコロシアム空間とトーチカ（防衛小部屋・遮蔽ブロック）
   */
  private static buildSectorFortressArena(
    map: WorldMap,
    sector: SectorBounds,
    _rng: SeededRandom
  ): void {
    const x1 = sector.x1 + 1;
    const y1 = sector.y1 + 1;
    const x2 = sector.x2 - 1;
    const y2 = sector.y2 - 1;
    const midX = Math.floor((x1 + x2) / 2);
    const midY = Math.floor((y1 + y2) / 2);

    // 外枠壁（各辺の中央に幅3のゲート）
    for (let x = x1; x <= x2; x++) {
      if (Math.abs(x - midX) > 1) {
        this.safePlaceBlock(map, x, y1);
        this.safePlaceBlock(map, x, y2);
      }
    }
    for (let y = y1; y <= y2; y++) {
      if (Math.abs(y - midY) > 1) {
        this.safePlaceBlock(map, x1, y);
        this.safePlaceBlock(map, x2, y);
      }
    }

    // アリーナ内にトーチカ（十字型遮蔽ブロック群）を中央＋四隅に複数配置
    const pillboxCenters: Position[] = [
      { x: midX - 3, y: midY },
      { x: midX + 3, y: midY },
      { x: x1 + 3, y: y1 + 3 },
      { x: x2 - 3, y: y1 + 3 },
      { x: x1 + 3, y: y2 - 3 },
      { x: x2 - 3, y: y2 - 3 },
    ];
    for (const pb of pillboxCenters) {
      if (pb.x > x1 + 1 && pb.x < x2 - 1 && pb.y > y1 + 1 && pb.y < y2 - 1) {
        this.safePlaceBlock(map, pb.x, pb.y);
        this.safePlaceBlock(map, pb.x + 1, pb.y);
        this.safePlaceBlock(map, pb.x - 1, pb.y);
        this.safePlaceBlock(map, pb.x, pb.y + 1);
        this.safePlaceBlock(map, pb.x, pb.y - 1);
      }
    }
  }

  /**
   * パンドラの墓場 (Pandora Graveyard): 3〜4基の墓が密集したハイリスク・ハイリターン区画
   */
  private static buildPandoraGraveyard(
    map: WorldMap,
    sector: SectorBounds,
    _rng: SeededRandom
  ): number {
    const cx = sector.x1 + 6;
    const cy = sector.y1 + 6;
    const gravePositions: Position[] = [
      { x: cx, y: cy },
      { x: cx + 3, y: cy },
      { x: cx, y: cy + 3 },
      { x: cx + 3, y: cy + 3 },
    ];

    let placedCount = 0;
    for (const gp of gravePositions) {
      if (map.isInside(gp)) {
        map.setBaseTile(gp, 'GRAVE');
        map.setObject(gp, 'NONE');
        placedCount++;
        this.safePlaceBlock(map, gp.x + 1, gp.y);
      }
    }

    // 周囲にパワーストーンと宝箱を配置
    this.safePlaceItem(map, cx + 1, cy + 1, 'POWER_STONE');
    this.safePlaceChest(map, cx + 2, cy + 1);
    this.safePlaceChest(map, cx + 1, cy + 2);

    return placedCount;
  }

  /**
   * 閉鎖された宝物庫 (Sealed Treasure Vault):
   * 四方を BLOCK で完全に密閉された密室空間（指輪の岩押し、ゴースト運び出し、BREAKで開拓可能）
   */
  private static buildSealedTreasureVault(
    map: WorldMap,
    sector: SectorBounds,
    _rng: SeededRandom
  ): void {
    const vx = sector.x1 + 4;
    const vy = sector.y1 + 4;
    const size = 5;

    // 四方を BLOCK で密閉
    for (let x = vx; x < vx + size; x++) {
      this.safePlaceBlock(map, x, vy);
      this.safePlaceBlock(map, x, vy + size - 1);
    }
    for (let y = vy; y < vy + size; y++) {
      this.safePlaceBlock(map, vx, y);
      this.safePlaceBlock(map, vx + size - 1, y);
    }

    // 内部にパワーストーン・壺・宝箱を配置
    this.safePlaceItem(map, vx + 1, vy + 1, 'POWER_STONE');
    this.safePlaceItem(map, vx + 2, vy + 1, 'POTION');
    this.safePlaceChest(map, vx + 1, vy + 2);
    this.safePlaceChest(map, vx + 2, vy + 2);
  }

  /**
   * セクターゲート: セクター境界の幹線通路にボトルネック＋塞ぎ用可動BLOCKを配置
   */
  private static placeSectorGates(map: WorldMap, _dragonCenter: Position): void {
    const gatePoints: Position[] = [
      { x: 22, y: 12 },
      { x: 40, y: 12 },
      { x: 22, y: 50 },
      { x: 40, y: 50 },
      { x: 12, y: 22 },
      { x: 50, y: 22 },
      { x: 12, y: 40 },
      { x: 50, y: 40 },
    ];
    for (const gp of gatePoints) {
      if (this.isTileCompletelyFree(map, gp.x, gp.y)) {
        map.setObject(gp, 'BLOCK');
      }
    }
  }

  /**
   * 有機的コリドー・連絡回廊の掘削 (Organic Corridor Carving)
   * 均等な十字直線ハイウェイ（x=22, 40, y=22, 40）および固定枠脱出路を完全撤廃。
   * セクター境界の動的開口ゲート（幅2マス）と、各ゲート前後の貫通アプローチを彫削する。
   */
  private static carveDynamicCorridors(
    map: WorldMap,
    sectors: DynamicSector[],
    _dragonCenter: Position,
    rng: SeededRandom
  ): void {
    // 各セクター境界のランダム開口ゲート（幅2マス、前後1マスの貫通クリアランス）
    for (const s of sectors) {
      // 北辺と南辺の開口ゲート
      const gX1 = rng.nextInt(s.x1 + 3, Math.max(s.x1 + 3, s.x2 - 4));
      for (let dy = -1; dy <= 1; dy++) {
        map.setObject(map.wrapPosition({ x: gX1, y: s.y1 + dy }), 'NONE');
        map.setObject(map.wrapPosition({ x: gX1 + 1, y: s.y1 + dy }), 'NONE');
      }

      const gX2 = rng.nextInt(s.x1 + 3, Math.max(s.x1 + 3, s.x2 - 4));
      for (let dy = -1; dy <= 1; dy++) {
        map.setObject(map.wrapPosition({ x: gX2, y: s.y2 + dy }), 'NONE');
        map.setObject(map.wrapPosition({ x: gX2 + 1, y: s.y2 + dy }), 'NONE');
      }

      // 西辺と東辺の開口ゲート
      const gY1 = rng.nextInt(s.y1 + 3, Math.max(s.y1 + 3, s.y2 - 4));
      for (let dx = -1; dx <= 1; dx++) {
        map.setObject(map.wrapPosition({ x: s.x1 + dx, y: gY1 }), 'NONE');
        map.setObject(map.wrapPosition({ x: s.x1 + dx, y: gY1 + 1 }), 'NONE');
      }

      const gY2 = rng.nextInt(s.y1 + 3, Math.max(s.y1 + 3, s.y2 - 4));
      for (let dx = -1; dx <= 1; dx++) {
        map.setObject(map.wrapPosition({ x: s.x2 + dx, y: gY2 }), 'NONE');
        map.setObject(map.wrapPosition({ x: s.x2 + dx, y: gY2 + 1 }), 'NONE');
      }
    }
  }

  /**
   * セクター間主要回廊（旧互換用：動的開口に移行したため何もしない）
   */
  public static carveMainCorridors(_map: WorldMap, _dragonCenter: Position): void {
  }

  /**
   * 墓（GRAVE）と封鎖パズル用ブロック（BLOCK）を分散配置
   */
  private static placeGravesWithBlocks(
    map: WorldMap,
    sectors: SectorBounds[],
    targetGraves: number,
    homePos: Position,
    dragonCenter: Position,
    rng: SeededRandom
  ): void {
    // すでに配置済みの墓（スタート2基＋要塞2基＝4基）をカウント
    let currentGraves = 0;
    for (let y = 1; y < map.height - 1; y++) {
      for (let x = 1; x < map.width - 1; x++) {
        if (map.getBaseTile({ x, y }) === 'GRAVE') currentGraves++;
      }
    }

    let attempts = 0;
    while (currentGraves < targetGraves && attempts < 400) {
      attempts++;
      const sector = sectors[rng.nextInt(0, sectors.length - 1)];
      const gx = rng.nextInt(sector.x1 + 2, sector.x2 - 2);
      const gy = rng.nextInt(sector.y1 + 2, sector.y2 - 2);

      if (Math.abs(gx - homePos.x) <= 5 && Math.abs(gy - homePos.y) <= 5) continue;
      if (Math.abs(gx - dragonCenter.x) <= 6 && Math.abs(gy - dragonCenter.y) <= 6) continue;
      if (!this.isTileCompletelyFree(map, gx, gy)) continue;

      // 周囲4マスのうち最低3マスが空床であることを確認（壁閉じ込め防止）
      const dirs = [
        { dx: 0, dy: -1 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 0 },
        { dx: 1, dy: 0 },
      ];
      const freeNeighbors = dirs.filter(d =>
        this.isTileCompletelyFree(map, gx + d.dx, gy + d.dy)
      );
      if (freeNeighbors.length < 3) continue;

      map.setBaseTile({ x: gx, y: gy }, 'GRAVE');
      currentGraves++;

      // 封鎖パズル用の岩を隣接1マスに配置（残り2方向以上は空床のまま残るためモンスターはスポーン可能）
      const blockDir = freeNeighbors[0];
      const pushFromX = gx + blockDir.dx * 2;
      const pushFromY = gy + blockDir.dy * 2;
      if (this.isTileCompletelyFree(map, pushFromX, pushFromY)) {
        this.safePlaceBlock(map, gx + blockDir.dx, gy + blockDir.dy);
      }
    }
  }

  /**
   * 原作風の「宝物地帯（Treasure Zones / 宝物庫クラスター）」を複数セクターに生成
   * 8歩周期を使わずランダム開封（確率1/8）しても十分なパワーストーンが出るよう、
   * 塊（グリッド状・2列回廊状・市松状）で宝箱が密集したエリアを構築する。
   */
  private static buildTreasureZones(
    map: WorldMap,
    sectors: SectorBounds[],
    homePos: Position,
    dragonCenter: Position,
    rng: SeededRandom
  ): void {
    // 7セクターのうちランダムに3〜4セクターを「大宝物地帯」、残りを「小宝物だまり」とする
    const indices = rng.shuffle(sectors.map((_, idx) => idx));

    for (let i = 0; i < indices.length; i++) {
      const sector = sectors[indices[i]];
      const isMajorVault = i < 4;

      // セクター内の中心付近を基準にクラスター領域を決定
      const w = isMajorVault ? rng.nextInt(4, 6) : rng.nextInt(3, 4);
      const h = isMajorVault ? rng.nextInt(4, 5) : rng.nextInt(2, 3);
      const startX = rng.nextInt(sector.x1 + 3, Math.max(sector.x1 + 3, sector.x2 - w - 3));
      const startY = rng.nextInt(sector.y1 + 3, Math.max(sector.y1 + 3, sector.y2 - h - 3));

      // パターン選択 (0: 密集グリッド塊, 1: 水平2列ギャラリー, 2: 市松・交互配列)
      const pattern = rng.nextInt(0, 2);

      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const cx = startX + dx;
          const cy = startY + dy;

          if (Math.abs(cx - homePos.x) <= 3 && Math.abs(cy - homePos.y) <= 3) continue;
          if (Math.abs(cx - dragonCenter.x) <= 6 && Math.abs(cy - dragonCenter.y) <= 6) continue;
          if (cx === 22 || cx === 40 || cy === 22 || cy === 40) continue; // 幹線通路は塞がない

          let shouldPlace = true;
          if (pattern === 1 && dy % 2 === 1 && dx > 0 && dx < w - 1) {
            shouldPlace = false; // 中央通路を空けた2列構造
          } else if (pattern === 2 && (dx + dy) % 2 === 1) {
            shouldPlace = false; // 市松構造
          }

          if (shouldPlace) {
            // 宝物地帯予定地の既存BLOCKをどかして宝箱を敷き詰める（墓やアイテムは上書きしない）
            if (
              map.getBaseTile({ x: cx, y: cy }) === 'EMPTY' &&
              map.getItem({ x: cx, y: cy }) === 'NONE'
            ) {
              map.setObject({ x: cx, y: cy }, 'CHEST');
            }
          }
        }
      }
    }
  }

  /**
   * 宝箱（CHEST）を目標総数（デフォルト100個）に達するまでマップ全域に補充配置
   */
  private static placeChestsAcrossMap(
    map: WorldMap,
    sectors: SectorBounds[],
    targetChests: number,
    homePos: Position,
    dragonCenter: Position,
    rng: SeededRandom
  ): void {
    let currentChests = 0;
    for (let y = 1; y < map.height - 1; y++) {
      for (let x = 1; x < map.width - 1; x++) {
        if (map.getObject({ x, y }) === 'CHEST') currentChests++;
      }
    }

    let attempts = 0;
    while (currentChests < targetChests && attempts < 2500) {
      attempts++;
      const sector = sectors[attempts % sectors.length];
      const cx = rng.nextInt(sector.x1 + 1, sector.x2 - 1);
      const cy = rng.nextInt(sector.y1 + 1, sector.y2 - 1);

      if (Math.abs(cx - homePos.x) <= 3 && Math.abs(cy - homePos.y) <= 3) continue;
      if (Math.abs(cx - dragonCenter.x) <= 6 && Math.abs(cy - dragonCenter.y) <= 6) continue;

      if (this.isTileCompletelyFree(map, cx, cy)) {
        map.setObject({ x: cx, y: cy }, 'CHEST');
        currentChests++;
      }
    }
  }

  /**
   * 広大すぎる空地（スカスカ空間）を検知し、適度な岩塊・ピラーを散布して密度を向上
   */
  private static densifyOpenAreas(
    map: WorldMap,
    homePos: Position,
    dragonCenter: Position,
    rng: SeededRandom
  ): void {
    // スキャンステップ（3マスおきにサンプル検査）
    for (let y = 3; y < map.height - 3; y += 3) {
      for (let x = 3; x < map.width - 3; x += 3) {
        // 我が家周辺やドラゴン要塞内は保護
        if (Math.abs(x - homePos.x) <= 4 && Math.abs(y - homePos.y) <= 4) continue;
        if (Math.abs(x - dragonCenter.x) <= 7 && Math.abs(y - dragonCenter.y) <= 7) continue;

        // 周囲 5x5 の障害物密度をカウント
        let obstacleCount = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const checkX = x + dx;
            const checkY = y + dy;
            if (checkX >= 0 && checkX < map.width && checkY >= 0 && checkY < map.height) {
              const base = map.getBaseTile({ x: checkX, y: checkY });
              const obj = map.getObject({ x: checkX, y: checkY });
              if (
                base === 'WALL_STATIC' ||
                base === 'GRAVE' ||
                obj === 'BLOCK' ||
                obj === 'CHEST' ||
                obj === 'CHEST_DRAGON'
              ) {
                obstacleCount++;
              }
            }
          }
        }

        // 周囲に障害物が極端に少ない（<= 2個）スカスカ空間に自然な岩塊・柱を配置
        if (obstacleCount <= 2 && rng.next() < 0.75) {
          const clusterSize = rng.nextInt(2, 4);
          for (let c = 0; c < clusterSize; c++) {
            const ox = x + rng.nextInt(-1, 1);
            const oy = y + rng.nextInt(-1, 1);
            if (this.isTileCompletelyFree(map, ox, oy)) {
              map.setObject({ x: ox, y: oy }, 'BLOCK');
            }
          }
        }
      }
    }
  }

  /**
   * 床置きアイテム（パワーストーン、壺、コイン、予備の指輪・鍵・十字架・剣）を各セクターへ配置
   */
  private static placeFloorItemsAcrossMap(
    map: WorldMap,
    sectors: SectorBounds[],
    homePos: Position,
    dragonCenter: Position,
    rng: SeededRandom,
    tuningParams?: ResolvedDungeonTuningParams,
    archetype?: DungeonArchetype
  ): void {
    const extraCross = tuningParams ? Math.max(0, tuningParams.resourceCapConfig.cross.initial - 1) : 1;
    const extraRing = tuningParams ? Math.max(0, tuningParams.resourceCapConfig.ring.initial - 1) : 1;
    const extraKey = tuningParams ? Math.max(0, tuningParams.resourceCapConfig.key.initial - 1) : 1;
    const extraSword = tuningParams ? Math.max(0, tuningParams.resourceCapConfig.sword.initial - 1) : 0;

    const itemsToPlace: TileType[] = [
      // パワーストーン（5個）
      'POWER_STONE', 'POWER_STONE', 'POWER_STONE', 'POWER_STONE', 'POWER_STONE',
      // 魔法の壺（8個）
      'POTION', 'POTION', 'POTION', 'POTION', 'POTION', 'POTION', 'POTION', 'POTION',
      // 金貨（14枚）
      'COIN', 'COIN', 'COIN', 'COIN', 'COIN', 'COIN', 'COIN',
      'COIN', 'COIN', 'COIN', 'COIN', 'COIN', 'COIN', 'COIN',
    ];

    for (let i = 0; i < extraKey; i++) itemsToPlace.push('KEY');
    for (let i = 0; i < extraRing; i++) itemsToPlace.push('RING');
    for (let i = 0; i < extraCross; i++) itemsToPlace.push('CROSS');
    for (let i = 0; i < extraSword; i++) itemsToPlace.push('SWORD');

    // テーマ別追加アイテム
    if (archetype === 'SANCTUARY') {
      // 聖域: 十字架をさらに3〜5個散布し、結界防衛を可能にする
      const addCross = rng.nextInt(3, 5);
      for (let i = 0; i < addCross; i++) itemsToPlace.push('CROSS');
    } else if (archetype === 'ARMORY') {
      // 武器庫: 剣をさらに2〜3本散布し、予備武器キープや床置き誘導を可能にする
      const addSword = rng.nextInt(2, 3);
      for (let i = 0; i < addSword; i++) itemsToPlace.push('SWORD');
    }

    let sectorIdx = 0;
    for (const item of itemsToPlace) {
      let placed = false;
      for (let tries = 0; tries < 100 && !placed; tries++) {
        const sector = sectors[(sectorIdx + tries) % sectors.length];
        const ix = rng.nextInt(sector.x1 + 1, sector.x2 - 1);
        const iy = rng.nextInt(sector.y1 + 1, sector.y2 - 1);

        if (Math.abs(ix - homePos.x) <= 3 && Math.abs(iy - homePos.y) <= 3) continue;
        if (Math.abs(ix - dragonCenter.x) <= 6 && Math.abs(iy - dragonCenter.y) <= 6) continue;

        if (this.isTileCompletelyFree(map, ix, iy)) {
          map.setItem({ x: ix, y: iy }, item);
          placed = true;
          sectorIdx++;
        }
      }
    }
  }

  /**
   * ワープゾーンペアの配置（通常ショートカット＋テーマ別ワープ密集ネットワーク）
   */
  private static placeProceduralWarps(
    map: WorldMap,
    sectors: SectorBounds[],
    dragonCenter: Position,
    rng: SeededRandom,
    archetype?: DungeonArchetype
  ): void {
    const findFreeInBox = (x1: number, y1: number, x2: number, y2: number): Position => {
      for (let i = 0; i < 60; i++) {
        const x = rng.nextInt(x1, x2);
        const y = rng.nextInt(y1, y2);
        if (this.isTileCompletelyFree(map, x, y)) {
          return { x, y };
        }
      }
      return { x: x1, y: y1 };
    };

    // 基本ペア1: 北西外縁 <-> 南東深部
    const w1A = findFreeInBox(17, 17, 21, 21);
    const w1B = findFreeInBox(46, 46, 54, 54);
    map.addWarpPair(w1A, w1B);

    // 基本ペア2: 南西 <-> 北東
    const w2A = findFreeInBox(14, 44, 20, 52);
    const w2B = findFreeInBox(44, 14, 52, 20);
    map.addWarpPair(w2A, w2B);

    // 基本ペア3: 南東奥地 <-> ドラゴン要塞北西角 (cx-5, cy-5) 付近
    const w3A = findFreeInBox(55, 55, 60, 60);
    const w3B = { x: dragonCenter.x - 5, y: dragonCenter.y - 4 };
    map.setObject(w3B, 'NONE');
    map.setItem(w3B, 'NONE');
    map.addWarpPair(w3A, w3B);

    // WARP_NEXUS (ワープ迷宮) テーマ: さらに10〜12ペア (合計26〜30マス) のワープをマップ全域に散布
    if (archetype === 'WARP_NEXUS') {
      const extraPairs = rng.nextInt(10, 12);
      for (let p = 0; p < extraPairs; p++) {
        const sA = sectors[rng.nextInt(0, sectors.length - 1)];
        const sB = sectors[rng.nextInt(0, sectors.length - 1)];
        const posA = findFreeInBox(sA.x1 + 2, sA.y1 + 2, sA.x2 - 2, sA.y2 - 2);
        const posB = findFreeInBox(sB.x1 + 2, sB.y1 + 2, sB.x2 - 2, sB.y2 - 2);
        if (posA.x !== posB.x || posA.y !== posB.y) {
          map.addWarpPair(posA, posB);
        }
      }
    }
  }

  /**
   * 重要座標（プレイヤー初期位置、我が家、ドラゴン5部位、斜め安全4マス、王冠出現4マス）の完全保護
   */
  private static enforceCriticalClearance(
    map: WorldMap,
    homePos: Position,
    dragonCenter: Position
  ): void {
    // 1. 我が家とプレイヤー初期位置 (8, 8)
    map.setBaseTile(homePos, 'HOME');
    map.setObject(homePos, 'NONE');
    map.setItem(homePos, 'NONE');

    const playerStart = { x: homePos.x + 1, y: homePos.y + 1 };
    map.setBaseTile(playerStart, 'EMPTY');
    map.setObject(playerStart, 'NONE');

    // 2. ドラゴン中心・3首・尻尾、斜め攻撃4マス、王冠出現4マス
    const cx = dragonCenter.x;
    const cy = dragonCenter.y;
    const reservedDragonTiles: Position[] = [
      // 十字5部位 (BODY, LEFT_HEAD, CENTER_HEAD, RIGHT_HEAD, TAIL)
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

    for (const pos of reservedDragonTiles) {
      if (map.isInside(pos)) {
        map.setBaseTile(pos, 'EMPTY');
        map.setObject(pos, 'NONE');
        map.setItem(pos, 'NONE');
      }
    }

    // ドラゴンの周辺4箇所（頭・しっぽのすぐ横）にドラゴンの宝箱（CHEST_DRAGON）を初期配置
    const dragonChestPositions: Position[] = [
      { x: cx - 1, y: cy - 1 },
      { x: cx + 1, y: cy - 1 },
      { x: cx - 1, y: cy + 1 },
      { x: cx + 1, y: cy + 1 },
    ];
    for (const pos of dragonChestPositions) {
      if (map.isInside(pos)) {
        map.setObject(pos, 'CHEST_DRAGON');
      }
    }
  }

  /**
   * 生成されたマップのクリア可能性（Solvability）を自動検証・診断する
   */
  public static validateSolvability(
    map: WorldMap,
    dragonCenter?: Position,
    seed: number = 0,
    tuningParams?: ResolvedDungeonTuningParams | DungeonTuningParams
  ): MapSolvabilityReport {
    const effDragonCenter = dragonCenter ?? map.dragonCenter ?? { x: 32, y: 32 };
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

        // 重複チェック
        if (item !== 'NONE' && obj !== 'NONE') {
          overlaps++;
        }
        if ((item !== 'NONE' || obj !== 'NONE') && (base === 'WALL_STATIC' || base === 'HOME')) {
          overlaps++;
        }

        // 破壊不能な WALL_STATIC がないかチェック（トーラス仕様では外周含めWALL_STATIC完全廃止）
        if (base === 'WALL_STATIC') {
          internalStaticWalls++;
        }

        if (obj === 'CHEST') counts.chests++;
        if (obj === 'BLOCK') counts.blocks++;
        if (base === 'WARP') counts.warps++;
        if (base === 'GRAVE') {
          counts.graves++;
          if (obj === 'NONE') {
            // 隣接4方向に少なくとも1つの通行可能マスがあるか
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

    // ドラゴン要塞のクリアランス検証
    const cx = effDragonCenter.x;
    const cy = effDragonCenter.y;
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
      return map.getBaseTile(p) === 'EMPTY' && (obj === expectedObj || (isCornerPos && (obj === 'NONE' || obj === 'CHEST')));
    });
    if (!dragonArenaValid) {
      issues.push('ドラゴン要塞の部位・斜め安全地帯・王冠出現マスに障害物が存在します');
    }

    // ブートストラップ検証
    const bootstrapValid =
      map.getBaseTile(map.homePos) === 'HOME' &&
      counts.swords >= 1 &&
      counts.keys >= 1 &&
      counts.rings >= 1 &&
      counts.potions >= 2 &&
      counts.crosses >= 1 &&
      counts.openGraves >= 5;
    if (!bootstrapValid) {
      issues.push('初期必須アイテム（SWORD, KEY, RING, POTION, CROSS）または開いた墓が不足しています');
    }

    // 最大到達可能STRの試算:
    // 8歩周期を一切使わず「純粋なランダム開封（確率 1/8 = 12.5%）」のみで得られるパワーストーン期待値
    // ＋床置きパワーストーンでドラゴンの中首（DEF 400,000）を突破可能か検証する
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

    // ランダム開封の期待値だけでドラゴンの中首 DEF 400,000 を上回る requiredStr 以上に到達可能か
    const resourceSufficient = counts.chests >= minChests && simulatedStr >= requiredStr;
    if (!resourceSufficient) {
      issues.push(
        `資源不足(ランダム開封1/8基準): 宝箱=${counts.chests}個, 期待パワーストーン=${achievableStones}個, 想定到達STR=${simulatedStr} (必要: 宝箱>=${minChests}, STR>=${requiredStr})`
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

  // --- 内部配置ヘルパー ---

  private static isTileCompletelyFree(map: WorldMap, x: number, y: number): boolean {
    if (!map.isInside({ x, y })) return false;
    return (
      map.getBaseTile({ x, y }) === 'EMPTY' &&
      map.getObject({ x, y }) === 'NONE' &&
      map.getItem({ x, y }) === 'NONE'
    );
  }

  private static safePlaceBlock(map: WorldMap, x: number, y: number): void {
    if (this.isTileCompletelyFree(map, x, y)) {
      map.setObject({ x, y }, 'BLOCK');
    }
  }

  private static safePlaceChest(map: WorldMap, x: number, y: number): void {
    if (this.isTileCompletelyFree(map, x, y)) {
      map.setObject({ x, y }, 'CHEST');
    }
  }

  private static safePlaceItem(map: WorldMap, x: number, y: number, item: TileType): void {
    if (this.isTileCompletelyFree(map, x, y)) {
      map.setItem({ x, y }, item);
    }
  }
}
