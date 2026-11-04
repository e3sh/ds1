import assert from 'assert';
import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { Dragon } from '../src/models/Dragon.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { SpawnSystem } from '../src/systems/SpawnSystem.js';
import { MagicSystem } from '../src/systems/MagicSystem.js';
import { EnemyInstance } from '../src/models/Enemy.js';

console.log('--- Home Relocation, Dual-Home Respawn & Main Home / Spawn Separation Tests ---');

// Test 1: 指輪による家の移動とメインホーム追従
console.log('Testing 1: Ring push moves HOME and updates realHomePos...');
{
  const map = new WorldMap();
  const player = new Player({ x: 7, y: 8, hp: 5000, experience: 5000, strength: 1000 });
  player.holdItem = 'RING';

  assert.strictEqual(map.getBaseTile({ x: 7, y: 7 }), 'HOME');
  assert.strictEqual(map.homePos.x, 7);
  assert.strictEqual(map.homePos.y, 7);
  assert.strictEqual(map.initialHomePos.x, 7);
  assert.strictEqual(map.initialHomePos.y, 7);

  // 上方向へ家を押す ((7, 7) -> (7, 6))
  // (7, 6) は初期マップで BLOCK (8, 6) や POWER_STONE (8, 6) などの近く
  // テストのため (7, 6) の障害物/アイテムをクリア
  map.setObject({ x: 7, y: 6 }, 'NONE');
  map.setItem({ x: 7, y: 6 }, 'NONE');

  const moved = MovementSystem.tryMove(player, 'UP', map);
  assert.strictEqual(moved, true, '家を上へ押せること');
  assert.strictEqual(map.getBaseTile({ x: 7, y: 6 }), 'HOME', '移動先がHOMEになること');
  assert.strictEqual(map.getBaseTile({ x: 7, y: 7 }), 'EMPTY', '移動元の家は下地に戻ること');
  assert.strictEqual(map.homePos.x, 7);
  assert.strictEqual(map.homePos.y, 6, 'realHomePosが(7, 6)に更新されること');
  assert.strictEqual(map.initialHomePos.x, 7);
  assert.strictEqual(map.initialHomePos.y, 7, 'initialHomePosは(7, 7)のままであること');
}

// Test 2: ドラゴン首1本討伐時の家復活と2軒化（移動先の家は維持）
console.log('Testing 2: Dragon head 1 defeat keeps relocated home and respawns initial home (Dual-Home)...');
{
  const map = new WorldMap();
  const player = new Player({ x: 7, y: 8, hp: 5000, experience: 5000, strength: 1000 });
  const dragon = new Dragon({ x: 32, y: 32 });

  // 家を (10, 10) へ移転
  map.moveTile({ x: 7, y: 7 }, { x: 10, y: 10 });
  map.setRealHomePos({ x: 10, y: 10 });
  assert.strictEqual(map.getBaseTile({ x: 10, y: 10 }), 'HOME');
  assert.strictEqual(map.getBaseTile({ x: 7, y: 7 }), 'EMPTY');

  // 首を1本倒す
  dragon.damageHead(dragon.heads[0], 999999);
  assert.strictEqual(dragon.defeatedHeadsCount, 1);
  const changes = dragon.applyWorldChanges(map);

  assert.strictEqual(changes.resetHome, true);
  // 移動先の家が維持されていること
  assert.strictEqual(map.getBaseTile({ x: 10, y: 10 }), 'HOME', '移動先の別宅が維持されていること');
  // 初期位置に家が出現していること
  assert.strictEqual(map.getBaseTile({ x: 7, y: 7 }), 'HOME', '初期位置に家が復活配置されること');
  // マップ上に2軒の家が存在すること
  let homeCount = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.getBaseTile({ x, y }) === 'HOME') {
        homeCount++;
      }
    }
  }
  assert.strictEqual(homeCount, 2, 'マップ上に合計2軒の家が存在すること');

  // プレイヤーの拠点（homePos）は移動先のまま維持
  assert.strictEqual(map.homePos.x, 10);
  assert.strictEqual(map.homePos.y, 10);
  // 敵の湧き場（spawnHomePos）は初期位置 (7, 7) に設定
  assert.strictEqual(map.spawnHomePos.x, 7);
  assert.strictEqual(map.spawnHomePos.y, 7);
}

