import { ThemeBlockTemplate } from '../ThemeBlockTypes.js';

/**
 * ドラゴン周辺 ＆ 我が家スタートブロック・カタログ
 *
 * 【ドラゴン中心5×5コア規約】
 * すべてのドラゴンブロックは、中心座標 (cx, cy) に対し以下の 5×5 不変コアを持つ:
 * - 十字5マス (cx, cy), (cx, cy-1), (cx-1, cy), (cx+1, cy), (cx, cy+1) は空床(EMPTY: '.')
 * - 斜め4マス (cx-1, cy-1), (cx+1, cy-1), (cx-1, cy+1), (cx+1, cy+1) は王冠出現箱(CHEST_DRAGON: 'D')
 * - 3首正面アンチ・ブロック押し込みバリア:
 *   - 中首正面 (cx, cy-2) に POTION ('P')
 *   - 左首正面 (cx-2, cy) に CHEST ('C')
 *   - 右首正面 (cx+2, cy) に CHEST ('C')
 * - 挟み込み BLOCK ('#'):
 *   - (cx-1, cy-2), (cx+1, cy-2)
 *   - (cx-2, cy-1), (cx+2, cy-1)
 *   - (cx-2, cy+1), (cx+2, cy+1)
 *   - (cx-1, cy+2), (cx+1, cy+2)
 * - 南進入路 (cx, cy+2) は空床(EMPTY: '.')
 *
 * ※ ドラゴンコアは火炎弾射線・首の向き・バリア位置の不変性のため allowRotation: false を基本とする。
 */

// ============================================================================
// ドラゴン周辺ブロック
// ============================================================================

/**
 * 8x8 迷路潜伏型ドラゴン (MAZE_LAIR)
 * 中心 (3, 3) に 5x5 コアを内包。
 * 周囲は幅1マスの迷路壁で囲まれ、火炎弾がすぐに遮蔽されるため遠距離被弾が少ない。
 * ボット方針: enableHomeRelocation: false（迷路内への我が家移転をスキップし、BREAK壁掘削を優先）
 *
 *   0 1 2 3 4 5 6 7
 * 0 . . . . . . . .
 * 1 . . # P # . . .  <- cy-2=1 (cx: 1..5)
 * 2 . # D . D # . .  <- cy-1=2
 * 3 . C . . . C . .  <- cy  =3 (左首C, BODY, 右首C)
 * 4 . # D . D # . .  <- cy+1=4
 * 5 . . # . # . . .  <- cy+2=5 (南進入路)
 * 6 . # # . # # # .
 * 7 . . . . . . . .
 */
export const DRAGON_8x8_MAZE_LAIR: ThemeBlockTemplate = {
  id: 'dragon_8x8_maze_lair',
  size: '8x8',
  category: 'DRAGON',
  layout: [
    '........',
    '..#P#...',
    '.#D.D#..',
    '.C...C..',
    '.#D.D#..',
    '..#.#...',
    '.##.###.',
    '........',
  ],
  allowRotation: false,
  allowFlip: false,
  dragonLairStyle: 'MAZE_LAIR',
  botTuning: {
    enableHomeRelocation: true,
    homeRelocateTargetDistMin: 5,
    homeRelocateTargetDistMax: 8,
  },
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 2 },
  ],
  localBreachShortcuts: [
    { x: 3, y: 6 },
    { x: 6, y: 3 },
  ],
};

/**
 * 12x12 中規模迷路潜伏型ドラゴン (MAZE_LAIR)
 * 中心 (5, 5) に 5x5 コア。
 * 周囲に複雑な迷路壁を配し、迂回路とショートカット用ブロック(BREAK対象)を配置。
 */
export const DRAGON_12x12_MAZE_LAIR: ThemeBlockTemplate = {
  id: 'dragon_12x12_maze_lair',
  size: '12x12',
  category: 'DRAGON',
  layout: [
    '..#.........',
    '.###.######.',
    '.#...#....#.',
    '.#..#P#...#.', // cx=5 -> (4,3)=#, (5,3)=P, (6,3)=#
    '.#.#D.D#..#.', // (3,4)=#, (4,4)=D, (5,4)=., (6,4)=D, (7,4)=#
    '.#.C...C..#.', // (3,5)=C, (4,5)=., (5,5)=., (6,5)=., (7,5)=C
    '.#.#D.D#..#.', // (3,6)=#, (4,6)=D, (5,6)=., (6,6)=D, (7,6)=#
    '.#..#.#...#.', // (4,7)=#, (5,7)=., (6,7)=#
    '.#...#....#.',
    '.###.####.#.',
    '.#........#.',
    '..#.........',
  ],
  allowRotation: false,
  allowFlip: false,
  dragonLairStyle: 'MAZE_LAIR',
  botTuning: {
    enableHomeRelocation: true,
    homeRelocateTargetDistMin: 5,
    homeRelocateTargetDistMax: 8,
  },
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'WEST', cellIndex: 1, offsetInCell: 1 },
    { direction: 'EAST', cellIndex: 1, offsetInCell: 1 },
  ],
  localBreachShortcuts: [
    { x: 5, y: 8 },
    { x: 8, y: 5 },
  ],
};

