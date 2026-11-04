import assert from 'node:assert';
import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { EnemyAISystem } from '../src/systems/EnemyAISystem.js';
import { Dragon } from '../src/models/Dragon.js';
import { ChestSystem } from '../src/systems/ChestSystem.js';
import { SpawnSystem } from '../src/systems/SpawnSystem.js';
import { CombatSystem } from '../src/systems/CombatSystem.js';

console.log('--- Authentic DS1 (Level 2.0) Core Mechanics Verification ---');

// ========================================================
// 1. レイヤー構造: アイテムの上に乗る（自動拾得されない）
// ========================================================
console.log('Testing 1: Standing on items without auto-pickup (Layering)...');
{
  const map = new WorldMap(30, 30);
  const player = new Player({ x: 5, y: 5 });

  // 床にパワーストーンを配置
  map.setItem({ x: 6, y: 5 }, 'POWER_STONE');
  assert.strictEqual(map.getItem({ x: 6, y: 5 }), 'POWER_STONE');

  // パワーストーンのマスへ歩いて乗る
  MovementSystem.tryMove(player, 'RIGHT', map);
  assert.strictEqual(player.pos.x, 6);
  assert.strictEqual(player.pos.y, 5);

  // 重要: 乗っただけでは拾わない（手ぶらのまま）
  assert.strictEqual(player.holdItem, 'NONE', '歩いて乗っただけではアイテムを拾わないこと');
  assert.strictEqual(map.getItem({ x: 6, y: 5 }), 'POWER_STONE', '足元にパワーストーンが残っていること');

  // SPACEキーを押すと初めて足元のアイテムを拾う
  const pickRes = MovementSystem.executeSpaceAction(player, map);
  assert.strictEqual(pickRes.action, 'PICKUP');
  assert.strictEqual(player.holdItem, 'POWER_STONE', 'SPACEキーで足元のアイテムを拾うこと');
  assert.strictEqual(map.getItem({ x: 6, y: 5 }), 'NONE', '拾った後は床から無くなること');

  console.log('✓ 1. Standing on items & manual pickup tests passed.');
}

// ========================================================
// 2. SPACEキーによるアイテムの「置く（ドロップ）」と「交換」
// ========================================================
console.log('Testing 2: Dropping and hands-free restrictions via SPACE action...');
{
  const map = new WorldMap(30, 30);
  const player = new Player({ x: 10, y: 10 });
  player.holdItem = 'KEY';

  // 2-A. 何もない床でSPACEキーを押すと、手持ちアイテムを足元に置く
  assert.strictEqual(map.getItem({ x: 10, y: 10 }), 'NONE');
  const dropRes = MovementSystem.executeSpaceAction(player, map);
  assert.strictEqual(dropRes.action, 'DROP');
  assert.strictEqual(player.holdItem, 'NONE', '手持ちがNONEになること');
  assert.strictEqual(map.getItem({ x: 10, y: 10 }), 'KEY', '足元の床にKEYが置かれること');

  // 2-B. 床にRINGがあるマスへ移動して、SPACEキーでRINGを拾う
  map.setItem({ x: 11, y: 10 }, 'RING');
  MovementSystem.tryMove(player, 'RIGHT', map);
  assert.strictEqual(player.pos.x, 11);
  MovementSystem.executeSpaceAction(player, map);
  assert.strictEqual(player.holdItem, 'RING');

  // 2-C. RINGを持った状態でさっき置いたKEYのマス(10, 10)に戻り、SPACEキーを押すと道具所持中のためブロックされる
  MovementSystem.tryMove(player, 'LEFT', map);
  assert.strictEqual(player.pos.x, 10);
  assert.strictEqual(map.getItem({ x: 10, y: 10 }), 'KEY');
  const blockedRes = MovementSystem.executeSpaceAction(player, map);
  assert.strictEqual(blockedRes.action, 'WAIT', '道具所持中は拾えずブロックされること');
  assert.strictEqual(player.holdItem, 'RING', '手持ちはRINGのまま');
  assert.strictEqual(map.getItem({ x: 10, y: 10 }), 'KEY', '足元はKEYのまま');

  // 2-D. 空マス(10, 9)へ移動してRINGを置き、手ぶらになってからKEYを回収
  MovementSystem.tryMove(player, 'UP', map);
  const dropRing = MovementSystem.executeSpaceAction(player, map);
  assert.strictEqual(dropRing.action, 'DROP');
  assert.strictEqual(player.holdItem, 'NONE');
  MovementSystem.tryMove(player, 'DOWN', map); // (10, 10)
  const pickKey = MovementSystem.executeSpaceAction(player, map);
  assert.strictEqual(pickKey.action, 'PICKUP');
  assert.strictEqual(player.holdItem, 'KEY');

  console.log('✓ 2. Dropping and hands-free restrictions via SPACE action tests passed.');
}

