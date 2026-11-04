import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { ChestSystem } from '../src/systems/ChestSystem.js';

function runPhase2Tests() {
  console.log('--- Phase 2: Map Objects & Items Verification ---');

  // ==========================================
  // 1. 指輪（RING）とプッシュ移動システム
  // ==========================================
  console.log('Testing 1: Ring and push movement system...');
  const map = new WorldMap(30, 30);
  const player = new Player({ x: 5, y: 5, hp: 1000, experience: 1000 });

  // 1-1. 指輪なしでブロック（岩）を押そうとする -> 移動不可
  map.setTile({ x: 6, y: 5 }, 'BLOCK');
  map.setTile({ x: 7, y: 5 }, 'EMPTY');
  player.holdItem = 'NONE';
  const pushWithoutRing = MovementSystem.tryMove(player, 'RIGHT', map);
  console.assert(!pushWithoutRing, 'Should not push block without RING');
  console.assert(player.pos.x === 5, 'Player should not have moved');
  console.assert(map.getTile({ x: 6, y: 5 }) === 'BLOCK', 'Block should stay at (6, 5)');

  // 1-2. 指輪ありでブロックを押す -> ブロックが(7,5)へ、プレイヤーが(6,5)へ移動
  player.holdItem = 'RING';
  const pushWithRing = MovementSystem.tryMove(player, 'RIGHT', map);
  console.assert(pushWithRing, 'Should push block with RING');
  console.assert(player.pos.x === 6 && player.pos.y === 5, 'Player should advance to (6, 5)');
  console.assert(map.getTile({ x: 7, y: 5 }) === 'BLOCK', 'Block should be moved to (7, 5)');
  console.assert(map.getTile({ x: 6, y: 5 }) === 'EMPTY', 'Old block tile should become EMPTY (under player)');

  // 1-3. 押し出し先が外壁（WALL_STATIC）の場合 -> 押せない
  map.setTile({ x: 8, y: 5 }, 'WALL_STATIC');
  const pushIntoWall = MovementSystem.tryMove(player, 'RIGHT', map);
  console.assert(!pushIntoWall, 'Should not push block into WALL_STATIC');
  console.assert(player.pos.x === 6, 'Player should remain at (6, 5)');
  console.assert(map.getTile({ x: 7, y: 5 }) === 'BLOCK', 'Block should remain at (7, 5)');

  // 1-4. 墓（GRAVE）は固定障害物のためブロックを押し込めないことの検証（原作仕様）
  map.setTile({ x: 6, y: 6 }, 'GRAVE'); // (6,6) は墓
  // プレイヤーは (6,4) に位置し、(6,5) のブロックを墓 (6,6) に向かって押そうとする
  player.pos = { x: 6, y: 4 };
  map.setTile({ x: 6, y: 5 }, 'BLOCK'); // (6,5) にブロック

  const pushOntoGrave = MovementSystem.tryMove(player, 'DOWN', map);
  console.assert(!pushOntoGrave, 'Pushing block onto GRAVE must be strictly forbidden (original spec)');
  console.assert(player.pos.x === 6 && player.pos.y === 4, 'Player should not move when pushing against GRAVE');
  console.assert(map.getTile({ x: 6, y: 5 }) === 'BLOCK', 'Block should remain at (6, 5)');
  console.assert(map.getTile({ x: 6, y: 6 }) === 'GRAVE', 'Grave should remain intact at (6, 6)');

  // 1-5. 我が家（HOME）のプッシュ移動と本物の我が家（realHomePos）追跡
  map.setTile({ x: 10, y: 10 }, 'HOME');
  map.setTile({ x: 11, y: 10 }, 'EMPTY');
  map.setRealHomePos({ x: 10, y: 10 });
  player.pos = { x: 9, y: 10 };
  player.holdItem = 'RING';

  const pushHome = MovementSystem.tryMove(player, 'RIGHT', map);
  console.assert(pushHome, 'Should push HOME with RING');
  console.assert(player.pos.x === 10 && player.pos.y === 10, 'Player should step onto old home position');
  console.assert(map.getTile({ x: 11, y: 10 }) === 'HOME', 'HOME should move to (11, 10)');
  console.assert(map.homePos.x === 11 && map.homePos.y === 10, 'map.homePos should update to new position');

  // 1-6. 指輪なしで我が家に入る -> 押されずに家に入って全快
  player.holdItem = 'NONE';
  player.hp = 100;
  player.gold = 5;
  const enterHome = MovementSystem.tryMove(player, 'RIGHT', map);
  console.assert(enterHome, 'Should enter HOME without RING');
  console.assert(player.pos.x === 11 && player.pos.y === 10, 'Player should be inside HOME');
  console.assert(player.hp === player.experience + 50, 'Player HP should be healed to EXP + gold bonus');
  console.assert(player.gold === 0, 'Gold consumed on home heal');

  console.log('✓ 1. Ring and push movement tests passed.');

  // ==========================================
  // 2. 宝箱（CHEST）と8歩周期ロジック
  // ==========================================
  console.log('Testing 2: Chest and 8-step cycle logic...');
  const chestPos = { x: 15, y: 15 };
  map.setTile(chestPos, 'CHEST');
  player.pos = { x: 14, y: 15 };

  // 2-1. 鍵（KEY）なしで宝箱に乗る -> 乗れるがSPACEキーで開かない
  player.holdItem = 'NONE';
  const stepOntoChestWithoutKey = MovementSystem.tryMove(player, 'RIGHT', map);
  console.assert(stepOntoChestWithoutKey, 'Should step onto chest tile (floor object)');
  console.assert(player.pos.x === 15, 'Player stands on chest tile');
  const openWithoutKey = MovementSystem.executeSpaceAction(player, map);
  console.assert(openWithoutKey.action === 'WAIT', 'Should not open chest without KEY');
  console.assert(map.getObject(chestPos) === 'CHEST', 'Chest should remain closed');

  // 2-2. 鍵所持で宝箱の上でSPACEキー -> 開封成功、鍵は手元に残り中身が床上に出現
  player.holdItem = 'KEY';
  ChestSystem.forcedNextItem = 'COIN';
  const openWithKey = MovementSystem.executeSpaceAction(player, map);
  console.assert(openWithKey.action === 'OPEN_CHEST', 'Should open chest with KEY via SPACE action');
  console.assert(player.holdItem === 'KEY', 'Key must NOT be consumed');
  console.assert(map.getObject(chestPos) === 'NONE', 'Chest object removed');
  console.assert(map.getItem(chestPos) === 'COIN', 'Chest becomes COIN on floor');
  // 道具所持中は足元のコインを拾えずブロックされる（手ぶら厳格化）
  const blockedCoin = MovementSystem.executeSpaceAction(player, map);
  console.assert(blockedCoin.action === 'WAIT', 'Should block coin pickup while holding item');
  console.assert(player.gold === 0, 'Gold must remain 0 while blocked');
  // 空床へ移動してKEYを置き、手ぶらになってから回収
  player.pos = { x: 14, y: 15 };
  map.setItem({ x: 14, y: 15 }, 'NONE');
  MovementSystem.executeSpaceAction(player, map); // DROP KEY
  console.assert(player.holdItem === 'NONE', 'Player dropped key');
  player.pos = chestPos; // コインマスへ
  MovementSystem.executeSpaceAction(player, map); // PICKUP COIN
  console.assert(player.gold === 1, 'Coin from chest collected when hands-free');

  // 2-3. 8歩周期パワーストーン確定出現ロジック
  // パワーストーン出現によりカウンターが 0 にリセット
  player.stepCountSinceStone = 0;
  // 7歩歩かせる
  for (let i = 0; i < 7; i++) {
    player.stepCountSinceStone++;
  }
  console.assert(player.stepCountSinceStone === 7, 'Step count should be 7');

  // 8歩目に宝箱を開けた場合、確率に関係なく100%パワーストーンを排出
  map.setTile({ x: 16, y: 15 }, 'CHEST');
  ChestSystem.forcedNextItem = null; // 乱数モード
  player.stepCountSinceStone = 8;
  const itemAtStep8 = ChestSystem.rollChestItem(player);
  console.assert(itemAtStep8 === 'POWER_STONE', 'At exactly 8 steps, chest MUST yield POWER_STONE');
  console.assert(player.stepCountSinceStone === 0, 'Counter should reset to 0 after POWER_STONE');

  // 2-4. 死神（DEATH）の宝箱出現とLevel 2.0仕様
  // 未憑依の場合: 宝箱を開けると死神に取り憑く
  player.hasDeath = false;
  player.holdItem = 'KEY';
  ChestSystem.forcedNextItem = 'DEATH';
  map.setTile({ x: 16, y: 15 }, 'CHEST');
  player.pos = { x: 15, y: 15 };
  MovementSystem.tryMove(player, 'RIGHT', map); // 宝箱に乗る
  MovementSystem.executeSpaceAction(player, map); // 宝箱開錠
  console.assert(player.hasDeath === true, 'Player should become possessed by DEATH');
  console.assert(map.getTile({ x: 16, y: 15 }) === 'EMPTY', 'Tile should be EMPTY when death possesses player');

  // 既に死神憑依中に死神が出現した場合: 死神はその場に残る（Level 2.0仕様）
  console.assert(player.hasDeath === true, 'Player already has death');
  ChestSystem.forcedNextItem = 'DEATH';
  map.setTile({ x: 17, y: 15 }, 'CHEST');
  MovementSystem.tryMove(player, 'RIGHT', map); // 宝箱に乗る
  MovementSystem.executeSpaceAction(player, map); // 開錠
  console.assert(map.getItem({ x: 17, y: 15 }) === 'DEATH', 'New death MUST remain on the field (Level 2.0)');
  console.assert(player.pos.x === 17, 'Player stands on tile with death');

  console.log('✓ 2. Chest and 8-step logic tests passed.');

  // ==========================================
  // 3. 携帯アイテムの保持・手ぶら厳格化（インベントリ）
  // ==========================================
  console.log('Testing 3: Hold item inventory and hands-free restrictions...');
  player.pos = { x: 20, y: 20 };
  player.holdItem = 'NONE';

  // 3-1. 何も持っていない状態で KEY のマスに乗り、SPACEキーで拾う
  map.setTile({ x: 21, y: 20 }, 'KEY');
  MovementSystem.tryMove(player, 'RIGHT', map);
  console.assert(player.pos.x === 21, 'Player stands on KEY tile');
  MovementSystem.executeSpaceAction(player, map);
  console.assert(player.holdItem === 'KEY', 'Player should pick up KEY');
  console.assert(map.getTile({ x: 21, y: 20 }) === 'EMPTY', 'Tile should become EMPTY');

  // 3-2. KEY を持った状態で RING のマスに乗る -> 道具所持中のため拾えずブロックされる
  map.setTile({ x: 22, y: 20 }, 'RING');
  MovementSystem.tryMove(player, 'RIGHT', map);
  console.assert(player.pos.x === 22, 'Player stands on RING tile');
  const blockedRing = MovementSystem.executeSpaceAction(player, map);
  console.assert(blockedRing.action === 'WAIT', 'Should block swap/pickup while holding item');
  console.assert(player.holdItem === 'KEY', 'Player still holds KEY');
  console.assert(map.getTile({ x: 22, y: 20 }) === 'RING', 'RING remains on the floor');

  // 3-3. 空マス(22, 19)でSPACEキーを押すと手持ちアイテムを足元に置く（ドロップ）
  player.pos = { x: 22, y: 19 };
  map.setTile({ x: 22, y: 19 }, 'EMPTY');
  MovementSystem.executeSpaceAction(player, map);
  console.assert(player.holdItem === 'NONE', 'Item dropped, player now hands-free');
  console.assert(map.getTile({ x: 22, y: 19 }) === 'KEY', 'KEY is placed on the floor');

  // 3-4. 手ぶらになったので RING のマスへ戻って拾う
  player.pos = { x: 22, y: 20 };
  MovementSystem.executeSpaceAction(player, map);
  console.assert(player.holdItem === 'RING', 'Player can now pick up RING');
  console.assert(map.getTile({ x: 22, y: 20 }) === 'EMPTY', 'Tile becomes EMPTY');

  console.log('✓ 3. Inventory and hands-free restrictions tests passed.');

  // ==========================================
  // 4. 十字架（CROSS）のLevel 2.0仕様
  // ==========================================
  console.log('Testing 4: CROSS Level 2.0 specifications...');
  // 4-1. 十字架所持時は被ダメージ完全無効（無敵）
  player.holdItem = 'CROSS';
  player.hp = 1000;
  player.takeDamage(500);
  console.assert(player.hp === 1000, 'CROSS bearer should take ZERO damage (invincible)');

  // 十字架を手放すとダメージを受ける
  player.holdItem = 'NONE';
  player.takeDamage(300);
  console.assert(player.hp === 700, 'Without CROSS, player should take normal damage');

  // 4-2. 地面に置かれた十字架は敵・おばけ進入不可結界
  map.setTile({ x: 25, y: 25 }, 'CROSS');
  console.assert(!map.isPassableByEnemy({ x: 25, y: 25 }), 'Enemies/ghosts cannot enter CROSS tile');

  // 4-3. 死神憑依中に十字架マスを通過すると死神が消滅する
  player.hasDeath = true;
  player.pos = { x: 24, y: 25 };
  MovementSystem.tryMove(player, 'RIGHT', map);
  console.assert(player.hasDeath === false, 'Death MUST vanish when passing over CROSS tile');

  console.log('✓ 4. CROSS Level 2.0 specification tests passed.');

  // ==========================================
  // 5. 我が家（HOME）へのアイテム持ち帰り
  // ==========================================
  console.log('Testing 5: Returning items to HOME...');
  map.setTile({ x: 5, y: 5 }, 'HOME');
  map.setRealHomePos({ x: 5, y: 5 });

  // 5-1. パワーストーンを家に持ち帰ると STRENGTH 恒久上昇
  player.pos = { x: 5, y: 4 };
  player.holdItem = 'POWER_STONE';
  const oldStr = player.strength;
  MovementSystem.tryMove(player, 'DOWN', map);
  console.assert(player.pos.x === 5 && player.pos.y === 5, 'Player entered HOME');
  console.assert(player.strength === oldStr + 1000, 'STRENGTH should increase by 1000');
  console.assert(player.holdItem === 'NONE', 'POWER_STONE consumed at HOME');

  // 5-2. コインを持ち帰ると HP が EXPERIENCE を超えて一時加算
  player.pos = { x: 5, y: 4 };
  player.gold = 3;
  player.experience = 2000;
  MovementSystem.tryMove(player, 'DOWN', map);
  console.assert(player.hp === 2000 + 30, 'HP healed to EXP + gold bonus (2030)');
  console.assert(player.gold === 0, 'Gold consumed at HOME');

  // 5-3. 我が家への帰還による死神の離脱
  player.pos = { x: 5, y: 4 };
  player.hasDeath = true;
  MovementSystem.tryMove(player, 'DOWN', map);
  console.assert(player.hasDeath === false, 'DEATH should leave the player when returning HOME');

  console.log('--- ✓ All Phase 2 Logic & System Tests Passed Successfully! ---');
}

runPhase2Tests();
