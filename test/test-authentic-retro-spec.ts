import assert from 'node:assert';
import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { EnemyAISystem } from '../src/systems/EnemyAISystem.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { Ghost } from '../src/models/Ghost.js';
import { GhostAISystem } from '../src/systems/GhostAISystem.js';
import { SpawnSystem } from '../src/systems/SpawnSystem.js';
import { Dragon } from '../src/models/Dragon.js';
import { ProceduralMapGenerator } from '../src/systems/ProceduralMapGenerator.js';
import { MagicSystem } from '../src/systems/MagicSystem.js';
import { CombatSystem } from '../src/systems/CombatSystem.js';

console.log('--- Authentic Retro Specification Verification (Tasks 1-4) ---');

// ========================================================
// タスク1: 敵モンスターの8方向移動と4方向戦闘の分離（墓の封鎖を含む）
// ========================================================
console.log('Testing Task 1: 8-way enemy movement, 4-way combat restriction, dragon head diagonal exception, and natural grave blockage...');
{
  const map = new WorldMap(30, 30);
  // (22, 22) 周辺の空床エリアでテスト
  const player = new Player({ x: 20, y: 20, hp: 1000, experience: 2000 });
  const enemy = new EnemyInstance({ typeId: 1, pos: { x: 22, y: 22 } });

  // 1-1. 敵の斜め移動: (22, 22) からプレイヤー (20, 20) へ向かって斜め (21, 21) へ移動可能
  EnemyAISystem.stepEnemy(enemy, 'CHASE', player, map, [enemy]);
  assert.strictEqual(enemy.pos.x, 21, 'Enemy should move diagonally along X towards player');
  assert.strictEqual(enemy.pos.y, 21, 'Enemy should move diagonally along Y towards player');

  // 1-2. 斜めからの敵攻撃は発生しない:
  // 敵 (21, 21) からプレイヤー (20, 20) は斜め隣接。直接体当たり攻撃は発生せず、上下左右のみ攻撃可能
  const hpBefore = player.hp;
  EnemyAISystem.lastCombatResults = [];
  EnemyAISystem.stepEnemy(enemy, 'CHASE', player, map, [enemy]);
  assert.strictEqual(player.hp, hpBefore, 'Diagonal attack from enemy must NOT occur');

  // 1-3. プレイヤーから一般敵への斜め攻撃禁止:
  // プレイヤーが斜め移動可能（canDiagonal = true）であっても、一般敵への斜め攻撃はブロックされる
  player.canDiagonal = true;
  player.pos = { x: 20, y: 20 };
  const attackEnemy = new EnemyInstance({ typeId: 1, pos: { x: 21, y: 21 } });
  const tryDiagonalAttack = MovementSystem.tryMove(player, 'DOWN_RIGHT', map, [attackEnemy]);
  assert.strictEqual(tryDiagonalAttack, false, 'Player diagonal attack against normal enemy must be prohibited');
  assert.strictEqual(player.pos.x, 20, 'Player position should remain unchanged');

  // 1-4. ドラゴンの首への斜め攻撃特権:
  // ドラゴンの左首 (14, 15: 左向き) に対し、斜めマス (13, 14) から攻撃可能
  const dragon = new Dragon({ x: 15, y: 15 });
  player.pos = { x: 13, y: 14 }; // 左首 (14, 15) に対する斜めマス
  player.hasSword = true;
  player.strength = 1000000; // 首を一撃で倒せる攻撃力
  const headBeforeHp = dragon.heads[0].hp;
  const attackDragonDiagonal = MovementSystem.tryMove(player, 'DOWN_RIGHT', map, [], dragon);
  assert.strictEqual(attackDragonDiagonal, true, 'Diagonal attack against Dragon head MUST be allowed (authentic trick)');
  assert.strictEqual(dragon.heads[0].hp < headBeforeHp, true, 'Dragon head should receive damage from diagonal attack');

  // 1-5. 墓の周囲8方向封鎖による敵スタックと自然なスポーン阻止:
  // 1-5-A. 4方向（上下左右）だけ塞いだ場合は斜めから敵が這い出してくる（4方向塞ぎでは封鎖不可）
  const graveMap = new WorldMap(30, 30);
  for (let y = 0; y < 30; y++) {
    for (let x = 0; x < 30; x++) {
      if (graveMap.getBaseTile({ x, y }) === 'GRAVE') {
        graveMap.setBaseTile({ x, y }, 'EMPTY');
      }
    }
  }
  const test4WayPos = { x: 25, y: 25 };
  graveMap.setBaseTile(test4WayPos, 'GRAVE');
  graveMap.setObject({ x: 25, y: 24 }, 'BLOCK'); // UP
  graveMap.setObject({ x: 25, y: 26 }, 'BLOCK'); // DOWN
  graveMap.setObject({ x: 24, y: 25 }, 'BLOCK'); // LEFT
  graveMap.setObject({ x: 26, y: 25 }, 'BLOCK'); // RIGHT
  const enemy4Way = new EnemyInstance({ typeId: 1, pos: { ...test4WayPos } });
  player.pos = { x: 28, y: 28 };
  EnemyAISystem.stepEnemy(enemy4Way, 'CHASE', player, graveMap, [enemy4Way]);
  // 斜め4マスが空いているため、斜め(26, 26)へ抜け出してくること
  assert.strictEqual(enemy4Way.pos.x, 26, 'Enemy should escape via diagonal when only 4 ways are blocked');
  assert.strictEqual(enemy4Way.pos.y, 26, 'Enemy should escape via diagonal when only 4 ways are blocked');

  // 1-5-B. 周囲8方向すべてを塞いだ場合に初めて敵がスタックし、墓の上に居座る
  graveMap.setBaseTile(test4WayPos, 'EMPTY'); // 直前の墓をクリア
  const gravePos = { x: 20, y: 20 };
  graveMap.setBaseTile(gravePos, 'GRAVE');
  // 周囲8方向をすべて BLOCK で囲む
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      graveMap.setObject({ x: gravePos.x + dx, y: gravePos.y + dy }, 'BLOCK');
    }
  }

  // 墓の上にスポーンした敵
  const trappedEnemy = new EnemyInstance({ typeId: 1, pos: { ...gravePos } });
  const enemiesList = [trappedEnemy];
  // 敵のターン行動: 周囲8方向が全て塞がれているため墓から出られずスタック
  EnemyAISystem.stepEnemy(trappedEnemy, 'CHASE', player, graveMap, enemiesList);
  assert.strictEqual(trappedEnemy.pos.x, gravePos.x, 'Enemy should remain stuck on grave X');
  assert.strictEqual(trappedEnemy.pos.y, gravePos.y, 'Enemy should remain stuck on grave Y');

  // 墓の上に敵が居座っているため、追加スポーン試行しても自然に阻止される
  SpawnSystem.reset();
  const spawned = SpawnSystem.spawnOneFromGraves(enemiesList, player, graveMap);
  assert.strictEqual(spawned, null, 'Grave occupied by trapped enemy must naturally suppress new spawn');

  console.log('✓ Task 1 tests passed.');
}