// ========================================================
// 3. 宝箱解錠: 宝箱の上に乗って鍵を持ってSPACEキーで解錠
// ========================================================
console.log('Testing 3: Chest unlocking yields item on floor without losing KEY...');
{
  const map = new WorldMap(30, 30);
  const player = new Player({ x: 15, y: 15 });
  player.holdItem = 'KEY';

  // 宝箱を配置 (床オブジェクト)
  map.setObject({ x: 16, y: 15 }, 'CHEST');
  ChestSystem.forcedNextItem = 'POWER_STONE';

  // 宝箱のマスへ歩いて乗る（床オブジェクトなので乗れる）
  const steppedOntoChest = MovementSystem.tryMove(player, 'RIGHT', map);
  assert.strictEqual(steppedOntoChest, true);
  assert.strictEqual(player.pos.x, 16);
  assert.strictEqual(map.getObject({ x: 16, y: 15 }), 'CHEST', '乗っただけでは宝箱は開かないこと');

  // 鍵を持った状態でSPACEキーを押して解錠！
  const unlockRes = MovementSystem.executeSpaceAction(player, map);
  assert.strictEqual(unlockRes.action, 'OPEN_CHEST');
  assert.strictEqual(player.holdItem, 'KEY', '鍵は消費されず手元に残ること');
  assert.strictEqual(map.getObject({ x: 16, y: 15 }), 'NONE', '宝箱オブジェクトは消去されること');
  assert.strictEqual(map.getItem({ x: 16, y: 15 }), 'POWER_STONE', '中身が足元の床上に出現すること');

  // 手にKEYを持っているため、この場ではPOWER_STONEを拾えずブロックされる
  const blockedStone = MovementSystem.executeSpaceAction(player, map);
  assert.strictEqual(blockedStone.action, 'WAIT', '道具所持中は足元のアイテムを拾えずブロックされること');
  assert.strictEqual(player.holdItem, 'KEY');

  // 空マス(16, 14)へ移動してKEYを置き、手ぶらになってからPOWER_STONEを拾う
  MovementSystem.tryMove(player, 'UP', map);
  MovementSystem.executeSpaceAction(player, map); // DROP KEY
  assert.strictEqual(player.holdItem, 'NONE');
  MovementSystem.tryMove(player, 'DOWN', map); // (16, 15)へ戻る
  const pickStone = MovementSystem.executeSpaceAction(player, map);
  assert.strictEqual(pickStone.action, 'PICKUP');
  assert.strictEqual(player.holdItem, 'POWER_STONE', 'POWER_STONEが手持ちになること');

  console.log('✓ 3. Chest unlocking behavior tests passed.');
}

