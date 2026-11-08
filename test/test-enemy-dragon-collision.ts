import assert from 'node:assert';
import { WorldMap } from '../src/models/WorldMap.js';
import { Dragon } from '../src/models/Dragon.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { Player } from '../src/models/Player.js';
import { EnemyAISystem } from '../src/systems/EnemyAISystem.js';
import { SpawnSystem } from '../src/systems/SpawnSystem.js';

console.log('--- Enemy Dragon Collision & Freeze Prevention Verification ---');

// ============================================================================
// Test 1: isPassableByEnemy がドラゴンの頭・胴体・尻尾を進入不可と判定すること
// ============================================================================
console.log('Testing 1: isPassableByEnemy blocks all dragon parts...');
{
  const map = new WorldMap(64, 64);
  const dragon = new Dragon({ x: 32, y: 32 });

  assert.strictEqual(map.isPassableByEnemy({ x: 32, y: 31 }, dragon), false, 'CENTER_HEAD must be impassable');
  assert.strictEqual(map.isPassableByEnemy({ x: 31, y: 32 }, dragon), false, 'LEFT_HEAD must be impassable');
  assert.strictEqual(map.isPassableByEnemy({ x: 33, y: 32 }, dragon), false, 'RIGHT_HEAD must be impassable');
  assert.strictEqual(map.isPassableByEnemy({ x: 32, y: 32 }, dragon), false, 'BODY must be impassable');
  assert.strictEqual(map.isPassableByEnemy({ x: 32, y: 33 }, dragon), false, 'TAIL must be impassable');

  // ドラゴンがいない通常の空床は通行可能
  assert.strictEqual(map.isPassableByEnemy({ x: 30, y: 30 }, dragon), true, 'Empty floor without dragon must be passable');
  console.log('✓ 1. isPassableByEnemy blocks all dragon parts successfully.');
}

// ============================================================================
// Test 2: 敵AI（CHASEおよびWANDER）がドラゴンの頭に乗らないこと
// ============================================================================
console.log('Testing 2: EnemyAISystem prevents enemies from moving onto dragon parts...');
{
  const map = new WorldMap(64, 64);
  const dragon = new Dragon({ x: 32, y: 32 });
  const player = new Player({ x: 31, y: 30 }); // 左首 (31, 32) の北
  const enemy = new EnemyInstance({ typeId: 1, pos: { x: 31, y: 33 } }); // 左首の南
  const enemies = [enemy];

  // 敵がCHASEモードでプレイヤーを追跡する際、最短経路にある左首 (31, 32) を避けて迂回すること
  EnemyAISystem.stepEnemy(enemy, 'CHASE', player, map, enemies, 1.0, undefined, dragon);
  assert.notStrictEqual(
    `${enemy.pos.x},${enemy.pos.y}`,
    '31,32',
    'Enemy must NOT step onto LEFT_HEAD'
  );
  assert.strictEqual(dragon.getPartAt(enemy.pos), null, 'Enemy must not be on any dragon part');

  // WANDERモードでも首に乗らないこと
  for (let i = 0; i < 20; i++) {
    enemy.pos = { x: 31, y: 33 };
    EnemyAISystem.stepEnemy(enemy, 'WANDER', player, map, enemies, 1.0, undefined, dragon);
    assert.strictEqual(dragon.getPartAt(enemy.pos), null, `Wander step ${i}: Enemy must not enter dragon parts`);
  }

  console.log('✓ 2. EnemyAISystem strictly prevents enemies from moving onto dragon parts.');
}

// ============================================================================
// Test 3: フェイルセーフ（万一敵がドラゴン部位に重なった場合の自動退去）
// ============================================================================
console.log('Testing 3: Failsafe repulse evicts enemies from dragon parts...');
{
  const map = new WorldMap(64, 64);
  const dragon = new Dragon({ x: 32, y: 32 });
  const player = new Player({ x: 20, y: 20 });
  const enemy = new EnemyInstance({ typeId: 1, pos: { x: 32, y: 31 } }); // 強制的にCENTER_HEADに配置
  const enemies = [enemy];

  assert.notStrictEqual(dragon.getPartAt(enemy.pos), null, 'Enemy initially on dragon head');
  EnemyAISystem.stepEnemy(enemy, 'CHASE', player, map, enemies, 1.0, undefined, dragon);

  assert.strictEqual(
    dragon.getPartAt(enemy.pos),
    null,
    'Failsafe must immediately evict enemy from dragon head'
  );
  console.log('✓ 3. Failsafe repulse successfully evicts overlapping enemies.');
}

// ============================================================================
// Test 4: SpawnSystem がドラゴンの部位上に直接敵をスポーンさせないこと
// ============================================================================
console.log('Testing 4: SpawnSystem avoids spawning enemies on dragon parts...');
{
  const map = new WorldMap(64, 64);
  // 我が家をドラゴンの左首 (31, 32) のすぐ隣 (30, 32) に配置
  map.homePos = { x: 30, y: 32 };
  map.spawnHomePos = { x: 30, y: 32 };
  const dragon = new Dragon({ x: 32, y: 32 });
  const player = new Player({ x: 10, y: 10 });
  const enemies: EnemyInstance[] = [];

  // 我が家周辺スポーンの候補 { x: 31, y: 32 } (LEFT_HEAD) が選ばれないこと
  for (let i = 0; i < 10; i++) {
    const spawned = SpawnSystem.spawnFromHome(enemies, player, map, dragon);
    if (spawned) {
      assert.strictEqual(
        dragon.getPartAt(spawned.pos),
        null,
        'Spawned enemy must not spawn on dragon parts'
      );
    }
  }
  console.log('✓ 4. SpawnSystem avoids spawning enemies on dragon parts successfully.');
}

console.log('--- ✓ All Enemy Dragon Collision Tests Passed Successfully! ---');