// ========================================================
// タスク2: お化け（ゴースト）の8方向移動 & アイテム取得時の方向転換
// ========================================================
console.log('Testing Task 2: 8-way ghost movement and direction turn on item pickup...');
{
  const map = new WorldMap(30, 30);
  const player = new Player({ x: 25, y: 25, hp: 1000 });

  // 2-1. 上下左右を含む8方向移動の検証
  const horizontalGhost = new Ghost({ pos: { x: 10, y: 10 }, vx: 1, vy: 0 });
  GhostAISystem.stepGhost(horizontalGhost, player, map);
  assert.strictEqual(horizontalGhost.pos.x, 11, 'Ghost should support horizontal movement (vx=1, vy=0)');
  assert.strictEqual(horizontalGhost.pos.y, 10);

  const verticalGhost = new Ghost({ pos: { x: 10, y: 10 }, vx: 0, vy: -1 });
  GhostAISystem.stepGhost(verticalGhost, player, map);
  assert.strictEqual(verticalGhost.pos.x, 10);
  assert.strictEqual(verticalGhost.pos.y, 9, 'Ghost should support vertical movement (vx=0, vy=-1)');

  // 2-2. アイテム取得時の急転換:
  // 床に POTION を配置し、ゴーストがそれを吸い上げた瞬間に向きが変わる
  const itemPos = { x: 15, y: 15 };
  map.setItem(itemPos, 'POTION');
  const pickupGhost = new Ghost({ pos: { x: 14, y: 15 }, vx: 1, vy: 0 });
  const origVx = pickupGhost.vx;
  const origVy = pickupGhost.vy;

  GhostAISystem.stepGhost(pickupGhost, player, map);
  assert.strictEqual(pickupGhost.pos.x, 15);
  assert.strictEqual(pickupGhost.carriedItem, 'POTION', 'Ghost should pick up the floor item');
  assert.strictEqual(map.getItem(itemPos), 'NONE', 'Floor item should be cleared');
  // 向きが急転換されていること
  const changedDirection = pickupGhost.vx !== origVx || pickupGhost.vy !== origVy;
  assert.strictEqual(changedDirection, true, 'Ghost must abruptly change direction upon picking up an item');

  console.log('✓ Task 2 tests passed.');
}

