import { ThemeBlockTemplate } from '../ThemeBlockTypes.js';

/**
 * 床落ちアイテム密集パターン・ブロックカタログ
 *
 * 宝箱に入っていない床落ちアイテム（POWER_STONE, CROSS, RING, KEY, SWORD, POTION, COIN）が
 * まとまって配置される部屋バリエーション群。
 */

/**
 * 4x4 パワーストーン群生（鉱脈）: S x 5
 */
export const CLUSTER_4x4_STONE_VEIN: ThemeBlockTemplate = {
  id: 'cluster_4x4_stone_vein',
  size: '4x4',
  category: 'TREASURE',
  weight: 2,
  layout: [
    '#..#',
    '.SS.',
    'SSS.',
    '#..#',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 1 },
  ],
};

/**
 * 8x8 パワーストーン結晶洞窟: S x 14
 */
export const CLUSTER_8x8_STONE_CAVERN: ThemeBlockTemplate = {
  id: 'cluster_8x8_stone_cavern',
  size: '8x8',
  category: 'TREASURE',
  weight: 2,
  layout: [
    '#.######',
    '#SSSSS.#',
    '.#S##S#.',
    '#SSSSS.#',
    '#.#S##S#',
    '#SSSSS.#',
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
 * 4x4 装備品密集小室（武器庫）: !, K, R, +
 */
export const CLUSTER_4x4_ARMORY: ThemeBlockTemplate = {
  id: 'cluster_4x4_armory',
  size: '4x4',
  category: 'MISC',
  weight: 1,
  maxInstances: 2,
  layout: [
    '#..#',
    '.!K.',
    '.R+.',
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
 * 8x8 聖域・装備品保管庫: + x2, R x2, K x2, ! x1, P x2
 */
export const CLUSTER_8x8_SANCTUARY_DEPOT: ThemeBlockTemplate = {
  id: 'cluster_8x8_sanctuary_depot',
  size: '8x8',
  category: 'MISC',
  weight: 1,
  maxInstances: 2,
  layout: [
    '#.######',
    '#+...+##',
    '.R...R..',
    '#K..!.K#',
    '#P....P#',
    '#......#',
    '#..##..#',
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
 * 4x4 金貨の山: $ x 6
 */
export const CLUSTER_4x4_GOLD_PILE: ThemeBlockTemplate = {
  id: 'cluster_4x4_gold_pile',
  size: '4x4',
  category: 'MISC',
  weight: 2,
  layout: [
    '#..#',
    '.$$.',
    '$$$$',
    '#..#',
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
 * 4x4 壺の備蓄庫: P x 6
 */
export const CLUSTER_4x4_POTION_CELLAR: ThemeBlockTemplate = {
  id: 'cluster_4x4_potion_cellar',
  size: '4x4',
  category: 'MISC',
  weight: 2,
  layout: [
    '#..#',
    '.PP.',
    'PPPP',
    '#..#',
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
 * 8x8 複合トレジャー部屋: 宝箱(C x8) + パワーストーン(S x4) + 金貨($ x4) + 壺(P x4)
 */
export const CLUSTER_8x8_GRAND_DEPOT: ThemeBlockTemplate = {
  id: 'cluster_8x8_grand_depot',
  size: '8x8',
  category: 'TREASURE',
  weight: 2,
  layout: [
    '#.######',
    '#cc$cc.#',
    '.cSSSc..',
    '#$PP$..#',
    '#cPSPc.#',
    '#cc$cc.#',
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
      id: 'grand_depot_8x8',
      bounds: { x1: 1, y1: 1, x2: 6, y2: 5 },
      entryPorts: [{ x: 0, y: 2 }, { x: 1, y: 0 }],
      chestCount: 12,
      isEightStepOptimal: true,
    },
  ],
};

export const ALL_ITEM_CLUSTER_BLOCKS: ThemeBlockTemplate[] = [
  CLUSTER_4x4_STONE_VEIN,
  CLUSTER_8x8_STONE_CAVERN,
  CLUSTER_4x4_ARMORY,
  CLUSTER_8x8_SANCTUARY_DEPOT,
  CLUSTER_4x4_GOLD_PILE,
  CLUSTER_4x4_POTION_CELLAR,
  CLUSTER_8x8_GRAND_DEPOT,
];
