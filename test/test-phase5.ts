import { Player } from '../src/models/Player.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { PaletteManager } from '../src/view/PaletteManager.js';
import { PSGAudio } from '../src/audio/PSGAudio.js';
import { GameEngine } from '../src/core/GameEngine.js';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

console.log('--- Phase 5: Presentation, Sound & System Integration Verification ---');

// ==========================================
// 1. ワープゾーン (WARP) の移動検証
// ==========================================
console.log('Testing 1: Warp zone teleportation mechanics...');

{
  const map = new WorldMap();
  const player = new Player({ x: 15, y: 16 });

  // (16, 16) はデフォルトのワープゾーン。対向は (48, 48)
  assert(map.getBaseTile({ x: 16, y: 16 }) === 'WARP', 'Tile at (16, 16) should be WARP');
  assert(map.getBaseTile({ x: 48, y: 48 }) === 'WARP', 'Tile at (48, 48) should be WARP');

  const dest = map.getWarpDestination({ x: 16, y: 16 });
  assert(dest !== null && dest.x === 48 && dest.y === 48, 'Warp destination from (16,16) should be (48,48)');

  // 右に1歩進んでワープゾーンを踏む
  const moved = MovementSystem.tryMove(player, 'RIGHT', map);
  assert(moved === true, 'Player should successfully move onto WARP zone');
  assert(player.pos.x === 48 && player.pos.y === 48, `Player should be warped to (48, 48), got (${player.pos.x}, ${player.pos.y})`);
  assert(MovementSystem.lastWarped === true, 'MovementSystem.lastWarped should be true');

  // 逆方向のワープ確認: 任意ペア追加
  map.addWarpPair({ x: 2, y: 2 }, { x: 10, y: 10 });
  player.pos = { x: 2, y: 3 };
  MovementSystem.tryMove(player, 'UP', map);
  assert(player.pos.x === 10 && player.pos.y === 10, 'Player should warp from (2,2) to (10,10)');

  console.log('✓ 1. Warp zone teleportation tests passed.');
}

// ==========================================
// 2. パレット切り替え演出 & DOM UIテーマ検証
// ==========================================
console.log('Testing 2: PaletteManager state and colors...');

{
  const palette = new PaletteManager();

  // 通常状態
  palette.updateByPlayerHP(1000, false);
  assert(palette.getMode() === 'NORMAL', 'Should be NORMAL mode when HP >= 500');
  assert(palette.getThemeClass() === 'theme-normal', 'Theme class should be theme-normal');
  assert(palette.fieldBackgroundColor === '#002800', 'Normal field bg color');

  // ピンチ状態 (HP < 500)
  palette.updateByPlayerHP(499, false);
  assert(palette.getMode() === 'PINCH', 'Should be PINCH mode when HP < 500');
  assert(palette.getThemeClass() === 'theme-pinch', 'Theme class should be theme-pinch');
  assert(palette.fieldBackgroundColor === '#3a0000', 'Pinch field bg color (red base)');

  palette.updateByPlayerHP(1, false);
  assert(palette.getMode() === 'PINCH', 'Should remain PINCH when HP is 1');

  // 終盤状態 (ドラゴン全首討伐: allHeadsDefeated = true)
  palette.updateByPlayerHP(1000, true);
  assert(palette.getMode() === 'DARK', 'Should be DARK mode when all heads defeated');
  assert(palette.getThemeClass() === 'theme-dark', 'Theme class should be theme-dark');
  assert(palette.fieldBackgroundColor === '#000000', 'Dark field bg color (black)');

  // HPが低くてもドラゴン全首討伐が最優先
  palette.updateByPlayerHP(200, true);
  assert(palette.getMode() === 'DARK', 'DARK mode has priority over PINCH');

  console.log('✓ 2. PaletteManager tests passed.');
}

// ==========================================
// 3. PSG音源レトロサウンドシステム検証
// ==========================================
console.log('Testing 3: PSGAudio headless safe-fallback & methods...');

{
  const audio = PSGAudio.getInstance();
  assert(audio !== null, 'PSGAudio instance should be created');

  // ヘッドレス環境での安全呼び出し確認（例外をスローしないこと）
  audio.playBumpCombat();
  audio.playDamage();
  audio.playBreak();
  audio.playUnlockChest();
  audio.playPickup();
  audio.playSwap();
  audio.playMagicCast();
  audio.playFireball();
  audio.playWarp();
  audio.playGameOver();
  audio.playClearFanfare();
  audio.startBGM();
  audio.stopBGM();

  // ミュート制御
  assert(audio.isMuted() === false, 'Audio should default to unmuted');
  audio.setMuted(true);
  assert(audio.isMuted() === true, 'Audio should be muted');
  audio.toggleMute();
  assert(audio.isMuted() === false, 'Audio toggle should unmute');

  console.log('✓ 3. PSGAudio safe-fallback tests passed.');
}

// ==========================================
// 4. ゲーム状態・システム統合検証
// ==========================================
console.log('Testing 4: GameEngine state transitions (TITLE / PLAYING / GAMEOVER / STAGECLEAR)...');

{
  // モックCanvas
  const mockCanvas = {
    getContext: () => ({
      fillRect: () => {},
      strokeRect: () => {},
      drawImage: () => {},
      fillText: () => {},
      measureText: () => ({ width: 0 }),
      imageSmoothingEnabled: false,
    }),
  } as unknown as HTMLCanvasElement;

  const engine = new GameEngine(mockCanvas);

  // 初期状態は TITLE
  assert(engine.getState() === 'TITLE', `Initial state should be TITLE, got ${engine.getState()}`);

  // TITLE 中は移動入力を受け付けない
  const player = engine.getPlayer();
  const initPos = { ...player.pos };
  engine.executeTurn('RIGHT');
  assert(player.pos.x === initPos.x && player.pos.y === initPos.y, 'Player should not move in TITLE state');

  // ゲーム開始
  engine.startGame();
  assert(engine.getState() === 'PLAYING', 'State should be PLAYING after startGame');

  // 死亡判定 -> GAMEOVER への遷移
  player.hp = 0;
  // ターンを進めて死亡判定を発火
  engine.executeTurn(null, true);
  assert(engine.getState() === 'GAMEOVER', `State should transition to GAMEOVER when HP <= 0, got ${engine.getState()}`);

  // GAMEOVER からのリセット -> PLAYING に復帰
  engine.resetGame();
  assert(engine.getState() === 'PLAYING', 'State should return to PLAYING after resetGame');
  assert(engine.getPlayer().hp === 1000, 'Player HP should reset to 1000');

  // ステージクリア判定 -> STAGECLEAR への遷移
  const p2 = engine.getPlayer();
  p2.crowns = 4;
  p2.isStageCleared = true;
  engine.executeTurn(null, true);
  assert(engine.getState() === 'STAGECLEAR', `State should transition to STAGECLEAR when stage cleared, got ${engine.getState()}`);

  console.log('✓ 4. GameEngine state transition tests passed.');
}

console.log('--- ✓ All Phase 5 Presentation, Sound & System Integration Tests Passed Successfully! ---');
