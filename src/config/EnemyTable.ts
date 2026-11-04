import { PALETTE } from './Constants.js';

export interface EnemyConfig {
  id: number;
  name: string;
  displayName: string;
  symbol: string;
  color: string;
  hp: number;
  atk: number;
  def: number;
  drainAtk?: number;      // 攻撃力吸収量 (dora, knight: 3000)
  drainExp?: number;      // 経験値吸収量 (rich, crownload: 1000)
  stealPotion?: boolean;  // 魔法の壺強奪フラグ (monstir)
}

/**
 * DS1ish 全32種モンスター基本パラメータ定義
 */
export const ENEMY_CONFIG_TABLE: readonly EnemyConfig[] = [
  { id: 1, name: 'skeleton', displayName: 'スケルトン', symbol: 'SK', color: PALETTE.WHITE, hp: 1500, atk: 300, def: 150 },
  { id: 2, name: 'saulus', displayName: 'サウルス', symbol: 'SA', color: PALETTE.CYAN, hp: 3000, atk: 800, def: 400 },
  { id: 3, name: 'condor', displayName: 'コンドル', symbol: 'CD', color: PALETTE.CYAN, hp: 2000, atk: 2000, def: 1600 },
  { id: 4, name: 'bug', displayName: 'バグ', symbol: 'BG', color: PALETTE.GREEN, hp: 4200, atk: 4000, def: 3000 },
  { id: 5, name: 'monstir', displayName: 'モンスティル', symbol: 'MS', color: PALETTE.GREEN, hp: 5000, atk: 7500, def: 6400, stealPotion: true },
  { id: 6, name: 'foot', displayName: 'フット', symbol: 'FT', color: PALETTE.GREEN, hp: 7500, atk: 13000, def: 11000 },
  { id: 7, name: 'eyes', displayName: 'アイズ', symbol: 'EY', color: PALETTE.YELLOW, hp: 10000, atk: 20000, def: 11400 },
  { id: 8, name: 'tamori', displayName: 'タモリ', symbol: 'TM', color: PALETTE.YELLOW, hp: 20000, atk: 25000, def: 17800 },
  { id: 9, name: 'dora', displayName: 'ドラ', symbol: 'DO', color: PALETTE.RED, hp: 300000, atk: 35000, def: 9000, drainAtk: 3000 },
  { id: 10, name: 'rich', displayName: 'リッチ', symbol: 'RC', color: PALETTE.YELLOW, hp: 100000, atk: 45000, def: 36000, drainExp: 1000 },
  { id: 11, name: 'vampire', displayName: 'ヴァンパイア', symbol: 'VP', color: PALETTE.MAGENTA, hp: 60000, atk: 58000, def: 61000 },
  { id: 12, name: 'niko', displayName: 'ニコ', symbol: 'NK', color: PALETTE.MAGENTA, hp: 13000, atk: 70000, def: 54000 },
  { id: 13, name: 'knight', displayName: 'ナイト', symbol: 'KN', color: PALETTE.CYAN, hp: 47000, atk: 85000, def: 89000, drainAtk: 3000 },
  { id: 14, name: 'pen', displayName: 'ペン', symbol: 'PN', color: PALETTE.CYAN, hp: 60000, atk: 100000, def: 51000 },
  { id: 15, name: 'renge', displayName: 'レンジ', symbol: 'RG', color: PALETTE.WHITE, hp: 50000, atk: 115000, def: 91000 },
  { id: 16, name: 'flanc', displayName: 'フラン', symbol: 'FL', color: PALETTE.GREEN, hp: 147000, atk: 135000, def: 86000 },
  { id: 17, name: 'cangaru', displayName: 'カンガルー', symbol: 'CG', color: PALETTE.YELLOW, hp: 90000, atk: 150000, def: 109000 },
  { id: 18, name: 'sauhead', displayName: 'サウヘッド', symbol: 'SH', color: PALETTE.RED, hp: 270000, atk: 175000, def: 270000 },
  { id: 19, name: 'grassman', displayName: 'グラスマン', symbol: 'GM', color: PALETTE.GREEN, hp: 348000, atk: 195000, def: 142000 },
  { id: 20, name: 'goblin', displayName: 'ゴブリン', symbol: 'GB', color: PALETTE.GREEN, hp: 300000, atk: 220000, def: 125000 },
  { id: 21, name: 'crownload', displayName: 'クラウンロード', symbol: 'CL', color: PALETTE.YELLOW, hp: 160000, atk: 245000, def: 141000, drainExp: 1000 },
  { id: 22, name: 'tin', displayName: 'ティン', symbol: 'TN', color: PALETTE.CYAN, hp: 60000, atk: 270000, def: 327000 },
  { id: 23, name: 'ogre', displayName: 'オーガ', symbol: 'OG', color: PALETTE.RED, hp: 647000, atk: 295000, def: 11000 },
  { id: 24, name: 'snake', displayName: 'スネーク', symbol: 'SN', color: PALETTE.GREEN, hp: 280000, atk: 323000, def: 111000 },
  { id: 25, name: 'deye', displayName: 'ディアイ', symbol: 'DY', color: PALETTE.YELLOW, hp: 150000, atk: 355000, def: 201000 },
  { id: 26, name: 'book', displayName: 'ブック', symbol: 'BK', color: PALETTE.MAGENTA, hp: 247000, atk: 385000, def: 330000 },
  { id: 27, name: 'nokonoko', displayName: 'ノコノコ', symbol: 'NN', color: PALETTE.GREEN, hp: 510000, atk: 415000, def: 10000 },
  { id: 28, name: 'cyclops', displayName: 'サイクロプス', symbol: 'CY', color: PALETTE.RED, hp: 390000, atk: 450000, def: 220000 },
  { id: 29, name: 'beast', displayName: 'ビースト', symbol: 'BS', color: PALETTE.RED, hp: 480000, atk: 483000, def: 342000 },
  { id: 30, name: 'robo', displayName: 'ロボ', symbol: 'RB', color: PALETTE.CYAN, hp: 300000, atk: 500000, def: 245000 },
  { id: 31, name: 'rabbit', displayName: 'ラビット', symbol: 'RA', color: PALETTE.WHITE, hp: 600000, atk: 550000, def: 400000 },
  { id: 32, name: 'doppel', displayName: 'ドッペル', symbol: 'DP', color: PALETTE.MAGENTA, hp: 650000, atk: 650000, def: 520000 },
];

export function getEnemyConfigById(id: number): EnemyConfig {
  const cfg = ENEMY_CONFIG_TABLE.find(e => e.id === id);
  if (!cfg) {
    throw new Error(`Unknown enemy ID: ${id}`);
  }
  return cfg;
}

export function getEnemyConfigByName(name: string): EnemyConfig {
  const cfg = ENEMY_CONFIG_TABLE.find(e => e.name.toLowerCase() === name.toLowerCase());
  if (!cfg) {
    throw new Error(`Unknown enemy Name: ${name}`);
  }
  return cfg;
}
