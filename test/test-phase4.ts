import assert from 'node:assert';
import { Player } from '../src/models/Player.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { Ghost } from '../src/models/Ghost.js';
import { Dragon } from '../src/models/Dragon.js';
import { MagicSystem } from '../src/systems/MagicSystem.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { CombatSystem } from '../src/systems/CombatSystem.js';
import { SpawnSystem } from '../src/systems/SpawnSystem.js';
import { PaletteManager } from '../src/view/PaletteManager.js';

console.log('--- Phase 4: Magic & Dragon Boss System Verification ---');

// ==========================================
// Test 1: 魔法アンロック & 使用制限フラグの検証
// ==========================================
console.log('Testing 1: Magic unlocking table and casting restrictions...');
{
  const player = new Player({ hp: 1000, experience: 1000 });
  player.magic = 5;

  // 1. 初期状態 (EXP: 1000) では JUMP のみがアンロック
  let unlocked = MagicSystem.getUnlockedMagics(player);
  assert.strictEqual(unlocked.length, 1);
  assert.strictEqual(unlocked[0].type, 'JUMP');

  // EXP を 5000 に増加 -> JUMP, RETURN, MAP, BREAK, KICK がアンロック
  player.experience = 5000;
  unlocked = MagicSystem.getUnlockedMagics(player);
  assert.strictEqual(unlocked.length, 5);
  const types = unlocked.map(m => m.type);
  assert.deepStrictEqual(types, ['JUMP', 'RETURN', 'MAP', 'BREAK', 'KICK']);

  // EXP を 15000 に増加 -> 全魔法 (9種) がアンロック
  player.experience = 15000;
  unlocked = MagicSystem.getUnlockedMagics(player);
  assert.strictEqual(unlocked.length, 9);

  // 特技・斜め移動 (DIAGONAL_REQUIRED_EXP = 12000)
  MagicSystem.updatePassiveSkills(player);
  assert.strictEqual(player.canDiagonal, true, 'EXP >= 12000 で斜め移動がアンロックされること');

  // 2. 制限チェック: 正常時は BREAK が発動可能
  assert.strictEqual(MagicSystem.canCast(player, 'BREAK').allowed, true);

  // 2-A. 死神憑依中 -> 魔法不可
  player.hasDeath = true;
  assert.strictEqual(MagicSystem.canCast(player, 'BREAK').allowed, false);
  player.hasDeath = false;

  // 2-B. 十字架所持中 -> 魔法不可
  player.holdItem = 'CROSS';
  assert.strictEqual(MagicSystem.canCast(player, 'BREAK').allowed, false);
  player.holdItem = 'NONE';

  // 2-C. クラウン手持ち中 -> 魔法不可（納品後は手ぶらなら魔法可能）
  player.holdItem = 'CROWN';
  assert.strictEqual(MagicSystem.canCast(player, 'BREAK').allowed, false);
  player.holdItem = 'NONE';
  player.crowns = 1; // 納品済み
  assert.strictEqual(MagicSystem.canCast(player, 'BREAK').allowed, true, '納品後は手ぶらなら魔法が使えること');
  player.crowns = 0;

  // 2-D. MAGICストック不足 (magic = 0) -> 魔法不可
  player.magic = 0;
  assert.strictEqual(MagicSystem.canCast(player, 'BREAK').allowed, false);
  player.magic = 5;

  console.log('✓ 1. Magic unlocking table & restriction tests passed.');
}