// ========================================================
// タスク3: アイテム取得の厳格化（「手ぶら」時のみ取得可能）
// ========================================================
console.log('Testing Task 3: Hands-free pickup restriction and manual drop before pickup...');
{
  const map = new WorldMap(30, 30);
  const player = new Player({ x: 10, y: 10 });
  player.holdItem = 'KEY'; // 道具を所持中

  // 3-1. 道具所持中は床のアイテム（COIN, POTION, SWORD, POWER_STONE, CROWN等）を拾えない
  const itemTypes = ['COIN', 'POTION', 'SWORD', 'POWER_STONE', 'RING', 'CROWN'] as const;
  for (let i = 0; i < itemTypes.length; i++) {
    const item = itemTypes[i];
    const pos = { x: 11 + i, y: 10 };
    map.setItem(pos, item);

    player.pos = { ...pos };
    const res = MovementSystem.executeSpaceAction(player, map);
    assert.strictEqual(res.action, 'WAIT', `Holding item must block pickup of ${item}`);
    assert.strictEqual(map.getItem(pos), item, `${item} must remain on floor`);
    assert.strictEqual(player.holdItem, 'KEY', 'Player must still hold KEY');
  }

  // 3-2. 空床に手持ち道具を「置く（DROP）」操作をして手ぶら（NONE）になる
  player.pos = { x: 5, y: 5 };
  map.setItem({ x: 5, y: 5 }, 'NONE');
  const dropRes = MovementSystem.executeSpaceAction(player, map);
  assert.strictEqual(dropRes.action, 'DROP', 'Player should drop item on empty floor');
  assert.strictEqual(player.holdItem, 'NONE', 'Player must now be hands-free');
  assert.strictEqual(map.getItem({ x: 5, y: 5 }), 'KEY', 'KEY is placed on floor');

  // 3-3. 手ぶら状態であれば床のアイテムを正常に拾える
  player.pos = { x: 11, y: 10 }; // COIN
  const pickCoin = MovementSystem.executeSpaceAction(player, map);
  assert.strictEqual(pickCoin.action, 'PICKUP');
  assert.strictEqual(player.gold, 1, 'Player should collect COIN');
  assert.strictEqual(player.holdItem, 'NONE', 'Player remains hands-free after coin');

  console.log('✓ Task 3 tests passed.');
}

