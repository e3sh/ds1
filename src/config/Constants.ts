export const TILE_SIZE = 32;
export const VIEW_TILES_X = 15; // 15マス
export const VIEW_TILES_Y = 11; // 11マス

// 高精細純マップ Canvas 解像度 (480 x 352: 15x32, 11x32)
export const MAP_VIEW_WIDTH = VIEW_TILES_X * TILE_SIZE;  // 480
export const MAP_VIEW_HEIGHT = VIEW_TILES_Y * TILE_SIZE; // 352

export const SCREEN_WIDTH = MAP_VIEW_WIDTH;   // 480
export const SCREEN_HEIGHT = MAP_VIEW_HEIGHT; // 352

// プレイヤーの画面内固定タイル座標 (中央)
export const PLAYER_SCREEN_TILE_X = Math.floor(VIEW_TILES_X / 2); // 7
export const PLAYER_SCREEN_TILE_Y = Math.floor(VIEW_TILES_Y / 2); // 5

// マップ全体サイズ (例: 64x64 タイル)
export const WORLD_MAP_WIDTH = 64;
export const WORLD_MAP_HEIGHT = 64;

// KICK魔法の最大滑走射程（マス数: 画面全幅相当）
export const KICK_MAX_RANGE = 15;

// 1ターンの自動進行時間 (ミリ秒)
export const TURN_TIME_LIMIT_MS = 2500;

// PC-8801 基本カラーパレット
export const PALETTE = {
  BLACK: '#000000',
  BLUE: '#0000ff',
  RED: '#ff0000',
  MAGENTA: '#ff00ff',
  GREEN: '#00ff00',
  CYAN: '#00ffff',
  YELLOW: '#ffff00',
  WHITE: '#ffffff',
  DARK_GREEN: '#005500',
  DARK_BLUE: '#000055',
  DARK_RED: '#550000',
  GRAY: '#777777',
} as const;

export type ColorValue = string;
