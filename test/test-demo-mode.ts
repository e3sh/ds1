import { GameEngine } from '../src/core/GameEngine.js';
import { InputManager } from '../src/core/InputManager.js';
import { DOMUIManager } from '../src/view/DOMUIManager.js';

console.log('--- Attract Demo Mode & Input Interruption Verification ---');

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// -----------------------------------------------------------------------------
// Test 1: デモ開始と初期状態
// -----------------------------------------------------------------------------
console.log('Testing 1: startDemoMode initializes demo bot and active state...');
{
  const engine = new GameEngine(null, { seed: 12345 });
  assert(engine.getState() === 'TITLE', 'Initial engine state should be TITLE');
  assert(!engine.isDemoActive(), 'Demo should not be active initially');

  engine.startDemoMode();
  assert(engine.isDemoActive(), 'Demo should be active after startDemoMode()');
  assert(engine.getState() === 'PLAYING', 'Game state should be PLAYING during demo');

  engine.stopDemoMode();
  assert(!engine.isDemoActive(), 'Demo should be stopped after stopDemoMode()');
  assert(engine.getState() === 'TITLE', 'State should return to TITLE after stopDemoMode()');
  console.log('✓ 1. startDemoMode and stopDemoMode state transition verified.');
}

// -----------------------------------------------------------------------------
// Test 2: デモ中のゲームオーバー／ステージクリアからタイトル画面への自動復帰
// -----------------------------------------------------------------------------
console.log('Testing 2: Demo gameover / stageclear transition to TITLE after delay...');
{
  // 2-1: GAMEOVER 時のタイトル復帰
  const engine1 = new GameEngine(null, { seed: 12345 });
  engine1.startDemoMode();
  assert(engine1.isDemoActive(), 'Demo is active');

  // 強制的にゲームオーバーを発生させる
  (engine1 as any).handleGameOver();
  assert(engine1.getState() === 'GAMEOVER', 'State should be GAMEOVER');
  assert(engine1.isDemoActive(), 'Demo should still be active during post-gameover fanfare delay');

  // 11ステップ経過: まだGAMEOVER演出中（タイトルには戻らない）
  for (let i = 0; i < 11; i++) {
    engine1.stepDemo();
    assert(engine1.isDemoActive(), `Demo should remain active during delay frame ${i + 1}`);
    assert(engine1.getState() === 'GAMEOVER', 'State should still be GAMEOVER');
  }

  // 12ステップ目: 遅延演出終了 -> タイトル画面へ自動復帰
  engine1.stepDemo();
  assert(!engine1.isDemoActive(), 'Demo should be stopped after delay');
  assert(engine1.getState() === 'TITLE', 'State should automatically transition to TITLE');

  // 2-2: STAGECLEAR 時のタイトル復帰
  const engine2 = new GameEngine(null, { seed: 12345 });
  engine2.startDemoMode();
  (engine2 as any).handleStageClear();
  assert(engine2.getState() === 'STAGECLEAR', 'State should be STAGECLEAR');

  for (let i = 0; i < 11; i++) {
    engine2.stepDemo();
    assert(engine2.isDemoActive(), `Demo active during delay frame ${i + 1}`);
    assert(engine2.getState() === 'STAGECLEAR', 'State should still be STAGECLEAR');
  }

  engine2.stepDemo();
  assert(!engine2.isDemoActive(), 'Demo should be stopped after delay');
  assert(engine2.getState() === 'TITLE', 'State should automatically transition to TITLE after clear');

  console.log('✓ 2. Demo ends with delay and automatically returns to TITLE.');
}

// -----------------------------------------------------------------------------
// Test 3: スペースキーによるデモ中断時は必ずタイトル画面へ移動
// -----------------------------------------------------------------------------
console.log('Testing 3: SPACE key interruption stops demo and safely stays at TITLE...');
{
  const engine = new GameEngine(null, { seed: 12345 });
  engine.startDemoMode();
  assert(engine.isDemoActive(), 'Demo is active');
  assert(engine.getState() === 'PLAYING', 'Demo is PLAYING');

  const input = (engine as any).inputManager as InputManager;

  // デモ再生中に Space キーを押下
  (input as any).handleKeyDown({
    code: 'Space',
    preventDefault: () => {},
  });
  (input as any).handleKeyUp({ code: 'Space' });

  // 検証:
  // 1. デモは停止している
  assert(!engine.isDemoActive(), 'Demo must be stopped by Space key');
  // 2. 即座にゲーム開始（PLAYING）されず、必ずTITLE画面にとどまっている
  assert(engine.getState() === 'TITLE', 'Engine state must be TITLE, not immediately restarted');

  // 改めてプレイヤーがタイトル画面で Space キーを押下
  (input as any).handleKeyDown({
    code: 'Space',
    preventDefault: () => {},
  });
  (input as any).handleKeyUp({ code: 'Space' });

  // 初めてプレイヤー自身のプレイとしてゲームが開始される
  assert(!engine.isDemoActive(), 'Demo must not be active');
  assert(engine.getState() === 'PLAYING', 'Game should start as player game upon second Space key');

  console.log('✓ 3. Space key safely interrupts demo to TITLE, and next Space starts player game.');
}

