import assert from 'assert';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { GameEngine } from '../src/core/GameEngine.js';

console.log('--- AutoPlayBot Sticky Target & Loop Blacklist Verification ---');

// 1. 三つ巴アイテム配置でのスティッキーターゲットによる一貫回収の検証
// パワーストーン（距離16付近）、POTION（距離14付近）、コイン（距離3付近）
{
  console.log('Testing 1: Sticky target prevents boundary oscillation and reaches locked item...');
  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  const engine = new GameEngine(null, { seed: 42 });
  engine.startGame();
  const player = engine.getPlayer();
  const map = engine.getMap();

  // マップ全体を平坦な床にし、余計なアイテムや敵をクリア
  engine.getEnemies().length = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const p = { x, y };
      map.setItem(p, 'NONE');
      map.setObject(p, 'NONE');
      map.setBaseTile(p, 'EMPTY');
    }
  }

  // プレイヤー初期設定: 手ぶら、STR不足、MP不足、EXP条件合致
  player.pos = { x: 20, y: 20 };
  player.hasSword = true;
  player.holdItem = 'NONE';
  player.strength = 1000;
  player.experience = 1000;
  player.hp = 1000;
  player.maxHp = 1000;
  player.magic = 2;

  bot.setPhase('POWER_RUSH');

  // アイテム配置:
  // - パワーストーン: (35, 21) -> 初期位置(20,20)からマンハッタン距離 16 (閾値15超)
  //   ※1歩下(20,21)へ動くと距離 15 (閾値15以内) となり、旧ロジックでは境界振動を引き起こす
  // - POTION: (20, 34) -> 初期位置(20,20)からマンハッタン距離 14 (閾値18以内)
  // - コイン: (17, 20) -> 初期位置(20,20)からマンハッタン距離 3
  const stonePos = { x: 35, y: 21 };
  const potionPos = { x: 20, y: 34 };
  const coinPos = { x: 17, y: 20 };

  map.setItem(stonePos, 'POWER_STONE');
  map.setItem(potionPos, 'POTION');
  map.setItem(coinPos, 'COIN');

  // 1手目: 初期位置(20, 20)で判断
  // 石(距離16)は閾値外 -> POTION(距離14)がロックされる
  bot.step(engine);
  assert.strictEqual(bot.lockedItemType, 'POTION', 'Initial target should lock POTION');
  assert.deepStrictEqual(bot.lockedItemPos, potionPos, 'Locked position should be potionPos');

  // POTIONに向かってDOWNへ移動していること
  assert.strictEqual(player.pos.x, 20);
  assert.strictEqual(player.pos.y, 21);

  // 2手目以降: (20, 21)において、石(35, 21)の距離が15になり閾値内に入るが、
  // スティッキーターゲットが働き、石やコインへ目移りせずPOTIONロックを継続すること！
  let reachedPotion = false;
  for (let turn = 0; turn < 25; turn++) {
    if (player.pos.x === potionPos.x && player.pos.y === potionPos.y) {
      reachedPotion = true;
      break;
    }
    // POTION到達前の各ステップで、ロックがPOTIONからブレていないことを検証
    assert.strictEqual(bot.lockedItemType, 'POTION', `Turn ${turn}: Target should remain sticky to POTION`);
    assert.deepStrictEqual(bot.lockedItemPos, potionPos, `Turn ${turn}: Target pos should remain potionPos`);
    bot.step(engine);
  }

  assert.ok(reachedPotion, 'Bot should consistently navigate to and reach the locked POTION without oscillating');

  // POTION到達マスで回収アクション（SPACE）を行い、手持ちまたはMPが増加すること
  bot.step(engine);
  assert.strictEqual(map.getItem(potionPos), 'NONE', 'POTION should be picked up from map');

  console.log('✓ 1. Sticky target prevents boundary oscillation and reaches locked item verified.');
}

// 2. 局所ループ検知時のエスケープと直近ターゲットのブラックリスト登録検証
{
  console.log('Testing 2: Local loop detection blacklists recent target item...');
  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  const engine = new GameEngine(null, { seed: 42 });
  engine.startGame();
  const player = engine.getPlayer();
  const map = engine.getMap();

  engine.getEnemies().length = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const p = { x, y };
      map.setItem(p, 'NONE');
      map.setObject(p, 'NONE');
      map.setBaseTile(p, 'EMPTY');
    }
  }

  player.pos = { x: 10, y: 10 };
  player.hasSword = true;
  player.holdItem = 'NONE';
  player.strength = 1000;
  player.magic = 2;
  bot.setPhase('POWER_RUSH');

  const targetItemPos = { x: 15, y: 10 };
  map.setItem(targetItemPos, 'POTION');
  bot.setLockedItem(targetItemPos, 'POTION');

  // 3マス周回ループを強制シミュレート: (10,10) -> (10,11) -> (11,11) -> (10,10)
  player.pos = { x: 10, y: 10 };
  bot.step(engine);

  player.pos = { x: 10, y: 11 };
  bot.step(engine);

  player.pos = { x: 11, y: 11 };
  bot.step(engine);

  // ループ1周目完了: (10,10)に戻る (lookback = 3)
  player.pos = { x: 10, y: 10 };
  bot.step(engine);

  player.pos = { x: 10, y: 11 };
  bot.step(engine);

  player.pos = { x: 11, y: 11 };
  bot.step(engine);

  // ループ2周目完了: (10,10)に戻る
  player.pos = { x: 10, y: 10 };
  bot.step(engine);

  // エスケープが発動し、直近ターゲットがブラックリストに登録されていること
  assert.ok(bot.forceWanderTurns > 0, 'Escape wander should be triggered on local loop');
  assert.ok(bot.isTargetUnreachable(targetItemPos), 'Target item should be marked unreachable in blacklist');

  console.log('✓ 2. Local loop detection blacklists recent target item verified.');
}

// 3. 極近傍（距離<=2）の上位アイテムついで回収の検証
{
  console.log('Testing 3: Nearby higher-priority item interrupts lower priority sticky target...');
  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  const engine = new GameEngine(null, { seed: 42 });
  engine.startGame();
  const player = engine.getPlayer();
  const map = engine.getMap();

  engine.getEnemies().length = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const p = { x, y };
      map.setItem(p, 'NONE');
      map.setObject(p, 'NONE');
      map.setBaseTile(p, 'EMPTY');
    }
  }

  player.pos = { x: 20, y: 20 };
  player.hasSword = true;
  player.holdItem = 'NONE';
  player.strength = 1000; // STR不足（石が最上位）
  player.magic = 5;       // MPは十分
  player.experience = 1000;
  bot.setPhase('POWER_RUSH');

  // コイン(距離5)をロック中
  const coinPos = { x: 25, y: 20 };
  map.setItem(coinPos, 'COIN');
  bot.setLockedItem(coinPos, 'COIN');

  // すぐ隣（マンハッタン距離1）にパワーストーンが出現
  const stonePos = { x: 21, y: 20 };
  map.setItem(stonePos, 'POWER_STONE');

  // 次のステップで、コインへのスティッキーが解除され、極近傍の上位アイテム（石）がロックされること
  bot.step(engine);
  assert.strictEqual(bot.lockedItemType, 'POWER_STONE', 'Should switch to nearby higher priority POWER_STONE');
  assert.deepStrictEqual(bot.lockedItemPos, stonePos, 'Locked position should be stonePos');

  console.log('✓ 3. Nearby higher-priority item interrupts lower priority sticky target verified.');
}

console.log('--- ✓ All AutoPlayBot Sticky Target & Loop Blacklist Tests PASSED! ---');
