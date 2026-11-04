import assert from 'node:assert';
import { GameEngine } from '../src/core/GameEngine.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';

console.log('--- AutoPlayBot Continuous PowerStone & Warp Ping-Pong Resolution & Infinite AutoPlay Verify ---');

// =============================================================================
// Test 1: 自走検証モードのタイムアウト完全廃止（3000ターン & 200フレーム留まりでも終了しない）
// =============================================================================
console.log('Testing 1: AutoPlay Verify infinite timeout & stuck rescue...');
{
  // 1-A. 通常デモ（startDemoMode）は従来通り 500 ターンおよび STUCK 60 フレームで終了する
  const demoEngine = new GameEngine(null, { seed: 12345 });
  demoEngine.startDemoMode();
  assert.strictEqual(demoEngine.isDemoActive(), true);
  assert.strictEqual(demoEngine.isAutoPlayVerifyActive(), false);

  // 500 ターンに到達させると終了すること
  (demoEngine as any).demoTurns = 499;
  demoEngine.stepDemo();
  assert.strictEqual(demoEngine.isDemoActive(), false, 'Normal demo must stop at 500 turns');

  // 通常デモで STUCK 60 フレーム留まると終了すること
  const stuckDemoEngine = new GameEngine(null, { seed: 12345 });
  stuckDemoEngine.startDemoMode();
  (stuckDemoEngine as any).lastDemoPos = { ...stuckDemoEngine.getPlayer().pos };
  (stuckDemoEngine as any).demoStuckFrames = 59;
  stuckDemoEngine.stepDemo();
  assert.strictEqual(stuckDemoEngine.isDemoActive(), false, 'Normal demo must stop at 60 stuck frames');

  // 1-B. 自走検証モード（startAutoPlayVerifyMode）は 3000 ターンおよび 200 フレームを超えても継続する
  const verifyEngine = new GameEngine(null, { seed: 54321 });
  verifyEngine.startAutoPlayVerifyMode({ topology: 'STANDARD_ROOMS' });
  assert.strictEqual(verifyEngine.isAutoPlayVerifyActive(), true);
  verifyEngine.getPlayer().hp = 999999;
  verifyEngine.getPlayer().maxHp = 999999;

  // 3000 ターンを超えるまで stepDemo を実行
  (verifyEngine as any).demoTurns = 3050;
  verifyEngine.stepDemo();
  assert.strictEqual(verifyEngine.isAutoPlayVerifyActive(), true, 'AutoPlay Verify must NOT terminate at 3000+ turns');
  assert.strictEqual(verifyEngine.getState(), 'PLAYING');

  // 同一座標に 200 フレーム以上留まっても終了せず、救済処理が行われること
  const bot = (verifyEngine as any).demoBot as AutoPlayBot;
  let rescueCalled = false;
  const originalRescue = bot.handleStuckRescue.bind(bot);
  bot.handleStuckRescue = () => {
    rescueCalled = true;
    originalRescue();
  };

  (verifyEngine as any).lastDemoPos = { ...verifyEngine.getPlayer().pos };
  (verifyEngine as any).demoStuckFrames = 250;
  verifyEngine.stepDemo();

  assert.strictEqual(verifyEngine.isAutoPlayVerifyActive(), true, 'AutoPlay Verify must NOT terminate on 200+ stuck frames');
  assert.strictEqual(verifyEngine.getState(), 'PLAYING');
  assert.strictEqual(rescueCalled, true, 'handleStuckRescue must be triggered during prolonged stuck state');

  verifyEngine.stopAutoPlayVerifyMode(false);
  console.log('✓ 1. AutoPlay Verify infinite timeout & stuck rescue verified successfully.');
}

