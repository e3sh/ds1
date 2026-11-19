import { ThemeBlockTemplate } from '../ThemeBlockTypes.js';

/**
 * 宝箱部屋 ＆ 迷路テーマブロック・カタログ
 *
 * 単調な四角い部屋を排除し、宝箱部屋と幅1マス迷路を複合・隣接させて
 * L字型、T字型、回廊型などの有機的で複雑な外形を形成する。
 * 8歩周期確定チェーン（EightStepController）に適したギャラリー配置も完備。
 */

// ============================================================================
// 宝箱部屋ブロック
// ============================================================================

/**
 * 4x4 小宝物庫（アルコーブ）
 * 奥まったスペースに宝箱3個とコイン1個。入口に押し込みブロック。
 *
 *   0 1 2 3
 * 0 # # # #
 * 1 # C C #
 * 2 # C $ .
 * 3 # # . #
 */
export const TREASURE_4x4_ALCOVE: ThemeBlockTemplate = {
  id: 'treasure_4x4_alcove',
  size: '4x4',
  category: 'TREASURE',
  layout: [
    '####',
    '#cc#',
    '#c$.',
    '##.#',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 2 },
  ],
  localTreasureHints: [
    {
      id: 'alcove_4x4',
      bounds: { x1: 1, y1: 1, x2: 2, y2: 2 },
      entryPorts: [{ x: 2, y: 3 }, { x: 3, y: 2 }],
      chestCount: 3,
      isEightStepOptimal: false,
    },
  ],
};

export const TREASURE_8x8_GALLERY: ThemeBlockTemplate = {
  id: 'treasure_8x8_gallery',
  size: '8x8',
  category: 'TREASURE',
  layout: [
    '#.######',
    '#.cccc.#',
    '........',
    '#.cccc.#',
    '#......#',
    '#.cccc.#',
    '#......#',
    '#.######',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 2 },
  ],
  localTreasureHints: [
    {
      id: 'gallery_8x8',
      bounds: { x1: 2, y1: 1, x2: 5, y2: 5 },
      entryPorts: [{ x: 0, y: 2 }, { x: 7, y: 2 }],
      chestCount: 12,
      isEightStepOptimal: true,
    },
  ],
};

export const TREASURE_8x8_CHECKER: ThemeBlockTemplate = {
  id: 'treasure_8x8_checker',
  size: '8x8',
  category: 'TREASURE',
  layout: [
    '##.#####',
    '#c.c.c.#',
    '..c.c.c#',
    '#c.c.c.#',
    '#......#',
    '#.c.c.c.',
    '#......#',
    '##.#####',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 1, offsetInCell: 1 },
  ],
  localTreasureHints: [
    {
      id: 'checker_8x8',
      bounds: { x1: 1, y1: 1, x2: 6, y2: 5 },
      entryPorts: [{ x: 0, y: 2 }, { x: 7, y: 5 }],
      chestCount: 12,
      isEightStepOptimal: true,
    },
  ],
};

/**
 * 12x12 L字型複合大宝物室 ＆ 迷路回廊 (準広域テーマ)
 * L字型の広い宝物庫とそれを取り囲む幅1マスの迷路で構成され、
 * 内部に 4x4 のサブスロット（小墓または小密室）を1つ保持。
 */
export const TREASURE_12x12_COMPLEX: ThemeBlockTemplate = {
  id: 'treasure_12x12_complex',
  size: '12x12',
  category: 'TREASURE',
  layout: [
    '##.#########',
    '#..#..#cccc#',
    '#..#..#cccc#',
    '#..#..#....#',
    '#.##.......#',
    '............',
    '#..........#',
    '#..........#',
    '#.##.###.#.#',
    '#..#.....#.#',
    '#.########.#',
    '##.#########',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'WEST', cellIndex: 1, offsetInCell: 1 },
    { direction: 'EAST', cellIndex: 1, offsetInCell: 1 },
  ],
  subSlots: [
    {
      id: 'complex_subslot_1',
      offsetCell: { x: 1, y: 1 }, // セル(1, 1) = タイル(4, 4)〜(7, 7)
      sizeCell: { w: 1, h: 1 },
      allowedCategories: ['GRAVE', 'TREASURE', 'MISC'],
    },
  ],
  localTreasureHints: [
    {
      id: 'complex_12x12_hall',
      bounds: { x1: 7, y1: 1, x2: 10, y2: 2 },
      entryPorts: [{ x: 7, y: 3 }],
      chestCount: 8,
      isEightStepOptimal: true,
    },
  ],
};

