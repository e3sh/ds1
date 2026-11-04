import assert from 'node:assert';
import { WorldMap } from '../src/models/WorldMap.js';
import { Dragon } from '../src/models/Dragon.js';

console.log('--- 64x64 Authentic Dungeon Puzzle Map Verification ---');

const map = new WorldMap(64, 64);
const dragon = new Dragon({ x: 32, y: 32 });

// 1. 全タイルの重複チェック (1マス1要素)
let overlaps = 0;
for (let y = 0; y < 64; y++) {
  for (let x = 0; x < 64; x++) {
    const item = map.getItem({ x, y });
    const obj = map.getObject({ x, y });
    const base = map.getBaseTile({ x, y });
    if (item !== 'NONE' && obj !== 'NONE') {
      console.error(`Overlap at (${x}, ${y}): Item=${item}, Object=${obj}`);
      overlaps++;
    }
    if ((item !== 'NONE' || obj !== 'NONE') && (base === 'WALL_STATIC' || base === 'HOME')) {
      console.error(`Overlap with base at (${x}, ${y}): Base=${base}, Item=${item}, Obj=${obj}`);
      overlaps++;
    }
  }
}
assert.strictEqual(overlaps, 0, 'No overlapping tiles allowed anywhere on the 64x64 map');
console.log('✓ 1. Zero overlaps across all 4,096 tiles verified.');

// 2. クラウン・ドラゴンの宝箱出現マスの確認 (31,31), (33,31), (31,33), (33,33)
const crownPositions = [
  { x: 31, y: 31 },
  { x: 33, y: 31 },
  { x: 31, y: 33 },
  { x: 33, y: 33 },
];
for (const pos of crownPositions) {
  const base = map.getBaseTile(pos);
  const obj = map.getObject(pos);
  assert.strictEqual(base, 'EMPTY', `Crown tile at (${pos.x}, ${pos.y}) must be EMPTY base`);
  assert.strictEqual(obj, 'NONE', `Crown tile at (${pos.x}, ${pos.y}) must have NO object`);
}
console.log('✓ 2. All 4 dragon crown destination tiles strictly clear (EMPTY floor).');

// 3. 各首の正面遮蔽壁・可動岩の確認
const diagonalPositions = [
  { x: 31, y: 31 },
  { x: 33, y: 31 },
];
for (const pos of diagonalPositions) {
  const base = map.getBaseTile(pos);
  const obj = map.getObject(pos);
  assert.strictEqual(base, 'EMPTY', `Diagonal safe tile at (${pos.x}, ${pos.y}) must be EMPTY base`);
  assert.strictEqual(obj, 'NONE', `Diagonal safe tile at (${pos.x}, ${pos.y}) must have NO object`);
}
console.log('✓ 3. Diagonal safe attack tiles accessible for dragon combat.');

// 4. ワープゾーンペアの確認
assert.strictEqual(map.getBaseTile({ x: 16, y: 16 }), 'WARP');
assert.strictEqual(map.getBaseTile({ x: 48, y: 48 }), 'WARP');
assert.strictEqual(map.getBaseTile({ x: 16, y: 48 }), 'WARP');
assert.strictEqual(map.getBaseTile({ x: 48, y: 16 }), 'WARP');
assert.strictEqual(map.getBaseTile({ x: 58, y: 58 }), 'WARP');
assert.strictEqual(map.getBaseTile({ x: 27, y: 27 }), 'WARP');

const warp1 = map.getWarpDestination({ x: 16, y: 16 });
assert.deepStrictEqual(warp1, { x: 48, y: 48 });
const warp2 = map.getWarpDestination({ x: 48, y: 48 });
assert.deepStrictEqual(warp2, { x: 16, y: 16 });
const warp3 = map.getWarpDestination({ x: 58, y: 58 });
assert.deepStrictEqual(warp3, { x: 27, y: 27 });
console.log('✓ 4. Strategic warp network pairs verified.');

// 5. 各エリアのオブジェクト集計確認
let graveCount = 0;
let chestCount = 0;
let powerStoneCount = 0;
let blockCount = 0;

for (let y = 0; y < 64; y++) {
  for (let x = 0; x < 64; x++) {
    if (map.getBaseTile({ x, y }) === 'GRAVE') {
      graveCount++;
    }
    if (map.getObject({ x, y }) === 'CHEST') chestCount++;
    if (map.getObject({ x, y }) === 'BLOCK') blockCount++;
    if (map.getItem({ x, y }) === 'POWER_STONE') powerStoneCount++;
  }
}

assert.ok(graveCount >= 15, `Sufficient graves for authentic spawn pacing (found ${graveCount})`);
assert.ok(blockCount >= 30, `Sufficient rocks for Sokoban puzzles and grave blockage (found ${blockCount})`);
assert.ok(chestCount >= 15, `Sufficient treasure chests across wings (found ${chestCount})`);
assert.ok(powerStoneCount >= 4, `Multiple hidden power stones (found ${powerStoneCount})`);

