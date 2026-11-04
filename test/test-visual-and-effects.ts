import assert from 'node:assert';
import { CombatEffectManager } from '../src/view/CombatEffectManager.js';
import { Player } from '../src/models/Player.js';
import {
  MAP_VIEW_HEIGHT,
  MAP_VIEW_WIDTH,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  TILE_SIZE,
  VIEW_TILES_X,
  VIEW_TILES_Y,
} from '../src/config/Constants.js';

console.log('--- Visual & Combat Effects Verification ---');

// テスト1: 高精細純マップ Canvas 定数の整合性検証
console.log('Testing 1: High-res pure map Canvas constants...');
if (TILE_SIZE !== 32) {
  throw new Error(`Expected TILE_SIZE to be 32, got ${TILE_SIZE}`);
}
if (VIEW_TILES_X !== 15 || VIEW_TILES_Y !== 11) {
  throw new Error(`Expected view tiles to be 15x11, got ${VIEW_TILES_X}x${VIEW_TILES_Y}`);
}
if (SCREEN_WIDTH !== 480 || SCREEN_HEIGHT !== 352) {
  throw new Error(`Expected Canvas resolution to be 480x352, got ${SCREEN_WIDTH}x${SCREEN_HEIGHT}`);
}
if (MAP_VIEW_WIDTH !== SCREEN_WIDTH || MAP_VIEW_HEIGHT !== SCREEN_HEIGHT) {
  throw new Error('Canvas must be purely dedicated to the map viewport');
}
console.log('✓ 1. Pure map Canvas constants verified successfully.');

// テスト2: CombatEffectManager のプレイヤー攻撃エフェクト＆フリッカー
console.log('Testing 2: Player attack effects and enemy flicker lifecycle...');
const effectMgr = new CombatEffectManager();
effectMgr.triggerPlayerAttack({ x: 5, y: 5 }, 'enemy_slime_1', 25, false);

if (!effectMgr.isEnemyFlickering('enemy_slime_1')) {
  throw new Error('Enemy should be flickering immediately after attack');
}
if (effectMgr.isPlayerHurtFlickering()) {
  throw new Error('Player should not be flickering on player attack');
}

// 時間経過 (200ms) で敵のフリッカーが終了することを確認
effectMgr.update(200);
if (effectMgr.isEnemyFlickering('enemy_slime_1')) {
  throw new Error('Enemy flicker should expire after duration');
}
console.log('✓ 2. Player attack effects & enemy flicker lifecycle verified.');

// テスト3: 敵反撃エフェクト＆プレイヤー被弾フリッカー
console.log('Testing 3: Enemy counter effects and player hurt flicker...');
effectMgr.triggerEnemyCounter({ x: 8, y: 8 }, 15);
if (!effectMgr.isPlayerHurtFlickering()) {
  throw new Error('Player should be flickering after taking damage');
}

// 時間経過 (200ms) でプレイヤーの被弾フリッカーが終了することを確認
effectMgr.update(200);
if (effectMgr.isPlayerHurtFlickering()) {
  throw new Error('Player hurt flicker should expire after duration');
}
console.log('✓ 3. Enemy counter & player hurt flicker verified.');

// テスト4: プレイヤーの携帯アイテム所持状態
console.log('Testing 4: Player hold items visual state support...');
const player = new Player({ x: 8, y: 8 });
player.holdItem = 'RING';
if (player.holdItem !== 'RING') throw new Error('Player should hold RING');

player.holdItem = 'CROSS';
if (player.holdItem !== 'CROSS') throw new Error('Player should hold CROSS');

player.holdItem = 'POWER_STONE';
if (player.holdItem !== 'POWER_STONE') throw new Error('Player should hold POWER_STONE');

player.holdItem = 'KEY';
if (player.holdItem !== 'KEY') throw new Error('Player should hold KEY');
console.log('✓ 4. Player hold item states verified.');

// テスト5: 初期配置においてブロックとアイテム・宝箱が重複していないこと
console.log('Testing 5: Initial map objects and items non-overlapping verification...');
import { WorldMap } from '../src/models/WorldMap.js';
const testMap = new WorldMap();

// 鍵 (KEY) の初期位置がブロックの下に隠れていないこと
const keyPos = { x: 10, y: 6 };
if (testMap.getItem(keyPos) !== 'KEY') {
  throw new Error(`Expected KEY at (${keyPos.x}, ${keyPos.y}), got ${testMap.getItem(keyPos)}`);
}
if (testMap.getObject(keyPos) !== 'NONE') {
  throw new Error(`KEY tile must NOT be covered by an object: found ${testMap.getObject(keyPos)}`);
}

