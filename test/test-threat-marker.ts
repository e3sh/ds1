import assert from 'assert';
import { Player } from '../src/models/Player.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { DragonPart } from '../src/models/Dragon.js';
import { ThreatEvaluator } from '../src/systems/ThreatEvaluator.js';
import { CombatSystem } from '../src/systems/CombatSystem.js';
import { GameEngine } from '../src/core/GameEngine.js';

console.log('--- Tactical Threat Marker & ThreatEvaluator Verification ---');

// Test 1: ONE_SHOT 一撃撃破ライン（先制反撃スキップ）
{
  console.log('Testing 1: ONE_SHOT (One-shot kill skips counter and drain)...');

  const player = new Player({ x: 0, y: 0, hp: 1000, experience: 1000 });
  player.strength = 1000;
  player.hasSword = true; // effectiveAttack = 2000

  // HP 50, DEF 0, ATK 999999 (即死攻撃力), STR吸収100, EXP吸収100, 壺強奪あり
  const enemy = new EnemyInstance({
    typeId: 1,
    pos: { x: 1, y: 0 },
    hp: 50,
    def: 0,
    atk: 999999,
  });

  const threat = ThreatEvaluator.evaluateThreat(player, {
    hp: enemy.hp,
    atk: enemy.atk,
    def: enemy.def,
    drainAtk: 100,
    drainExp: 100,
    stealPotion: true,
  });

  assert.strictEqual(
    threat,
    'ONE_SHOT',
    'Enemy with lethal attack and drain must be ONE_SHOT if killed in 1 hit.'
  );

  // CombatSystemの静的メソッド経由でも判定可能か確認
  assert.strictEqual(
    CombatSystem.evaluateThreat(player, {
      hp: enemy.hp,
      atk: enemy.atk,
      def: enemy.def,
      drainAtk: 100,
    }),
    'ONE_SHOT'
  );

  console.log('✓ 1. ONE_SHOT logic verified successfully.');
}

// Test 2: 動的相対性: 剣（SWORD）の着脱による盤面反転
{
  console.log('Testing 2: Dynamic relativity - Swapping SWORD flips threat level...');

  const player = new Player({ x: 0, y: 0, hp: 1000, experience: 1000 });
  player.strength = 1500;
  player.hasSword = true; // effectiveAttack = 1500

  // 敵: HP 1000, DEF 200, ATK 1200 (被ダメ: 200)
  const enemy = new EnemyInstance({
    typeId: 5,
    pos: { x: 1, y: 0 },
    hp: 1000,
    def: 200,
    atk: 1200,
  });

  // 剣所持時: 与ダメ = 1500 - 200 = 1300 >= 1000 -> turnsToKill = 1 -> ONE_SHOT!
  const threatWithSword = ThreatEvaluator.evaluateThreat(player, enemy);
  assert.strictEqual(
    threatWithSword,
    'ONE_SHOT',
    'With sword, player deals 1300 dmg and kills 1000 HP enemy in 1 hit (ONE_SHOT).'
  );

  // 剣を床に置いて鍵を持った瞬間 (hasSword = false -> effectiveAttack = 10)
  player.hasSword = false;
  player.holdItem = 'KEY';

  // 剣非所持時: 与ダメ = max(1, 10 - 200) = 1 (有効打なし), 被ダメ = 1200 - 1000 = 200 -> DANGER!
  const threatWithoutSword = ThreatEvaluator.evaluateThreat(player, enemy);
  assert.strictEqual(
    threatWithoutSword,
    'DANGER',
    'Dropping sword drops attack to 10; player deals only 1 dmg and takes 200 counter dmg (DANGER).'
  );

  console.log('✓ 2. SWORD dynamic relativity flip verified successfully.');
}

// Test 3: SAFE 有効打が入り被ダメ0（安全な育成源）
{
  console.log('Testing 3: SAFE (Effective damage and zero damage / no drain)...');

  const player = new Player({ x: 0, y: 0, hp: 1000, experience: 1500 });
  player.strength = 1100;
  player.hasSword = true; // effectiveAttack = 1100

  // 敵: HP 1500, DEF 600, ATK 1000 (被ダメ: 0, 特殊能力なし)
  // 与ダメ = 1100 - 600 = 500. turnsToKill = ceil(1500 / 500) = 3 (<= 6 -> 有効打あり)
  const enemy = new EnemyInstance({
    typeId: 2,
    pos: { x: 1, y: 0 },
    hp: 1500,
    def: 600,
    atk: 1000,
  });

  const threat = ThreatEvaluator.evaluateThreat(player, enemy);
  assert.strictEqual(
    threat,
    'SAFE',
    'Dealing 500 dmg (3 turns to kill) with 0 counter damage must be SAFE.'
  );

  console.log('✓ 3. SAFE logic verified successfully.');
}

