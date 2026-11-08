import { ThemeBlockTemplate } from '../ThemeBlockTypes.js';

/**
 * ============================================================================
 * 空き地・広場 (OPEN FIELD)
 * ============================================================================
 */

/**
 * 4x4 完全平坦な空き地・小広場
 * 壁や障害物が一切なく、視界と移動がクリアな平原。
 */
export const OPEN_4x4_PLAINS: ThemeBlockTemplate = {
  id: 'open_4x4_plains',
  size: '4x4',
  category: 'MISC',
  weight: 1,
  maxInstances: 3,
  layout: [
    '....',
    '....',
    '....',
    '....',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 1 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 1 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 2 },
  ],
};

/**
 * 4x4 コインが落ちている小広場
 * 序盤の非戦闘EXP獲得に役立つコインが点在する平原。
 */
export const OPEN_4x4_MEADOW_COIN: ThemeBlockTemplate = {
  id: 'open_4x4_meadow_coin',
  size: '4x4',
  category: 'MISC',
  weight: 1,
  maxInstances: 3,
  layout: [
    '....',
    '.$..',
    '..$.',
    '....',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 1 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 2 },
  ],
};

/**
 * 8x8 完全フラットな大広場 / 中庭 (Courtyard)
 * 迷路や密室の間に挟まる広大なオープン空間。戦闘の回避やアイテムデポに最適。
 */
export const OPEN_8x8_COURTYARD: ThemeBlockTemplate = {
  id: 'open_8x8_courtyard',
  size: '8x8',
  category: 'MISC',
  weight: 1,
  maxInstances: 1,
  layout: [
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'NORTH', cellIndex: 1, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'SOUTH', cellIndex: 1, offsetInCell: 1 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'WEST', cellIndex: 1, offsetInCell: 1 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 1, offsetInCell: 1 },
  ],
};

/**
 * 8x8 4本柱の中庭広場
 * 開放感のある大広場の中に4本の独立した岩柱（BLOCK）があり、
 * 敵の視線を切りながら回り込んで撒くことができる。
 */
export const OPEN_8x8_PILLARS: ThemeBlockTemplate = {
  id: 'open_8x8_pillars',
  size: '8x8',
  category: 'MISC',
  weight: 1,
  maxInstances: 2,
  layout: [
    '........',
    '..#..#..',
    '........',
    '........',
    '........',
    '........',
    '..#..#..',
    '........',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'NORTH', cellIndex: 1, offsetInCell: 2 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 1, offsetInCell: 2 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 1 },
    { direction: 'WEST', cellIndex: 1, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 1 },
    { direction: 'EAST', cellIndex: 1, offsetInCell: 2 },
  ],
};

/**
 * ============================================================================
 * 閉じた四角・密閉ブロック (ENCLOSED / MONOLITH)
 * ============================================================================
 */

/**
 * 4x4 閉じた四角（密閉小部屋）
 * 外枠が可動ブロックで密閉され、内部に宝箱スロット(c)とコイン($)を隠匿。
 * BREAK魔法で外壁を破壊するか、外側から岩を押して侵入する。
 */
export const ENCLOSED_4x4_BOX: ThemeBlockTemplate = {
  id: 'enclosed_4x4_box',
  size: '4x4',
  category: 'MISC',
  weight: 3,
  maxInstances: 3,
  layout: [
    '####',
    '#c.#',
    '#.$#',
    '####',
  ],
  allowRotation: true,
  allowFlip: true,
  localBreachShortcuts: [
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 1 },
    { x: 3, y: 2 },
    { x: 2, y: 3 },
    { x: 1, y: 3 },
    { x: 0, y: 2 },
    { x: 0, y: 1 },
  ],
};

/**
 * 4x4 巨大ブロック塊（モノリス）
 * 4x4マスすべてがBLOCKで埋まった岩の巨塊。
 * マップ全体の遮蔽構造となり、プレイヤーの土木工事（BREAKや岩押し）で通路を開通できる。
 */
export const ENCLOSED_4x4_SOLID: ThemeBlockTemplate = {
  id: 'enclosed_4x4_solid',
  size: '4x4',
  category: 'MISC',
  weight: 2,
  maxInstances: 2,
  layout: [
    '####',
    '####',
    '####',
    '####',
  ],
  allowRotation: false,
  allowFlip: false,
};

/**
 * 8x8 閉じた大四角（密閉城塞大宝物庫）
 * 外周を頑丈なブロック壁で囲まれた大密室。
 * 内部には四隅に確定宝箱(C)と中央にポーション(P)が備蓄されており、
 * BREAK魔法で壁を穿つことで大量の物資を獲得できる。
 */
