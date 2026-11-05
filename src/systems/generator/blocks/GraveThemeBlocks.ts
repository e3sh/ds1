import { ThemeBlockTemplate } from '../ThemeBlockTypes.js';

/**
 * 墓テーマブロック・カタログ
 *
 * モンスターの8方向移動とスポーン停止ルール:
 * - 斜めの角隙間（# . / . #）をすり抜けるため、墓の周囲や出口はL字角で閉じる。
 * - 4x4 パズル墓: 1〜3手で墓の周囲8マスを直接埋めるタイプ (DIRECT_8WAY)
 * - 8x8 箱型墓: 外枠の4出口に栓をして箱ごと隔離するタイプ (BOX_EXITS)
 * - 16x16 ネクロポリス: 4基の墓を持つ複合墓地
 */

// --- 4x4 パズル墓 (DIRECT_8WAY) ---

/**
 * パターン A1: 1手押し＋1十字架封鎖型
 * (1, 0) の # を南へ押すと (1, 1) が埋まる。残る (1, 3) は十字架または下からのブロックで封鎖。
 *
 *   0 1 2 3
 * 0 . # . .
 * 1 # . # .
 * 2 # G # .
 * 3 # . # .
 */
export const GRAVE_4x4_A1: ThemeBlockTemplate = {
  id: 'grave_4x4_a1',
  size: '4x4',
  category: 'GRAVE',
  layout: [
    '.#..',
    '#.#.',
    '#G#.',
    '#.#.',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 2 },
  ],
  localGraveHints: [
    {
      gravePos: { x: 1, y: 2 },
      themeId: 'grave_4x4_a1',
      sealMode: 'DIRECT_8WAY',
      sealTargetPositions: [
        { x: 1, y: 1 },
        { x: 1, y: 3 },
      ],
      recommendedPushes: [
        {
          blockPos: { x: 1, y: 0 },
          dir: 'DOWN',
          destinationPos: { x: 1, y: 1 },
        },
      ],
      priority: 'HIGH',
    },
  ],
};

/**
 * パターン A2: 2手L字プッシュ封鎖型
 * (2, 0) を南へ、(0, 2) を東へ押せば墓(2, 2)の周囲がすべて埋まる！
 *
 *   0 1 2 3
 * 0 . . # .
 * 1 . # . #
 * 2 # . G #
 * 3 . # # #
 */
export const GRAVE_4x4_A2: ThemeBlockTemplate = {
  id: 'grave_4x4_a2',
  size: '4x4',
  category: 'GRAVE',
  layout: [
    '..#.',
    '.#.#',
    '#.G#',
    '.###',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 2 },
  ],
  localGraveHints: [
    {
      gravePos: { x: 2, y: 2 },
      themeId: 'grave_4x4_a2',
      sealMode: 'DIRECT_8WAY',
      sealTargetPositions: [
        { x: 2, y: 1 },
        { x: 1, y: 2 },
      ],
      recommendedPushes: [
        {
          blockPos: { x: 2, y: 0 },
          dir: 'DOWN',
          destinationPos: { x: 2, y: 1 },
        },
        {
          blockPos: { x: 0, y: 2 },
          dir: 'RIGHT',
          destinationPos: { x: 1, y: 2 },
        },
      ],
      priority: 'HIGH',
    },
  ],
};

/**
 * パターン A3: 3手倉庫番囲い込み墓
 * 周囲に3つの可動ブロックがあり、順番に押し込むことで中央の墓を完全封鎖
 *
 *   0 1 2 3
 * 0 . # . .
 * 1 # G . #
 * 2 . # . .
 * 3 . . # .
 */
export const GRAVE_4x4_A3: ThemeBlockTemplate = {
  id: 'grave_4x4_a3',
  size: '4x4',
  category: 'GRAVE',
  layout: [
    '.#..',
    '#G.#',
    '.#..',
    '..#.',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 1 },
  ],
  localGraveHints: [
    {
      gravePos: { x: 1, y: 1 },
      themeId: 'grave_4x4_a3',
      sealMode: 'DIRECT_8WAY',
      sealTargetPositions: [
        { x: 2, y: 1 },
        { x: 2, y: 2 },
      ],
      recommendedPushes: [
        {
          blockPos: { x: 3, y: 1 },
          dir: 'LEFT',
          destinationPos: { x: 2, y: 1 },
        },
        {
          blockPos: { x: 2, y: 3 },
          dir: 'UP',
          destinationPos: { x: 2, y: 2 },
        },
      ],
      priority: 'NORMAL',
    },
  ],
};