// ========================================================
// 4. 敵の移動頻度 (下位敵は2ターンに1回、首討伐で加速)
// ========================================================
console.log('Testing 4: Enemy movement frequency (2-turn interval & Dragon rage)...');
{
  const map = new WorldMap(30, 30);
  // テスト用エリアの障害物をクリア
  for (let x = 18; x <= 25; x++) {
    map.setObject({ x, y: 25 }, 'NONE');
    map.setBaseTile({ x, y: 25 }, 'EMPTY');
  }

  const player = new Player({ x: 18, y: 25, hp: 500, experience: 2000 }); // 負傷中 -> 追跡
  const skeleton = new EnemyInstance({ typeId: 1, pos: { x: 22, y: 25 } }); // ID 1 (下位敵: 2ターンに1回)

  assert.strictEqual(skeleton.moveInterval, 2, 'ID 1 の移動インターバルは 2 であること');

  // ターン 1: moveCounter = 1 -> 動かない
  EnemyAISystem.updateEnemies([skeleton], player, map);
  assert.strictEqual(skeleton.pos.x, 22, '1ターン目は待機');

  // ターン 2: moveCounter = 2 -> 1歩追跡移動 (22 -> 21)
  EnemyAISystem.updateEnemies([skeleton], player, map);
  assert.strictEqual(skeleton.pos.x, 21, '2ターン目に1歩移動すること');

  // ドラゴンの首を1本討伐した場合 -> 全敵が毎ターン移動に加速！
  const dragon = new Dragon();
  dragon.defeatedHeadsCount = 1;

  // 次のターン: 毎ターン移動モードなので moveCounter の偶奇に関係なく動く (21 -> 20)
  EnemyAISystem.updateEnemies([skeleton], player, map, dragon);
  assert.strictEqual(skeleton.pos.x, 20, '首討伐後は毎ターン加速して移動すること');

  console.log('✓ 4. Enemy movement frequency & rage acceleration tests passed.');
}

// ========================================================
// 5. 体当たり戦闘: 生存中は押し合い進入不可、撃破時のみ進入
// ========================================================
console.log('Testing 5: Bump combat pushback and kill advancement...');
{
  const map = new WorldMap(30, 30);
  const player = new Player({ x: 5, y: 5, hp: 5000, strength: 100, experience: 1000 });
  player.hasSword = true;

  // HPの高い敵 (HP: 2000, DEF: 0)
  const tankEnemy = new EnemyInstance({ typeId: 2, pos: { x: 6, y: 5 }, hp: 2000, def: 0 });

  // 攻撃 1: 敵は生き残る
  MovementSystem.tryMove(player, 'RIGHT', map, [tankEnemy]);
  assert.strictEqual(player.pos.x, 5, '敵が生き残っている間は進入せずその場に留まること');
  assert.strictEqual(tankEnemy.isAlive, true);
  assert.strictEqual(tankEnemy.pos.x, 6);

  // 敵のHPを1にする
  tankEnemy.hp = 1;

  // 攻撃 2: 撃破！
  MovementSystem.tryMove(player, 'RIGHT', map, [tankEnemy]);
  assert.strictEqual(tankEnemy.isAlive, false, '敵が撃破されること');
  assert.strictEqual(player.pos.x, 5, '原作仕様: 敵を撃破した際もそのマスへ前進せずその場に留まること');

  // 墓の上の敵を倒した場合の検証（墓の上に乗らないこと）
  const gravePos = { x: 7, y: 5 };
  map.setBaseTile(gravePos, 'GRAVE');
  const enemyOnGrave = new EnemyInstance({ typeId: 1, pos: { ...gravePos }, hp: 1, def: 0 });
  player.pos = { x: 6, y: 5 };
  MovementSystem.tryMove(player, 'RIGHT', map, [enemyOnGrave]);
  assert.strictEqual(enemyOnGrave.isAlive, false, '墓の上の敵が撃破されること');
  assert.strictEqual(player.pos.x, 6, '墓の上の敵を倒しても墓の上に乗らずその場に留まること');

  console.log('✓ 5. Bump combat mechanics tests passed.');
}