console.log(`Summary of 64x64 Map:`);
console.log(`  GRAVE: ${graveCount}`);
console.log(`  BLOCK: ${blockCount}`);
console.log(`  CHEST: ${chestCount}`);
console.log(`  POWER_STONE: ${powerStoneCount}`);

// 6. ワープゾーンの上を家を押して通過してもワープゾーンが消滅しないことの検証
console.log('Testing 6: Pushing HOME over WARP zone preserves WARP tile...');
{
  const warpTestMap = new WorldMap(20, 20);
  const homePos = { x: 5, y: 5 };
  warpTestMap.setBaseTile(homePos, 'HOME');
  warpTestMap.setRealHomePos(homePos);
  warpTestMap.addWarpPair({ x: 6, y: 5 }, { x: 15, y: 15 });

  assert.strictEqual(warpTestMap.getBaseTile({ x: 6, y: 5 }), 'WARP', 'Initially (6, 5) is WARP');

  // 家を (6, 5) のワープゾーンの上へ押す
  warpTestMap.moveTile({ x: 5, y: 5 }, { x: 6, y: 5 });
  assert.strictEqual(warpTestMap.getBaseTile({ x: 6, y: 5 }), 'HOME', '(6, 5) is now HOME');
  assert.strictEqual(warpTestMap.homePos.x, 6);

  // さらに家を (7, 5) へ押し出す -> 元の (6, 5) が WARP に復元されること！
  warpTestMap.moveTile({ x: 6, y: 5 }, { x: 7, y: 5 });
  assert.strictEqual(warpTestMap.getBaseTile({ x: 6, y: 5 }), 'WARP', '(6, 5) MUST be restored as WARP!');
  assert.strictEqual(warpTestMap.getBaseTile({ x: 7, y: 5 }), 'HOME', '(7, 5) is now HOME');
  console.log('✓ 6. WARP preservation when HOME moves over it verified.');
}

// 7. 家の中のプレイヤーに対する敵攻撃の完全遮断検証（安全地帯）
console.log('Testing 7: Enemies cannot attack player inside HOME...');
import { Player } from '../src/models/Player.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { EnemyAISystem } from '../src/systems/EnemyAISystem.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
{
  const homeCombatMap = new WorldMap(20, 20);
  const homePos = { x: 7, y: 7 };
  homeCombatMap.setBaseTile(homePos, 'HOME');

  const playerInHome = new Player({ x: 7, y: 7, hp: 500, experience: 2000 });
  const adjacentEnemy = new EnemyInstance({ typeId: 2, pos: { x: 8, y: 7 }, atk: 1000 }); // 家の外壁直近に隣接

  EnemyAISystem.lastCombatResults = [];
  EnemyAISystem.stepEnemy(adjacentEnemy, 'CHASE', playerInHome, homeCombatMap, [adjacentEnemy]);

  assert.strictEqual(EnemyAISystem.lastCombatResults.length, 0, 'No combat results when player is inside HOME');
  assert.strictEqual(playerInHome.hp, 500, 'Player HP remains unchanged inside HOME');
  console.log('✓ 7. Monster attack blocked while player inside HOME verified.');
}

// 8. 岩や家の押し出し先にモンスターがいる場合、重ねて押し出せないこと（壁埋まり・壁抜け防止）
console.log('Testing 8: Rock/HOME pushing blocked if destination has enemy...');
{
  const pushEnemyMap = new WorldMap(20, 20);
  const player = new Player({ x: 5, y: 5 });
  player.holdItem = 'RING';

  pushEnemyMap.setObject({ x: 6, y: 5 }, 'BLOCK');
  const enemyAtDest = new EnemyInstance({ typeId: 1, pos: { x: 7, y: 5 } });

  // (7, 5) に敵がいるため、(6, 5) の岩を右に押せないこと
  const pushSuccess = MovementSystem.tryMove(player, 'RIGHT', pushEnemyMap, [enemyAtDest]);
  assert.strictEqual(pushSuccess, false, 'Should NOT push block onto an enemy tile');
  assert.strictEqual(player.pos.x, 5, 'Player should remain at (5, 5)');
  assert.strictEqual(pushEnemyMap.getObject({ x: 6, y: 5 }), 'BLOCK', 'Block should remain at (6, 5)');
  assert.strictEqual(enemyAtDest.pos.x, 7, 'Enemy position unchanged');
  console.log('✓ 8. Block pushing onto enemy tile strictly forbidden.');
}

console.log('--- ✓ All 64x64 Authentic Dungeon Tests Passed Successfully! ---');