/**
 * 16x16 大宝物殿鎮座型ドラゴン (GRAND_TREASURE_HALL)
 * 中心 (7, 7) に 5x5 コア。
 * 周囲に二重の宝箱回廊、守護墓 G (2, 2)、そして外縁安全マスに我が家の推奨引越しアンカー！
 * ボット方針: 外縁入口に家を横付けして王冠4個を高速回収する戦術が真価を発揮。
 */
export const DRAGON_16x16_GRAND_HALL: ThemeBlockTemplate = {
  id: 'dragon_16x16_grand_hall',
  size: '16x16',
  category: 'DRAGON',
  layout: [
    '..#.......#.....',
    '.###.###.###.##.',
    '.#G..#.#...#..#.',
    '.#.###.###.#..#.',
    '.#.#.....#.#..#.',
    '.#.#..#P#..#..#.', // y=5: cx=7 -> (6,5)=#, (7,5)=P, (8,5)=#
    '.#.#.#D.D#.#..#.', // y=6: (5,6)=#, (6,6)=D, (7,6)=., (8,6)=D, (9,6)=#
    '.#.#.C...C.#..#.', // y=7: (5,7)=C, (6,7)=., (7,7)=., (8,7)=., (9,7)=C
    '.#.#.#D.D#.#..#.', // y=8: (5,8)=#, (6,8)=D, (7,8)=., (8,8)=D, (9,8)=#
    '.#.#..#.#..#..#.', // y=9: (6,9)=#, (7,9)=., (8,9)=#
    '.#.#.....#.#..#.',
    '.#.#.CCC.#.#..#.',
    '.#.###.#.###..#.',
    '.#...#.#......#.',
    '.###.###.######.',
    '..#.......#.....',
  ],
  allowRotation: false,
  allowFlip: false,
  dragonLairStyle: 'GRAND_TREASURE_HALL',
  botTuning: {
    enableHomeRelocation: true,
    homeRelocateTargetDistMin: 5,
    homeRelocateTargetDistMax: 8,
  },
  edgePorts: [
    { direction: 'NORTH', cellIndex: 1, offsetInCell: 2 },
    { direction: 'SOUTH', cellIndex: 1, offsetInCell: 2 },
    { direction: 'WEST', cellIndex: 1, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 1, offsetInCell: 2 },
  ],
  localRelocateAnchors: [
    { x: 1, y: 14 }, // 南西の安全マス
    { x: 14, y: 1 }, // 北東の安全マス
  ],
  localGraveHints: [
    {
      gravePos: { x: 2, y: 2 },
      themeId: 'dragon_16x16_grand_hall',
      sealMode: 'BOX_EXITS',
      sealTargetPositions: [{ x: 2, y: 4 }],
      recommendedPushes: [
        { blockPos: { x: 2, y: 5 }, dir: 'UP', destinationPos: { x: 2, y: 4 } },
      ],
      priority: 'HIGH',
    },
  ],
};

/**
 * 24x24 超広域ドラゴン城塞 (CITADEL)
 * 中心 (11, 11) に 5x5 コア。
 * 4x4 のサブスロットを2つ内包し、広大な回廊・四隅宝物庫・引越しアンカーを持つ。
 */