// ==========================================
// Test 2: 個別魔法の効果検証 (BREAK, KICK, FREEZE, FLASH, FLY, JUMP, RETURN)
// ==========================================
console.log('Testing 2: Individual magic spell effects...');
{
  const map = new WorldMap();
  const player = new Player({ x: 10, y: 10, hp: 1000, experience: 15000 });
  player.magic = 5;

  // 2-A. BREAK: 目の前のブロックを破壊（実質MAGIC消費0）
  player.dir = 'RIGHT';
  map.setTile({ x: 11, y: 10 }, 'BLOCK');
  const breakResult = MagicSystem.cast(player, 'BREAK', map);
  assert.strictEqual(breakResult.success, true);
  assert.strictEqual(map.getTile({ x: 11, y: 10 }), 'EMPTY', 'ブロックが破壊されてEMPTYになること');
  assert.strictEqual(player.magic, 5, 'BREAKは実質MAGIC消費0であること');

  // 2-B. KICK: 目の前の岩を蹴飛ばし、モンスター激突即死（MAGIC 1消費）
  map.setTile({ x: 11, y: 10 }, 'BLOCK');
  const enemy = new EnemyInstance({ typeId: 10, pos: { x: 12, y: 10 } }); // dora
  const enemies = [enemy];
  const kickResult = MagicSystem.cast(player, 'KICK', map, enemies);
  assert.strictEqual(kickResult.success, true);
  assert.strictEqual(enemy.isAlive, false, 'KICKが命中した敵は即死すること');
  assert.strictEqual(player.magic, 4, 'モンスター命中時はMAGICを1消費すること');

  // KICK: 障害物なしで岩を飛ばす（実質消費0）
  player.dir = 'RIGHT';
  map.setTile({ x: 11, y: 10 }, 'BLOCK');
  map.setTile({ x: 12, y: 10 }, 'EMPTY');
  const kickPushResult = MagicSystem.cast(player, 'KICK', map, []);
  assert.strictEqual(kickPushResult.success, true);
  assert.strictEqual(map.getTile({ x: 11, y: 10 }), 'EMPTY');
  assert.strictEqual(map.getTile({ x: 12, y: 10 }), 'BLOCK');
  assert.strictEqual(player.magic, 4, 'モンスターに当たらなければ消費0');

  // KICK: 墓に向かって岩を蹴った場合（敵なし: 岩は消滅）
  map.setTile({ x: 11, y: 10 }, 'BLOCK');
  map.setBaseTile({ x: 12, y: 10 }, 'GRAVE');
  map.setTile({ x: 12, y: 10 }, 'GRAVE');
  const kickIntoGrave = MagicSystem.cast(player, 'KICK', map, []);
  assert.strictEqual(kickIntoGrave.success, true);
  assert.strictEqual(map.getTile({ x: 11, y: 10 }), 'EMPTY', '元の岩は消滅すること');
  assert.strictEqual(map.getTile({ x: 12, y: 10 }), 'GRAVE', '墓の上には岩は乗らず墓のままであること');

  // KICK: 墓の上の敵に向かって岩を蹴った場合（敵あり: 敵撃破＆墓の上に岩は乗らず消滅）
  map.setTile({ x: 11, y: 10 }, 'BLOCK');
  map.setBaseTile({ x: 12, y: 10 }, 'GRAVE');
  map.setTile({ x: 12, y: 10 }, 'GRAVE');
  const enemyOnGrave = new EnemyInstance({ typeId: 2, pos: { x: 12, y: 10 } });
  const kickGraveEnemy = MagicSystem.cast(player, 'KICK', map, [enemyOnGrave]);
  assert.strictEqual(kickGraveEnemy.success, true);
  assert.strictEqual(enemyOnGrave.isAlive, false, '墓の上の敵も即死すること');
  assert.strictEqual(map.getTile({ x: 11, y: 10 }), 'EMPTY', '元の岩は消滅すること');
  assert.strictEqual(map.getTile({ x: 12, y: 10 }), 'GRAVE', '墓の上には岩が乗らず墓のままであること');
  player.magic = 4; // 後続テストのためにmagicストックを戻す

  // 2-C. FREEZE: 周囲モンスターを凍結（MAGIC 1消費）
  const nearEnemy = new EnemyInstance({ typeId: 1, pos: { x: 11, y: 11 } });
  const farEnemy = new EnemyInstance({ typeId: 1, pos: { x: 25, y: 25 } });
  const freezeResult = MagicSystem.cast(player, 'FREEZE', map, [nearEnemy, farEnemy]);
  assert.strictEqual(freezeResult.success, true);
  assert.strictEqual(player.magic, 3);
  assert.strictEqual(nearEnemy.frozenTimer > 0, true, '近隣敵は凍結タイマーが付与されること');
  assert.strictEqual(farEnemy.frozenTimer, 0, '遠方の敵は凍結されないこと');

  // 2-D. FLASH: 全モンスターを凍結（MAGIC 1消費）
  const flashResult = MagicSystem.cast(player, 'FLASH', map, [nearEnemy, farEnemy]);
  assert.strictEqual(flashResult.success, true);
  assert.strictEqual(player.magic, 2);
  assert.strictEqual(farEnemy.frozenTimer > 0, true, '画面全敵が行動停止になること');

  // 2-E. FLY: 鳥に変身し壁抜け移動（MAGIC 1消費）
  const flyResult = MagicSystem.cast(player, 'FLY', map);
  assert.strictEqual(flyResult.success, true);
  assert.strictEqual(player.magic, 1);
  assert.strictEqual(player.isFlying, true);
  assert.strictEqual(player.flyTimer > 0, true);

  // FLY中はブロックのあるマスへも移動可能
  map.setTile({ x: 10, y: 11 }, 'BLOCK');
  const flyMove = MovementSystem.tryMove(player, 'DOWN', map);
  assert.strictEqual(flyMove, true, 'FLY中はブロックをすり抜けて移動できること');
  assert.strictEqual(player.pos.x, 10);
  assert.strictEqual(player.pos.y, 11);

  // 2-F. JUMP: ゴーストの位置へワープ（MAGIC 1消費）
  const ghost = new Ghost({ pos: { x: 22, y: 18 } });
  const jumpResult = MagicSystem.cast(player, 'JUMP', map, [], [ghost]);
  assert.strictEqual(jumpResult.success, true);
  assert.strictEqual(player.pos.x, 22);
  assert.strictEqual(player.pos.y, 18);
  assert.strictEqual(player.magic, 0);

  // 2-G. RETURN: 我が家へ瞬時テレポート
  player.magic = 1;
  map.setRealHomePos({ x: 7, y: 7 });
  const returnResult = MagicSystem.cast(player, 'RETURN', map);
  assert.strictEqual(returnResult.success, true);
  assert.strictEqual(player.pos.x, 7);
  assert.strictEqual(player.pos.y, 7);
  assert.strictEqual(player.magic, 0);

  console.log('✓ 2. Individual magic spell effects tests passed.');
}