// マップ全体を走査し、アイテムとオブジェクト（岩・宝箱）が重複していないことを網羅検証
let overlapCount = 0;
for (let y = 0; y < testMap.height; y++) {
  for (let x = 0; x < testMap.width; x++) {
    const item = testMap.getItem({ x, y });
    const obj = testMap.getObject({ x, y });
    if (item !== 'NONE' && obj !== 'NONE') {
      overlapCount++;
    }
  }
}
if (overlapCount > 0) {
  throw new Error(`Found ${overlapCount} overlapping item/object tiles in initial map`);
}
console.log('✓ 5. Initial map objects and items strictly non-overlapping verified.');

// テスト6: 岩（BLOCK）をアイテムのあるマスへ重ねて押し出せないこと
console.log('Testing 6: Block pushing onto items forbidden...');
const pushItemPos = { x: 15, y: 15 };
testMap.setItem(pushItemPos, 'KEY');
if (testMap.isPushDestinationValid(pushItemPos)) {
  throw new Error('isPushDestinationValid must return false when tile contains an item');
}
console.log('✓ 6. Block pushing onto items forbidden verified.');

// テスト7: 家（HOME）のマスでのアイテムドロップ・交換禁止検証
console.log('Testing 7: Dropping items inside HOME forbidden...');
import { MovementSystem } from '../src/systems/MovementSystem.js';
const homeTestMap = new WorldMap(20, 20);
const homePlayer = new Player({ x: homeTestMap.homePos.x, y: homeTestMap.homePos.y });
homePlayer.holdItem = 'KEY';

// 家の上でスペースキーを押してもアイテムはドロップされないこと
const homeSpaceResult = MovementSystem.executeSpaceAction(homePlayer, homeTestMap);
if (homeSpaceResult.action !== 'WAIT') {
  throw new Error(`Expected WAIT action inside HOME, got ${homeSpaceResult.action}`);
}
if (homePlayer.holdItem !== 'KEY') {
  throw new Error('Player must still hold KEY when drop is refused inside HOME');
}
if (homeTestMap.getItem(homeTestMap.homePos) !== 'NONE') {
  throw new Error('No item should be placed onto HOME floor tile');
}
console.log('✓ 7. Dropping items inside HOME forbidden verified.');

// テスト8: 死神（hasDeath）の背後追従と十字架取得による成仏消滅検証
console.log('Testing 8: Death follower positioning and cross purification...');
const deathPlayer = new Player({ x: 5, y: 5 });
deathPlayer.hasDeath = true;
deathPlayer.deathFollowerPos = { x: 4, y: 5 };

// 移動したときに、死神が直前の座標（5, 5）へ追従すること
const moved = MovementSystem.tryMove(deathPlayer, 'RIGHT', homeTestMap);
if (!moved) throw new Error('Player should move RIGHT');
if (deathPlayer.pos.x !== 6 || deathPlayer.pos.y !== 5) {
  throw new Error('Player position should be (6, 5)');
}
if (!deathPlayer.deathFollowerPos || deathPlayer.deathFollowerPos.x !== 5 || deathPlayer.deathFollowerPos.y !== 5) {
  throw new Error(`Death follower should follow to previous pos (5, 5), got ${JSON.stringify(deathPlayer.deathFollowerPos)}`);
}

// 十字架を拾ったときに死神が成仏して消滅すること
homeTestMap.setItem({ x: 6, y: 5 }, 'CROSS');
deathPlayer.holdItem = 'NONE';
const pickCrossRes = MovementSystem.executeSpaceAction(deathPlayer, homeTestMap);
if (pickCrossRes.item !== 'CROSS') throw new Error('Player should pick CROSS');
if (deathPlayer.hasDeath !== false) throw new Error('Death curse must be purified upon picking CROSS');
if (deathPlayer.deathFollowerPos !== null) throw new Error('Death follower must be cleared upon purification');
console.log('✓ 8. Death follower positioning and cross purification verified.');

// テスト9: FREEZE状態モンスターの白■背景塗りつぶし＆上下ボビング停止検証
console.log('Testing 9: Frozen enemy white square background fill and bobbing stop...');
import { EnemyInstance } from '../src/models/Enemy.js';
import { MonsterGraphics } from '../src/view/MonsterGraphics.js';