// ========================================================
// タスク4: ドラゴンの宝箱（CHEST_DRAGON）と王冠四方散乱イベントの実装
// ========================================================
console.log('Testing Task 4: CHEST_DRAGON placement, crown scatter sequence, and crown delivery to HOME...');
{
  const map = new WorldMap(64, 64);
  const rep = ProceduralMapGenerator.generateStandardDungeon(map, { seed: 1234 });
  assert.strictEqual(rep.isSolvable, true, 'Generated map must be solvable');

  // 4-1. マップ生成時、ドラゴンの周辺4箇所（頭・しっぽのすぐ横 cx±1, cy±1）に CHEST_DRAGON が初期配置されていること
  const cx = 32, cy = 32;
  const crownPositions = [
    { x: cx - 1, y: cy - 1 },
    { x: cx + 1, y: cy - 1 },
    { x: cx - 1, y: cy + 1 },
    { x: cx + 1, y: cy + 1 },
  ];
  for (const pos of crownPositions) {
    assert.strictEqual(map.getObject(pos), 'CHEST_DRAGON', `Tile at (${pos.x}, ${pos.y}) must be CHEST_DRAGON`);
  }

  // 4-2. ドラゴン全首撃破時のイベント:
  const dragon = new Dragon({ x: cx, y: cy });
  dragon.defeatedHeadsCount = 3;
  const ghosts: Ghost[] = [];
  const worldChanges = dragon.applyWorldChanges(map, ghosts);
  assert.strictEqual(worldChanges.crownsSpawned, true, 'Crowns must be spawned');

  // 4箇所の CHEST_DRAGON が開き、消去されていること
  for (const pos of crownPositions) {
    assert.strictEqual(map.getObject(pos), 'NONE', `CHEST_DRAGON at (${pos.x}, ${pos.y}) must be opened`);
  }

  // ゴーストが王冠を掴んで四方八方へ散開していること
  assert.strictEqual(ghosts.length, 4, '4 ghosts must be spawned to scatter the crowns');
  for (const ghost of ghosts) {
    assert.strictEqual(ghost.carriedItem, 'CROWN', 'Each scattering ghost must carry a CROWN');
    assert.strictEqual(ghost.vx !== 0 && ghost.vy !== 0, true, 'Ghosts must scatter diagonally towards the 4 corners');
  }

  // 4-3. 王冠の運搬と魔法制限、およびクリア:
  // 王冠（CROWN）を床に置き、プレイヤーが手ぶらで拾う
  const testCrownPos = { x: 7, y: 6 };
  map.setItem(testCrownPos, 'CROWN');
  const player = new Player({ x: 7, y: 6, hp: 1000, experience: 2000 });
  player.holdItem = 'NONE';
  player.magic = 5;

  MovementSystem.executeSpaceAction(player, map);
  assert.strictEqual(player.holdItem, 'CROWN', 'Player should hold CROWN as HoldItemType');
  assert.strictEqual(map.getItem(testCrownPos), 'NONE', 'CROWN should be removed from floor');

  // 王冠を手に持っている間は魔法使用不可
  assert.strictEqual(MagicSystem.canCast(player, 'JUMP').allowed, false, 'Magic must be blocked while holding CROWN');

  // 我が家 (HOME: 7, 7) に運搬して納品
  map.setBaseTile({ x: 7, y: 7 }, 'HOME');
  MovementSystem.tryMove(player, 'DOWN', map);
  assert.strictEqual(player.crowns, 1, 'Crown must be delivered to home (crowns = 1)');
  assert.strictEqual(player.holdItem, 'NONE', 'Hold item must be cleared to NONE after delivery');
  assert.strictEqual(player.isStageCleared, false, 'Not yet cleared with 1 crown');

  // 納品後、手ぶらになったら魔法が再び使えること！
  assert.strictEqual(MagicSystem.canCast(player, 'JUMP').allowed, true, 'Magic must be allowed after delivering CROWN and becoming hands-free');

  // 4つ目の納品でステージクリア
  player.crowns = 3;
  player.holdItem = 'CROWN';
  player.pos = { x: 7, y: 6 };
  MovementSystem.tryMove(player, 'DOWN', map);
  assert.strictEqual(player.crowns, 4, '4 crowns total delivered');
  assert.strictEqual(player.isStageCleared, true, 'Stage must be cleared upon delivering 4 crowns');

  console.log('✓ Task 4 tests passed.');
}