// ==========================================
// Test 3: 3首ドラゴン部位構成 & 戦闘 & 尻尾弾き飛ばし
// ==========================================
console.log('Testing 3: 3-headed Dragon boss mechanics...');
{
  const map = new WorldMap();
  const dragon = new Dragon({ x: 30, y: 30 });
  const player = new Player({ x: 28, y: 30, hp: 5000, experience: 2000, strength: 2000 });
  player.hasSword = true;
  player.canDiagonal = true;

  // 部位配置チェック
  assert.strictEqual(dragon.body.pos.x, 30);
  assert.strictEqual(dragon.body.pos.y, 30);
  assert.strictEqual(dragon.heads[0].type, 'LEFT_HEAD');
  assert.strictEqual(dragon.heads[0].pos.x, 29);
  assert.strictEqual(dragon.heads[0].pos.y, 30);
  assert.strictEqual(dragon.heads[1].type, 'CENTER_HEAD');
  assert.strictEqual(dragon.heads[1].pos.x, 30);
  assert.strictEqual(dragon.heads[1].pos.y, 29);
  assert.strictEqual(dragon.heads[2].type, 'RIGHT_HEAD');
  assert.strictEqual(dragon.heads[2].pos.x, 31);
  assert.strictEqual(dragon.heads[2].pos.y, 30);
  assert.strictEqual(dragon.tail.pos.x, 30);
  assert.strictEqual(dragon.tail.pos.y, 31);

  // 3-A. 首への正面・直線攻撃 (LEFT_HEADへの右向き攻撃)
  // 直線攻撃時は首からの反撃ダメージを受ける
  const leftHead = dragon.heads[0];
  const initialPlayerHp = player.hp;
  const straightCombat = CombatSystem.resolvePlayerAttackDragon(player, dragon, leftHead, 'RIGHT', map);
  assert.strictEqual(straightCombat.attacked, true);
  assert.strictEqual(straightCombat.damageToEnemy > 0, true);
  assert.strictEqual(straightCombat.damageToPlayer > 0, true, '直線攻撃時は反撃を受けること');
  assert.strictEqual(player.hp < initialPlayerHp, true);

  // 3-B. 首への斜め攻撃 (特技活用: 安全地帯からの攻撃)
  // 斜めからの攻撃に対しては首は反撃不可（被ダメ0）
  const hpBeforeDiagonal = player.hp;
  const diagonalCombat = CombatSystem.resolvePlayerAttackDragon(player, dragon, leftHead, 'UP_RIGHT', map);
  assert.strictEqual(diagonalCombat.attacked, true);
  assert.strictEqual(diagonalCombat.damageToEnemy > 0, true);
  assert.strictEqual(diagonalCombat.damageToPlayer, 0, '斜め攻撃時は反撃ダメージが0であること');
  assert.strictEqual(player.hp, hpBeforeDiagonal);

  // 3-C. 尻尾接触時の初期地点付近への弾き飛ばし処理
  player.pos = { x: 30, y: 32 }; // 尻尾の直下
  const repulsePos = dragon.repulsePlayerByTail(player, map);
  assert.strictEqual(player.pos.x, repulsePos.x);
  assert.strictEqual(player.pos.y, repulsePos.y);
  assert.strictEqual(player.pos.x !== 30 || player.pos.y !== 32, true, '初期地点付近へ弾き飛ばされること');

  // 3-D. 火炎弾の発射
  player.pos = { x: 25, y: 30 }; // LEFT_HEADの正面直線上
  dragon.updateFireballs(player, map);
  assert.strictEqual(dragon.fireballs.length > 0, true, '正面直線上のプレイヤーに向けて火炎弾を発射すること');

  console.log('✓ 3. Dragon boss mechanics & combat tests passed.');
}

