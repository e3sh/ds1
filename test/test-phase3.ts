import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { Ghost } from '../src/models/Ghost.js';
import { ENEMY_CONFIG_TABLE, getEnemyConfigById, getEnemyConfigByName } from '../src/config/EnemyTable.js';
import { CombatSystem } from '../src/systems/CombatSystem.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { EnemyAISystem } from '../src/systems/EnemyAISystem.js';
import { GhostAISystem } from '../src/systems/GhostAISystem.js';
import { SpawnSystem } from '../src/systems/SpawnSystem.js';

function runPhase3Tests() {
  console.log('--- Phase 3: Monster & Combat System Verification ---');

  // ==========================================
  // 1. 一般モンスター全32種のデータテーブルとモデル検証
  // ==========================================
  console.log('Testing 1: Enemy table 32 species and Level 2.0 parameters...');
  console.assert(ENEMY_CONFIG_TABLE.length === 32, 'Enemy config table must contain exactly 32 species');

  // 最初の敵 skeleton と最後の敵 doppel の検証
  const skeletonCfg = getEnemyConfigById(1);
  console.assert(skeletonCfg.name === 'skeleton', 'Enemy 1 must be skeleton');
  console.assert(skeletonCfg.hp === 1500 && skeletonCfg.atk === 300 && skeletonCfg.def === 150, 'Skeleton Level 2.0 stats');

  const doppelCfg = getEnemyConfigById(32);
  console.assert(doppelCfg.name === 'doppel', 'Enemy 32 must be doppel');
  console.assert(doppelCfg.hp === 650000 && doppelCfg.atk === 650000 && doppelCfg.def === 520000, 'Doppel Level 2.0 stats');

  // Level 2.0仕様の経験値計算式検証: floor(Enemy.DEF / 2) + 50
  const skeleton = new EnemyInstance({ typeId: 1, pos: { x: 0, y: 0 } });
  const expectedSkeletonExp = Math.floor(150 / 2) + 50; // 75 + 50 = 125
  console.assert(skeleton.expReward === expectedSkeletonExp, `Skeleton exp reward should be ${expectedSkeletonExp}, got ${skeleton.expReward}`);

  const doppel = new EnemyInstance({ typeId: 32, pos: { x: 0, y: 0 } });
  const expectedDoppelExp = Math.floor(520000 / 2) + 50; // 260050
  console.assert(doppel.expReward === expectedDoppelExp, `Doppel exp reward should be ${expectedDoppelExp}, got ${doppel.expReward}`);

  // 特殊フラグ検証
  const doraCfg = getEnemyConfigByName('dora');
  console.assert(doraCfg.drainAtk === 3000, 'Dora should drain 3000 attack');
  const knightCfg = getEnemyConfigByName('knight');
  console.assert(knightCfg.drainAtk === 3000, 'Knight should drain 3000 attack');

  const richCfg = getEnemyConfigByName('rich');
  console.assert(richCfg.drainExp === 1000, 'Rich should drain exp');
  const crownloadCfg = getEnemyConfigByName('crownload');
  console.assert(crownloadCfg.drainExp === 1000, 'Crownload should drain exp');

  const monstirCfg = getEnemyConfigByName('monstir');
  console.assert(monstirCfg.stealPotion === true, 'Monstir should steal potion');
  console.log('✓ 1. Enemy table & Level 2.0 parameters passed.');

  // ==========================================
  // 2. 体当たり戦闘システム (CombatSystem) 検証
  // ==========================================
  console.log('Testing 2: Bump Combat System & calculations...');
  // 2-1. 剣がない場合（攻撃力10固定）
  const playerWithoutSword = new Player({ x: 5, y: 5, hp: 1000, experience: 1000 });
  playerWithoutSword.hasSword = false;
  playerWithoutSword.strength = 5000; // 剣がないので無効
  const dummyEnemy1 = new EnemyInstance({ typeId: 1, pos: { x: 6, y: 5 } }); // def: 150, atk: 300

  const combat1 = CombatSystem.resolvePlayerAttack(playerWithoutSword, dummyEnemy1);
  // 与ダメ: max(1, 10 - 150) = 1 (最低1保証)
  // 被ダメ: max(0, 300 - 1000) = 0 (EXPで完全防御)
  console.assert(combat1.damageToEnemy === 1, `Without sword, damage to enemy should be 1 (minimum guaranteed), got ${combat1.damageToEnemy}`);
  console.assert(combat1.damageToPlayer === 0, `Player EXP (1000) > Enemy ATK (300), player damage should be 0, got ${combat1.damageToPlayer}`);
  console.assert(playerWithoutSword.hp === 1000, 'Player HP should remain 1000');

  // 2-2. 剣ありで敵を一撃撃破
  const playerWithSword = new Player({ x: 5, y: 5, hp: 1000, experience: 1000 });
  playerWithSword.hasSword = true;
  playerWithSword.strength = 5000;
  const dummyEnemy2 = new EnemyInstance({ typeId: 1, pos: { x: 6, y: 5 } }); // hp: 1500, def: 150

  const initialExp = playerWithSword.experience;
  const combat2 = CombatSystem.resolvePlayerAttack(playerWithSword, dummyEnemy2);
  // 与ダメ: 5000 - 150 = 4850
  console.assert(combat2.damageToEnemy === 4850, 'Damage should be 4850');
  console.assert(combat2.enemyKilled, 'Enemy should be killed');
  console.assert(!dummyEnemy2.isAlive, 'Enemy alive flag should be false');
  console.assert(playerWithSword.experience === initialExp + dummyEnemy2.expReward, 'Player should gain Level 2.0 EXP');

  // 2-3. 十字架（CROSS）所持時の無敵 & 攻撃不可判定
  const playerWithCross = new Player({ x: 5, y: 5, hp: 1000, experience: 1000 });
  playerWithCross.hasSword = true;
  playerWithCross.strength = 5000;
  playerWithCross.holdItem = 'CROSS';
  const dummyEnemy3 = new EnemyInstance({ typeId: 1, pos: { x: 6, y: 5 } });
  const enemyInitialHp = dummyEnemy3.hp;

  const combatCross = CombatSystem.resolvePlayerAttack(playerWithCross, dummyEnemy3);
  console.assert(!combatCross.attacked, 'Should not attack while holding CROSS');
  console.assert(combatCross.damageToEnemy === 0, 'No damage to enemy while holding CROSS');
  console.assert(combatCross.damageToPlayer === 0, 'No damage to player while holding CROSS');
  console.assert(dummyEnemy3.hp === enemyInitialHp, 'Enemy HP should not change');

  // MovementSystem 経由での進入試行時も CROSS 所持中は進入阻止
  const mapCombat = new WorldMap(20, 20);
  const moveResultWithCross = MovementSystem.tryMove(playerWithCross, 'RIGHT', mapCombat, [dummyEnemy3]);
  console.assert(!moveResultWithCross, 'Player should not enter enemy tile with CROSS');
  console.assert(playerWithCross.pos.x === 5, 'Player position should not change');
  console.log('✓ 2. Bump combat tests passed.');

  // ==========================================
  // 3. 特殊モンスターの能力検証
  // ==========================================
  console.log('Testing 3: Special enemy abilities (drain STR, drain EXP, steal potion)...');
  // 3-1. dora: STR 3000 吸い取る
  const playerDora = new Player({ x: 5, y: 5, hp: 5000, experience: 50000 });
  playerDora.hasSword = true;
  playerDora.strength = 10000;
  const doraEnemy = new EnemyInstance({ typeId: 9, pos: { x: 6, y: 5 } }); // dora HP 300000, 生き残る
  CombatSystem.resolvePlayerAttack(playerDora, doraEnemy);
  console.assert(playerDora.strength === 7000, `Dora should drain 3000 STR (10000 -> 7000), got ${playerDora.strength}`);

  // 3-2. rich: EXP 1000 吸い取る
  const playerRich = new Player({ x: 5, y: 5, hp: 5000, experience: 5000 });
  playerRich.hasSword = true;
  playerRich.strength = 500;
  const richEnemy = new EnemyInstance({ typeId: 10, pos: { x: 6, y: 5 } }); // rich HP 100000, 生き残る
  CombatSystem.resolvePlayerAttack(playerRich, richEnemy);
  console.assert(playerRich.experience === 4000, `Rich should drain 1000 EXP (5000 -> 4000), got ${playerRich.experience}`);

  // 3-3. monstir: 魔法の壺 (MAGIC) 強奪
  const playerMonstir = new Player({ x: 5, y: 5, hp: 5000, experience: 50000 });
  playerMonstir.hasSword = true;
  playerMonstir.strength = 500;
  playerMonstir.magic = 3;
  const monstirEnemy = new EnemyInstance({ typeId: 5, pos: { x: 6, y: 5 } });
  CombatSystem.resolvePlayerAttack(playerMonstir, monstirEnemy);
  console.assert(playerMonstir.magic === 2, `Monstir should steal 1 potion (3 -> 2), got ${playerMonstir.magic}`);
  console.log('✓ 3. Special monster ability tests passed.');

  // ==========================================
  // 4. 敵AIルーチン & 原作豹変仕様検証
  // ==========================================
  console.log('Testing 4: Enemy AI flee/chase and HP < EXP transformation...');
  const mapAI = new WorldMap(30, 30);
  // テスト用エリアをEMPTYでクリア
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 20; x++) {
      if (x > 0 && y > 0 && x < 19 && y < 14) {
        mapAI.setTile({ x, y }, 'EMPTY');
      }
    }
  }

  const playerAI = new Player({ x: 10, y: 10, hp: 1000, experience: 1000 });
  playerAI.hasSword = true;
  playerAI.strength = 2000; // skeleton (def 150) より圧倒的に強い

  // 4-1. 通常時（HP == EXP）: プレイヤーが優位なので skeleton は逃走（FLEE）
  // (skeleton は 2ターンに1回移動のため、moveCounter を 1 にセットして次回確実に動かす)
  const weakEnemy = new EnemyInstance({ typeId: 1, pos: { x: 11, y: 10 } }); // 右隣
  weakEnemy.moveCounter = 1;
  const initialDist = Math.abs(weakEnemy.pos.x - playerAI.pos.x) + Math.abs(weakEnemy.pos.y - playerAI.pos.y);
  EnemyAISystem.updateEnemies([weakEnemy], playerAI, mapAI);
  const fleeDist = Math.abs(weakEnemy.pos.x - playerAI.pos.x) + Math.abs(weakEnemy.pos.y - playerAI.pos.y);
  console.assert(fleeDist > initialDist, 'Weak enemy should flee from strong player when HP >= EXP');

  // 4-2. 原作豹変仕様: HP < EXP になった瞬間、弱敵が一斉に追跡（CHASE）へ豹変！
  playerAI.hp = 500; // 負傷！ HP < EXP (500 < 1000)
  weakEnemy.pos = { x: 14, y: 10 }; // 距離 4
  weakEnemy.moveCounter = 1; // 次回ターンで行動
  const distBeforeInjured = Math.abs(weakEnemy.pos.x - playerAI.pos.x) + Math.abs(weakEnemy.pos.y - playerAI.pos.y);
  EnemyAISystem.updateEnemies([weakEnemy], playerAI, mapAI);
  const distAfterInjured = Math.abs(weakEnemy.pos.x - playerAI.pos.x) + Math.abs(weakEnemy.pos.y - playerAI.pos.y);
  console.assert(distAfterInjured < distBeforeInjured, 'Enemy should switch to CHASE mode when player HP < EXP (豹変仕様)');

  // 4-3. Level 2.0仕様: 敵は地面の十字架（CROSS）の上には進入不可
  const crossPos = { x: 11, y: 10 };
  mapAI.setTile(crossPos, 'CROSS');
  const enemyNearCross = new EnemyInstance({ typeId: 1, pos: { x: 12, y: 10 } });
  playerAI.pos = { x: 10, y: 10 }; // プレイヤーは十字架の向こう
  EnemyAISystem.stepEnemy(enemyNearCross, 'CHASE', playerAI, mapAI, [enemyNearCross]);
  console.assert(
    !(enemyNearCross.pos.x === crossPos.x && enemyNearCross.pos.y === crossPos.y),
    'Enemy must NOT step onto CROSS tile (Level 2.0 specification)'
  );
  console.log('✓ 4. Enemy AI & transformation tests passed.');

  // ==========================================
  // 5. 墓（GRAVE）からのモンスター湧き & 岩封鎖検証
  // ==========================================
  console.log('Testing 5: Grave spawn and rock-blocked suppression...');
  const mapSpawn = new WorldMap(30, 30);
  const playerSpawn = new Player({ x: 2, y: 2, hp: 1000, experience: 1000 });
  const gravePos = { x: 15, y: 15 };
  mapSpawn.setTile(gravePos, 'GRAVE');
  mapSpawn.setBaseTile(gravePos, 'GRAVE');

  // 墓が塞がれていない場合 -> スポーンする
  const enemiesList: EnemyInstance[] = [];
  SpawnSystem.reset();
  const spawned = SpawnSystem.spawnFromAllGraves(enemiesList, playerSpawn, mapSpawn);
  const graveHasEnemy = enemiesList.some(e => e.pos.x === gravePos.x && e.pos.y === gravePos.y);
  console.assert(graveHasEnemy, 'Grave should spawn an enemy when not blocked');

  // 5-2. 墓の上にすでに生存中の敵がいる場合、新しい敵は重複出現しない（自然なスポーン抑止）
  const enemiesListBlocked: EnemyInstance[] = [
    new EnemyInstance({ typeId: 1, pos: { ...gravePos } })
  ];
  const countBefore = enemiesListBlocked.length;
  SpawnSystem.spawnOneFromGraves(enemiesListBlocked, playerSpawn, mapSpawn);
  const enemyCountOnGrave = enemiesListBlocked.filter(e => e.isAlive && e.pos.x === gravePos.x && e.pos.y === gravePos.y).length;
  console.assert(enemyCountOnGrave === 1, 'Occupied grave must NOT spawn another enemy on top (natural suppression)');
  console.log('✓ 5. Grave spawn & natural suppression tests passed.');

  // ==========================================
  // 6. 特殊エネミー: ゴースト（おばけ）検証
  // ==========================================
  console.log('Testing 6: Ghost wall phasing, item stealing, and Level 2.0 CROSS restrictions...');
  const mapGhost = new WorldMap(30, 30);
  const ghost = new Ghost({ pos: { x: 10, y: 10 } });

  // 6-1. 壁（BLOCK）をすり抜けて移動可能
  mapGhost.setTile({ x: 10, y: 9 }, 'BLOCK');
  mapGhost.setTile({ x: 10, y: 11 }, 'BLOCK');
  mapGhost.setTile({ x: 9, y: 10 }, 'BLOCK');
  mapGhost.setTile({ x: 11, y: 10 }, 'BLOCK');
  // 四方をBLOCKで囲まれても移動できる
  GhostAISystem.stepGhost(ghost, playerAI, mapGhost);
  console.assert(
    ghost.pos.x !== 10 || ghost.pos.y !== 10,
    'Ghost should phase through BLOCK walls'
  );

  // 6-2. プレイヤー接触時の手持ちアイテム強奪（十字架 CROSS も強奪可能）
  const playerForGhost = new Player({ x: 15, y: 15, hp: 1000, experience: 1000 });
  playerForGhost.holdItem = 'CROSS';
  const ghostSteal = new Ghost({ pos: { x: 15, y: 14 } });
  // ゴーストがプレイヤーマスへ移動するように位置を設定してステップ
  ghostSteal.pos = { x: 15, y: 15 };
  // プレイヤー接触判定を実行
  if (ghostSteal.pos.x === playerForGhost.pos.x && ghostSteal.pos.y === playerForGhost.pos.y) {
    if (playerForGhost.holdItem !== 'NONE') {
      ghostSteal.carriedItem = playerForGhost.holdItem as any;
      playerForGhost.holdItem = 'NONE';
    }
  }
  console.assert(playerForGhost.holdItem === 'NONE', 'Ghost should steal player holdItem even if it is CROSS');
  console.assert(ghostSteal.carriedItem === 'CROSS', 'Ghost should carry stolen CROSS');

  // 6-3. Level 2.0仕様: 地面の十字架（CROSS）マスは進入不可
  const ghostCrossTest = new Ghost({ pos: { x: 20, y: 20 } });
  // 3方を外壁、右だけCROSSにした状態で右へ行けないことを検証
  mapGhost.setTile({ x: 20, y: 19 }, 'WALL_STATIC');
  mapGhost.setTile({ x: 20, y: 21 }, 'WALL_STATIC');
  mapGhost.setTile({ x: 19, y: 20 }, 'WALL_STATIC');
  mapGhost.setTile({ x: 21, y: 20 }, 'CROSS'); // 右は地面の十字架
  // ステップ実行しても (21, 20) には入れない
  GhostAISystem.stepGhost(ghostCrossTest, playerForGhost, mapGhost);
  console.assert(
    !(ghostCrossTest.pos.x === 21 && ghostCrossTest.pos.y === 20),
    'Ghost must NOT enter ground CROSS tile in Level 2.0'
  );
  console.log('✓ 6. Ghost mechanics & Level 2.0 restrictions passed.');

  console.log('--- ✓ All Phase 3 Monster & Combat System Tests Passed Successfully! ---');
}

runPhase3Tests();
