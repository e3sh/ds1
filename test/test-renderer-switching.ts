import assert from 'node:assert';
import { GameEngine } from '../src/core/GameEngine.js';
import { SmoothCanvasRenderer } from '../src/view/SmoothCanvasRenderer.js';
import { CanvasRenderer } from '../src/view/CanvasRenderer.js';
import { CombatEffectManager } from '../src/view/CombatEffectManager.js';
import { Player } from '../src/models/Player.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../src/config/Constants.js';

console.log('--- Phase 16: IGameRenderer & SmoothCanvasRenderer Verification ---');

function createMockCanvas() {
  const calls: { op: string; args: any[] }[] = [];
  const ctx: any = {
    imageSmoothingEnabled: true,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    lineCap: 'butt',
    save: () => calls.push({ op: 'save', args: [] }),
    restore: () => calls.push({ op: 'restore', args: [] }),
    translate: (x: number, y: number) => calls.push({ op: 'translate', args: [x, y] }),
    scale: (x: number, y: number) => calls.push({ op: 'scale', args: [x, y] }),
    fillRect: (x: number, y: number, w: number, h: number) => calls.push({ op: 'fillRect', args: [x, y, w, h] }),
    strokeRect: (x: number, y: number, w: number, h: number) => calls.push({ op: 'strokeRect', args: [x, y, w, h] }),
    clearRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    ellipse: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    fillText: () => {},
    measureText: (t: string) => ({ width: t.length * 6 }),
  };

  const canvas: any = {
    id: 'game-canvas',
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    className: '',
    parentElement: null,
    getContext: (type: string) => (type === '2d' ? ctx : null),
  };

  return { canvas: canvas as HTMLCanvasElement, ctx, calls };
}

// 1. GameEngine のレンダラー切替と状態引き継ぎ
{
  console.log('Testing 1: GameEngine renderer switching & state preservation...');
  const { canvas } = createMockCanvas();
  const engine = new GameEngine(canvas);

  assert.strictEqual(engine.getRendererMode(), 'classic');
  assert.ok(engine.getRenderer() instanceof CanvasRenderer);

  engine.getPlayer().hp = 300;
  engine.getRenderer()?.getPalette().setMode('PINCH');
  engine.getRenderer()?.setTacticalMarker(false);

  const mode2 = engine.toggleRenderer();
  assert.strictEqual(mode2, 'smooth');
  assert.strictEqual(engine.getRendererMode(), 'smooth');
  assert.ok(engine.getRenderer() instanceof SmoothCanvasRenderer);
  assert.strictEqual(engine.getRenderer()?.getPalette().getMode(), 'PINCH');
  assert.strictEqual(engine.getRenderer()?.isTacticalMarkerEnabled(), false);

  const mode3 = engine.switchRenderer('classic');
  assert.strictEqual(mode3, 'classic');
  assert.ok(engine.getRenderer() instanceof CanvasRenderer);
  assert.strictEqual(engine.getRenderer()?.getPalette().getMode(), 'PINCH');
  assert.strictEqual(engine.getRenderer()?.isTacticalMarkerEnabled(), false);

  engine.stop();
  console.log('✓ 1. GameEngine renderer switching & state preservation verified.');
}

// 2. SmoothCanvasRenderer の移動補間 & ワープ即座スナップ
{
  console.log('Testing 2: SmoothCanvasRenderer interpolation & warp snap...');
  const { canvas } = createMockCanvas();
  const renderer = new SmoothCanvasRenderer(canvas);
  const map = new WorldMap();
  const player = new Player({ x: 8, y: 8 });

  // 初回描画（スナップ）
  renderer.render(player, map, 0);
  assert.strictEqual(renderer.getCameraTransform().centerX, 8);
  assert.strictEqual(renderer.getCameraTransform().centerY, 8);

  // 隣接1マス移動 -> 補間開始
  player.pos = { x: 9, y: 8 };
  renderer.render(player, map, 0);
  // 途中フレーム（60ms経過）では 8 < centerX < 9
  renderer.update(60, { autoPlaySpeed: 1, isSpectatorMode: false });
  renderer.render(player, map, 0);
  const midX = renderer.getCameraTransform().centerX;
  assert.ok(midX > 8 && midX < 9, `Expected midX between 8 and 9, got ${midX}`);

  // 完了まで進める
  renderer.update(100, { autoPlaySpeed: 1, isSpectatorMode: false });
  renderer.render(player, map, 0);
  assert.strictEqual(renderer.getCameraTransform().centerX, 9);

  // 2マス以上移動（WARP / JUMP等）-> 補間スキップして即座スナップ
  player.pos = { x: 25, y: 20 };
  renderer.render(player, map, 0);
  assert.strictEqual(renderer.getCameraTransform().centerX, 25);
  assert.strictEqual(renderer.getCameraTransform().centerY, 20);

  renderer.destroy();
  console.log('✓ 2. SmoothCanvasRenderer interpolation & warp snap verified.');
}

