import assert from 'node:assert';
import { Player } from '../src/models/Player.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { Dragon } from '../src/models/Dragon.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { CombatSystem } from '../src/systems/CombatSystem.js';
import { DOMUIManager } from '../src/view/DOMUIManager.js';
import { GameEngine } from '../src/core/GameEngine.js';

console.log('--- Phase 7: Cause of Death & Fatal Tracking Verification ---');

// Test 1: モンスターの攻撃（敵手番）による致命傷トラッキング
{
  console.log('Testing 1: Monster direct attack death tracking...');
  const player = new Player({ hp: 50, experience: 100 });
  const enemy = new EnemyInstance({
    id: 'enemy_test_1',
    typeId: 5,
    name: 'MONSTER_A',
    displayName: 'NO.05 モンステア',
    color: '#ff4444',
    hp: 500,
    maxHp: 500,
    atk: 300,
    def: 50,
    expReward: 100,
    dropItem: 'SWORD',
    isSpecial: false,
    specialType: null,
    moveInterval: 2,
    pos: { x: 5, y: 5 },
  });

  // 敵の攻撃: atk(300) - player.exp(100) = 200ダメージ > player.hp(50)
  const result = CombatSystem.resolveEnemyAttack(enemy, player);
  assert.strictEqual(player.hp, 0, 'Player HP should be 0');
  assert.ok(player.deathInfo !== null, 'deathInfo should be recorded');
  assert.strictEqual(player.deathInfo.cause, 'MONSTER_ATTACK', 'Cause should be MONSTER_ATTACK');
  assert.strictEqual(player.deathInfo.enemyTypeId, 5, 'enemyTypeId should be 5');
  assert.strictEqual(player.deathInfo.enemyDisplayName, enemy.displayName);
  assert.strictEqual(player.deathInfo.damage, 200, 'Damage should be 200');
  assert.ok(player.deathInfo.message.includes(enemy.displayName), 'Message should contain enemy name');
  console.log('✓ 1. Monster attack death tracking passed.');
}

// Test 2: モンスター反撃による致命傷トラッキング
{
  console.log('Testing 2: Monster counter-attack death tracking...');
  const player = new Player({ hp: 30, experience: 50 });
  const enemy = new EnemyInstance({
    id: 'enemy_test_2',
    typeId: 10,
    name: 'HEAVY_BEAST',
    displayName: 'NO.10 ビースト',
    color: '#aa22ee',
    hp: 800,
    maxHp: 800,
    atk: 200,
    def: 50,
    expReward: 150,
    dropItem: 'COIN',
    isSpecial: false,
    specialType: null,
    moveInterval: 2,
    pos: { x: 5, y: 6 },
  });

  // 即時反撃モード: enemy.atk(200) - player.exp(50) = 150ダメージ > hp(30)
  CombatSystem.resolvePlayerAttack(player, enemy, true);
  assert.strictEqual(player.hp, 0, 'Player HP should be 0');
  assert.ok(player.deathInfo !== null, 'deathInfo should be recorded');
  assert.strictEqual(player.deathInfo.cause, 'MONSTER_COUNTER');
  assert.strictEqual(player.deathInfo.enemyTypeId, 10);
  assert.strictEqual(player.deathInfo.damage, 150);
  assert.ok(player.deathInfo.message.includes('反撃'));
  console.log('✓ 2. Monster counter-attack death tracking passed.');
}

// Test 3: ドラゴン首への攻撃時の反撃による致命傷
{
  console.log('Testing 3: Dragon head counter death tracking...');
  const player = new Player({ hp: 100, experience: 200 });
  const map = new WorldMap();
  const dragon = new Dragon({ x: 32, y: 32 });
  const centerHead = dragon.heads[1]; // CENTER_HEAD: atk 500,000 (Level 2.0仕様)

  // 正面（UP）から攻撃 -> 首から反撃ダメージ: 500,000 - 200 = 499,800 > hp(100)
  CombatSystem.resolvePlayerAttackDragon(player, dragon, centerHead, 'UP', map);
  assert.strictEqual(player.hp, 0);
  assert.ok(player.deathInfo !== null);
  assert.strictEqual(player.deathInfo.cause, 'DRAGON_HEAD');
  assert.strictEqual(player.deathInfo.dragonPartType, 'CENTER_HEAD');
  assert.strictEqual(player.deathInfo.damage, 499800);
  assert.ok(player.deathInfo.message.includes('ドラゴンの首'));
  console.log('✓ 3. Dragon head counter death tracking passed.');
}

