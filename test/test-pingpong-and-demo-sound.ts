import assert from 'assert';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { GameEngine } from '../src/core/GameEngine.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { PSGAudio } from '../src/audio/PSGAudio.js';

console.log('--- Ping-Pong Elimination & Demo Sound Off Verification ---');

// =============================================================================
// Test 1: 目標チャタリング（Target Flip-Flop）防止【目標ロック / ヒステリシス】
// =============================================================================
console.log('Testing 1: Target lock and hysteresis prevents flip-flop between equidistant targets...');
{
  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  const map = new WorldMap(30, 30);
  // 初期マップのオブジェクトやアイテムをすべてクリア
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      map.setTile({ x, y }, 'EMPTY');
      map.setObject({ x, y }, 'NONE');
      map.setItem({ x, y }, 'NONE');
    }
  }
  const player = new Player({ x: 10, y: 10, hp: 1000, experience: 2000 });
  player.hasSword = true;
  player.holdItem = 'KEY';

  // プレイヤー (10, 10) から見て等距離（マンハッタン距離 4）に2つの宝箱を配置
  // 宝箱A: (10, 6) -> 距離 4
  // 宝箱B: (14, 10) -> 距離 4
  map.setObject({ x: 10, y: 6 }, 'CHEST');
  map.setObject({ x: 14, y: 10 }, 'CHEST');

  // 最初に対象を探索
  const target1 = (bot as any).findNearestChest(player.pos, map, [], player);
  assert.ok(target1 !== null, 'Should find one of the chests');
  assert.ok(
    (target1.x === 10 && target1.y === 6) || (target1.x === 14 && target1.y === 10),
    'Target must be chest A or B'
  );

  // 選択された目標へ向けてロック
  (bot as any).setLockedChest(target1);
  const lockedPos = (bot as any).lockedChestPos;
  assert.deepStrictEqual(lockedPos, target1, 'Chest target must be locked');

  // 他方の宝箱に1マス近づく位置（例: target1が(10,6)の場合、(11,10)へ移動して宝箱Bとの距離が3、宝箱Aとの距離が5）
  // 通常なら宝箱Bのほうが2マス近いため入れ替わるが、
  // ヒステリシスボーナス(-3)により、宝箱Aの有効距離は 5 - 3 = 2 となり、宝箱Aが維持される！
  const otherChest = target1.x === 10 && target1.y === 6 ? { x: 14, y: 10 } : { x: 10, y: 6 };
  const intermediatePos = target1.x === 10 && target1.y === 6 ? { x: 11, y: 10 } : { x: 10, y: 9 };

  const target2 = (bot as any).findNearestChest(intermediatePos, map, [], player);
  assert.deepStrictEqual(
    target2,
    target1,
    'Target should remain locked due to -3 hysteresis bonus despite moving closer to alternative'
  );

  console.log('✓ 1. Target lock and hysteresis successfully prevented flip-flop.');
}

// =============================================================================
// Test 2: 危険ゾーン境界での進退ループ（Flinching）解消
// =============================================================================
console.log('Testing 2: Flinching resolution via magic neutralization and taboo cost...');
{
  // 2-1: 振動検知時、近傍に未凍結の危険敵がいれば MP を消費して FREEZE / FLASH で突破
  const engine = new GameEngine(null, { seed: 12345 });
  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  const player = engine.getPlayer();
  player.hasSword = true;
  player.magic = 3;
  player.experience = 7000; // FREEZE(6000)習得済み
  player.pos = { x: 15, y: 15 };

  // チェビシェフ距離 1 に危険な敵（atk: 25000）を配置
  const enemy = new EnemyInstance({
    typeId: 8, // タモリ
    pos: { x: 16, y: 15 },
  });
  engine.getEnemies().push(enemy);

  // 振動状態（oscillationCount >= 2）および往復履歴をシミュレート
  (bot as any).recentPositions = [
    { x: 15, y: 15 },
    { x: 15, y: 16 },
    { x: 15, y: 15 },
    { x: 15, y: 16 },
  ];
  (bot as any).oscillationCount = 2;

  const action = bot.decideAction(engine);
  assert.ok(
    action.type === 'MAGIC' && (action.magic === 'FREEZE' || action.magic === 'FLASH'),
    `Action must be FREEZE or FLASH magic to neutralize threat, got: ${JSON.stringify(action)}`
  );

  // 2-2: 退避タイルのタブー記憶とペナルティ
  (bot as any).recentEvadedTile = { x: 16, y: 15 };
  (bot as any).recentEvadedTurns = 6;
  assert.strictEqual((bot as any).recentEvadedTurns, 6, 'Evaded tile turns must be 6');

  // 1手進めるとデクリメントされる
  bot.decideAction(engine);
  assert.strictEqual((bot as any).recentEvadedTurns, 5, 'Evaded tile turns must decrement');

  console.log('✓ 2. Flinching resolution verified.');
}