// --- 8x8 箱型墓 (BOX_EXITS) ---

/**
 * パターン B1: 8×8 四方出口・L字角ボックス墓
 * 中央 (3, 3) に墓があり、四隅はL字壁（角マス閉塞で斜め抜け完全防止）。
 * 北 (3, 1)、南 (3, 5)、西 (1, 3)、東 (5, 3) の4箇所が出口。
 * 外周通路の (3, 0), (3, 6), (0, 3), (6, 3) に栓用ブロックがあり、4手で箱ごと完全隔離可能！
 *
 *   0 1 2 3 4 5 6 7
 * 0 . . . # . . . .
 * 1 . # # . # # . .
 * 2 . # . . . # . .
 * 3 # . . G . . # .
 * 4 . # . . . # . .
 * 5 . # # . # # . .
 * 6 . . . # . . . .
 * 7 . . . . . . . .
 */
export const GRAVE_8x8_B1: ThemeBlockTemplate = {
  id: 'grave_8x8_b1',
  size: '8x8',
  category: 'GRAVE',
  layout: [
    '...#....',
    '.##.##..',
    '.#...#..',
    '#..G..#.',
    '.#...#..',
    '.##.##..',
    '...#....',
    '........',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 2 },
  ],
  localGraveHints: [
    {
      gravePos: { x: 3, y: 3 },
      themeId: 'grave_8x8_b1',
      sealMode: 'BOX_EXITS',
      sealTargetPositions: [
        { x: 3, y: 1 }, // 北出口
        { x: 3, y: 5 }, // 南出口
        { x: 1, y: 3 }, // 西出口
        { x: 5, y: 3 }, // 東出口
      ],
      recommendedPushes: [
        { blockPos: { x: 3, y: 0 }, dir: 'DOWN', destinationPos: { x: 3, y: 1 } },
        { blockPos: { x: 3, y: 6 }, dir: 'UP', destinationPos: { x: 3, y: 5 } },
        { blockPos: { x: 0, y: 3 }, dir: 'RIGHT', destinationPos: { x: 1, y: 3 } },
        { blockPos: { x: 6, y: 3 }, dir: 'LEFT', destinationPos: { x: 5, y: 3 } },
      ],
      priority: 'HIGH',
    },
  ],
};

/**
 * パターン B2: 8×8 クランク出口・2出口要塞墓
 * 出口が北(3, 1)と東(6, 4)の2箇所のみ。少手順で手堅く封鎖できる中規模墓。
 *
 *   0 1 2 3 4 5 6 7
 * 0 . . . # . . . .
 * 1 . # # . # # # .
 * 2 . # . . . . # .
 * 3 . # . G . . # .
 * 4 . # . . . . . #
 * 5 . # # # # # # .
 * 6 . . . . . . . .
 * 7 . . . . . . . .
 */
export const GRAVE_8x8_B2: ThemeBlockTemplate = {
  id: 'grave_8x8_b2',
  size: '8x8',
  category: 'GRAVE',
  layout: [
    '...#....',
    '.##.###.',
    '.#....#.',
    '.#.G..#.',
    '.#......',
    '.######.',
    '........',
    '........',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 1, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 2 },
  ],
  localGraveHints: [
    {
      gravePos: { x: 3, y: 3 },
      themeId: 'grave_8x8_b2',
      sealMode: 'BOX_EXITS',
      sealTargetPositions: [
        { x: 3, y: 1 },
        { x: 6, y: 4 },
      ],
      recommendedPushes: [
        { blockPos: { x: 3, y: 0 }, dir: 'DOWN', destinationPos: { x: 3, y: 1 } },
      ],
      priority: 'NORMAL',
    },
  ],
};

// --- 16x16 複合墓地 (ネクロポリス) ---