export const TREASURE_16x16_GRAND_VAULT: ThemeBlockTemplate = {
  id: 'treasure_16x16_grand_vault',
  size: '16x16',
  category: 'TREASURE',
  layout: [
    '....##.#####.###',
    '....#..#...#...#',
    '....#.###.###..#',
    '....#.#.....#..#',
    '#####.#.###.#.##',
    '#...#.#.#S#.#..#',
    '....#.#.ccc.#...',
    '#.###.#.ccc.#..#',
    '#.#...#.....#..#',
    '#.#.###.###.#..#',
    '#.#.#...#...#..#',
    '#.###.###.###.##',
    '#...#.#.#.......',
    '#.#.#.#.#.......',
    '#.#...#.#.......',
    '######.#########',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 1, offsetInCell: 2 },
    { direction: 'SOUTH', cellIndex: 1, offsetInCell: 2 },
    { direction: 'WEST', cellIndex: 1, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 1, offsetInCell: 2 },
  ],
  subSlots: [
    {
      id: 'grand_vault_slot_1',
      offsetCell: { x: 0, y: 0 },
      sizeCell: { w: 1, h: 1 },
      allowedCategories: ['GRAVE', 'TREASURE', 'MISC'],
    },
    {
      id: 'grand_vault_slot_2',
      offsetCell: { x: 3, y: 3 },
      sizeCell: { w: 1, h: 1 },
      allowedCategories: ['GRAVE', 'CORRIDOR', 'MISC'],
    },
  ],
  localTreasureHints: [
    {
      id: 'grand_vault_center',
      bounds: { x1: 8, y1: 6, x2: 10, y2: 7 },
      entryPorts: [{ x: 9, y: 8 }],
      chestCount: 6,
      isEightStepOptimal: false,
    },
  ],
};

export const TREASURE_4x4_DENSE_PACK: ThemeBlockTemplate = {
  id: 'treasure_4x4_dense_pack',
  size: '4x4',
  category: 'TREASURE',
  weight: 2,
  layout: [
    '#.c#',
    'cccc',
    'cccc',
    '#c.#',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 1 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 1 },
  ],
  localTreasureHints: [
    {
      id: 'dense_pack_4x4',
      bounds: { x1: 0, y1: 0, x2: 3, y2: 3 },
      entryPorts: [{ x: 1, y: 0 }, { x: 2, y: 3 }],
      chestCount: 10,
      isEightStepOptimal: true,
    },
  ],
};

export const TREASURE_8x8_SOLID_VAULT: ThemeBlockTemplate = {
  id: 'treasure_8x8_solid_vault',
  size: '8x8',
  category: 'TREASURE',
  weight: 2,
  layout: [
    '#.######',
    '#......#',
    '..cccc..',
    '#.cccc.#',
    '#.cccc.#',
    '#.cccc.#',
    '#......#',
    '#.######',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 2 },
  ],
  localTreasureHints: [
    {
      id: 'solid_vault_8x8',
      bounds: { x1: 2, y1: 2, x2: 5, y2: 5 },
      entryPorts: [{ x: 1, y: 2 }, { x: 6, y: 2 }],
      chestCount: 16,
      isEightStepOptimal: true,
    },
  ],
};

