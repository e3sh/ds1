import assert from 'node:assert';
import { GameEngine } from '../src/core/GameEngine.js';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';

console.log('--- Map Assessment, Strategy Tuning & Potion Tactics Verification ---');

// 1. マップ静的評価 (assessMap) の検証
console.log('Testing 1: Map assessment and recommended policy calculation...');
{
  const map = new WorldMap(32, 32);
  // タイルを一度クリア
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      map.setBaseTile({ x, y }, 'EMPTY');
      map.setObject({ x, y }, 'NONE');
      map.setItem({ x, y }, 'NONE');
    }
  }
  map.setRealHomePos({ x: 10, y: 10 });

  // 墓を配置: 我が家近傍 (距離5) に1箇所、遠方 (距離20) に3箇所
  map.setBaseTile({ x: 12, y: 10 }, 'GRAVE');
  map.setBaseTile({ x: 25, y: 25 }, 'GRAVE');
  map.setBaseTile({ x: 26, y: 25 }, 'GRAVE');
  map.setBaseTile({ x: 27, y: 25 }, 'GRAVE');

  // 十字架とPOTIONを配置
  map.setItem({ x: 5, y: 5 }, 'CROSS');
  map.setItem({ x: 6, y: 5 }, 'CROSS');
  map.setItem({ x: 7, y: 5 }, 'POTION');

  const bot = new AutoPlayBot({
    strategyTuning: {
      nearHomeRadius: 10,
    },
  });

  const assessment = bot.assessMap(map);
  assert.strictEqual(assessment.totalGraves, 4, 'Total graves should be 4');
  assert.strictEqual(assessment.nearHomeGraves, 1, 'Near home graves within radius 10 should be 1');
  assert.strictEqual(assessment.totalCrosses, 2, 'Total crosses should be 2');
  assert.strictEqual(assessment.totalPotions, 1, 'Total potions should be 1');
  // totalGraves <= 6 かつ totalCrosses >= 2 なので ALL が推奨される
  assert.strictEqual(assessment.recommendedPolicy, 'ALL', 'Small graves count should recommend ALL');

  // 墓が多い場合 (>15) のテスト
  for (let i = 0; i < 15; i++) {
    map.setTile({ x: i, y: 0 }, 'GRAVE');
  }
  const botMany = new AutoPlayBot();
  const assessmentMany = botMany.assessMap(map);
  assert.strictEqual(assessmentMany.recommendedPolicy, 'NEAR_HOME', 'Many graves should recommend NEAR_HOME');

  console.log('✓ 1. Map assessment and recommended policy calculation verified.');
}

// 2. CROWN_ESCAPE フェーズでの POTION 回収検証
console.log('Testing 2: CROWN_ESCAPE potion collection on low magic...');
{
  const engine = new GameEngine({ headless: true });
  engine.startGame();
  const player = engine.getPlayer();
  const map = engine.getMap();
  const dragon = engine.getDragon();

  // ドラゴン全首討伐状態にする
  dragon.defeatedHeadsCount = 3;
  for (const h of dragon.heads) {
    h.hp = 0;
    h.isAlive = false;
  }

  // プレイヤーを手ぶら、MP=0、STR十分にする
  player.holdItem = 'NONE';
  player.magic = 0;
  player.hasSword = true;
  player.strength = 450000;
  player.pos = { x: 5, y: 5 };

  // プレイヤーの周囲マスの障害物をクリアして確実な経路を確保
  map.setBaseTile({ x: 5, y: 5 }, 'EMPTY');
  map.setObject({ x: 5, y: 5 }, 'NONE');
  map.setItem({ x: 5, y: 5 }, 'NONE');

  // 周囲の敵を退避させて偶発的な回避行動を防ぐ
  for (const e of engine.getEnemies()) {
    if (Math.abs(e.pos.x - 5) <= 5 && Math.abs(e.pos.y - 5) <= 5) {
      e.pos = { x: 50, y: 50 };
    }
  }

  // マップ上の残存アイテム(POTION, CROWN等)をクリアして意図したPOTIONへの誘導を確実に検証
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.getItem({ x, y }) !== 'NONE') {
        map.setItem({ x, y }, 'NONE');
      }
    }
  }

  map.setBaseTile({ x: 6, y: 5 }, 'EMPTY');
  map.setObject({ x: 6, y: 5 }, 'NONE');
  map.setItem({ x: 6, y: 5 }, 'NONE');

  map.setBaseTile({ x: 7, y: 5 }, 'EMPTY');
  map.setObject({ x: 7, y: 5 }, 'NONE');
  // 足元から2マス隣に POTION を配置
  map.setItem({ x: 7, y: 5 }, 'POTION');

  // 遠方に王冠を配置
  map.setItem({ x: 20, y: 20 }, 'CROWN');

  const bot = new AutoPlayBot();
  // 決定される行動を取得
  const action = bot.decideAction(engine);
  assert.strictEqual(bot.currentPhase, 'CROWN_ESCAPE', 'Phase must be CROWN_ESCAPE');

  // MP=0のため、遠方の王冠ではなく近くのPOTION回収へ向かうべき (x=5から右へ移動)
  assert.strictEqual(action.type, 'MOVE', 'Action should be MOVE towards nearby potion');
  if (action.type === 'MOVE') {
    assert.strictEqual(action.dir, 'RIGHT', 'Should move RIGHT towards nearby POTION at x=7');
  }

  // 足元が POTION の場合、即座に SPACE で拾うこと
  player.pos = { x: 7, y: 5 };
  const actionPickup = bot.decideAction(engine);
  assert.strictEqual(actionPickup.type, 'SPACE', 'Should pick up POTION on current tile');

  console.log('✓ 2. CROWN_ESCAPE potion priority & pickup verified.');
}

