import assert from 'assert';
import { GameEngine } from '../src/core/GameEngine.js';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { EnemyInstance } from '../src/models/Enemy.js';

console.log('--- AutoPlayBot Growth Stage Combat Control Verification ---');

// 1. EXPONENTIAL モード: STR未達かつ鍵所持中は、遠くの安全な敵を無視して宝箱開錠を最優先すること
console.log('Testing 1: Suppress enemy chase when holding KEY during early STR growth (EXPONENTIAL)...');
{
  const engine = new GameEngine({ headless: true });
  engine.startGame();
  const player = engine.getPlayer();
  const map = engine.getMap();
  const dragon = engine.getDragon();

  player.hasSword = true;
  player.strength = 1500; // 初期STR
  player.experience = 1000;
  player.holdItem = 'KEY';
  player.pos = { x: 10, y: 10 };

  // マップ上の残存アイテム・オブジェクトをクリア
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      map.setItem({ x, y }, 'NONE');
      map.setObject({ x, y }, 'NONE');
      map.setBaseTile({ x, y }, 'EMPTY');
    }
  }

  // ドラゴンを遠方に退避させて直進経路を確保
  dragon.body.pos = { x: 55, y: 55 };
  dragon.tail.pos = { x: 55, y: 56 };
  for (const head of dragon.heads) {
    head.pos = { x: 55, y: 55 };
  }

  // 敵リストをクリアし、距離5の場所に安全な敵（スケルトン: ATK=300, HP=1500, DEF=150）を1体配置
  engine.getEnemies().length = 0;
  const safeEnemy = new EnemyInstance({
    typeId: 1,
    name: 'skeleton',
    hp: 100,
    atk: 100,
    def: 0,
    exp: 100,
    speed: 1,
    canPassWall: false,
    aiCategory: 'CHASE',
    pos: { x: 15, y: 10 },
  });
  engine.getEnemies().push(safeEnemy);

  // プレイヤーのすぐ上（距離2）に宝箱を配置
  map.setObject({ x: 10, y: 8 }, 'CHEST');

  const bot = new AutoPlayBot();
  const action = bot.decideAction(engine);

  assert.strictEqual(bot.currentPhase, 'POWER_RUSH', 'Phase should be POWER_RUSH');
  // 敵（x=15, RIGHT方向）ではなく、宝箱（y=8, UP方向）へ進むべき
  assert.strictEqual(action.type, 'MOVE', 'Action should be MOVE towards CHEST');
  if (action.type === 'MOVE') {
    assert.strictEqual(action.dir, 'UP', 'Should move UP towards CHEST instead of chasing distant safe enemy at RIGHT');
  }

  console.log('✓ 1. Suppress enemy chase when holding KEY verified.');
}

// 2. EXPONENTIAL モード: 手ぶら時（STR未達）は距離3以上の敵を追尾せず、パワーストーン回収を優先すること
console.log('Testing 2: Hands-free early stage does not chase distant enemy (dist >= 3) and prioritizes POWER_STONE...');
{
  const engine = new GameEngine({ headless: true });
  engine.startGame();
  const player = engine.getPlayer();
  const map = engine.getMap();

  player.hasSword = true;
  player.strength = 1500;
  player.experience = 1000;
  player.holdItem = 'NONE';
  player.pos = { x: 10, y: 10 };

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      map.setItem({ x, y }, 'NONE');
      map.setObject({ x, y }, 'NONE');
      map.setBaseTile({ x, y }, 'EMPTY');
    }
  }

  // ドラゴンを遠方に退避させて直進経路を確保
  const dragon = engine.getDragon();
  dragon.body.pos = { x: 55, y: 55 };
  dragon.tail.pos = { x: 55, y: 56 };
  for (const head of dragon.heads) {
    head.pos = { x: 55, y: 55 };
  }

  // 距離4に安全な敵
  engine.getEnemies().length = 0;
  const safeEnemy = new EnemyInstance({
    typeId: 1,
    name: 'skeleton',
    hp: 100,
    atk: 100,
    def: 0,
    exp: 100,
    speed: 1,
    canPassWall: false,
    aiCategory: 'CHASE',
    pos: { x: 14, y: 10 },
  });
  engine.getEnemies().push(safeEnemy);

  // 距離3にパワーストーン
  map.setItem({ x: 10, y: 7 }, 'POWER_STONE');

  const bot = new AutoPlayBot();
  const action = bot.decideAction(engine);

  assert.strictEqual(action.type, 'MOVE', 'Action should be MOVE towards POWER_STONE');
  if (action.type === 'MOVE') {
    assert.strictEqual(action.dir, 'UP', 'Should move UP towards POWER_STONE instead of chasing enemy at dist=4');
  }

  console.log('✓ 2. Prioritizing POWER_STONE over distant enemy verified.');
}