// =============================================================================
// Test 2: ワープゾーンが経路上に存在するマップでのワープ往復（ピンポン現象）解消
// =============================================================================
console.log('Testing 2: Warp ping-pong prevention & warp-aware BFS routing...');
{
  const engine = new GameEngine(null, { seed: 99999 });
  engine.startClassicGame();
  const map = engine.getMap();
  const player = engine.getPlayer();

  // テスト用マップのクリア
  map.clearWarpPairs();
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      map.setBaseTile({ x, y }, 'WALL_STATIC');
      map.setObject({ x, y }, 'NONE');
      map.setItem({ x, y }, 'NONE');
    }
  }

  // 安全な直線通路 (10, 10) 〜 (16, 10)
  for (let x = 10; x <= 16; x++) {
    map.setBaseTile({ x, y: 10 }, 'EMPTY');
  }

  // 通路の隣にワープA (13, 9) と 孤立した遠隔地ワープB (40, 40) を配置
  map.setBaseTile({ x: 13, y: 9 }, 'WARP');
  map.setBaseTile({ x: 40, y: 40 }, 'WARP');
  map.addWarpPair({ x: 13, y: 9 }, { x: 40, y: 40 });

  // プレイヤーは (10, 10)、目標アイテムは (16, 10)
  player.reset({ x: 10, y: 10, hp: 1000, experience: 20000 });
  player.holdItem = 'NONE';
  map.setItem({ x: 16, y: 10 }, 'SWORD');

  const bot = new AutoPlayBot();

  // (1) 通常の床ルートが存在する場合、BFSが意図せず不要なワープ(13, 9)を踏まず、床を通って目標へ向かうこと
  let reached = false;
  for (let t = 0; t < 15; t++) {
    const action = bot.step(engine);
    if (player.pos.x === 16 && player.pos.y === 10) {
      reached = true;
      break;
    }
    // 遠隔地ワープB(40, 40)へ飛ばされていないこと
    assert.ok(player.pos.x < 30, 'Player must not accidentally step into unnecessary warp');
  }
  assert.strictEqual(reached, true, 'Player must reach target item via normal corridor without stepping into warp');

  // (2) ワープ着地直後の逆戻り防止（ワープタブー制御）の検証
  // プレイヤーをワープA(13, 9)へ乗せ、ワープB(40, 40)に着地させる
  map.setBaseTile({ x: 40, y: 41 }, 'EMPTY');
  map.setBaseTile({ x: 40, y: 39 }, 'EMPTY');
  map.setBaseTile({ x: 41, y: 40 }, 'EMPTY');
  player.pos = { x: 13, y: 9 };
  // ワープ実行
  player.pos = { x: 40, y: 40 };
  (bot as any).recordWarpEvent({ x: 13, y: 9 }, { x: 40, y: 40 });

  assert.strictEqual((bot as any).isWarpTaboo({ x: 40, y: 40 }), true, 'Warp destination must be registered as taboo');
  assert.strictEqual((bot as any).isWarpTaboo({ x: 13, y: 9 }), true, 'Warp origin must be registered as taboo');

  // 徘徊（wanderSafe）で直前のワープ(40, 40)を即座に踏み直さないこと
  player.pos = { x: 40, y: 41 }; // 1歩離れた位置
  const wanderAction = (bot as any).wanderSafe(player, map, [], undefined);
  if (wanderAction.type === 'MOVE') {
    const nextPos = MovementSystem.getNextPosition(player.pos, wanderAction.dir);
    assert.ok(!(nextPos.x === 40 && nextPos.y === 40), 'WanderSafe must not re-enter taboo warp tile immediately');
  }

  console.log('✓ 2. Warp ping-pong prevention & warp-aware BFS routing verified.');
}

// =============================================================================
// Test 3: 8歩周期パワーストーン連続開錠の近傍拡張（3個以上の宝箱連鎖開錠）
// =============================================================================
console.log('Testing 3: 8-step cycle continuous chain on nearby chests (3+ chests)...');
{
  const engine = new GameEngine(null, { seed: 11111 });
  engine.startClassicGame();
  const map = engine.getMap();
  const player = engine.getPlayer();

  // マップ全域を空床に初期化＆敵を消去
  (engine as any).enemies = [];
  (engine as any).ghosts = [];
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      map.setBaseTile({ x, y }, 'EMPTY');
      map.setObject({ x, y }, 'NONE');
      map.setItem({ x, y }, 'NONE');
    }
  }

  // 宝箱を3個配置:
  // 宝箱1: (10, 10)
  // 宝箱2: (11, 11) - 宝箱1の斜め1マス（距離2）
  // 宝箱3: (13, 11) - 宝箱2から直角2マス（マンハッタン距離2、斜めではない近傍配置！）
  map.setObject({ x: 10, y: 10 }, 'CHEST');
  map.setObject({ x: 11, y: 11 }, 'CHEST');
  map.setObject({ x: 13, y: 11 }, 'CHEST');

  // プレイヤー初期設定: 剣と鍵を所持して宝箱1の位置に配置（初期開錠でPOWER_STONEを排出）
  player.reset({ x: 10, y: 10, hp: 10000, experience: 20000 });
  player.hp = 10000;
  player.maxHp = 10000;
  player.hasSword = true;
  player.holdItem = 'KEY';
  player.stepCountSinceStone = 8; // 8歩目で開錠して最初のPOWER_STONEを確定排出

  const bot = new AutoPlayBot();

  // 1個目の宝箱を開錠（SPACEアクション）
  engine.executeTurn(null);
  assert.strictEqual(map.getObject({ x: 10, y: 10 }), 'NONE', 'Chest 1 should be opened');
  assert.strictEqual(map.getItem({ x: 10, y: 10 }), 'POWER_STONE', 'Chest 1 must drop POWER_STONE');
  assert.strictEqual(player.stepCountSinceStone, 0, 'stepCountSinceStone should reset to 0');
  assert.strictEqual(player.holdItem, 'KEY', 'Player must retain KEY');

  // ボットが自律的に宝箱2へ向けて8歩調整を行い、8歩目で開錠すること
  let chest2Opened = false;
  for (let turn = 0; turn < 12; turn++) {
    const action = bot.step(engine);
    if (map.getObject({ x: 11, y: 11 }) === 'NONE') {
      chest2Opened = true;
      break;
    }
  }

  assert.strictEqual(chest2Opened, true, 'Chest 2 must be opened within 8-step cycle');
  assert.strictEqual(map.getItem({ x: 11, y: 11 }), 'POWER_STONE', 'Chest 2 must drop POWER_STONE on floor');
  assert.strictEqual(player.stepCountSinceStone, 0, 'stepCountSinceStone must reset to 0 upon chest 2 unlock');
  assert.strictEqual(player.pos.x, 11);
  assert.strictEqual(player.pos.y, 11);

  // 宝箱1のパワーストーンも床に残っていること
  assert.strictEqual(map.getItem({ x: 10, y: 10 }), 'POWER_STONE', 'Chest 1 POWER_STONE must remain on floor');

  // 斜め配置ではない宝箱3 (13, 11) を近傍探索で検知できるか確認
  const target3 = bot.findNearbyChestForEightStepCycle(player.pos, map, [], engine.getDragon(), player);
  assert.ok(target3 !== null, 'findNearbyChestForEightStepCycle must find non-diagonal chest 3');
  assert.strictEqual(target3.chestPos.x, 13);
  assert.strictEqual(target3.chestPos.y, 11);

  // ボットが継続して宝箱3へ向けて8歩調整を行い、8歩目で開錠すること（3個目連続排出！）
  let chest3Opened = false;
  for (let turn = 0; turn < 15; turn++) {
    const action = bot.step(engine);
    if (map.getObject({ x: 13, y: 11 }) === 'NONE') {
      chest3Opened = true;
      break;
    }
  }

  assert.strictEqual(chest3Opened, true, 'Chest 3 (distance 2, non-diagonal) must be opened via 8-step continuous chain');
  assert.strictEqual(map.getItem({ x: 13, y: 11 }), 'POWER_STONE', 'Chest 3 must drop 3rd POWER_STONE');
  assert.strictEqual(player.stepCountSinceStone, 0, 'stepCountSinceStone must reset to 0 upon chest 3 unlock');

  // マップ上に3個すべてのパワーストーンが排出されていること！
  assert.strictEqual(map.getItem({ x: 10, y: 10 }), 'POWER_STONE', 'Stone 1 intact');
  assert.strictEqual(map.getItem({ x: 11, y: 11 }), 'POWER_STONE', 'Stone 2 intact');
  assert.strictEqual(map.getItem({ x: 13, y: 11 }), 'POWER_STONE', 'Stone 3 intact');

  console.log('✓ 3. 8-step cycle continuous chain on nearby chests (3+ chests) verified successfully.');
}