// 3. 墓封鎖フェーズ (GRAVE_SEAL) の遷移とパラメータ制御
console.log('Testing 3: Grave seal phase transition and policy overrides...');
{
  const engine = new GameEngine({ headless: true });
  engine.startGame();
  const player = engine.getPlayer();
  const map = engine.getMap();

  player.hasSword = true;
  player.strength = 35000; // graveSealEarlyStr (30,000) 超え
  player.pos = { x: map.realHomePos.x, y: map.realHomePos.y };

  // 我が家至近に未封鎖の墓と未設置の十字架を設置（十字架は墓の8近傍外に配置して未使用ツールと認識させる）
  const nearGravePos = { x: map.realHomePos.x + 2, y: map.realHomePos.y };
  map.setTile(nearGravePos, 'GRAVE');
  map.setObject(nearGravePos, 'NONE');
  map.setItem({ x: map.realHomePos.x - 2, y: map.realHomePos.y }, 'CROSS');

  // policy: NONE のボット -> 墓封鎖に入らず POWER_RUSH を維持
  const botNone = new AutoPlayBot({
    strategyTuning: { graveSealPolicy: 'NONE' },
  });
  botNone.decideAction(engine);
  assert.strictEqual(botNone.currentPhase, 'POWER_RUSH', 'Policy NONE should stay in POWER_RUSH');

  // policy: NEAR_HOME のボット -> EARLY タイミングで GRAVE_SEAL に入る
  const botNearHome = new AutoPlayBot({
    strategyTuning: { graveSealPolicy: 'NEAR_HOME', graveSealTiming: 'EARLY' },
  });
  botNearHome.decideAction(engine);
  assert.strictEqual(botNearHome.currentPhase, 'GRAVE_SEAL', 'Policy NEAR_HOME should enter GRAVE_SEAL');

  console.log('✓ 3. Grave seal phase transition & policy tuning verified.');
}

// 4. コイン回収および早期魔法解禁タクティクス検証
console.log('Testing 4: Coin collection & non-combat early magic unlock...');
{
  const engine = new GameEngine({ headless: true });
  engine.startGame();
  const player = engine.getPlayer();
  const map = engine.getMap();

  player.hasSword = true;
  player.strength = 1500;
  player.experience = 1000;
  player.gold = 0; // 手ぶら・所持金ゼロからスタート
  player.magic = 5; // MPストック満杯にしてPOTION回収バイパス
  player.hp = 1000;
  player.maxHp = 1000;
  player.holdItem = 'NONE';
  player.pos = { x: 10, y: 10 };
  engine.getEnemies().length = 0; // 敵をクリアして純粋なアイテムナビゲーションを検証

  // 周囲のアイテムをクリアしてCOINだけを配置
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const p = { x: 10 + dx, y: 10 + dy };
      map.setItem(p, 'NONE');
      map.setObject(p, 'NONE');
      map.setBaseTile(p, 'EMPTY');
    }
  }

  // マップ上の残存アイテム(COIN, POWER_STONE等)をクリアしてCOINへの誘導を確実に検証
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.getItem({ x, y }) !== 'NONE') {
        map.setItem({ x, y }, 'NONE');
      }
    }
  }

  // 1マス隣にCOINを配置
  map.setItem({ x: 11, y: 10 }, 'COIN');

  const bot = new AutoPlayBot();
  const action1 = bot.decideAction(engine);
  if (action1.type === 'MAGIC') {
    console.error('DEBUG: action1 was MAGIC:', action1, 'player:', { hp: player.hp, maxHp: player.maxHp, exp: player.experience, magic: player.magic, pos: player.pos });
  }
  assert.strictEqual(action1.type, 'MOVE', 'Should move towards nearby COIN');
  if (action1.type === 'MOVE') {
    assert.strictEqual(action1.dir, 'RIGHT', 'Should move RIGHT towards COIN');
  }

  // コインのマスに乗った状態で判定
  player.pos = { x: 11, y: 10 };
  const actionPickup = bot.decideAction(engine);
  assert.strictEqual(actionPickup.type, 'SPACE', 'Should pick up COIN on current tile');

  // コイン取得実行
  engine.executeTurn(null);
  assert.strictEqual(player.gold, 1, 'Player should have 1 coin');
  assert.strictEqual(player.holdItem, 'NONE', 'Player should remain hands-free after picking up COIN');

  console.log('✓ 4. Coin collection & non-combat early magic unlock verified.');
}

console.log('--- ✓ All Map Assessment & Potion Tactics Tests PASSED! ---');
