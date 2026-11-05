import { Direction, Position } from '../../models/Types.js';
import { BotStrategyTuning } from '../../ai/BotTypes.js';

export type BlockSize = '4x4' | '8x8' | '12x12' | '16x16' | '24x24';

export const BLOCK_SIZE_TILES: Record<BlockSize, number> = {
  '4x4': 4,
  '8x8': 8,
  '12x12': 12,
  '16x16': 16,
  '24x24': 24,
};

export const BLOCK_SIZE_CELLS: Record<BlockSize, number> = {
  '4x4': 1,
  '8x8': 2,
  '12x12': 3,
  '16x16': 4,
  '24x24': 6,
};

export const GRID_SIZE_CELLS = 16;
export const CELL_SIZE_TILES = 4;
export const WORLD_SIZE_TILES = 64;

export type BlockCategory =
  | 'GRAVE'
  | 'TREASURE'
  | 'MAZE'
  | 'DRAGON'
  | 'HOME'
  | 'CORRIDOR'
  | 'MISC';

export type PortDirection = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';

export interface EdgePort {
  direction: PortDirection;
  /** 当該辺における 4x4 マクロセルのインデックス (0 .. sizeInCells - 1) */
  cellIndex: number;
  /** 4マス中のインデックス (1 または 2) */
  offsetInCell: 1 | 2;
}

export interface SubSlotDefinition {
  id: string;
  /** ブロック内でのマクロセル相対座標 (4x4単位) */
  offsetCell: { x: number; y: number };
  /** スロットの大きさ (セル単位: 1x1=4x4, 2x2=8x8) */
  sizeCell: { w: number; h: number };
  allowedCategories?: BlockCategory[];
}

export interface RecommendedPush {
  blockPos: Position;
  dir: Direction;
  destinationPos: Position;
}

export interface GravePuzzleHint {
  gravePos: Position;
  themeId: string;
  /**
   * DIRECT_8WAY: 墓の周囲8マスを直接埋めるタイプ (4x4パズル墓など)
   * BOX_EXITS: 外枠の出口（チョークポイント）を塞げば箱ごと隔離できるタイプ (8x8 L字箱型墓など)
   */
  sealMode: 'DIRECT_8WAY' | 'BOX_EXITS';
  /** 塞ぐべきターゲット座標（開口部または箱の出口） */
  sealTargetPositions: Position[];
  /** 1手〜数手で塞げる初期配置ブロックのプッシュ指示ヒント */
  recommendedPushes: RecommendedPush[];
  /** 序盤に優先封鎖すべきか */
  priority: 'HIGH' | 'NORMAL' | 'LOW';
}

export interface TreasureZoneHint {
  id: string;
  bounds: { x1: number; y1: number; x2: number; y2: number };
  entryPorts: Position[];
  chestCount: number;
  /** 8歩周期チェーンに適した密集配置か */
  isEightStepOptimal: boolean;
}

export type DragonLairStyle = 'GRAND_TREASURE_HALL' | 'MAZE_LAIR' | 'STANDARD_FORTRESS';

export interface MapTacticalMetadata {
  dragonLairStyle: DragonLairStyle;
  recommendedBotTuning: Partial<BotStrategyTuning>;
  recommendedRelocateAnchors: Position[];
  gravePuzzleHints: GravePuzzleHint[];
  treasureZoneHints: TreasureZoneHint[];
  breachShortcutPositions: Position[];
}

export interface ThemeBlockTemplate {
  id: string;
  size: BlockSize;
  category: BlockCategory;
  /** ASCII DSL文字列配列 (各行の文字長 = sizeInTiles, 配列要素数 = sizeInTiles) */
  layout: string[];
  /** 回転を許可するか（ドラゴンコアなどは false） デフォルト: true */
  allowRotation?: boolean;
  /** 反転を許可するか デフォルト: true */
  allowFlip?: boolean;
  edgePorts?: EdgePort[];
  subSlots?: SubSlotDefinition[];
  // ブロックローカルの戦術ピン定義
  localGraveHints?: GravePuzzleHint[];
  localTreasureHints?: TreasureZoneHint[];
  localRelocateAnchors?: Position[];
  localBreachShortcuts?: Position[];
  dragonLairStyle?: DragonLairStyle;
  botTuning?: Partial<BotStrategyTuning>;
  /** 出現重み（デフォルト: 1） */
  weight?: number;
  /** 1マップあたりの最大配置可能数（省略時は無制限） */
  maxInstances?: number;
}

export interface PlacedThemeBlock {
  template: ThemeBlockTemplate;
  cellX: number; // 0..15
  cellY: number; // 0..15
  rotation: 0 | 90 | 180 | 270;
  flipX: boolean;
  flipY: boolean;
  isSubSlotOverlay?: boolean;
  parentBlockId?: string;
}

/**
 * DSL文字から TileType または特殊扱いへのマッピング
 */
export type DSLSymbol =
  | '.'  // EMPTY (通行可能床)
  | '#'  // BLOCK (可動岩)
  | 'W'  // WALL_STATIC (固定外壁)
  | 'G'  // GRAVE (墓)
  | 'C'  // 確定CHEST
  | 'c'  // 予算連動CHESTスロット
  | 'P'  // POTION
  | 'S'  // POWER_STONE
  | '$'  // COIN
  | '+'  // CROSS
  | 'H'  // HOME
  | 'D'  // CHEST_DRAGON
  | 'K'  // KEY
  | 'R'  // RING
  | '!'  // SWORD
  | '*'  // WARP
  | ' '; // TRANSPARENT (下地を上書きしない透過セル)