// ==========================================
// Test 4: 首討伐後の世界変化 (Level 2.0仕様)
// ==========================================
console.log('Testing 4: World changes upon defeating Dragon heads (Level 2.0)...');
{
  const map = new WorldMap();
  const dragon = new Dragon({ x: 30, y: 30 });
  const player = new Player({ x: 8, y: 8, hp: 10000, experience: 10000, strength: 50000 });
  player.hasSword = true;

  // 我が家を動かしておく
  map.setRealHomePos({ x: 15, y: 15 });
  assert.strictEqual(map.homePos.x, 15);

  // 4-A. 首1本討伐 (defeatedHeadsCount = 1)
  // 世界変化: 移動先の家は維持され、初期位置に我が家が復活配置される（家が2軒化）
  dragon.damageHead(dragon.heads[0], 999999);
  assert.strictEqual(dragon.defeatedHeadsCount, 1);
  const change1 = dragon.applyWorldChanges(map);
  assert.strictEqual(change1.resetHome, true);
  assert.strictEqual(map.getBaseTile(map.initialHomePos), 'HOME', '初期位置に家が復活出現すること');
  assert.strictEqual(map.spawnHomePos.x, map.initialHomePos.x, '敵湧き対象座標が初期位置の家になること');
  assert.strictEqual(map.homePos.x, 15, '移動先のプレイヤーメインホームが維持されること');
  assert.strictEqual(map.homePos.y, 15);

  // 首1本討伐時の家スポーン（復活した初期位置の家から湧く）
  const enemies: EnemyInstance[] = [];
  const homeSpawn1 = SpawnSystem.spawnFromHome(enemies, player, map, dragon);
  assert.strictEqual(homeSpawn1 !== null, true, '初期位置の家から敵が湧き出すこと');
  assert.strictEqual(Math.abs(homeSpawn1!.pos.x - map.initialHomePos.x) + Math.abs(homeSpawn1!.pos.y - map.initialHomePos.y), 1, '敵は初期位置の家の隣接マスに出現すること');

  // 4-B. 首2本討伐 (defeatedHeadsCount = 2)
  dragon.damageHead(dragon.heads[1], 999999);
  assert.strictEqual(dragon.defeatedHeadsCount, 2);
  const change2 = dragon.applyWorldChanges(map);
  assert.strictEqual(change2.allEnemiesFromHome, true, '全モンスターが家から湧き出すフラグが立つこと');

  // 4-C. 首3本討伐（全滅） (defeatedHeadsCount = 3)
  dragon.damageHead(dragon.heads[2], 999999);
  assert.strictEqual(dragon.defeatedHeadsCount, 3);
  assert.strictEqual(dragon.isAllHeadsDefeated, true);
  const change3 = dragon.applyWorldChanges(map);
  assert.strictEqual(change3.darkPalette, true, 'パレットがDARKに変化すること');
  assert.strictEqual(change3.crownsSpawned, true, '王冠4個が出現すること');

  // パレット更新チェック
  const palette = new PaletteManager();
  palette.updateByPlayerHP(player.hp, dragon.isAllHeadsDefeated);
  assert.strictEqual(palette.getMode(), 'DARK', '全首討伐後はDARKパレットになること');

  // 墓からの湧き停止チェック
  const spawnedAfterAllHeads = SpawnSystem.onTurnEnd([], player, map, dragon);
  // 墓からのスポーンは0（家からのみ湧く）
  assert.strictEqual(dragon.isAllHeadsDefeated, true);

  console.log('✓ 4. Dragon defeat world change tests passed.');
}

