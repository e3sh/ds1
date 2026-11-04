import assert from 'node:assert';
import { Player } from '../src/models/Player.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { CombatSystem } from '../src/systems/CombatSystem.js';
import { EnemyAISystem } from '../src/systems/EnemyAISystem.js';
import { MagicSystem } from '../src/systems/MagicSystem.js';
import { PSGAudio } from '../src/audio/PSGAudio.js';
import { GameEngine } from '../src/core/GameEngine.js';

console.log('--- Turn Combat Arbitration & HOME Return Verification ---');

// ========================================================
// 1. 交互バトル調停 (Turn Combat Arbitration)
// ========================================================
console.log('Testing 1: Alternating turn combat arbitration...');
{
  const map = new WorldMap(30, 30);
  for (let x = 1; x <= 10; x++) {
    for (let y = 1; y <= 10; y++) {
      map.setBaseTile({ x, y }, 'EMPTY');
      map.setObject({ x, y }, 'NONE');
    }
  }

  // プレイヤー: HP 1000, STR 500, EXP 1000, 剣装備
  const player = new Player({ x: 5, y: 5, hp: 1000, experience: 1000 });
  player.hasSword = true;
  player.strength = 500;

  // 敵 (頑丈な戦士): HP 2000, DEF 100, ATK 1200
  const enemy = new EnemyInstance({ typeId: 2, pos: { x: 6, y: 5 }, hp: 2000, def: 100, atk: 1200 });

  // 1-1. プレイヤーターン: 体当たり攻撃
  const moved = MovementSystem.tryMove(player, 'RIGHT', map, [enemy]);
  assert.strictEqual(moved, true, '体当たりアクションが実行されること');

  // 与ダメ = 500 - 100 = 400
  assert.strictEqual(enemy.hp, 1600, '敵HPが与ダメ400分減少していること');
  assert.strictEqual(MovementSystem.lastCombatResult?.damageToEnemy, 400, '与ダメが400であること');

  // 交互調停の検証: プレイヤーターンでは被ダメは受けない（被ダメ 0）
  assert.strictEqual(MovementSystem.lastCombatResult?.damageToPlayer, 0, 'プレイヤーターンでの反撃被ダメは0であること');
  assert.strictEqual(player.hp, 1000, 'プレイヤーHPは減少しないこと');
  assert.strictEqual(player.pos.x, 5, '敵生存中は進入せず押し合い（その場足踏み）となること');
  assert.strictEqual(CombatSystem.engagedEnemy?.id, enemy.id, '敵が交戦相手として登録されること');

  // 1-2. 直後の敵ターン: 敵AIによる反撃手番
  EnemyAISystem.updateEnemies([enemy], player, map);
  assert.strictEqual(EnemyAISystem.lastCombatResults.length, 1, '敵の反撃攻撃が1件発生すること');
  const enemyAttack = EnemyAISystem.lastCombatResults[0];

  // 敵与ダメ = max(0, 1200 - 1000) = 200
  assert.strictEqual(enemyAttack.damageToPlayer, 200, '敵の反撃被ダメが200であること');
  assert.strictEqual(player.hp, 800, 'プレイヤーHPが800に減少すること');

  // 1-3. 特殊能力持ち（dora: STR吸収）の交互調停
  const playerDora = new Player({ x: 5, y: 5, hp: 5000, experience: 50000 });
  playerDora.hasSword = true;
  playerDora.strength = 10000;
  const doraEnemy = new EnemyInstance({ typeId: 9, pos: { x: 6, y: 5 } }); // HP 300000

  // プレイヤー体当たり時: STRはまだ吸われない
  MovementSystem.tryMove(playerDora, 'RIGHT', map, [doraEnemy]);
  assert.strictEqual(playerDora.strength, 10000, 'プレイヤーターンではSTRは吸われないこと');

  // 敵ターン反撃時: STRが3000吸われる
  EnemyAISystem.updateEnemies([doraEnemy], playerDora, map);
  assert.strictEqual(playerDora.strength, 7000, '敵の反撃手番でSTRが3000吸われること');

  console.log('✓ 1. Alternating turn combat arbitration tests passed.');
}