export const TREASURE_8x8_DOUBLE_CHAMBER: ThemeBlockTemplate = {
  id: 'treasure_8x8_double_chamber',
  size: '8x8',
  category: 'TREASURE',
  weight: 2,
  layout: [
    '#.######',
    '#.cc#cc#',
    '..cc.cc.',
    '#.cc.cc#',
    '#...#..#',
    '#.cc#cc#',
    '#......#',
    '#.######',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 2 },
  ],
  localTreasureHints: [
    {
      id: 'double_chamber_8x8',
      bounds: { x1: 2, y1: 1, x2: 6, y2: 5 },
      entryPorts: [{ x: 1, y: 2 }, { x: 4, y: 2 }],
      chestCount: 16,
      isEightStepOptimal: true,
    },
  ],
};

export const TREASURE_12x12_TREASURY: ThemeBlockTemplate = {
  id: 'treasure_12x12_treasury',
  size: '12x12',
  category: 'TREASURE',
  weight: 1,
  layout: [
    '#####.######',
    '#..........#',
    '#.cccccccc.#',
    '#.cccccccc.#',
    '#..........#',
    '...cc$SS$cc.',
    '#.cc$SS$cc.#',
    '#..........#',
    '#.cccccccc.#',
    '#.cccccccc.#',
    '#..........#',
    '#####.######',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 1, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 1, offsetInCell: 1 },
    { direction: 'WEST', cellIndex: 1, offsetInCell: 1 },
    { direction: 'EAST', cellIndex: 1, offsetInCell: 1 },
  ],
  localTreasureHints: [
    {
      id: 'treasury_12x12',
      bounds: { x1: 2, y1: 2, x2: 9, y2: 9 },
      entryPorts: [{ x: 1, y: 5 }, { x: 10, y: 5 }],
      chestCount: 40,
      isEightStepOptimal: true,
    },
  ],
};

// ============================================================================
// 迷路・通路ブロック
// ============================================================================

/**
 * 4x4 クランク型通路ピース
 * 北ポート(1, 0)と東ポート(3, 2)を繋ぐクランク状の通路
 */
export const MAZE_4x4_CRANK: ThemeBlockTemplate = {
  id: 'maze_4x4_crank',
  size: '4x4',
  category: 'CORRIDOR',
  layout: [
    '.#..',
    '.#.#',
    '...#',
    '####',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 2 },
  ],
};

/**
 * 4x4 十字路通路ピース
 * 4方すべてに通路ポートを持つ基本コネクタ
 */
export const MAZE_4x4_CROSS: ThemeBlockTemplate = {
  id: 'maze_4x4_cross',
  size: '4x4',
  category: 'CORRIDOR',
  layout: [
    '#..#',
    '....',
    '....',
    '#..#',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 1 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 1 },
  ],
};

/**
 * 8x8 幅1マス蛇行迷路
 * 中央に障害物岩と迂回路を持つ幅1マスの迷路ブロック
 */
export const MAZE_8x8_WINDING: ThemeBlockTemplate = {
  id: 'maze_8x8_winding',
  size: '8x8',
  category: 'MAZE',
  layout: [
    '#.######',
    '#.#....#',
    '..#.##.#',
    '#.#.#..#',
    '#.#..#.#',
    '#.#.##.#',
    '#......#',
    '#.######',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 2 },
  ],
};

/**
 * 4x4 直線・壁厚回廊ピース (CORRIDOR)
 */
export const MAZE_4x4_CORRIDOR_I: ThemeBlockTemplate = {
  id: 'maze_4x4_corridor_i',
  size: '4x4',
  category: 'CORRIDOR',
  layout: [
    '#.##',
    '#.##',
    '#.##',
    '#.##',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 1 },
  ],
};

/**
 * 4x4 T字路回廊ピース (CORRIDOR)
 */
export const MAZE_4x4_T_JUNCTION: ThemeBlockTemplate = {
  id: 'maze_4x4_t_junction',
  size: '4x4',
  category: 'CORRIDOR',
  layout: [
    '#.##',
    '#...',
    '#.##',
    '#.##',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 1 },
  ],
};