// 3. EXPONENTIAL モード: 手ぶら時（STR未達）でも極近傍（距離2以内）の安全な敵は排除すること
console.log('Testing 3: Hands-free early stage eliminates adjacent/immediate safe enemy (dist <= 2)...');
{
  const engine = new GameEngine({ headless: true });
  engine.startGame();
  const player = engine.getPlayer();
  const map = engine.getMap();

  player.hasSword = true;
  player.strength = 1500;
  player.experience = 1000;
  player.holdItem = 'NONE';
  player.pos = { x: 10, y: 10 };

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      map.setItem({ x, y }, 'NONE');
      map.setObject({ x, y }, 'NONE');
      map.setBaseTile({ x, y }, 'EMPTY');
    }
  }

  // ドラゴンを遠方に退避させて直進経路を確保
  const dragon = engine.getDragon();
  dragon.body.pos = { x: 55, y: 55 };
  dragon.tail.pos = { x: 55, y: 56 };
  for (const head of dragon.heads) {
    head.pos = { x: 55, y: 55 };
  }

  // 距離2 (x=12, y=10) に安全な敵
  engine.getEnemies().length = 0;
  const safeEnemy = new EnemyInstance({
    typeId: 1,
    name: 'skeleton',
    hp: 100,
    atk: 100,
    def: 0,
    exp: 100,
    speed: 1,
    canPassWall: false,
    aiCategory: 'CHASE',
    pos: { x: 12, y: 10 },
  });
  engine.getEnemies().push(safeEnemy);

  const bot = new AutoPlayBot();
  const action = bot.decideAction(engine);

  assert.strictEqual(action.type, 'MOVE', 'Action should be MOVE towards nearby safe enemy');
  if (action.type === 'MOVE') {
    assert.strictEqual(action.dir, 'RIGHT', 'Should move RIGHT towards immediate enemy at dist=2');
  }

  console.log('✓ 3. Eliminating immediate safe enemy (dist <= 2) verified.');
}

// 4. 終盤（STR達成済み: strength >= targetStr）では、遠距離（dist=20）の敵を能動的に狩りに行くこと
console.log('Testing 4: Endgame (strength >= targetStr) actively hunts distant enemies (dist <= 45) for defense EXP...');
{
  const engine = new GameEngine({ headless: true });
  engine.startGame();
  const player = engine.getPlayer();
  const map = engine.getMap();

  player.hasSword = true;
  player.strength = 450000; // 目標STR (350,000) 達成済み
  player.experience = 10000; // targetDefenseExp (350,000) 未達
  player.holdItem = 'NONE';
  player.magic = 3;
  player.pos = { x: 10, y: 10 };

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      map.setItem({ x, y }, 'NONE');
      map.setObject({ x, y }, 'NONE');
      map.setBaseTile({ x, y }, 'EMPTY');
    }
  }

  // ドラゴンを遠方に退避させて直進経路を確保
  const dragon = engine.getDragon();
  dragon.body.pos = { x: 55, y: 55 };
  dragon.tail.pos = { x: 55, y: 56 };
  for (const head of dragon.heads) {
    head.pos = { x: 55, y: 55 };
  }

  // 距離20 (x=30, y=10) に安全な敵を配置
  engine.getEnemies().length = 0;
  const safeEnemy = new EnemyInstance({
    typeId: 1,
    name: 'skeleton',
    hp: 100,
    atk: 100,
    def: 0,
    exp: 100,
    speed: 1,
    canPassWall: false,
    aiCategory: 'CHASE',
    pos: { x: 30, y: 10 },
  });
  engine.getEnemies().push(safeEnemy);

  const bot = new AutoPlayBot();
  const action = bot.decideAction(engine);

  assert.strictEqual(action.type, 'MOVE', 'Action should be MOVE towards distant enemy for defense farming');
  if (action.type === 'MOVE') {
    assert.strictEqual(action.dir, 'RIGHT', 'Should move RIGHT towards distant enemy at dist=20 in endgame');
  }

  console.log('✓ 4. Endgame active hunting for defense EXP verified.');
}

// 5. CLASSIC モード: 最序盤（STR < 3000）では距離5の敵を追尾しないこと
console.log('Testing 5: CLASSIC mode early stage restricts hunt distance (STR < 3000 ignores dist=5)...');
{
  const engine = new GameEngine({ headless: true });
  engine.startGame({ ruleMode: 'CLASSIC' });
  const player = engine.getPlayer();
  const map = engine.getMap();

  player.hasSword = true;
  player.strength = 1500; // 最序盤 (STR < 3000)
  player.experience = 1000; // needDiagonal, needReturn
  player.holdItem = 'NONE';
  player.pos = { x: 10, y: 10 };

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      map.setItem({ x, y }, 'NONE');
      map.setObject({ x, y }, 'NONE');
      map.setBaseTile({ x, y }, 'EMPTY');
    }
  }

  // ドラゴンを遠方に退避させて直進経路を確保
  const dragon = engine.getDragon();
  dragon.body.pos = { x: 55, y: 55 };
  dragon.tail.pos = { x: 55, y: 56 };
  for (const head of dragon.heads) {
    head.pos = { x: 55, y: 55 };
  }

  // 距離5 (x=15, y=10) に安全な敵
  engine.getEnemies().length = 0;
  const safeEnemy = new EnemyInstance({
    typeId: 1,
    name: 'skeleton',
    hp: 100,
    atk: 100,
    def: 0,
    exp: 100,
    speed: 1,
    canPassWall: false,
    aiCategory: 'CHASE',
    pos: { x: 15, y: 10 },
  });
  engine.getEnemies().push(safeEnemy);

  // 距離4に鍵
  map.setItem({ x: 10, y: 6 }, 'KEY');

  const bot = new AutoPlayBot();
  const action = bot.decideAction(engine);

  // 距離5の敵は追わず、距離4のKEYへ向かうこと
  assert.strictEqual(action.type, 'MOVE', 'Action should be MOVE towards KEY');
  if (action.type === 'MOVE') {
    assert.strictEqual(action.dir, 'UP', 'Should move UP towards KEY instead of hunting distant enemy in CLASSIC early game');
  }

  console.log('✓ 5. CLASSIC mode early hunt restriction verified.');
}

console.log('--- ✓ All AutoPlayBot Combat Control Tests PASSED! ---');