// ========================================================
// 6. 我が家 (HOME): 入れるが指輪があると移動できる特殊オブジェクト
// ========================================================
console.log('Testing 6: HOME enterable without RING, movable with RING...');
{
  const map = new WorldMap(30, 30);
  const homePos = { x: 10, y: 10 };
  map.setBaseTile(homePos, 'HOME');
  map.setRealHomePos(homePos);

  const player = new Player({ x: 9, y: 10, hp: 100, experience: 2000 });

  // 6-1. 指輪なし: 家の中に入って全快回復
  player.holdItem = 'NONE';
  const enterHome = MovementSystem.tryMove(player, 'RIGHT', map);
  assert.strictEqual(enterHome, true, '指輪なしで我が家に入れること');
  assert.strictEqual(player.pos.x, 10, '家の中に入ったこと');
  assert.strictEqual(player.hp, 2000, '家でHP全快回復したこと');

  // 6-2. 指輪あり: 家に向かって移動すると家を押し出す（倉庫番）
  player.pos = { x: 9, y: 10 };
  player.holdItem = 'RING';
  map.setBaseTile({ x: 11, y: 10 }, 'EMPTY'); // 押し出し先

  const pushHome = MovementSystem.tryMove(player, 'RIGHT', map);
  assert.strictEqual(pushHome, true, '指輪所持で我が家を押して動かせること');
  assert.strictEqual(player.pos.x, 10, 'プレイヤーは元の家の位置へ前進すること');
  assert.strictEqual(map.getBaseTile({ x: 11, y: 10 }), 'HOME', '家が(11, 10)へ移動したこと');
  assert.strictEqual(map.homePos.x, 11, '本物の家の座標が更新されたこと');

  console.log('✓ 6. HOME enterable & pushable tests passed.');
}

// ========================================================
// 7. 敵スポーン適正化 & ステージ状態管理 (首討伐数Cap、1体補充、ランク進行)
// ========================================================
console.log('Testing 7: Spawn cap by dragon stage, 1-by-1 grave replenishment & kill rank progression...');
{
  const map = new WorldMap(30, 30);
  const player = new Player({ x: 5, y: 5, hp: 1000, experience: 0 });
  const dragon = new Dragon();

  // 7-1. 首討伐状態に応じた最大生存数Cap
  assert.strictEqual(SpawnSystem.getMaxActiveEnemies(dragon), 7, '首0本時は最大7体');
  dragon.defeatedHeadsCount = 1;
  assert.strictEqual(SpawnSystem.getMaxActiveEnemies(dragon), 9, '首1本時は最大9体');
  dragon.defeatedHeadsCount = 2;
  assert.strictEqual(SpawnSystem.getMaxActiveEnemies(dragon), 11, '首2本時は最大11体');
  dragon.defeatedHeadsCount = 3;
  assert.strictEqual(SpawnSystem.getMaxActiveEnemies(dragon), 13, '首3本時は最大13体');

  // 7-2. 1体ずつの補充湧き
  // マップ上の墓を一旦クリアしてテスト用墓2箇所のみにする
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.getBaseTile({ x, y }) === 'GRAVE') {
        map.setBaseTile({ x, y }, 'EMPTY');
      }
    }
  }
  map.setBaseTile({ x: 10, y: 10 }, 'GRAVE');
  map.setBaseTile({ x: 20, y: 20 }, 'GRAVE');

  const enemies: EnemyInstance[] = [];
  const spawned1 = SpawnSystem.spawnOneFromGraves(enemies, player, map);
  assert.ok(spawned1 !== null, '墓から1体スポーンすること');
  assert.strictEqual(enemies.length, 1, '敵リストに1体のみ追加されること');

  const spawned2 = SpawnSystem.spawnOneFromGraves(enemies, player, map);
  assert.ok(spawned2 !== null, 'もう1箇所の墓から1体スポーンすること');
  assert.strictEqual(enemies.length, 2, '合計2体になること');

  // 両方の墓が塞がれているか敵で埋まっている場合は湧かない
  const spawned3 = SpawnSystem.spawnOneFromGraves(enemies, player, map);
  assert.strictEqual(spawned3, null, '空いている墓がない場合は湧かないこと');

  // 7-3. モンスターランク進行 (totalKills と EXP による上位種出現)
  SpawnSystem.totalKills = 0;
  // 序盤: totalKills=0, exp=0 -> ID 1〜4
  const earlyType = (SpawnSystem as any).selectEnemyTypeToSpawn(player);
  assert.ok(earlyType >= 1 && earlyType <= 4, '序盤はID 1〜4 (スケルトン等) が出現');

  // 討伐数と経験値が進行: totalKills=20, exp=20000 -> rankByKills=11, minId=10, maxId=12
  SpawnSystem.totalKills = 20;
  player.experience = 20000;
  const advancedType = (SpawnSystem as any).selectEnemyTypeToSpawn(player);
  assert.ok(advancedType >= 9, '撃破数・EXP進行で上位モンスターが選定されること');

  console.log('✓ 7. Spawn cap, replenishment & rank progression tests passed.');
}

