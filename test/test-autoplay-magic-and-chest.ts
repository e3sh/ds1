import assert from 'node:assert';
import { GameEngine } from '../src/core/GameEngine.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { Dragon } from '../src/models/Dragon.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { MagicSystem } from '../src/systems/MagicSystem.js';

console.log('--- AutoPlayBot Magic Operations & Early Chest Unlock Verification ---');

// ============================================================================
// Test 1: 目標STR到達後の事前宝箱開錠継続＆手ぶら時鍵回収（要件①）
// ============================================================================
console.log('Testing 1: Chest clearing & KEY holding continuation after reaching targetStr (Requirement 1)...');
{
  const map = new WorldMap(64, 64);
  const dragon = new Dragon({ x: 32, y: 32 });

  // 目標STR達成済み（STR = 450,000 >= 350,000）だが、MP=2（maxTargetMagic=5 未満）
  const player = new Player({ x: 20, y: 20, hp: 10000, experience: 20000, strength: 450000 });
  player.maxHp = 10000;
  player.hasSword = true;
  player.magic = 2; // 目標未満
  player.holdItem = 'KEY'; // 鍵を所持

  // 周囲の地形を整備（床POTIONが尽きている状況を再現、周囲の宝箱をクリア）
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      if (map.getItem({ x, y }) === 'POTION') {
        map.setItem({ x, y }, 'NONE');
      }
    }
  }
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      map.setObject({ x: 20 + dx, y: 20 + dy }, 'NONE');
    }
  }
  map.setBaseTile({ x: 20, y: 20 }, 'EMPTY');
  map.setItem({ x: 20, y: 20 }, 'NONE');

  // 距離2マスの右位置（22, 20）のみに未開封宝箱を配置
  map.setBaseTile({ x: 22, y: 20 }, 'EMPTY');
  map.setObject({ x: 22, y: 20 }, 'CHEST');
  map.setItem({ x: 22, y: 20 }, 'NONE');

  const bot = new AutoPlayBot({
    profile: 'STANDARD',
    strategyTuning: {
      maxTargetMagic: 5,
    },
  });

  const dummyEngine = {
    getPlayer: () => player,
    getMap: () => map,
    getEnemies: () => [],
    getDragon: () => dragon,
    getGhosts: () => [],
  } as unknown as GameEngine;

  // 1-A: 目標STR到達後でも、MP目標未達かつ宝箱ありなら即座に鍵を捨てず宝箱へ移動する
  const action1 = bot.decideAction(dummyEngine);
  assert.strictEqual(bot.currentPhase, 'POWER_RUSH');
  assert.notStrictEqual(action1.type, 'SPACE', '目標STR到達後も即座に鍵を捨ててはならない');
  assert.strictEqual(action1.type, 'MOVE', '宝箱へ向かって移動すること');
  assert.strictEqual(action1.dir, 'RIGHT');

  // 1-B: 手ぶら状態（holdItem === 'NONE'）でも、MP未達かつ近傍に未開封宝箱があれば近傍の鍵を回収する
  player.holdItem = 'NONE';
  map.setItem({ x: 20, y: 19 }, 'KEY'); // 1マス上に鍵を配置
  const action2 = bot.decideAction(dummyEngine);
  assert.strictEqual(action2.type, 'MOVE');
  assert.strictEqual(action2.dir, 'UP', '手ぶら時でも事前開錠継続のため鍵を拾いに向かうこと');

  // 1-C: MP満タン（magic = 5）かつ 防御EXP達成時（exp = 450,000）で周囲宝箱なしなら鍵を手放す
  map.setObject({ x: 22, y: 20 }, 'NONE'); // 宝箱消去
  map.setItem({ x: 20, y: 19 }, 'NONE');
  player.holdItem = 'KEY';
  player.magic = 5; // MP満タン
  player.experience = 450000; // 防御EXP達成
  player.pos = { x: 20, y: 20 };

  const action3 = bot.decideAction(dummyEngine);
  // 足元が空床なら SPACE で鍵を手放す
  assert.strictEqual(action3.type, 'SPACE', 'リソース確保完了後は鍵を手放して手ぶら化すること');

  console.log('✓ 1. Chest clearing & KEY holding continuation verified successfully.');
}