/**
 * 8x8 高密度格子迷路 (NARROW_MAZE向け)
 */
export const MAZE_8x8_GRID_LABYRINTH: ThemeBlockTemplate = {
  id: 'maze_8x8_grid_labyrinth',
  size: '8x8',
  category: 'MAZE',
  layout: [
    '#.######',
    '#...#..#',
    '.##.#.##',
    '#.#....#',
    '#.#.##.#',
    '#....#..',
    '###.##.#',
    '#.######',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 1, offsetInCell: 1 },
  ],
};

/**
 * 8x8 要塞アリーナ・トーチカ部屋 (FORTRESS_ARENA向け)
 */
export const ARENA_8x8_PILLBOX: ThemeBlockTemplate = {
  id: 'arena_8x8_pillbox',
  size: '8x8',
  category: 'MISC',
  layout: [
    '##.##.##',
    '#......#',
    '........',
    '#..##..#',
    '#..##..#',
    '........',
    '#......#',
    '##.##.##',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 1, offsetInCell: 1 },
  ],
};

/**
 * 12x12 コロッセオ大闘技場 (FORTRESS_ARENA向け)
 * 外周を厚壁で囲み、内部に広大な開放空間と4基の十字トーチカを配する。
 */
export const ARENA_12x12_COLOSSEUM: ThemeBlockTemplate = {
  id: 'arena_12x12_colosseum',
  size: '12x12',
  category: 'MISC',
  layout: [
    '#####..#####',
    '#..........#',
    '#..#....#..#',
    '#.##....##.#',
    '#..........#',
    '............',
    '............',
    '#..........#',
    '#.##....##.#',
    '#..#....#..#',
    '#..........#',
    '#####..#####',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 1, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 1, offsetInCell: 1 },
    { direction: 'WEST', cellIndex: 1, offsetInCell: 1 },
    { direction: 'EAST', cellIndex: 1, offsetInCell: 1 },
  ],
};

export const MAZE_12x12_SPIRAL: ThemeBlockTemplate = {
  id: 'maze_12x12_spiral',
  size: '12x12',
  category: 'MAZE',
  layout: [
    '#.##########',
    '#..........#',
    '#.########.#',
    '#.#......#.#',
    '#.#.####.#.#',
    '#.#.#..#.#.#',
    '#.#.#c.#.#.#',
    '#.#.##.#.#.#',
    '#.#....#.#.#',
    '#.######.#.#',
    '#..........#',
    '##########.#',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 2, offsetInCell: 2 },
  ],
  localTreasureHints: [
    {
      id: 'spiral_center',
      bounds: { x1: 6, y1: 6, x2: 6, y2: 6 },
      entryPorts: [{ x: 5, y: 6 }],
      chestCount: 1,
      isEightStepOptimal: false,
    },
  ],
};

export const ALL_TREASURE_AND_MAZE_BLOCKS: ThemeBlockTemplate[] = [
  TREASURE_4x4_ALCOVE,
  TREASURE_4x4_DENSE_PACK,
  TREASURE_8x8_GALLERY,
  TREASURE_8x8_CHECKER,
  TREASURE_8x8_SOLID_VAULT,
  TREASURE_8x8_DOUBLE_CHAMBER,
  TREASURE_12x12_COMPLEX,
  TREASURE_12x12_TREASURY,
  TREASURE_16x16_GRAND_VAULT,
  MAZE_4x4_CRANK,
  MAZE_4x4_CROSS,
  MAZE_4x4_CORRIDOR_I,
  MAZE_4x4_T_JUNCTION,
  MAZE_8x8_WINDING,
  MAZE_8x8_GRID_LABYRINTH,
  MAZE_12x12_SPIRAL,
  ARENA_8x8_PILLBOX,
  ARENA_12x12_COLOSSEUM,
];