const rectCalls: { x: number; y: number; w: number; h: number; fillStyle: string }[] = [];
const mockCtx = {
  fillStyle: '#000000',
  save: () => {},
  restore: () => {},
  fillRect: function (x: number, y: number, w: number, h: number) {
    rectCalls.push({ x, y, w, h, fillStyle: String(this.fillStyle) });
  },
} as unknown as CanvasRenderingContext2D;

const frozenSkeleton = new EnemyInstance({ typeId: 1, pos: { x: 10, y: 10 } });
frozenSkeleton.frozenTimer = 6;
MonsterGraphics.drawMonster(mockCtx, frozenSkeleton, 64, 96, false);

// 最初のfillRectが32x32の白背景塗りつぶし（#ffffff）であること
if (rectCalls.length === 0) {
  throw new Error('Expected fillRect calls for frozen monster');
}
const bgCall = rectCalls[0];
if (
  bgCall.x !== 64 ||
  bgCall.y !== 96 ||
  bgCall.w !== TILE_SIZE ||
  bgCall.h !== TILE_SIZE ||
  bgCall.fillStyle.toLowerCase() !== '#ffffff'
) {
  throw new Error(`Expected 32x32 white background fill at (64,96), got ${JSON.stringify(bgCall)}`);
}
// 白系モンスター（スケルトン）の本体色が白背景上で黒（#000000）に反転されて描画されていること
const bodyCall = rectCalls[1];
if (bodyCall.fillStyle.toLowerCase() !== '#000000') {
  throw new Error(`Expected white monster body color to invert to #000000 on white freeze background, got ${bodyCall.fillStyle}`);
}
console.log('✓ 9. Frozen enemy white square background fill & contrast inversion verified.');

// テスト10: オフスクリーンスプライトシートの初回一括生成＆drawImage切り出し検証
console.log('Testing 10: Offscreen monster sprite sheet generation and drawImage slicing...');
let sheetFillCount = 0;
const fakeSheetCanvas = {
  width: 0,
  height: 0,
  getContext: () => ({
    imageSmoothingEnabled: true,
    fillStyle: '#000000',
    clearRect: () => {},
    fillRect: () => {
      sheetFillCount++;
    },
  }),
} as unknown as HTMLCanvasElement;

const generatedSheet = MonsterGraphics.getOrCreateSpriteSheet((w, h) => {
  fakeSheetCanvas.width = w;
  fakeSheetCanvas.height = h;
  return fakeSheetCanvas;
});
if (!generatedSheet || generatedSheet.width !== 32 * TILE_SIZE || generatedSheet.height !== 2 * TILE_SIZE) {
  throw new Error(`Expected 1024x64 sprite sheet, got ${generatedSheet?.width}x${generatedSheet?.height}`);
}
if (sheetFillCount === 0) {
  throw new Error('Sprite sheet should pre-render all 32 monsters (normal + frozen rows)');
}

// スプライトシートキャッシュを設定した状態で drawMonster が 1回の drawImage で切り出すことを検証
(MonsterGraphics as any).spriteSheet = generatedSheet;
const drawImageCalls: { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }[] = [];
const sliceTestCtx = {
  save: () => {},
  restore: () => {},
  drawImage: (_img: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) => {
    drawImageCalls.push({ sx, sy, sw, sh, dx, dy, dw, dh });
  },
  fillRect: () => {
    throw new Error('fillRect should NOT be called when slicing from pre-rendered sprite sheet');
  },
} as unknown as CanvasRenderingContext2D;

// 通常状態の No.13 ナイト (colIndex=12 -> sx=384, sy=0)
const normalKnight = new EnemyInstance({ typeId: 13, pos: { x: 5, y: 5 } });
MonsterGraphics.drawMonster(sliceTestCtx, normalKnight, 128, 160, false);

// FREEZE状態の No.13 ナイト (colIndex=12 -> sx=384, sy=32)
const frozenKnight = new EnemyInstance({ typeId: 13, pos: { x: 5, y: 5 } });
frozenKnight.frozenTimer = 4;
MonsterGraphics.drawMonster(sliceTestCtx, frozenKnight, 128, 160, false);

MonsterGraphics.invalidateSpriteSheet();