// ============================================================================
// Test 2: MP=1時のセーフティリザーブ保護（BREAK/KICK温存）（要件②）
// ============================================================================
console.log('Testing 2: Magic safety reserve at MP=1 (Requirement 2)...');
{
  const map = new WorldMap(64, 64);
  const dragon = new Dragon({ x: 32, y: 32 });

  // BREAK習得済み（EXP = 5000 >= 4000）、MP = 1（最後の1つ）
  const player = new Player({ x: 10, y: 10, hp: 5000, experience: 5000, strength: 10000 });
  player.maxHp = 5000;
  player.hasSword = true;
  player.magic = 1; // セーフティリザーブ保護対象！
  player.holdItem = 'NONE';

  const bot = new AutoPlayBot({
    profile: 'STANDARD',
  });

  // 2-A: canSpendMagicReserve の判定検証
  // MP > 1 なら使用許可
  player.magic = 2;
  assert.strictEqual(bot.canSpendMagicReserve(player, [], map), true);

  // MP = 1 かつ BREAK 習得済みなら通常時は温存（false）
  player.magic = 1;
  assert.strictEqual(bot.canSpendMagicReserve(player, [], map), false);

  // パワーストーン所持中であっても通常時はMP=1での自爆転落防止のため温存（false）
  player.holdItem = 'POWER_STONE';
  assert.strictEqual(bot.canSpendMagicReserve(player, [], map), false);
  player.holdItem = 'NONE';

  // 王冠脱出フェーズなら許可（true）
  bot.currentPhase = 'CROWN_ESCAPE';
  assert.strictEqual(bot.canSpendMagicReserve(player, [], map), true);
  bot.currentPhase = 'POWER_RUSH';

  // 2-B: ピンポン脱出時、MP=1 の場合は安易に FREEZE / FLASH を消費しない
  bot.oscillationCount = 3; // ピンポン状態
  const enemy = new EnemyInstance({ typeId: 3, pos: { x: 11, y: 10 }, hp: 200, atk: 50, def: 0 }); // 隣接に敵
  const dummyEngine = {
    getPlayer: () => player,
    getMap: () => map,
    getEnemies: () => [enemy],
    getDragon: () => dragon,
    getGhosts: () => [],
  } as unknown as GameEngine;

  const pingPongAction = bot.decideAction(dummyEngine);
  assert.notStrictEqual(pingPongAction.type, 'MAGIC', 'MP=1時はピンポン回避でFREEZE/FLASHを安易に消費しないこと');

  // 2-C: 絶体絶命局面の例外許可
  // 隣接に即死級敵（LETHAL）がいて、周囲が壁で逃げ場が一切ない場合
  const lethalEnemy = new EnemyInstance({ typeId: 20, pos: { x: 11, y: 10 }, hp: 99999, atk: 50000, def: 0 });
  // 上下左を静的壁で塞ぐ
  map.setBaseTile({ x: 10, y: 9 }, 'WALL_STATIC');
  map.setBaseTile({ x: 10, y: 11 }, 'WALL_STATIC');
  map.setBaseTile({ x: 9, y: 10 }, 'WALL_STATIC');
  map.setBaseTile({ x: 10, y: 10 }, 'EMPTY');

  const emergencyEngine = {
    getPlayer: () => player,
    getMap: () => map,
    getEnemies: () => [lethalEnemy],
    getDragon: () => dragon,
    getGhosts: () => [],
  } as unknown as GameEngine;

  const emergencyAction = bot.decideAction(emergencyEngine);
  assert.strictEqual(emergencyAction.type, 'MAGIC', '逃げ場のない絶体絶命LETHAL局面ではMP=1でも例外として魔法を使用すること');
  assert.ok(emergencyAction.magic === 'FREEZE' || emergencyAction.magic === 'FLASH' || emergencyAction.magic === 'RETURN');

  console.log('✓ 2. Magic safety reserve at MP=1 verified successfully.');
}