// Test 4: STALEMATE (膠着状態、HPトレード、十字架所持)
{
  console.log('Testing 4: STALEMATE (Stalemate / trade / CROSS item)...');

  const player = new Player({ x: 0, y: 0, hp: 1000, experience: 2000 });
  player.strength = 10;
  player.hasSword = false; // effectiveAttack = 10

  // 4A: 入らず貰わない (膠着)
  // 敵: HP 5000, DEF 500, ATK 1000 (被ダメ: 0, 与ダメ: 1)
  const wallEnemy = new EnemyInstance({
    typeId: 8,
    pos: { x: 1, y: 0 },
    hp: 5000,
    def: 500,
    atk: 1000,
  });
  assert.strictEqual(
    ThreatEvaluator.evaluateThreat(player, wallEnemy),
    'STALEMATE',
    'Zero damage taken but minimum 1 damage dealt must be STALEMATE (stalemate wall).'
  );

  // 4B: 入り貰う (即死しないHPトレード)
  // 剣所持: effectiveAttack = 1100. 敵: HP 1500, DEF 600 (与ダメ 500, 3発で撃破), ATK 2300 (被ダメ 300 < 1000 HP)
  player.hasSword = true;
  player.strength = 1100;
  const tradeEnemy = new EnemyInstance({
    typeId: 12,
    pos: { x: 1, y: 0 },
    hp: 1500,
    def: 600,
    atk: 2300,
  });
  assert.strictEqual(
    ThreatEvaluator.evaluateThreat(player, tradeEnemy),
    'STALEMATE',
    'Effective damage dealt and non-lethal counter damage taken must be STALEMATE (HP trade).'
  );

  // 4C: 十字架（CROSS）所持
  player.holdItem = 'CROSS';
  assert.strictEqual(
    ThreatEvaluator.evaluateThreat(player, tradeEnemy),
    'STALEMATE',
    'Holding CROSS makes player invincible and unable to attack, which must be STALEMATE.'
  );

  console.log('✓ 4. STALEMATE logic verified successfully.');
}

// Test 5: DANGER (入らず被ダメ、または能力吸収被害あり)
{
  console.log('Testing 5: DANGER (Counter damage without effective attack / drain threat)...');

  const player = new Player({ x: 0, y: 0, hp: 1000, experience: 1000 });
  player.strength = 10;
  player.hasSword = false; // effectiveAttack = 10

  // 5A: 有効打なし + 被ダメあり (敵ATK 1200 -> 被ダメ 200)
  const dangerEnemy = new EnemyInstance({
    typeId: 6,
    pos: { x: 1, y: 0 },
    hp: 1000,
    def: 100,
    atk: 1200,
  });
  assert.strictEqual(
    ThreatEvaluator.evaluateThreat(player, dangerEnemy),
    'DANGER',
    'No effective damage and taking counter damage must be DANGER.'
  );

  // 5B: 有効打はあるが、2発撃破のため反撃を受け、STR吸収被害が発生する場合
  player.hasSword = true;
  player.strength = 500; // effectiveAttack = 1500 -> 与ダメ 1400 (HP 2000 なので 2発)
  player.experience = 2000; // 被ダメ 0
  const drainEnemy = {
    hp: 2000,
    def: 100,
    atk: 1000,
    drainAtk: 10,
  };
  assert.strictEqual(
    ThreatEvaluator.evaluateThreat(player, drainEnemy),
    'DANGER',
    'Taking STR drain on counter must be DANGER even if HP damage is 0.'
  );

  // 5C: 壺強奪（stealPotion）持ちでプレイヤーが魔力を持っている場合
  player.magic = 5;
  const stealEnemy = {
    hp: 2000,
    def: 100,
    atk: 1000,
    stealPotion: true,
  };
  assert.strictEqual(
    ThreatEvaluator.evaluateThreat(player, stealEnemy),
    'DANGER',
    'Taking potion steal on counter when player has magic must be DANGER.'
  );

  console.log('✓ 5. DANGER logic verified successfully.');
}