if (drawImageCalls.length !== 2) {
  throw new Error(`Expected 2 drawImage calls, got ${drawImageCalls.length}`);
}
if (drawImageCalls[0].sx !== 12 * 32 || drawImageCalls[0].sy !== 0 || drawImageCalls[0].dx !== 128 || drawImageCalls[0].dy !== 160) {
  throw new Error(`Unexpected normal slice coords: ${JSON.stringify(drawImageCalls[0])}`);
}
if (drawImageCalls[1].sx !== 12 * 32 || drawImageCalls[1].sy !== 32 || drawImageCalls[1].dx !== 128 || drawImageCalls[1].dy !== 160) {
  throw new Error(`Unexpected frozen slice coords: ${JSON.stringify(drawImageCalls[1])}`);
}
console.log('✓ 10. Offscreen monster sprite sheet generation & drawImage slicing verified.');

// テスト11: オフスクリーンマップタイルスプライトシート生成＆drawImage切り出し検証
console.log('Testing 11: Offscreen map tile sprite sheet generation and drawImage slicing...');
import { TileGraphics } from '../src/view/TileGraphics.js';
import { PaletteManager } from '../src/view/PaletteManager.js';

let tileSheetFillCount = 0;
const fakeTileSheetCanvas = {
  width: 0,
  height: 0,
  getContext: () => ({
    imageSmoothingEnabled: true,
    fillStyle: '#000000',
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    fillRect: () => {
      tileSheetFillCount++;
    },
  }),
} as unknown as HTMLCanvasElement;

const generatedTileSheet = TileGraphics.getOrCreateSpriteSheet((w, h) => {
  fakeTileSheetCanvas.width = w;
  fakeTileSheetCanvas.height = h;
  return fakeTileSheetCanvas;
});

// 17種タイル × 3パレット行（NORMAL/PINCH/DARK） = 544x96
const expectedWidth = 17 * TILE_SIZE; // 544
const expectedHeight = 3 * TILE_SIZE; // 96
if (!generatedTileSheet || generatedTileSheet.width !== expectedWidth || generatedTileSheet.height !== expectedHeight) {
  throw new Error(`Expected ${expectedWidth}x${expectedHeight} tile sprite sheet, got ${generatedTileSheet?.width}x${generatedTileSheet?.height}`);
}
if (tileSheetFillCount === 0) {
  throw new Error('Tile sprite sheet should pre-render all 17 tiles across 3 palette modes');
}

// スプライトシートキャッシュを設定した状態で drawTile が 1回の drawImage で切り出すことを検証
(TileGraphics as any).spriteSheet = generatedTileSheet;
const tileDrawImageCalls: { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }[] = [];
const tileSliceTestCtx = {
  drawImage: (_img: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) => {
    tileDrawImageCalls.push({ sx, sy, sw, sh, dx, dy, dw, dh });
  },
  fillRect: () => {
    throw new Error('fillRect should NOT be called when slicing from pre-rendered tile sprite sheet');
  },
} as unknown as CanvasRenderingContext2D;

const testPalette = new PaletteManager();

// 1. NORMALパレット (rowIndex=0) の 'EMPTY' (colIndex=0 -> sx=0, sy=0)
testPalette.setMode('NORMAL');
TileGraphics.drawTile(tileSliceTestCtx, 'EMPTY', 0, 0, testPalette);

// 2. PINCHパレット (rowIndex=1) の 'WALL_STATIC' (colIndex=1 -> sx=32, sy=32)
testPalette.setMode('PINCH');
TileGraphics.drawTile(tileSliceTestCtx, 'WALL_STATIC', 64, 32, testPalette);

// 3. DARKパレット (rowIndex=2) の 'CHEST' (colIndex=5 -> sx=160, sy=64)
testPalette.setMode('DARK');
TileGraphics.drawTile(tileSliceTestCtx, 'CHEST', 96, 128, testPalette);

// 4. NORMALパレット (rowIndex=0) の 'CROWN' (colIndex=16 -> sx=512, sy=0)
testPalette.setMode('NORMAL');
TileGraphics.drawTile(tileSliceTestCtx, 'CROWN', 160, 200, testPalette);

TileGraphics.invalidateSpriteSheet();