/**
 * パターン C1: 16×16 4墓複合ネクロポリス
 * 4隅に独立した墓室を持ち、中央交差点にパワーストーン S と高密度宝箱 C を配置。
 * 内部に 4x4 のサブスロットを2つ持ち、さらに追加のパズル墓や小宝物庫を入れ子にできる。
 */
export const GRAVE_16x16_NECROPOLIS: ThemeBlockTemplate = {
  id: 'grave_16x16_necropolis',
  size: '16x16',
  category: 'GRAVE',
  layout: [
    '...#.......#....',
    '.##.##...##.##..',
    '.#...#...#...#..',
    '.#.G.#...#.G.#..',
    '.#...#...#...#..',
    '.##.##...##.##..',
    '...#.......#....',
    '......CC........',
    '......CS........',
    '...#.......#....',
    '.##.##...##.##..',
    '.#...#...#...#..',
    '.#.G.#...#.G.#..',
    '.#...#...#...#..',
    '.##.##...##.##..',
    '...#.......#....',
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
      id: 'necropolis_subslot_1',
      offsetCell: { x: 0, y: 0 },
      sizeCell: { w: 1, h: 1 },
      allowedCategories: ['GRAVE', 'TREASURE', 'MISC'],
    },
    {
      id: 'necropolis_subslot_2',
      offsetCell: { x: 3, y: 3 },
      sizeCell: { w: 1, h: 1 },
      allowedCategories: ['GRAVE', 'TREASURE', 'MISC'],
    },
  ],
  localGraveHints: [
    {
      gravePos: { x: 3, y: 3 },
      themeId: 'grave_16x16_necropolis',
      sealMode: 'BOX_EXITS',
      sealTargetPositions: [{ x: 3, y: 1 }, { x: 3, y: 5 }],
      recommendedPushes: [
        { blockPos: { x: 3, y: 0 }, dir: 'DOWN', destinationPos: { x: 3, y: 1 } },
        { blockPos: { x: 3, y: 6 }, dir: 'UP', destinationPos: { x: 3, y: 5 } },
      ],
      priority: 'HIGH',
    },
    {
      gravePos: { x: 11, y: 3 },
      themeId: 'grave_16x16_necropolis',
      sealMode: 'BOX_EXITS',
      sealTargetPositions: [{ x: 11, y: 1 }, { x: 11, y: 5 }],
      recommendedPushes: [
        { blockPos: { x: 11, y: 0 }, dir: 'DOWN', destinationPos: { x: 11, y: 1 } },
        { blockPos: { x: 11, y: 6 }, dir: 'UP', destinationPos: { x: 11, y: 5 } },
      ],
      priority: 'NORMAL',
    },
    {
      gravePos: { x: 3, y: 12 },
      themeId: 'grave_16x16_necropolis',
      sealMode: 'BOX_EXITS',
      sealTargetPositions: [{ x: 3, y: 10 }, { x: 3, y: 14 }],
      recommendedPushes: [
        { blockPos: { x: 3, y: 9 }, dir: 'DOWN', destinationPos: { x: 3, y: 10 } },
        { blockPos: { x: 3, y: 15 }, dir: 'UP', destinationPos: { x: 3, y: 14 } },
      ],
      priority: 'NORMAL',
    },
    {
      gravePos: { x: 11, y: 12 },
      themeId: 'grave_16x16_necropolis',
      sealMode: 'BOX_EXITS',
      sealTargetPositions: [{ x: 11, y: 10 }, { x: 11, y: 14 }],
      recommendedPushes: [
        { blockPos: { x: 11, y: 9 }, dir: 'DOWN', destinationPos: { x: 11, y: 10 } },
        { blockPos: { x: 11, y: 15 }, dir: 'UP', destinationPos: { x: 11, y: 14 } },
      ],
      priority: 'LOW',
    },
  ],
};

export const ALL_GRAVE_BLOCKS: ThemeBlockTemplate[] = [
  GRAVE_4x4_A1,
  GRAVE_4x4_A2,
  GRAVE_4x4_A3,
  GRAVE_8x8_B1,
  GRAVE_8x8_B2,
  GRAVE_16x16_NECROPOLIS,
];