// ========================================================
console.log('Testing 8: Dragon head combat target position & Distance-based Enemy AI...');
{
  const map = new WorldMap(30, 30);
  const dragon = new Dragon({ x: 15, y: 15 });
  const player = new Player({ x: 14, y: 14, hp: 10000, experience: 10000 });
  player.hasSword = true;
  player.strength = 500000;

  // 8-1. 左首攻撃時の targetPos と dragonPart の整合性
  const leftHead = dragon.heads[0]; // LEFT_HEAD at (14, 15)
  const leftCombat = CombatSystem.resolvePlayerAttackDragon(player, dragon, leftHead, 'DOWN', map);
  assert.strictEqual(leftCombat.isDragonHead, true, '首攻撃フラグがtrueであること');
  assert.strictEqual(leftCombat.dragonPart?.type, 'LEFT_HEAD', '左首パーツが返ること');
  assert.deepStrictEqual(leftCombat.targetPos, { x: 14, y: 15 }, '左首の座標 (14, 15) が targetPos になること');

  // 8-2. 中央首攻撃時の targetPos と dragonPart の整合性
  const centerHead = dragon.heads[1]; // CENTER_HEAD at (15, 14)
  const centerCombat = CombatSystem.resolvePlayerAttackDragon(player, dragon, centerHead, 'RIGHT', map);
  assert.strictEqual(centerCombat.dragonPart?.type, 'CENTER_HEAD', '中央首パーツが返ること');
  assert.deepStrictEqual(centerCombat.targetPos, { x: 15, y: 14 }, '中央首の座標 (15, 14) が targetPos になること');

  // 8-3. 距離ベース敵AI (WANDER / CHASE / FLEE)
  for (let y = 1; y < 29; y++) {
    for (let x = 1; x < 29; x++) {
      map.setBaseTile({ x, y }, 'EMPTY');
      map.setObject({ x, y }, 'NONE');
    }
  }

  // 負傷していない状態 (HP >= EXP) を保証
  player.hp = player.experience;

  const enemyFar = new EnemyInstance({ typeId: 1, pos: { x: 26, y: 26 } }); // 遠距離 (マンハッタン距離 24)
  const enemyNear = new EnemyInstance({ typeId: 1, pos: { x: 16, y: 14 } }); // 近距離 (マンハッタン距離 2)

  // プレイヤー優位時 (hasSword & effectiveAtk > def):
  // 近距離は視界内逃走 (FLEE)
  enemyNear.moveCounter = 1;
  const initialNearDist = Math.abs(enemyNear.pos.x - player.pos.x) + Math.abs(enemyNear.pos.y - player.pos.y);
  EnemyAISystem.updateEnemies([enemyNear], player, map);
  const afterNearDist = Math.abs(enemyNear.pos.x - player.pos.x) + Math.abs(enemyNear.pos.y - player.pos.y);
  assert.ok(afterNearDist > initialNearDist, '視界内の敵は優位プレイヤーから逃走 (FLEE) すること');

  // 遠距離の敵はプレイヤーへ直線殺到せず、遠方にとどまる (WANDER)
  enemyFar.moveCounter = 1;
  EnemyAISystem.updateEnemies([enemyFar], player, map);
  const afterFarDist = Math.abs(enemyFar.pos.x - player.pos.x) + Math.abs(enemyFar.pos.y - player.pos.y);
  assert.ok(afterFarDist > 18, '遠距離の敵はプレイヤーに殺到せず徘徊 (WANDER) すること');

  console.log('✓ 8. Dragon head target pos & distance-based AI tests passed.');
}

console.log('--- ✓ All Authentic DS1 Core Mechanics Tests Passed Successfully! ---');