// =============================================================================
// Test 4: シームレスな自動 ⇔ 手動トグル切り替え（Toggle Auto-Play）の検証
// =============================================================================
console.log('Testing 4: Seamless Auto-Play toggle from current game state...');
{
  const engine = new GameEngine(null, { seed: 99999 });
  engine.startClassicGame();
  assert.strictEqual(engine.getState(), 'PLAYING');
  assert.strictEqual(engine.isAutoPlayVerifyActive(), false);
  assert.strictEqual(engine.isDemoActive(), false);

  const initialPos = { ...engine.getPlayer().pos };
  const initialHp = engine.getPlayer().hp;

  // 1. 手動プレイ中から toggleAutoPlay() で自走モードに切り替え
  engine.toggleAutoPlay();
  assert.strictEqual(engine.isAutoPlayVerifyActive(), true, 'AutoPlay must be active after toggle');
  assert.strictEqual(engine.isDemoActive(), true);
  // 状態（座標・HP）が維持されていること
  assert.strictEqual(engine.getPlayer().pos.x, initialPos.x);
  assert.strictEqual(engine.getPlayer().pos.y, initialPos.y);
  assert.strictEqual(engine.getPlayer().hp, initialHp);

  // 2. 自走モードでステップ実行
  engine.stepDemo();
  assert.strictEqual(engine.isAutoPlayVerifyActive(), true);

  // 3. 再度 toggleAutoPlay() で手動操作に戻す
  engine.toggleAutoPlay();
  assert.strictEqual(engine.isAutoPlayVerifyActive(), false, 'AutoPlay must be inactive after second toggle');
  assert.strictEqual(engine.isDemoActive(), false);
  assert.strictEqual(engine.getState(), 'PLAYING');

  // 4. 手動で操作した後に再度自走を再開できること
  const currentPos = { ...engine.getPlayer().pos };
  engine.toggleAutoPlay();
  assert.strictEqual(engine.isAutoPlayVerifyActive(), true, 'AutoPlay must resume seamlessly from current state');
  assert.strictEqual(engine.getPlayer().pos.x, currentPos.x);

  // 5. takeoverAutoPlay() による手動引き継ぎ
  engine.takeoverAutoPlay();
  assert.strictEqual(engine.isAutoPlayVerifyActive(), false, 'takeoverAutoPlay must return to manual control');
  assert.strictEqual(engine.getState(), 'PLAYING');

  console.log('✓ 4. Seamless Auto-Play toggle from current game state verified successfully.');
}

console.log('--- All AutoPlay Continuous & Warp Ping-Pong Tests Passed Successfully! ---');