// Test 3: 敵が初期位置の家（spawnHomePos）から湧き出し、別宅からは湧かないこと
console.log('Testing 3: Enemies spawn exclusively from spawnHomePos (initial home), not from relocated home...');
{
  const map = new WorldMap();
  const player = new Player({ x: 10, y: 11, hp: 5000, experience: 5000, strength: 1000 });
  const dragon = new Dragon({ x: 32, y: 32 });

  // 家を (10, 10) へ移転し、首討伐で初期位置 (7, 7) を復活
  map.moveTile({ x: 7, y: 7 }, { x: 10, y: 10 });
  map.setRealHomePos({ x: 10, y: 10 });
  dragon.damageHead(dragon.heads[0], 999999);
  dragon.applyWorldChanges(map);

  // 周囲の通行障害をクリア
  for (const p of [
    { x: 8, y: 7 }, { x: 6, y: 7 }, { x: 7, y: 8 }, { x: 7, y: 6 }
  ]) {
    map.setTile(p, 'EMPTY');
    map.setObject(p, 'NONE');
    map.setItem(p, 'NONE');
  }

  const enemies: EnemyInstance[] = [];
  const spawned = SpawnSystem.spawnFromHome(enemies, player, map, dragon);
  assert.strictEqual(spawned !== null, true, '敵がスポーンすること');

  // スポーンした敵が初期位置 (7, 7) に隣接しており、別宅 (10, 10) には隣接していないこと
  const distToInitial = Math.abs(spawned!.pos.x - 7) + Math.abs(spawned!.pos.y - 7);
  const distToRelocated = Math.abs(spawned!.pos.x - 10) + Math.abs(spawned!.pos.y - 10);

  assert.strictEqual(distToInitial, 1, '敵は初期位置の家(7, 7)に隣接してスポーンすること');
  assert.strictEqual(distToRelocated > 1, true, '別宅(10, 10)の周囲からはスポーンしないこと');
}

// Test 4: 家に入った時の realHomePos 更新と RETURN 魔法の着地先
console.log('Testing 4: Entering a HOME updates realHomePos, and RETURN teleports to the last entered home...');
{
  const map = new WorldMap();
  const player = new Player({ x: 10, y: 9, hp: 3000, experience: 5000, strength: 1000 });
  player.magic = 5;
  const dragon = new Dragon({ x: 32, y: 32 });

  // 2軒配置: 初期位置 (7, 7) と 別宅 (10, 10)
  map.moveTile({ x: 7, y: 7 }, { x: 10, y: 10 });
  map.setRealHomePos({ x: 10, y: 10 });
  dragon.damageHead(dragon.heads[0], 999999);
  dragon.applyWorldChanges(map);

  // プレイヤーは指輪を持たずに (10, 9) から DOWN して別宅 (10, 10) に入る
  player.holdItem = 'NONE';
  const enter1 = MovementSystem.tryMove(player, 'DOWN', map);
  assert.strictEqual(enter1, true);
  assert.strictEqual(player.pos.x, 10);
  assert.strictEqual(player.pos.y, 10);
  assert.strictEqual(map.realHomePos.x, 10, '別宅に入ったのでrealHomePosが(10, 10)になる');
  assert.strictEqual(map.realHomePos.y, 10);

  // プレイヤーが遠く (20, 20) に移動し、RETURN を唱える
  player.pos = { x: 20, y: 20 };
  const ret1 = MagicSystem.cast(player, 'RETURN', map);
  assert.strictEqual(ret1.success, true);
  assert.strictEqual(player.pos.x, 10, '最後に利用した別宅(10, 10)へRETURNできる');
  assert.strictEqual(player.pos.y, 10);

  // 次にプレイヤーが初期位置の家 (7, 7) の隣 (7, 6) へ行き、DOWN して初期位置の家に入る
  player.pos = { x: 7, y: 6 };
  const enter2 = MovementSystem.tryMove(player, 'DOWN', map);
  assert.strictEqual(enter2, true);
  assert.strictEqual(player.pos.x, 7);
  assert.strictEqual(player.pos.y, 7);
  assert.strictEqual(map.realHomePos.x, 7, '初期位置の家に入ったのでrealHomePosが(7, 7)に更新される');
  assert.strictEqual(map.realHomePos.y, 7);

  // 再び遠く (30, 30) から RETURN を唱える
  player.pos = { x: 30, y: 30 };
  player.magic = 3;
  const ret2 = MagicSystem.cast(player, 'RETURN', map);
  assert.strictEqual(ret2.success, true);
  assert.strictEqual(player.pos.x, 7, '最後に入った初期位置の家(7, 7)へRETURNできる');
  assert.strictEqual(player.pos.y, 7);
}

// Test 5: セーブ／ロード時の spawnHomePos 永続化
console.log('Testing 5: spawnHomePos is preserved across map serialization and deserialization...');
{
  const map1 = new WorldMap();
  map1.moveTile({ x: 7, y: 7 }, { x: 12, y: 12 });
  map1.setRealHomePos({ x: 12, y: 12 });
  map1.respawnInitialHome();

  assert.strictEqual(map1.homePos.x, 12);
  assert.strictEqual(map1.spawnHomePos.x, 7);

  const saved = map1.serialize();
  const map2 = new WorldMap();
  map2.deserialize(saved);

  assert.strictEqual(map2.homePos.x, 12, 'homePosが復元されること');
  assert.strictEqual(map2.homePos.y, 12);
  assert.strictEqual(map2.spawnHomePos.x, 7, 'spawnHomePosが復元されること');
  assert.strictEqual(map2.spawnHomePos.y, 7);
}

console.log('--- ✓ All Home Relocation & Dual-Home Respawn Tests Passed Successfully! ---');