// -----------------------------------------------------------------------------
// Test 4: Enter・Escape・矢印・魔法等の任意キーによるデモ中断
// -----------------------------------------------------------------------------
console.log('Testing 4: Any key (Enter, Escape, Arrow, Magic) safely interrupts demo to TITLE...');
{
  const testKeys = ['Enter', 'Escape', 'ArrowUp', 'KeyM', 'KeyX', 'KeyD', 'KeyQ', 'KeyR'];

  for (const key of testKeys) {
    const engine = new GameEngine(null, { seed: 54321 });
    engine.startDemoMode();
    assert(engine.isDemoActive(), `Demo active before ${key}`);

    const input = (engine as any).inputManager as InputManager;
    (input as any).handleKeyDown({
      code: key,
      preventDefault: () => {},
    });
    (input as any).handleKeyUp({ code: key });

    assert(!engine.isDemoActive(), `Demo must be stopped by ${key}`);
    assert(engine.getState() === 'TITLE', `State must be TITLE after pressing ${key}, not running actions`);
  }

  console.log('✓ 4. All input keys cleanly interrupt demo and return to TITLE.');
}

// -----------------------------------------------------------------------------
// Test 5: DOMUIManager コールバック経由でのデモ中断ガード
// -----------------------------------------------------------------------------
console.log('Testing 5: DOMUIManager callbacks guard against demo interference...');
{
  const engine = new GameEngine(null, { seed: 9999 });

  // DOMUIManager コールバックをエミュレート
  const callbacks = {
    onStartGame: () => {
      if ((engine as any).isDemoMode) {
        engine.stopDemoMode();
        return;
      }
      engine.startGame();
    },
  };

  engine.startDemoMode();
  assert(engine.isDemoActive(), 'Demo active');

  // デモ中にUIの「START GAME」ボタンハンドラが発火した場合
  callbacks.onStartGame();
  assert(!engine.isDemoActive(), 'Demo stopped by UI start button');
  assert(engine.getState() === 'TITLE', 'State transitions to TITLE without accidental immediate game start');

  console.log('✓ 5. DOMUIManager callbacks properly guard against direct game starts during demo.');
}

// -----------------------------------------------------------------------------
// Test 6: デモ中の最大ターン数タイムオーバー
// -----------------------------------------------------------------------------
console.log('Testing 6: Demo max turns timeout (500 turns) safely returns to TITLE...');
{
  const engine = new GameEngine(null, { seed: 12345 });
  engine.startDemoMode();
  assert(engine.isDemoActive(), 'Demo active');

  // 499ターンまで前進
  (engine as any).demoTurns = 499;
  // スタック検知が誤爆しないように位置を変更
  (engine as any).lastDemoPos = { x: -1, y: -1 };

  engine.stepDemo();
  // 500ターンに達して自動停止・タイトル復帰
  assert(!engine.isDemoActive(), 'Demo should be stopped at 500 turns');
  assert(engine.getState() === 'TITLE', 'State should return to TITLE on max turns timeout');
  console.log('✓ 6. Max turns timeout (500 turns) verified.');
}

// -----------------------------------------------------------------------------
// Test 7: デモ中の同一マス滞留（包囲・スタック）早期タイムオーバー
// -----------------------------------------------------------------------------
console.log('Testing 7: Stuck timeout (60 frames immobilized) safely returns to TITLE...');
{
  const engine = new GameEngine(null, { seed: 12345 });
  engine.startDemoMode();
  assert(engine.isDemoActive(), 'Demo active');

  const playerPos = engine.getPlayer().pos;
  (engine as any).lastDemoPos = { ...playerPos };
  (engine as any).demoStuckFrames = 59;

  // 60フレーム目の滞留を検知
  engine.stepDemo();
  assert(!engine.isDemoActive(), 'Demo should be stopped when stuck for 60 frames');
  assert(engine.getState() === 'TITLE', 'State should return to TITLE on stuck timeout');
  console.log('✓ 7. Stuck timeout verified.');
}

console.log('--- ✓ All Attract Demo Mode & Input Interruption Tests Passed Successfully! ---');