// 3. トーラス境界跨ぎ（x=63 -> x=0）の連続補間
{
  console.log('Testing 3: Torus boundary wrap-around smooth interpolation...');
  const { canvas } = createMockCanvas();
  const renderer = new SmoothCanvasRenderer(canvas);
  const map = new WorldMap();
  const player = new Player({ x: 63, y: 10 });

  renderer.render(player, map, 0);
  assert.strictEqual(renderer.getCameraTransform().centerX, 63);

  // 63 -> 0 への1マス移動
  player.pos = { x: 0, y: 10 };
  renderer.render(player, map, 0);
  renderer.update(40, { autoPlaySpeed: 1, isSpectatorMode: false });
  renderer.render(player, map, 0);

  const wrappedMidX = renderer.getCameraTransform().centerX;
  // 逆走（31.5付近）ではなく 63〜64(0) の間にあること
  assert.ok(wrappedMidX > 63 || wrappedMidX < 1, `Expected wrappedMidX near 63..0, got ${wrappedMidX}`);

  renderer.destroy();
  console.log('✓ 3. Torus boundary wrap-around interpolation verified.');
}

// 4. autoPlaySpeed 倍速連動 & 観戦モードズーム & 強ズームアウト全体俯瞰
{
  console.log('Testing 4: Spectator zoom, speed scaling & overview mode...');
  const { canvas } = createMockCanvas();
  const renderer = new SmoothCanvasRenderer(canvas);
  const map = new WorldMap();
  const player = new Player({ x: 8, y: 8 });

  renderer.render(player, map, 0);
  // 観戦モード移行で目標ズームが下がる
  renderer.update(100, { autoPlaySpeed: 5, isSpectatorMode: true });
  assert.ok(renderer.getCameraZoom() < 1.0, `Expected zoom < 1.0 in spectator mode, got ${renderer.getCameraZoom()}`);

  // 5x 倍速時は 30ms で 1マス移動補間がほぼ完了すること (120/5 = 24ms)
  player.pos = { x: 9, y: 8 };
  renderer.render(player, map, 0);
  renderer.update(30, { autoPlaySpeed: 5, isSpectatorMode: true });
  renderer.render(player, map, 0);
  assert.strictEqual(renderer.getCameraTransform().centerX, 9);

  // ズーム上限が 1.0x に制限されていること
  renderer.setCameraZoom(2.0);
  assert.strictEqual(renderer.getCameraZoom(), 1.0);

  // 強ズームアウト（0.25x）で全体俯瞰描画が例外なく動作すること
  renderer.setCameraZoom(0.25);
  renderer.render(player, map, 0);

  renderer.destroy();
  console.log('✓ 4. Spectator zoom, speed scaling & overview mode verified.');
}

// 5. CombatEffectManager のカメラ追従描画と後方互換
{
  console.log('Testing 5: CombatEffectManager camera-aware rendering...');
  const { ctx, calls } = createMockCanvas();
  const map = new WorldMap();
  const effects = new CombatEffectManager();
  effects.triggerPlayerAttack({ x: 10, y: 8 }, 'e1', 50, false);

  // 従来互換呼び出し
  effects.render(ctx, { x: 8, y: 8 }, map);
  assert.strictEqual(calls.filter((c) => c.op === 'scale').length, 0);

  calls.length = 0;
  // カメラ指定呼び出し
  effects.render(ctx, { x: 8, y: 8 }, map, undefined, { centerX: 8.5, centerY: 8, zoom: 0.5 });
  const scaleCalls = calls.filter((c) => c.op === 'scale');
  assert.strictEqual(scaleCalls.length, 1);
  assert.deepStrictEqual(scaleCalls[0].args, [0.5, 0.5]);

  console.log('✓ 5. CombatEffectManager camera-aware rendering verified.');
}

// 6. 拡大縮小時のタイル境界整数化・シームゼロ検証
{
  console.log('Testing 6: Seamless integer tile boundary on arbitrary zoom...');
  const { canvas, calls } = createMockCanvas();
  const renderer = new SmoothCanvasRenderer(canvas);
  const map = new WorldMap();
  const player = new Player({ x: 8, y: 8 });

  // 端数ズーム (0.55x) と補間途中の座標でも fillRect / drawImage 前に ctx.scale がタイルループに掛かっていないこと
  renderer.setCameraZoom(0.55);
  renderer.render(player, map, 0);

  // 最初の scale 呼び出しより前にタイル描画の fillRect が実行されていること（スクリーン空間での整数連結描画）
  const firstScaleIdx = calls.findIndex((c) => c.op === 'scale');
  const tileRectsBeforeScale = calls
    .slice(0, firstScaleIdx)
    .filter((c) => c.op === 'fillRect' && c.args[2] > 0 && c.args[2] < 32);
  assert.ok(tileRectsBeforeScale.length > 0, 'Tile rects should be drawn in screen integer space before ctx.scale');
  for (const r of tileRectsBeforeScale) {
    assert.ok(Number.isInteger(r.args[0]) && Number.isInteger(r.args[1]), 'Tile coordinates must be integers');
  }

  renderer.destroy();
  console.log('✓ 6. Seamless integer tile boundary verified.');
}

console.log('--- ✓ All Phase 16 Renderer Tests Passed Successfully! ---');