// ========================================================
// 2. 我が家帰還処理の完全化とイベント発火 (HOME Event & Heal)
// ========================================================
console.log('Testing 2: HOME return events & full healing...');
{
  const map = new WorldMap(30, 30);
  const homePos = { x: 10, y: 10 };
  map.setBaseTile(homePos, 'HOME');
  map.setRealHomePos(homePos);

  // 2-1. Player.healAtHome() の詳細リザルト検証
  const player = new Player({ x: 9, y: 10, hp: 200, experience: 1500 });
  player.gold = 5;
  player.holdItem = 'POWER_STONE';
  player.hasDeath = true;
  player.strength = 100;

  const result = player.healAtHome();
  assert.strictEqual(result.prevHp, 200, '回復前のHPが記録されていること');
  assert.strictEqual(result.goldConverted, 5, '所持コイン5枚が換算されること');
  assert.strictEqual(result.goldBonusHp, 50, 'コインによるHP上乗せが50であること');
  assert.strictEqual(result.newHp, 1550, '新HPが EXP(1500) + GOLD(50) = 1550 となること');
  assert.strictEqual(result.hpRestored, 1350, 'HP回復量が1350であること');
  assert.strictEqual(result.powerStoneConverted, true, 'パワーストーンが換算されたこと');
  assert.strictEqual(result.strGained, 1000, 'STRが1000増加したこと');
  assert.strictEqual(player.strength, 1100, 'プレイヤーSTRが1100になったこと');
  assert.strictEqual(player.holdItem, 'NONE', 'パワーストーンが消費されて手ぶらになったこと');
  assert.strictEqual(result.deathPurified, true, '死神が浄化されたこと');
  assert.strictEqual(player.hasDeath, false, 'プレイヤーの死神フラグが解除されたこと');

  // 2-2. MovementSystem.tryMove 経由での帰還イベント検知
  player.pos = { x: 9, y: 10 };
  player.hp = 500;
  player.gold = 3;
  MovementSystem.lastHomeEvent = null;

  MovementSystem.tryMove(player, 'RIGHT', map);
  assert.strictEqual(player.pos.x, 10, '我が家に入ったこと');
  assert.notStrictEqual(MovementSystem.lastHomeEvent, null, 'MovementSystem.lastHomeEvent が検知されること');
  assert.strictEqual(MovementSystem.lastHomeEvent?.goldConverted, 3, 'コイン3枚換算が記録されること');

  // 2-3. RETURN魔法経由での帰還イベント検知
  const playerReturn = new Player({ x: 2, y: 2, hp: 300, experience: 20000 });
  playerReturn.magic = 5;
  playerReturn.gold = 7;
  MovementSystem.lastHomeEvent = null;

  const castRes = MagicSystem.cast(playerReturn, 'RETURN', map);
  assert.strictEqual(castRes.success, true, 'RETURN魔法が成功すること');
  assert.strictEqual(playerReturn.pos.x, 10, '我が家のX座標へ帰還したこと');
  assert.strictEqual(playerReturn.pos.y, 10, '我が家のY座標へ帰還したこと');
  assert.notStrictEqual(MovementSystem.lastHomeEvent, null, 'RETURN魔法でも lastHomeEvent が記録されること');
  assert.strictEqual(MovementSystem.lastHomeEvent?.goldConverted, 7, 'コイン7枚換算が記録されること');

  // 2-4. PSGAudio.playHomeHeal() のヘッドレス安全呼び出し
  const audio = PSGAudio.getInstance();
  assert.doesNotThrow(() => {
    audio.playHomeHeal();
  }, 'playHomeHeal should execute safely in headless environment');

  console.log('✓ 2. HOME return events & full healing tests passed.');
}

// ========================================================
// 3. 対峙モンスター情報 (Target Enemy) の捕捉・更新・クリア
// ========================================================
console.log('Testing 3: Target enemy tracking, updating and clearing...');
{
  const mockCanvas = {
    getContext: () => ({
      fillRect: () => {},
      strokeRect: () => {},
      drawImage: () => {},
      fillText: () => {},
      measureText: () => ({ width: 0 }),
      imageSmoothingEnabled: false,
    }),
  } as unknown as HTMLCanvasElement;
  const engine = new GameEngine(mockCanvas);
  const player = engine.getPlayer();
  player.hasSword = true;
  player.strength = 1000;

  // 3-1. 敵インスタンスからのターゲット情報生成
  const monster = new EnemyInstance({ typeId: 5, pos: { x: 9, y: 8 }, hp: 1200 }); // monstir (壺強奪)
  const targetInfo = engine.createTargetEnemyInfo(monster);

  assert.strictEqual(targetInfo.name, 'monstir');
  assert.strictEqual(targetInfo.stealPotion, true, '壺強奪フラグが反映されること');
  assert.strictEqual(targetInfo.hp, 1200);
  assert.strictEqual(targetInfo.maxHp, 1200);

  // 3-2. ターゲットの設定と更新
  engine.setTargetEnemy(monster);
  assert.strictEqual(engine.getTargetEnemyInfo()?.name, 'monstir', 'ターゲット敵として捕捉されること');

  // 3-3. ダメージを受けた時の同期更新
  monster.takeDamage(400);
  assert.strictEqual(monster.hp, 800);
  engine.updateTargetTracking();
  assert.strictEqual(engine.getTargetEnemyInfo()?.hp, 800, 'リアルタイムにHPが同期されること');

  // 3-4. 敵撃破時の自動クリア
  monster.takeDamage(800);
  assert.strictEqual(monster.isAlive, false, '敵が死亡');
  engine.updateTargetTracking();
  assert.strictEqual(engine.getTargetEnemyInfo(), null, '敵死亡時にターゲットがクリアされること');

  console.log('✓ 3. Target enemy tracking, updating and clearing tests passed.');
}

console.log('--- ✓ All Combat and HOME Return Tests Passed Successfully! ---');