export const ENCLOSED_8x8_VAULT: ThemeBlockTemplate = {
  id: 'enclosed_8x8_vault',
  size: '8x8',
  category: 'TREASURE',
  weight: 2,
  maxInstances: 2,
  layout: [
    '########',
    '#......#',
    '#.C..C.#',
    '#..PP..#',
    '#..PP..#',
    '#.C..C.#',
    '#......#',
    '########',
  ],
  allowRotation: true,
  allowFlip: true,
  localBreachShortcuts: [
    { x: 3, y: 0 },
    { x: 4, y: 0 },
    { x: 7, y: 3 },
    { x: 7, y: 4 },
    { x: 4, y: 7 },
    { x: 3, y: 7 },
    { x: 0, y: 4 },
    { x: 0, y: 3 },
  ],
  localTreasureHints: [
    {
      id: 'enclosed_vault_8x8',
      bounds: { x1: 1, y1: 1, x2: 6, y2: 6 },
      entryPorts: [{ x: 3, y: 1 }, { x: 4, y: 6 }],
      chestCount: 4,
      isEightStepOptimal: true,
    },
  ],
};

/**
 * ============================================================================
 * 4x4 宝箱・コイン・ボトル補給所 (SUPPLY / PANTRY)
 * ============================================================================
 */

/**
 * 4x4 小補給所・オアシス (Pantry)
 * 四隅にブロックがあり、中央に確定宝箱(C)、コイン($)、ポーション(P)がセットされた立ち寄りスポット。
 * 四方すべてに通路が開けており、スムーズに物資を補給して走り抜けられる。
 */
export const SUPPLY_4x4_PANTRY: ThemeBlockTemplate = {
  id: 'supply_4x4_pantry',
  size: '4x4',
  category: 'TREASURE',
  weight: 2,
  maxInstances: 3,
  layout: [
    '#..#',
    '.C$.',
    '.P..',
    '#..#',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 1 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 1 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 2 },
  ],
  localTreasureHints: [
    {
      id: 'supply_pantry_4x4',
      bounds: { x1: 1, y1: 1, x2: 2, y2: 2 },
      entryPorts: [{ x: 1, y: 0 }, { x: 3, y: 1 }],
      chestCount: 1,
      isEightStepOptimal: false,
    },
  ],
};

/**
 * 4x4 アルコーブ備蓄庫 (Cache)
 * コ字型の壁で三方を守られた物資の隠し場所。
 * 宝箱スロット(c)、コイン($)、ポーション(P)を効率的に回収可能。
 */
export const SUPPLY_4x4_CACHE: ThemeBlockTemplate = {
  id: 'supply_4x4_cache',
  size: '4x4',
  category: 'TREASURE',
  weight: 2,
  maxInstances: 3,
  layout: [
    '###.',
    '#c$.',
    '#P..',
    '###.',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'EAST', cellIndex: 0, offsetInCell: 1 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 2 },
  ],
  localTreasureHints: [
    {
      id: 'supply_cache_4x4',
      bounds: { x1: 1, y1: 1, x2: 2, y2: 2 },
      entryPorts: [{ x: 3, y: 1 }, { x: 3, y: 2 }],
      chestCount: 1,
      isEightStepOptimal: false,
    },
  ],
};

/**
 * 4x4 十字路の補給スポット (Crossroad Depot)
 * 通路の交差部の窪みに宝箱(C)、ポーション(P)、コイン($)が配置された有機的ブロック。
 */
export const SUPPLY_4x4_CROSSROAD: ThemeBlockTemplate = {
  id: 'supply_4x4_crossroad',
  size: '4x4',
  category: 'TREASURE',
  weight: 2,
  maxInstances: 3,
  layout: [
    '.#..',
    '#CP.',
    '.$#.',
    '..#.',
  ],
  allowRotation: true,
  allowFlip: true,
  edgePorts: [
    { direction: 'NORTH', cellIndex: 0, offsetInCell: 2 },
    { direction: 'SOUTH', cellIndex: 0, offsetInCell: 1 },
    { direction: 'WEST', cellIndex: 0, offsetInCell: 2 },
    { direction: 'EAST', cellIndex: 0, offsetInCell: 1 },
  ],
  localTreasureHints: [
    {
      id: 'supply_crossroad_4x4',
      bounds: { x1: 1, y1: 1, x2: 2, y2: 2 },
      entryPorts: [{ x: 2, y: 0 }, { x: 3, y: 1 }],
      chestCount: 1,
      isEightStepOptimal: false,
    },
  ],
};

/**
 * 新規追加された空き地・密閉・補給ブロック一覧
 */
export const ALL_OPEN_AND_ENCLOSED_BLOCKS: ThemeBlockTemplate[] = [
  OPEN_4x4_PLAINS,
  OPEN_4x4_MEADOW_COIN,
  OPEN_8x8_COURTYARD,
  OPEN_8x8_PILLARS,
  ENCLOSED_4x4_BOX,
  ENCLOSED_4x4_SOLID,
  ENCLOSED_8x8_VAULT,
  SUPPLY_4x4_PANTRY,
  SUPPLY_4x4_CACHE,
  SUPPLY_4x4_CROSSROAD,
];