// Test 6: LETHAL (反撃1発でプレイヤー即死)
{
  console.log('Testing 6: LETHAL (Fatal 1-hit counter attack)...');

  const player = new Player({ x: 0, y: 0, hp: 500, experience: 1000 });
  player.strength = 1100;
  player.hasSword = true; // effectiveAttack = 1100

  // 敵: HP 5000, DEF 500, ATK 1600 (反撃被ダメ = 1600 - 1000 = 600 >= HP 500)
  const lethalEnemy = new EnemyInstance({
    typeId: 20,
    pos: { x: 1, y: 0 },
    hp: 5000,
    def: 500,
    atk: 1600,
  });

  assert.strictEqual(
    ThreatEvaluator.evaluateThreat(player, lethalEnemy),
    'LETHAL',
    'Counter damage (600) >= Player HP (500) must be LETHAL.'
  );

  // プレイヤーが家でHP回復して HP 800 になった場合: 被ダメ600 < 800 なので即死解除
  player.hp = 800;
  const threatAfterHeal = ThreatEvaluator.evaluateThreat(player, lethalEnemy);
  assert.notStrictEqual(
    threatAfterHeal,
    'LETHAL',
    'After healing above counter damage, enemy is no longer LETHAL.'
  );

  console.log('✓ 6. LETHAL logic verified successfully.');
}

// Test 7: ドラゴンの首（DragonPart）に対する判定
{
  console.log('Testing 7: Dragon Head threat evaluation...');

  const player = new Player({ x: 0, y: 0, hp: 1000, experience: 1000 });
  player.hasSword = true;

  // 初期状態: ドラゴンの左首 (HP 650,000 / ATK 600,000 / DEF 300,000)
  const leftHead: DragonPart = {
    type: 'LEFT_HEAD',
    pos: { x: 31, y: 32 },
    hp: 650000,
    maxHp: 650000,
    atk: 600000,
    def: 300000,
    isAlive: true,
    facingDir: 'DOWN',
  };

  const initialDragonThreat = ThreatEvaluator.evaluateThreat(player, leftHead);
  assert.strictEqual(
    initialDragonThreat,
    'LETHAL',
    'Initial player against Dragon head must be LETHAL (immediate death).'
  );

  // パワーストーンを大量奉納し、EXPとSTRがドラゴンを凌駕した場合
  player.experience = 650000; // 被ダメ 0
  player.strength = 1000000;   // effectiveAttack = 1001000 -> 与ダメ 701000 >= 650000 -> ONE_SHOT!
  const endgameDragonThreat = ThreatEvaluator.evaluateThreat(player, leftHead);
  assert.strictEqual(
    endgameDragonThreat,
    'ONE_SHOT',
    'Maxed out player can one-shot dragon head (ONE_SHOT).'
  );

  console.log('✓ 7. Dragon Head threat evaluation verified successfully.');
}

// Test 8: GameEngine マーカー表示切替トグル & TargetEnemyInfo 連携
{
  console.log('Testing 8: GameEngine toggleMarker and TargetEnemyInfo threatLevel...');

  const engine = new GameEngine(null);
  assert.strictEqual(engine.isMarkerEnabled(), true, 'Marker should be enabled (TACTICAL) by default.');

  engine.toggleMarker();
  assert.strictEqual(engine.isMarkerEnabled(), false, 'toggleMarker() should switch to RETRO (disabled).');

  engine.toggleMarker();
  assert.strictEqual(engine.isMarkerEnabled(), true, 'toggleMarker() should switch back to TACTICAL.');

  // TargetEnemyInfo に threatLevel が付与されていることを確認
  const enemy = new EnemyInstance({
    typeId: 1,
    pos: { x: 10, y: 10 },
    hp: 10,
    atk: 10,
    def: 0,
  });
  const info = engine.createTargetEnemyInfo(enemy);
  assert.ok(info.threatLevel, 'TargetEnemyInfo must include threatLevel.');
  assert.strictEqual(info.threatLevel, 'ONE_SHOT');

  console.log('✓ 8. GameEngine toggleMarker and TargetEnemyInfo verified successfully.');
}