// Test 4: ドラゴンの火炎弾直撃による致命傷
{
  console.log('Testing 4: Dragon fireball direct hit death tracking...');
  const player = new Player({ hp: 40, experience: 500 });
  player.pos = { x: 32, y: 25 };
  const map = new WorldMap();
  const dragon = new Dragon({ x: 32, y: 32 });

  // 火炎弾を直接プレイヤーの1マス手前に配置して進行させる
  dragon.fireballs = [
    {
      id: 'fb_lethal_test',
      pos: { x: 32, y: 26 },
      dir: 'UP',
      damage: 150,
      isAlive: true,
    },
  ];

  dragon.updateFireballs(player, map);
  assert.strictEqual(player.hp, 0);
  assert.ok(player.deathInfo !== null);
  assert.strictEqual(player.deathInfo.cause, 'FIREBALL');
  assert.strictEqual(player.deathInfo.damage, 150);
  assert.ok(player.deathInfo.message.includes('火炎弾'));
  console.log('✓ 4. Dragon fireball death tracking passed.');
}

function createMockCanvas(): HTMLCanvasElement {
  return {
    getContext: () => ({
      fillRect: () => {},
      strokeRect: () => {},
      drawImage: () => {},
      fillText: () => {},
      measureText: () => ({ width: 0 }),
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      scale: () => {},
    }),
  } as unknown as HTMLCanvasElement;
}

// Test 5: 探索断念（GIVE UP）の死因トラッキング
{
  console.log('Testing 5: GIVE UP death tracking...');
  const engine = new GameEngine(createMockCanvas());
  (engine as any).state = 'PLAYING';
  engine.handleGiveUp();

  const player = (engine as any).player as Player;
  assert.strictEqual((engine as any).state, 'GAMEOVER');
  assert.ok(player.deathInfo !== null);
  assert.strictEqual(player.deathInfo.cause, 'GIVE_UP');
  assert.strictEqual(player.deathInfo.damage, 0);
  assert.ok(player.deathInfo.message.includes('GIVE UP'));
  console.log('✓ 5. GIVE UP death tracking passed.');
}

// Test 6: 我が家帰還およびゲームリセット時の死因クリア検証
{
  console.log('Testing 6: Death info clearing on home return / reset...');
  const player = new Player({ hp: 100 });
  player.recordDeath(100, { cause: 'UNKNOWN' });
  assert.ok(player.deathInfo !== null);

  // 我が家帰還での回復
  player.healAtHome();
  assert.strictEqual(player.deathInfo, null, 'deathInfo should be cleared on healAtHome');

  // リセット
  const engine = new GameEngine(createMockCanvas());
  (engine as any).player.recordDeath(50, { cause: 'UNKNOWN' });
  assert.ok((engine as any).player.deathInfo !== null);
  engine.resetGame();
  assert.strictEqual((engine as any).player.deathInfo, null, 'deathInfo should be cleared on resetGame');
  console.log('✓ 6. Death info clearing verified.');
}

// Test 7: DOMUIManager での致命傷ログ & ゲームオーバー画面表示
{
  console.log('Testing 7: DOMUIManager fatal log & gameover modal rendering...');
  const domUI = new DOMUIManager('test-container');
  const player = new Player({ hp: 0, experience: 2500 });
  player.crowns = 2;
  player.gold = 350;
  player.hasSword = true;
  player.holdItem = 'RING';
  player.recordDeath(350, {
    cause: 'MONSTER_ATTACK',
    enemyDisplayName: 'NO.05 モンステア',
    enemyTypeId: 5,
    damage: 350,
  }, 48);

  // fatal ログ追加
  domUI.addLog(`☠ 【致命傷】${player.deathInfo?.message}`, 'fatal');

  // GAMEOVER 状態遷移（ヘッドレス環境で例外が出ないこと）
  domUI.setGameState('GAMEOVER', player, 12, 48);

  assert.ok(true, 'DOMUIManager rendered GAMEOVER state without exceptions');
  console.log('✓ 7. DOMUIManager fatal log & gameover rendering passed.');
}

console.log('--- ✓ All Phase 7 Cause of Death Tests Passed Successfully! ---');
