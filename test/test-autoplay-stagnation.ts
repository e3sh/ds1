import assert from 'node:assert';
import { GameEngine } from '../src/core/GameEngine.js';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { EnemyInstance } from '../src/models/Enemy.js';

console.log('================================================================');
console.log('   AutoPlayBot Stagnation Breakthrough & Early Farm Trap Test   ');
console.log('================================================================');

// -----------------------------------------------------------------------------
// Test 1: Breakthrough Combat on Stagnation
// -----------------------------------------------------------------------------
console.log('Testing 1: Breakthrough Combat on stagnation with killable enemy...');
{
  const engine = new GameEngine();
  const player = engine.getPlayer();
  const map = engine.getMap();

  player.pos = { x: 5, y: 5 };
  player.hasSword = true;
  // STR=500: スケルトン(DEF 150, HP 1500)への与ダメ 350 -> 5発で撃破可能 (turnsToKill = 5 <= 8)
  // EXP=1000: スケルトン(ATK 300)からの被ダメ 0 (NO_DAMAGE)
  player.strength = 500;
  player.experience = 1000;
  player.hp = 1000;
  player.maxHp = 1000;

  // 隣接マス (5, 4) にスケルトンを配置
  const enemy = new EnemyInstance({ typeId: 1, pos: { x: 5, y: 4 } });
  (engine as any).enemies = [enemy];

  const bot = new AutoPlayBot();

  // ヒートマップを人為的に高熱化して停滞状態をシミュレート（15ターン同一マス停留）
  for (let i = 0; i < 15; i++) {
    (bot as any).nav.updateTurn(player.pos);
  }
  assert.strictEqual((bot as any).nav.isStagnated(player, map), true, 'Player should be detected as stagnated');

  // アクション決定
  const action = bot.step(engine);
  assert.strictEqual(action.type, 'MOVE', 'Action should be MOVE');
  assert.strictEqual((action as any).dir, 'UP', 'Direction should be UP towards the enemy at (5, 4)');
  assert.ok(
    bot.lastDecidedActionDesc.includes('攻撃突破') || bot.lastDecidedActionDesc.includes('UP'),
    `Action desc should mention breakthrough: ${bot.lastDecidedActionDesc}`
  );
  console.log('✓ 1. Breakthrough combat triggered and attacked blocking enemy successfully.');
}

// -----------------------------------------------------------------------------
// Test 2: Early Resource Farm Trap GiveUP
// -----------------------------------------------------------------------------
console.log('Testing 2: Early Resource Farm Trap detected and GiveUP triggered...');
{
  const engine = new GameEngine();
  const player = engine.getPlayer();
  const map = engine.getMap();

  player.pos = { x: 2, y: 2 };
  player.hasSword = true;
  player.strength = 10; // 最序盤初期攻撃力
  player.experience = 1000;
  player.hp = 1000;
  player.maxHp = 1000;

  // (2, 2) の周囲を静的外壁で完全に囲み、外の宝箱や資源に一切到達できない状態を作成
  const cardDeltas = [
    { x: 1, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 1 }, { x: 2, y: 3 },
    { x: 1, y: 1 }, { x: 3, y: 1 }, { x: 1, y: 3 }, { x: 3, y: 3 },
  ];
  for (const d of cardDeltas) {
    map.setBaseTile(d, 'WALL_STATIC');
  }

  // 遠くに宝箱を設置
  map.setObject({ x: 15, y: 15 }, 'CHEST');

  (engine as any).enemies = [];

  const bot = new AutoPlayBot();
  (bot as any).setPhase('RESOURCE_FARM');

  // 何ターンかその場で足踏みしてヒートマップを飽和させる
  let gaveUp = false;
  for (let turn = 0; turn < 25; turn++) {
    const action = bot.step(engine);
    if (action.type === 'GIVE_UP' || (bot as any).isGivenUp) {
      gaveUp = true;
      console.log(`✓ 2. Early Resource Farm Trap detected and GiveUP triggered at turn ${turn + 1}`);
      break;
    }
  }

  assert.strictEqual(gaveUp, true, 'Bot should have given up due to early resource farm trap');
}

// -----------------------------------------------------------------------------
// Test 3: 3-Tile Incarceration Loop Trap GiveUP (3か所往復・循環での封鎖詰み)
// -----------------------------------------------------------------------------
console.log('Testing 3: 3-Tile Incarceration Loop Trap GiveUP (3か所往復での封鎖詰み)...');
{
  const engine = new GameEngine();
  const player = engine.getPlayer();
  const map = engine.getMap();

  // 3マスの通路: (2, 2) <-> (2, 3) <-> (2, 4)
  // 上下左右の外周を壁で囲み、(2, 4) の出口 (3, 4) をノーダメージのスケルトンで塞ぐ
  player.pos = { x: 2, y: 2 };
  player.hasSword = true;
  player.strength = 10; // スケルトンへの与ダメ1 (倒せない)
  player.experience = 1000; // スケルトンからの被ダメ0 (ノーダメージ)
  player.hp = 1000;
  player.maxHp = 1000;

  // 通路まわりを壁で囲む
  map.setBaseTile({ x: 2, y: 1 }, 'WALL_STATIC'); // (2, 2) の上
  map.setBaseTile({ x: 1, y: 2 }, 'WALL_STATIC'); // (2, 2) の左
  map.setBaseTile({ x: 3, y: 2 }, 'WALL_STATIC'); // (2, 2) の右

  map.setBaseTile({ x: 1, y: 3 }, 'WALL_STATIC'); // (2, 3) の左
  map.setBaseTile({ x: 3, y: 3 }, 'WALL_STATIC'); // (2, 3) の右

  map.setBaseTile({ x: 1, y: 4 }, 'WALL_STATIC'); // (2, 4) の左
  map.setBaseTile({ x: 2, y: 5 }, 'WALL_STATIC'); // (2, 4) の下

  // 唯一の出口 (3, 4) にスケルトンを配置
  const blockingSkeleton = new EnemyInstance({ typeId: 1, pos: { x: 3, y: 4 } });
  (engine as any).enemies = [blockingSkeleton];

  // 遠くに宝箱を設置（プレイヤーは宝箱に行こうとして出口のスケルトンと対峙し、3マスを行き来する）
  map.setObject({ x: 10, y: 4 }, 'CHEST');

  const bot = new AutoPlayBot();
  (bot as any).setPhase('RESOURCE_FARM');

  let gaveUp = false;
  let giveUpTurn = 0;
  for (let turn = 0; turn < 40; turn++) {
    const action = bot.step(engine);
    if (action.type === 'GIVE_UP' || (bot as any).isGivenUp) {
      gaveUp = true;
      giveUpTurn = turn + 1;
      console.log(`✓ 3. 3-Tile Incarceration Loop Trap GiveUP triggered at turn ${giveUpTurn}`);
      break;
    }
  }

  assert.strictEqual(gaveUp, true, 'Bot should give up when trapped in 3-tile dead-end with no-damage enemy');
  assert.ok(giveUpTurn <= 30, `GiveUP should happen within 30 turns, but took ${giveUpTurn} turns`);
}

console.log('================================================================');
console.log('   ALL Stagnation Breakthrough & Early Farm Trap Tests PASSED!  ');
console.log('================================================================');
