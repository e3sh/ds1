import assert from 'assert';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { GameEngine } from '../src/core/GameEngine.js';

console.log('--- AutoPlayBot Ping-Pong Detection & Telemetry Status Verification ---');

// 1. ピンポン検知と安全離脱エスケープの検証
{
  console.log('Testing 1: 2-tile ping-pong detection triggers escape and target blacklisting...');
  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  const engine = new GameEngine({ headless: true });
  engine.startGame();
  const player = engine.getPlayer();

  const map = engine.getMap();

  player.hasSword = true;
  player.holdItem = 'KEY';
  player.strength = 5000;
  player.experience = 5000;

  // POWER_RUSH フェーズに設定
  bot.setPhase('POWER_RUSH');

  // ターゲット宝箱を配置してロック
  map.setObject({ x: 10, y: 15 }, 'CHEST');
  bot.setLockedChest({ x: 10, y: 15 });

  // 1手目: (10, 10)
  player.pos = { x: 10, y: 10 };
  bot.step(engine);

  // 2手目: (10, 11)
  player.pos = { x: 10, y: 11 };
  bot.step(engine);

  // 3手目: (10, 10) へ引き返し（A -> B -> A: 1回目のピンポン検知）
  player.pos = { x: 10, y: 10 };
  bot.step(engine);
  assert.strictEqual(bot.pingPongCount, 1, 'First ping-pong return should increment pingPongCount to 1');
  assert.strictEqual(bot.forceWanderTurns, 0, 'Should not trigger escape on 1st return');

  // 4手目: (10, 11) へ引き返し（B -> A -> B: 2回目のピンポン検知 -> 即座にエスケープ発動！）
  player.pos = { x: 10, y: 11 };
  bot.step(engine);
  assert.strictEqual(bot.forceWanderTurns, 3, 'Second ping-pong return should trigger 3-turn escape wander');
  assert.strictEqual(bot.lockedChestPos, null, 'Locked chest should be cleared upon ping-pong escape');
  assert.ok(bot.isTargetUnreachable({ x: 10, y: 15 }), 'Escaped target should be marked unreachable in blacklist');

  // 5手目: エスケープ徘徊ターン進行 (3T -> 2T)
  bot.step(engine);
  assert.strictEqual(bot.forceWanderTurns, 2, 'Next turn should decrement escape wander turns');

  console.log('✓ 1. Ping-pong escape & target blacklisting verified.');
}

// 2. アイテム持ち替え中のピンポン誤検知防止検証
{
  console.log('Testing 2: Item swap sequence is immune to false ping-pong detection...');
  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  const engine = new GameEngine({ headless: true });
  engine.startGame();
  const player = engine.getPlayer();

  player.hasSword = true;
  player.holdItem = 'KEY';

  // アイテム持ち替え中フラグを立てる
  bot.tempDroppedKeyPos = { x: 15, y: 15 };

  // 2マスを往復してもピンポン誤判定されない
  player.pos = { x: 15, y: 15 };
  bot.step(engine);
  player.pos = { x: 15, y: 16 };
  bot.step(engine);
  player.pos = { x: 15, y: 15 };
  bot.step(engine);
  player.pos = { x: 15, y: 16 };
  bot.step(engine);
  player.pos = { x: 15, y: 15 };
  bot.step(engine);

  assert.strictEqual(bot.pingPongCount, 0, 'Ping-pong count must remain 0 during item swap');
  assert.strictEqual(bot.forceWanderTurns, 0, 'forceWanderTurns must not be triggered during item swap');
  console.log('✓ 2. Item swap immunity verified.');
}

// 3. 自走検証テレメトリ文字列の検証
{
  console.log('Testing 3: Telemetry status string format and contents...');
  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  const engine = new GameEngine({ headless: true });
  engine.startGame();
  const player = engine.getPlayer();
  const map = engine.getMap();

  player.pos = { x: 20, y: 20 };
  player.hp = 100;
  player.maxHp = 100;
  player.strength = 15000;
  player.experience = 5000;
  player.magic = 2;
  player.holdItem = 'KEY';

  bot.step(engine);

  const status = bot.getTelemetryStatus(player, map, 42);
  assert.ok(status.includes('T:42'), 'Status must include turn counter');
  assert.ok(status.includes(bot.currentPhase), 'Status must include phase');
  assert.ok(status.includes('🎯'), 'Status must include target indicator');
  assert.ok(status.includes('🤖'), 'Status must include action indicator');
  assert.strictEqual(status.includes('HP:'), false, 'Status must NOT include HP');
  assert.strictEqual(status.includes('STR:'), false, 'Status must NOT include STR');
  assert.strictEqual(status.includes('EXP:'), false, 'Status must NOT include EXP');
  assert.strictEqual(status.includes('MP:'), false, 'Status must NOT include MP');
  assert.ok(status.includes('[KEY]'), 'Status must include held item');

  console.log(`Telemetry output sample:\n  ${status}`);
  console.log('✓ 3. Telemetry status string format verified.');
}

console.log('--- ✓ All AutoPlayBot Ping-Pong & Telemetry Tests PASSED! ---');