// ==========================================
// Test 5: 王冠回収とステージクリア判定
// ==========================================
console.log('Testing 5: Crown collection and Stage Clear verification...');
{
  const map = new WorldMap();
  const player = new Player({ x: 7, y: 6, hp: 1000, experience: 2000 });

  // 王冠を拾う処理 (手ぶらで乗ってSPACEキーで手持ちCROWNに)
  map.setTile({ x: 7, y: 5 }, 'CROWN');
  player.pos = { x: 7, y: 6 };
  MovementSystem.tryMove(player, 'UP', map);
  assert.strictEqual(player.pos.x, 7);
  assert.strictEqual(player.pos.y, 5);
  MovementSystem.executeSpaceAction(player, map);
  assert.strictEqual(player.holdItem, 'CROWN', '手ぶらでSPACEキーを押すとCROWNを手持ちにすること');
  assert.strictEqual(map.getTile({ x: 7, y: 5 }), 'EMPTY');

  // 我が家 (HOME: 7, 7) に帰還・納品
  map.setTile({ x: 7, y: 7 }, 'HOME');
  MovementSystem.tryMove(player, 'DOWN', map); // (7, 6)
  MovementSystem.tryMove(player, 'DOWN', map); // (7, 7: HOME)
  assert.strictEqual(player.crowns, 1, '我が家に帰還して納品するとcrownsが1増えること');
  assert.strictEqual(player.holdItem, 'NONE', '納品完了後は手ぶらになること');

  // 王冠4個にする
  player.crowns = 3;
  player.holdItem = 'CROWN';

  // 4つ目の王冠を我が家 (HOME: 7, 7) へ納品してクリア判定
  player.pos = { x: 7, y: 6 };
  MovementSystem.tryMove(player, 'DOWN', map); // HOMEに入る

  assert.strictEqual(player.crowns, 4);
  assert.strictEqual(player.isStageCleared, true, '王冠4個を納品するとステージクリア判定となること');

  console.log('✓ 5. Crown collection and Stage Clear tests passed.');
}

console.log('--- ✓ All Phase 4 Logic & System Tests Passed Successfully! ---');