// =============================================================================
// Test 3: アイテム持ち替え（Hands-Free）中の無限バイパス防止タイムアウト
// =============================================================================
console.log('Testing 3: Item swap timeout cancels stuck item swapping after 10 turns...');
{
  const engine = new GameEngine(null, { seed: 12345 });
  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  const player = engine.getPlayer();
  player.hasSword = true;
  player.holdItem = 'KEY';

  // 持ち替え待ち状態を意図的に設定
  (bot as any).itemToPickupPos = { x: 20, y: 20 };
  assert.strictEqual((bot as any).itemSwapTurns, 0, 'Initial itemSwapTurns must be 0');

  // 9ターン経過: まだ持ち替えステートは維持
  for (let i = 1; i <= 9; i++) {
    bot.decideAction(engine);
    assert.ok((bot as any).itemToPickupPos !== null, `itemToPickupPos should persist at turn ${i}`);
    assert.strictEqual((bot as any).itemSwapTurns, i, `itemSwapTurns should be ${i}`);
  }

  // 10ターン目: 上限（MAX_ITEM_SWAP_TURNS = 10）到達で強制リセット
  bot.decideAction(engine);
  assert.strictEqual((bot as any).itemToPickupPos, null, 'itemToPickupPos must be reset to null on timeout');
  assert.strictEqual((bot as any).itemSwapTurns, 0, 'itemSwapTurns must be reset to 0');

  console.log('✓ 3. Item swap timeout successfully cancels infinite bypass.');
}

// =============================================================================
// Test 4: Demoモード中の Sound Off（自動消音と復元）
// =============================================================================
console.log('Testing 4: Demo mode sound off and restore functionality...');
{
  const audio = PSGAudio.getInstance();

  // ケースA: 通常音あり（muted === false）の状態でデモ開始
  audio.setMuted(false);
  assert.strictEqual(audio.isMuted(), false, 'Audio should initially not be muted');

  const engine = new GameEngine(null, { seed: 12345 });
  engine.startDemoMode();

  // デモ中は消音（Mute）されており、BGMも鳴っていない
  assert.strictEqual(engine.isDemoActive(), true, 'Demo should be active');
  assert.strictEqual(audio.isMuted(), true, 'Audio must be muted during demo');
  assert.strictEqual(audio.isBGMPlaying(), false, 'BGM must not be playing during demo');

  // stopDemoMode() でタイトルに戻ると、元の音あり状態に復元される
  engine.stopDemoMode();
  assert.strictEqual(engine.isDemoActive(), false, 'Demo should be stopped');
  assert.strictEqual(audio.isMuted(), false, 'Audio mute state must be restored to false');

  // ケースB: 元々ミュート（muted === true）の状態でデモ開始
  audio.setMuted(true);
  engine.startDemoMode();
  assert.strictEqual(audio.isMuted(), true, 'Audio is muted during demo');
  engine.stopDemoMode();
  assert.strictEqual(audio.isMuted(), true, 'Audio remains muted after demo');

  // ケースC: takeoverAutoPlay() によるプレイヤー引き継ぎ時
  audio.setMuted(false);
  engine.startAutoPlayVerifyMode();
  // 自走検証モードからプレイヤー手動引き継ぎ
  engine.takeoverAutoPlay();
  assert.strictEqual(engine.isDemoActive(), false, 'Demo should be deactivated on takeover');
  assert.strictEqual(audio.isMuted(), false, 'Audio must be restored to unmuted on takeover');

  console.log('✓ 4. Demo mode sound off and restoration verified successfully.');
}

console.log('--- ✓ All Ping-Pong & Demo Sound Tests Passed Successfully! ---');