if (tileDrawImageCalls.length !== 4) {
  throw new Error(`Expected 4 drawImage calls, got ${tileDrawImageCalls.length}`);
}
// EMPTY @ NORMAL: sx=0, sy=0
if (tileDrawImageCalls[0].sx !== 0 || tileDrawImageCalls[0].sy !== 0 || tileDrawImageCalls[0].dx !== 0 || tileDrawImageCalls[0].dy !== 0) {
  throw new Error(`Unexpected EMPTY normal slice coords: ${JSON.stringify(tileDrawImageCalls[0])}`);
}
// WALL_STATIC @ PINCH: sx=32, sy=32
if (tileDrawImageCalls[1].sx !== 32 || tileDrawImageCalls[1].sy !== 32 || tileDrawImageCalls[1].dx !== 64 || tileDrawImageCalls[1].dy !== 32) {
  throw new Error(`Unexpected WALL_STATIC pinch slice coords: ${JSON.stringify(tileDrawImageCalls[1])}`);
}
// CHEST @ DARK: sx=5*32=160, sy=2*32=64
if (tileDrawImageCalls[2].sx !== 160 || tileDrawImageCalls[2].sy !== 64 || tileDrawImageCalls[2].dx !== 96 || tileDrawImageCalls[2].dy !== 128) {
  throw new Error(`Unexpected CHEST dark slice coords: ${JSON.stringify(tileDrawImageCalls[2])}`);
}
// CROWN @ NORMAL: sx=16*32=512, sy=0
if (tileDrawImageCalls[3].sx !== 512 || tileDrawImageCalls[3].sy !== 0 || tileDrawImageCalls[3].dx !== 160 || tileDrawImageCalls[3].dy !== 200) {
  throw new Error(`Unexpected CROWN normal slice coords: ${JSON.stringify(tileDrawImageCalls[3])}`);
}
console.log('✓ 11. Offscreen map tile sprite sheet generation & drawImage slicing verified.');

// ==========================================
// 12. CombatEffectManager KICK スライドアニメーション & マップタイル隠蔽検証
// ==========================================
console.log('Testing 12: CombatEffectManager KICK slide animation and tile hiding lifecycle...');
{
  const effects = new CombatEffectManager();

  // 12-1. スライドアニメーションの開始とタイルの隠蔽
  const path = [
    { x: 10, y: 10 },
    { x: 11, y: 10 },
    { x: 12, y: 10 },
    { x: 13, y: 10 },
  ];
  effects.triggerKickSlide(path, { x: 13, y: 10 }, false);

  const slide = effects.getKickSlide();
  assert.ok(slide !== null, 'KickSlideAnimation should be active');
  assert.strictEqual(slide.path.length, 4);
  assert.strictEqual(slide.stepDurationMs, 40);
  assert.strictEqual(slide.elapsedMs, 0);

  // 着地マス (13, 10) はアニメーション中隠蔽されるべき
  assert.strictEqual(effects.isTileHiddenByKickAnimation({ x: 13, y: 10 }), true, 'Final position should be hidden');
  assert.strictEqual(effects.isTileHiddenByKickAnimation({ x: 10, y: 10 }), false, 'Initial position is not hidden');
  assert.strictEqual(effects.isTileHiddenByKickAnimation({ x: 12, y: 10 }), false, 'Intermediate position is not hidden');

  // 12-2. 時間経過によるステップ進行
  effects.update(40); // 1ステップ進行 (40ms)
  assert.ok(effects.getKickSlide() !== null);
  assert.strictEqual(effects.getKickSlide()?.elapsedMs, 40);
  assert.strictEqual(effects.isTileHiddenByKickAnimation({ x: 13, y: 10 }), true);

  effects.update(40); // 2ステップ進行 (80ms)
  assert.ok(effects.getKickSlide() !== null);
  assert.strictEqual(effects.getKickSlide()?.elapsedMs, 80);

  // 12-3. アニメーション完了 (120ms以上) と隠蔽解除・敵撃破エフェクト発生
  effects.update(45); // 合計125ms -> 完了 (3ステップ * 40ms = 120ms)
  assert.strictEqual(effects.getKickSlide(), null, 'KickSlideAnimation should finish and be cleared');
  assert.strictEqual(effects.isTileHiddenByKickAnimation({ x: 13, y: 10 }), false, 'Final position should no longer be hidden');

  // 12-4. その場粉砕 (crushed === true)
  effects.clear();
  effects.triggerKickSlide([{ x: 5, y: 5 }], undefined, true);
  assert.strictEqual(effects.getKickSlide(), null, 'Crushed slide should not register slide animation');
  assert.strictEqual(effects.isTileHiddenByKickAnimation({ x: 5, y: 5 }), false);

  console.log('✓ 12. CombatEffectManager KICK slide animation & tile hiding verified.');
}

console.log('--- ✓ All Visual & Combat Effects Tests Passed Successfully! ---');