// Test 9: 攻防2軸（3×3マトリクス）と「一撃だが一撃」「一撃だが貰う」「一撃・貰わない」の検証
{
  console.log('Testing 9: 3x3 Matrix ThreatEvaluationDetails (Safe One-Shot, Risky One-Shot, Lethal One-Shot)...');

  const player = new Player({ x: 0, y: 0, hp: 500, experience: 200 });
  player.strength = 1000;
  player.hasSword = true; // effectiveAttack = 2000

  // 9A: 一撃・貰わない (ONE_SHOT x NO_DAMAGE) - 真の安全ボーナス
  // 敵: HP 50, DEF 10, ATK 100 (被ダメ: 0, 特殊効果なし)
  const safeEnemy = { hp: 50, def: 10, atk: 100 };
  const safeDetails = ThreatEvaluator.evaluateThreatDetails(player, safeEnemy);
  assert.strictEqual(safeDetails.attackThreat, 'ONE_SHOT');
  assert.strictEqual(safeDetails.defenseThreat, 'NO_DAMAGE');
  assert.strictEqual(safeDetails.isRiskyOneShot, false);
  assert.strictEqual(safeDetails.isLethalOneShot, false);
  assert.strictEqual(safeDetails.overallThreat, 'ONE_SHOT');

  // 9B: 一撃だが貰う (ONE_SHOT x TAKES_DAMAGE) - 追走時の被弾リスク
  // 敵: HP 100, DEF 10, ATK 400 (被ダメ: 400 - 200 = 200 < 500 HP)
  const riskyEnemy = { hp: 100, def: 10, atk: 400 };
  const riskyDetails = ThreatEvaluator.evaluateThreatDetails(player, riskyEnemy);
  assert.strictEqual(riskyDetails.attackThreat, 'ONE_SHOT');
  assert.strictEqual(riskyDetails.defenseThreat, 'TAKES_DAMAGE');
  assert.strictEqual(riskyDetails.isRiskyOneShot, true);
  assert.strictEqual(riskyDetails.isLethalOneShot, false);
  assert.strictEqual(riskyDetails.damageToPlayer, 200);
  assert.strictEqual(riskyDetails.overallThreat, 'ONE_SHOT');

  // 能力吸収持ちで被ダメ0の場合も TAKES_DAMAGE かつ isRiskyOneShot となること
  const drainOneShotEnemy = { hp: 100, def: 10, atk: 100, drainAtk: 5 };
  const drainOneShotDetails = ThreatEvaluator.evaluateThreatDetails(player, drainOneShotEnemy);
  assert.strictEqual(drainOneShotDetails.attackThreat, 'ONE_SHOT');
  assert.strictEqual(drainOneShotDetails.defenseThreat, 'TAKES_DAMAGE');
  assert.strictEqual(drainOneShotDetails.isRiskyOneShot, true);
  assert.strictEqual(drainOneShotDetails.hasDrain, true);

  // 9C: 一撃だが一撃 (ONE_SHOT x LETHAL) - ガラスの剣（先手必須・敵先制で即死）
  // 敵: HP 150, DEF 0, ATK 800 (被ダメ: 800 - 200 = 600 >= 500 HP即死)
  const lethalOneShotEnemy = { hp: 150, def: 0, atk: 800 };
  const lethalOneShotDetails = ThreatEvaluator.evaluateThreatDetails(player, lethalOneShotEnemy);
  assert.strictEqual(lethalOneShotDetails.attackThreat, 'ONE_SHOT');
  assert.strictEqual(lethalOneShotDetails.defenseThreat, 'LETHAL');
  assert.strictEqual(lethalOneShotDetails.isRiskyOneShot, false);
  assert.strictEqual(lethalOneShotDetails.isLethalOneShot, true);
  assert.strictEqual(lethalOneShotDetails.damageToPlayer, 600);
  assert.strictEqual(lethalOneShotDetails.overallThreat, 'ONE_SHOT');

  // CombatSystem 経由での呼び出しも検証
  const combatDetails = CombatSystem.evaluateThreatDetails(player, lethalOneShotEnemy);
  assert.strictEqual(combatDetails.isLethalOneShot, true);

  // TargetEnemyInfo に threatDetails が付与されることを確認
  const engine = new GameEngine(null);
  const lethalEnemyInst = new EnemyInstance({
    typeId: 25,
    pos: { x: 5, y: 5 },
    hp: 150,
    def: 0,
    atk: 800,
  });
  // プレイヤーのステータスを調整
  (engine.getPlayer() as any).hp = 500;
  (engine.getPlayer() as any).experience = 200;
  (engine.getPlayer() as any).strength = 1000;
  (engine.getPlayer() as any).hasSword = true;
  const targetInfo = engine.createTargetEnemyInfo(lethalEnemyInst);
  assert.ok(targetInfo.threatDetails, 'TargetEnemyInfo must include threatDetails');
  assert.strictEqual(targetInfo.threatDetails?.isLethalOneShot, true);

  console.log('✓ 9. 3x3 Matrix ThreatEvaluationDetails verified successfully.');
}

console.log('--- ✓ All Tactical Threat Marker Tests Passed Successfully! ---');