// ============================================================================
// Test 3: KICK魔法オペレーションの実装（要件③）
// ============================================================================
console.log('Testing 3: KICK magic operations and long-range snipe (Requirement 3)...');
{
  const map = new WorldMap(64, 64);
  const dragon = new Dragon({ x: 32, y: 32 });

  // KICK習得済み（EXP >= 5000, MP >= 1）
  const player = new Player({ x: 10, y: 10, hp: 5000, experience: 6000, strength: 5000 });
  player.maxHp = 5000;
  player.hasSword = true;
  player.magic = 3;
  player.holdItem = 'NONE';

  // プレイヤーの右隣（11, 10）に岩（BLOCK）を配置
  map.setBaseTile({ x: 10, y: 10 }, 'EMPTY');
  map.setBaseTile({ x: 11, y: 10 }, 'EMPTY');
  map.setObject({ x: 11, y: 10 }, 'BLOCK');

  // 直線上の 5マス先（15, 10）に強敵（DANGER）を配置
  const targetEnemy = new EnemyInstance({ typeId: 15, pos: { x: 15, y: 10 }, hp: 5000, atk: 3000, def: 500 });
  for (let x = 12; x < 15; x++) {
    map.setBaseTile({ x, y: 10 }, 'EMPTY');
    map.setObject({ x, y: 10 }, 'NONE');
    map.setItem({ x, y: 10 }, 'NONE');
  }

  const bot = new AutoPlayBot({
    profile: 'STANDARD',
  });

  const dummyEngine = {
    getPlayer: () => player,
    getMap: () => map,
    getEnemies: () => [targetEnemy],
    getDragon: () => dragon,
    getGhosts: () => [],
  } as unknown as GameEngine;

  // 3-A: 直線上の敵への KICK スナイプ発動
  const kickAction = bot.decideAction(dummyEngine);
  assert.strictEqual(kickAction.type, 'MAGIC', 'KICKが発動すること');
  assert.strictEqual(kickAction.magic, 'KICK');
  assert.strictEqual(player.dir, 'RIGHT', 'KICKの方向へプレイヤーが向くこと');

  // 実際に発動して敵が即死することを確認
  const castResult = MagicSystem.cast(player, 'KICK', map, [targetEnemy], [], dragon);
  assert.strictEqual(castResult.success, true);
  assert.strictEqual(targetEnemy.isAlive, false, 'KICK命中により強敵が即死すること');
  assert.strictEqual(castResult.kickCrushed, false);

  // 3-B: 途中に壁などの障害物がある場合はスナイプを発動しない
  targetEnemy.isAlive = true;
  player.pos = { x: 10, y: 10 };
  map.setObject({ x: 11, y: 10 }, 'BLOCK');
  map.setBaseTile({ x: 13, y: 10 }, 'WALL_STATIC'); // 途中に壁

  const blockedKick = bot.tryKickSnipe(player, map, [targetEnemy], dragon);
  assert.strictEqual(blockedKick, null, '途中に障害物がある場合は射線が通らないためKICKを発動しないこと');

  // 3-C: handleMoveOrBreak での岩排除
  map.setBaseTile({ x: 10, y: 9 }, 'EMPTY');
  map.setObject({ x: 10, y: 9 }, 'BLOCK'); // 上にブロック
  const breakOrKickAction = bot.handleMoveOrBreak('UP', player, map);
  assert.strictEqual(breakOrKickAction.type, 'MAGIC');
  assert.ok(breakOrKickAction.magic === 'BREAK' || breakOrKickAction.magic === 'KICK');

  console.log('✓ 3. KICK magic operations and long-range snipe verified successfully.');
}

// ============================================================================
// Test 4: 後半戦（DRAGON_SLAY）におけるMP枯渇フォールバック（要件④）
// ============================================================================
console.log('Testing 4: Endgame DRAGON_SLAY low MP fallback to nearby KEY & CHEST (Requirement 4)...');
{
  const map = new WorldMap(64, 64);
  const dragon = new Dragon({ x: 32, y: 32 });

  // DRAGON_SLAYフェーズ、MP = 0（枯渇）、床置きPOTIONなし
  const player = new Player({ x: 30, y: 30, hp: 20000, experience: 200000, strength: 500000 });
  player.maxHp = 20000;
  player.hasSword = true;
  player.magic = 0; // MP枯渇！
  player.holdItem = 'NONE';

  // マップ上の床置きPOTIONはなし、近傍（30, 28）に鍵、（30, 26）に宝箱が存在
  map.setBaseTile({ x: 30, y: 30 }, 'EMPTY');
  map.setObject({ x: 30, y: 30 }, 'NONE');
  map.setItem({ x: 30, y: 30 }, 'NONE');

  map.setBaseTile({ x: 30, y: 28 }, 'EMPTY');
  map.setObject({ x: 30, y: 28 }, 'NONE');
  map.setItem({ x: 30, y: 28 }, 'KEY'); // 鍵

  map.setBaseTile({ x: 30, y: 26 }, 'EMPTY');
  map.setObject({ x: 30, y: 26 }, 'CHEST'); // 宝箱
  map.setItem({ x: 30, y: 26 }, 'NONE');

  const bot = new AutoPlayBot({
    profile: 'STANDARD',
    strategyTuning: {
      graveSealPolicy: 'NONE',
    },
  });
  bot.currentPhase = 'DRAGON_SLAY';

  const dummyEngine = {
    getPlayer: () => player,
    getMap: () => map,
    getEnemies: () => [],
    getDragon: () => dragon,
    getGhosts: () => [],
  } as unknown as GameEngine;

  // 4-A: MP枯渇時に床POTIONがない場合、鍵回収へ向かうこと
  const action1 = bot.decideAction(dummyEngine);
  assert.strictEqual(action1.type, 'MOVE');
  assert.strictEqual(action1.dir, 'UP', '鍵の方向へ向かって移動すること');

  // 4-B: 鍵を持っている場合は宝箱開錠へ向かうこと
  player.holdItem = 'KEY';
  const action2 = bot.decideAction(dummyEngine);
  assert.strictEqual(action2.type, 'MOVE');
  assert.strictEqual(action2.dir, 'UP', '鍵所持時は宝箱へ向かって移動すること');

  console.log('✓ 4. Endgame DRAGON_SLAY low MP fallback verified successfully.');
}

console.log('--- ✓ All AutoPlayBot Magic & Chest Verification Tests PASSED! ---');