export const DRAGON_24x24_CITADEL: ThemeBlockTemplate = {
  id: 'dragon_24x24_citadel',
  size: '24x24',
  category: 'DRAGON',
  layout: [
    '..#.......#.......#.....',
    '.###.###.###.###.###.##.',
    '.#...#.#...#.#...#.#..#.',
    '.#.###.###.#.###.#.##.#.',
    '.#.#.....#.#.#...#....#.',
    '.#.#.###.#.#.#.######.#.',
    '.#.#.#.#.#.#.#.#....#.#.',
    '.#.#.#.#.#.#.#.#.##.#.#.',
    '.#.#.#.#.#.#.#.#.#..#.#.',
    '.#.#.#.#..#P#..#.#.#..#.', // y=9: (10,9)=#, (11,9)=P, (12,9)=#
    '.#.#.#.#.#D.D#.#.#.#..#.', // y=10: (9,10)=#, (10,10)=D, (11,10)=., (12,10)=D, (13,10)=#
    '.#.#.#.#.C...C.#.#.#..#.', // y=11: (9,11)=C, (10,11)=., (11,11)=., (12,11)=., (13,11)=C
    '.#.#.#.#.#D.D#.#.#.#..#.', // y=12: (9,12)=#, (10,12)=D, (11,12)=., (12,12)=D, (13,12)=#
    '.#.#.#.#..#.#..#.#.#..#.', // y=13: (10,13)=#, (11,13)=., (12,13)=#
    '.#.#.#.#...#.#.#.#..#.#.',
    '.#.#.#.#####.#.#.#..#.#.',
    '.#.#.#.......#.#.#..#.#.',
    '.#.#.#########.#.#..#.#.',
    '.#.#...........#.#..#.#.',
    '.#.#############.#..#.#.',
    '.#...............#..#.#.',
    '.#################..#.#.',
    '.#....................#.',
    '..#.......#.......#.....',
  ],
  allowRotation: false,
  allowFlip: false,
  dragonLairStyle: 'GRAND_TREASURE_HALL',
  botTuning: {
    enableHomeRelocation: true,
    homeRelocateTargetDistMin: 6,
    homeRelocateTargetDistMax: 10,
  },
  edgePorts: [
    { direction: 'NORTH', cellIndex: 2, offsetInCell: 2 },
    { direction: 'SOUTH', cellIndex: 2, offsetInCell: 2 },
  ],
  subSlots: [
    {
      id: 'citadel_slot_nw',
      offsetCell: { x: 0, y: 0 },
      sizeCell: { w: 1, h: 1 },
      allowedCategories: ['GRAVE', 'TREASURE', 'MISC'],
    },
    {
      id: 'citadel_slot_ne',
      offsetCell: { x: 4, y: 0 },
      sizeCell: { w: 1, h: 1 },
      allowedCategories: ['TREASURE', 'MISC'],
    },
  ],
  localRelocateAnchors: [
    { x: 1, y: 22 }, // 南西安全アンカー
    { x: 22, y: 1 }, // 北東安全アンカー
  ],
};

// ============================================================================
// 我が家スタートブロック
// ============================================================================

/**
 * 4x4 我が家スタートブロック (COZY)
 * 我が家 H を中心に、ゲーム開始直後に必要な全基本アイテムを配置。
 *
 *   0 1 2 3
 * 0 . ! K .  <- 剣(!), 鍵(K)
 * 1 R H + .  <- 指輪(R), 家(H), 十字架(+)
 * 2 . S P .  <- パワーストーン(S), ポーション(P)
 * 3 . . $ .  <- コイン($)
 */
export const HOME_4x4_COZY: ThemeBlockTemplate = {
  id: 'home_4x4_cozy',
  size: '4x4',
  category: 'HOME',
  layout: [
    '.!K.',
    'RH+.',
    '.SP.',
    '..$.',
  ],
  allowRotation: false,
  allowFlip: false,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 1 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 1 },
  ],
};

/**
 * 8x8 我が家拡張拠点 (ESTATE)
 * 前庭、外壁、初期アイテム、倉庫番用パズル岩を備えたスタートブロック。
 *
 *   0 1 2 3 4 5 6 7
 * 0 . . # . . # . .
 * 1 . # ! K . . # .
 * 2 . # R H + . # .
 * 3 . . . S P . . .
 * 4 . # . . $ . # .
 * 5 . # # # # # # .
 * 6 . . . . . . . .
 * 7 . . . . . . . .
 */
export const HOME_8x8_ESTATE: ThemeBlockTemplate = {
  id: 'home_8x8_estate',
  size: '8x8',
  category: 'HOME',
  layout: [
    '..#..#..',
    '.#!K..#.',
    '.#RH+.#.',
    '...SP...',
    '.#..$.#.',
    '.######.',
    '........',
    '........',
  ],
  allowRotation: false,
  allowFlip: false,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 1 },
  ],
};

export const ALL_DRAGON_AND_HOME_BLOCKS: ThemeBlockTemplate[] = [
  DRAGON_8x8_MAZE_LAIR,
  DRAGON_12x12_MAZE_LAIR,
  DRAGON_16x16_GRAND_HALL,
  DRAGON_24x24_CITADEL,
  HOME_4x4_COZY,
  HOME_8x8_ESTATE,
];