// ========================================================
console.log('Testing Task 5: Authentic 16-bit status caps (EXPERIENCE and HP max 655,350)...');
{
  const player = new Player({ x: 5, y: 5, hp: 600000, experience: 650000 });
  assert.strictEqual(Player.MAX_EXPERIENCE, 655350, 'MAX_EXPERIENCE should be 655,350');
  assert.strictEqual(Player.MAX_HP, 655350, 'MAX_HP should be 655,350');
  assert.strictEqual(Player.MAX_STR, 655350, 'MAX_STR should be 655,350');

  // 1. addExperience による上限値クリッピング
  const gained = player.addExperience(10000); // 650,000 + 10,000 = 660,000 -> 655,350
  assert.strictEqual(player.experience, 655350, 'Experience must cap at 655,350');
  assert.strictEqual(gained, 5350, 'Gained experience should report clipped delta');
  assert.strictEqual(player.maxHp, 655350, 'maxHp should also update and cap at 655,350');

  // 追加で加算しても上限を維持
  player.addExperience(50000);
  assert.strictEqual(player.experience, 655350, 'Experience must stay at 655,350');

  // 2. モンスター撃破時の経験値加算テスト
  const enemy = new EnemyInstance({ typeId: 6, pos: { x: 5, y: 6 }, def: 200000, hp: 1 });
  player.experience = 650000;
  player.strength = 1000000;
  player.hasSword = true;

  CombatSystem.resolvePlayerAttack(player, enemy);
  assert.strictEqual(player.experience, 655350, 'Experience after enemy kill must cap at 655,350');

  // 3. 我が家でのゴールド換算回復時のHP上限テスト
  player.experience = 650000;
  player.gold = 5000; // 5000 * 10 = +50,000 HP -> 700,000 -> capped at 655,350
  player.healAtHome();
  assert.strictEqual(player.maxHp, 655350, 'maxHp at home must cap at 655,350');
  assert.strictEqual(player.hp, 655350, 'hp at home must cap at 655,350');

  console.log('✓ Task 5 tests passed.');
}

// ========================================================
console.log('Testing Task 6: FREEZE permanent freeze vs FLASH temporary stop...');
{
  const map = new WorldMap(30, 30);
  const player = new Player({ x: 10, y: 10, hp: 1000, experience: 20000 });
  player.magic = 10;

  // 1. FREEZE の永続性テスト
  const freezeTarget = new EnemyInstance({ typeId: 1, pos: { x: 10, y: 11 } });
  const farEnemy = new EnemyInstance({ typeId: 1, pos: { x: 20, y: 20 } });
  const enemies = [freezeTarget, farEnemy];

  const freezeRes = MagicSystem.cast(player, 'FREEZE', map, enemies);
  assert.strictEqual(freezeRes.success, true);
  assert.strictEqual(freezeTarget.isPermanentlyFrozen, true, 'Target must be permanently frozen');
  assert.strictEqual(freezeTarget.isFrozen, true, 'isFrozen getter must be true');
  assert.strictEqual(farEnemy.isPermanentlyFrozen, false, 'Far enemy must not be frozen');

  // 30ターン経過させても freezeTarget は解凍されず、位置も移動しない
  for (let t = 0; t < 30; t++) {
    EnemyAISystem.updateEnemies(enemies, player, map);
  }
  assert.strictEqual(freezeTarget.isPermanentlyFrozen, true, 'Target remains permanently frozen after 30 turns');
  assert.strictEqual(freezeTarget.isFrozen, true, 'isFrozen remains true');
  assert.strictEqual(freezeTarget.pos.x, 10);
  assert.strictEqual(freezeTarget.pos.y, 11);

  // 2. FLASH の一時停止テスト
  const flashEnemy = new EnemyInstance({ typeId: 2, pos: { x: 15, y: 15 } });
  const enemiesForFlash = [freezeTarget, flashEnemy];

  const flashRes = MagicSystem.cast(player, 'FLASH', map, enemiesForFlash);
  assert.strictEqual(flashRes.success, true);
  assert.strictEqual(freezeTarget.isPermanentlyFrozen, true, 'Permanently frozen enemy keeps permanent status');
  assert.strictEqual(flashEnemy.isPermanentlyFrozen, false, 'FLASH does NOT grant permanent freeze');
  assert.strictEqual(flashEnemy.frozenTimer, 8, 'FLASH grants 8-turn temporary stop');
  assert.strictEqual(flashEnemy.isFrozen, true);

  // 8ターン経過でタイマーが減少し、自然解凍されること
  for (let t = 0; t < 8; t++) {
    EnemyAISystem.updateEnemies(enemiesForFlash, player, map);
  }
  assert.strictEqual(flashEnemy.frozenTimer, 0, 'Flash timer should decrement to 0');
  assert.strictEqual(flashEnemy.isFrozen, false, 'Enemy should unfreeze naturally after FLASH duration');
  assert.strictEqual(freezeTarget.isPermanentlyFrozen, true, 'FREEZE target remains frozen forever');

  console.log('✓ Task 6 tests passed.');
}

