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
    '#CC#',
    '#C$.',
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

/**
 * 8x8 2列ギャラリー中宝物室 (8歩周期チェーン最適)
 * 中央に通路(1マス)を挟み、両側に宝箱が並ぶ構造（計10個）。
 * 移動しながら連続して8歩周期で開錠するのに最も適した形状。
 *
 *   0 1 2 3 4 5 6 7
 * 0 . . # # # # . .
 * 1 . # C C C C # .
 * 2 # # . . . . # #
 * 3 . . . . . . . .
 * 4 # # . . . . # #
 * 5 . # C C C C # .
 * 6 . . # # # # . .
 * 7 . . . . . . . .
 */
export const TREASURE_8x8_GALLERY: ThemeBlockTemplate = {
  id: 'treasure_8x8_gallery',
  size: '8x8',
  category: 'TREASURE',
  layout: [
    '..####..',
    '.#CCCC#.',
    '##....##',
    '........',
    '##....##',
    '.#CCCC#.',
    '..####..',
    '........',
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
      entryPorts: [{ x: 0, y: 3 }, { x: 7, y: 3 }],
      chestCount: 8,
      isEightStepOptimal: true,
    },
  ],
};

/**
 * 8x8 市松模様宝箱部屋 (8歩周期チェーン最適)
 * 通路と宝箱が格子状に交互に並び、敵を撒きながら連続開錠できる。
 */
export const TREASURE_8x8_CHECKER: ThemeBlockTemplate = {
  id: 'treasure_8x8_checker',
  size: '8x8',
  category: 'TREASURE',
  layout: [
    '..#.##..',
    '.#C.C.#.',
    '..#.C.C.',
    '..C.C.C.',
    '.C.C.C..',
    '.#C.C.#.',
    '..#.##..',
    '........',
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
      entryPorts: [{ x: 0, y: 3 }, { x: 7, y: 4 }],
      chestCount: 14,
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
    '..#.........',
    '.###.######.',
    '.#...#CCCC#.',
    '.#.###CCCC#.',
    '.#.#..#...#.',
    '.#.#.##...#.',
    '.#.#.##...#.',
    '.#.#.##...#.',
    '.#.###....#.',
    '.#...#....#.',
    '.###.######.',
    '..#.........',
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
      bounds: { x1: 6, y1: 2, x2: 9, y2: 4 },
      entryPorts: [{ x: 5, y: 4 }],
      chestCount: 8,
      isEightStepOptimal: true,
    },
  ],
};

/**
 * 16x16 大宝物庫 ＆ 外周迷路 (広域テーマ)
 * 中央にパワーストーン S を擁する大宝物庫があり、二重の外周迷路で囲まれている。
 * 4x4 サブスロットを2つ内蔵。
 */
export const TREASURE_16x16_GRAND_VAULT: ThemeBlockTemplate = {
  id: 'treasure_16x16_grand_vault',
  size: '16x16',
  category: 'TREASURE',
  layout: [
    '..#.......#.....',
    '.###.###.###.##.',
    '.#...#.#...#..#.',
    '.#.###.###.#..#.',
    '.#.#.....#.#..#.',
    '.#.#.###.#.#..#.',
    '.#.#.#S#.#.#..#.',
    '.#.#.CCC.#.#..#.',
    '.#.#.CCC.#.#..#.',
    '.#.#.....#.#..#.',
    '.#.#.###.#.#..#.',
    '.#.#...#.#.#..#.',
    '.#.###.#.###..#.',
    '.#...#.#......#.',
    '.###.###.######.',
    '..#.......#.....',
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
      bounds: { x1: 5, y1: 6, x2: 8, y2: 8 },
      entryPorts: [{ x: 6, y: 9 }],
      chestCount: 6,
      isEightStepOptimal: false,
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
    '..####..',
    '.#....#.',
    '.#.##.#.',
    '.#.#..#.',
    '.#..#.#.',
    '.#.##.#.',
    '.#....#.',
    '..####..',
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
 * 12x12 渦巻き型迷路
 * 外周から中心へと渦を巻きながら進む迷路。中央にアイテム・宝箱スロットを配置可能。
 */
export const MAZE_12x12_SPIRAL: ThemeBlockTemplate = {
  id: 'maze_12x12_spiral',
  size: '12x12',
  category: 'MAZE',
  layout: [
    '..##########',
    '.#..........',
    '.#.########.',
    '.#.#......#.',
    '.#.#.####.#.',
    '.#.#.#..#.#.',
    '.#.#.#C.#.#.',
    '.#.#.##.#.#.',
    '.#.#....#.#.',
    '.#.######.#.',
    '.#........#.',
    '###########.',
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
  TREASURE_8x8_GALLERY,
  TREASURE_8x8_CHECKER,
  TREASURE_12x12_COMPLEX,
  TREASURE_16x16_GRAND_VAULT,
  MAZE_4x4_CRANK,
  MAZE_4x4_CROSS,
  MAZE_8x8_WINDING,
  MAZE_12x12_SPIRAL,
];