// ========================================================
// タスク7: ドラゴン首討伐時の獲得経験値0化と脱出フェーズの難易度維持（Level 2.0原作仕様）
// ========================================================
console.log('Testing Task 7: Zero EXP on Dragon head defeat and threat maintenance in Crown retrieval phase...');
{
  const map = new WorldMap(30, 30);
  const dragon = new Dragon({ x: 15, y: 15 });
  // 斜め移動解放レベル（30,000）の経験値を持つプレイヤー
  const initialExp = 30000;
  const player = new Player({ x: 14, y: 14, hp: 50000, experience: initialExp });
  player.hasSword = true;
  player.strength = 655350; // STRカンスト状態で首を一撃で倒せる状態

  // 1. 首撃破時の獲得経験値が0であること（DEF/2 + 50 が加算されない）
  // 死角マス（しっぽ上や外周斜めマス）からの斜め攻撃で反撃0で撃破
  const leftHead = dragon.heads[0]; // DEF 300,000 at (14, 15)
  leftHead.hp = 300000; // 一撃で撃破可能なHPに設定
  // しっぽ (15, 16) から左首 (14, 15) へ UP_LEFT 斜め攻撃
  player.pos = { x: 15, y: 16 };
  const combatLeft = CombatSystem.resolvePlayerAttackDragon(player, dragon, leftHead, 'UP_LEFT', map);
  assert.strictEqual(combatLeft.damageToPlayer, 0, '死角からの斜め攻撃は反撃0');
  assert.strictEqual(combatLeft.enemyKilled, true, '左首を撃破');
  assert.strictEqual(player.experience, initialExp, '左首撃破後もEXPは増加しないこと（0獲得）');

  // 残りの中首・右首も撃破
  const centerHead = dragon.heads[1]; // DEF 400,000 at (15, 14)
  centerHead.hp = 250000;
  // 外周斜めマス (14, 13) から中央首 (15, 14) へ DOWN_RIGHT 斜め攻撃
  player.pos = { x: 14, y: 13 };
  const combatCenter = CombatSystem.resolvePlayerAttackDragon(player, dragon, centerHead, 'DOWN_RIGHT', map);
  assert.strictEqual(combatCenter.damageToPlayer, 0, '死角からの斜め攻撃は反撃0');
  assert.strictEqual(combatCenter.enemyKilled, true, '中首を撃破');
  assert.strictEqual(player.experience, initialExp, '中首撃破後もEXPは増加しないこと');

  const rightHead = dragon.heads[2]; // DEF 380,000 at (16, 15)
  rightHead.hp = 250000;
  // しっぽ (15, 16) から右首 (16, 15) へ UP_RIGHT 斜め攻撃
  player.pos = { x: 15, y: 16 };
  const combatRight = CombatSystem.resolvePlayerAttackDragon(player, dragon, rightHead, 'UP_RIGHT', map);
  assert.strictEqual(combatRight.damageToPlayer, 0, '死角からの斜め攻撃は反撃0');
  assert.strictEqual(combatRight.enemyKilled, true, '右首を撃破');
  assert.strictEqual(player.experience, initialExp, '3首全討伐後もEXPは討伐前の値を維持すること');
  assert.strictEqual(dragon.isAllHeadsDefeated, true, '全首討伐完了');

  // 2. 脱出フェーズにおける敵モンスターの攻撃で無敵化せず、適正なダメージを受けること
  // ドッペル (ATK 650,000)
  const doppel = new EnemyInstance({ typeId: 32, pos: { x: 14, y: 13 } });
  const damageFromDoppel = Math.max(0, doppel.atk - player.experience);
  assert.strictEqual(damageFromDoppel, 650000 - 30000, 'ドッペルから620,000ダメージを受けること（無敵化していない）');

  // 中位敵（例: ナイト ATK 85,000）
  const knight = new EnemyInstance({ typeId: 13, pos: { x: 14, y: 13 } });
  const damageFromKnight = Math.max(0, knight.atk - player.experience);
  assert.strictEqual(damageFromKnight, 85000 - 30000, 'ナイトから55,000ダメージを受けること');

  console.log('✓ Task 7 tests passed.');
}

console.log('--- ✓ All Authentic Retro Specification Tests Passed Successfully! ---');
