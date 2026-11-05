import assert from 'assert';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { GameEngine } from '../src/core/GameEngine.js';
import { EnemyInstance } from '../src/models/Enemy.js';

console.log('--- AutoPlayBot Threat Evaluation & POTION Stock Priority Verification ---');

// 1. フィールド全体の敵脅威度（LETHAL敵）存在時の決戦移行抑止テスト
{
  console.log('Testing 1: Defense ready is withheld when lethal enemy exists on field...');
  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  const engine = new GameEngine({ headless: true });
  engine.startGame();
  const player = engine.getPlayer();
  const map = engine.getMap();
  const dragon = engine.getDragon();

  player.hasSword = true;
  player.strength = 450000;
  player.experience = 350000;
  player.canDiagonal = true;
  player.magic = 3;
  player.hp = 10000;
  player.maxHp = 10000;

  // 強敵（サイクロプス: ATK 450,000）を配置 -> player.experience=350,000 では被ダメ 100,000 >= HP 10,000 なので LETHAL!
  const cyclops = new EnemyInstance({ typeId: 28, pos: { x: 15, y: 15 } });
  const enemies = [cyclops];

  bot.setPhase('POWER_RUSH');
  (bot as any).updatePhase(player, dragon, map, enemies);

  assert.strictEqual(bot.defenseReady, false, 'DefenseReady should remain false when lethal enemy exists');
  assert.strictEqual(bot.currentPhase, 'POWER_RUSH', 'Should stay in POWER_RUSH to farm further EXP');

  // 防御力(EXP)を 500,000 に強化 -> サイクロプスからの被ダメ 0 になり安全化
  player.experience = 500000;
  (bot as any).updatePhase(player, dragon, map, enemies);

  assert.strictEqual(bot.defenseReady, true, 'DefenseReady should become true once defense is sufficient');
  console.log('✓ 1. Field lethal enemy threat assessment verified.');
}

// 2. 鍵所持時のPOTION最優先およびコイン回収制限テスト
{
  console.log('Testing 2: KEY holder prioritizes POTION over COIN and restricts COIN pickup...');
  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  const engine = new GameEngine(null, { seed: 12345 });
  engine.startGame();
  const player = engine.getPlayer();
  const map = engine.getMap();

  // 敵・アイテムをクリアして純粋なアイテム優先度を検証
  engine.getEnemies().length = 0;
  for (let dy = -2; dy <= 7; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const p = { x: 20 + dx, y: 20 + dy };
      map.setItem(p, 'NONE');
      map.setObject(p, 'NONE');
      map.setBaseTile(p, 'EMPTY');
    }
  }

  player.pos = { x: 20, y: 20 };
  player.hasSword = true;
  player.holdItem = 'KEY';
  player.strength = 10000;
  player.experience = 5000;
  player.magic = 0; // MP枯渇状態！
  player.hp = 5000;
  player.maxHp = 5000;

  bot.setPhase('POWER_RUSH');

  // 近傍に POTION (距離 5) と COIN (距離 2) を配置
  map.setItem({ x: 20, y: 22 }, 'COIN');
  map.setItem({ x: 20, y: 25 }, 'POTION');

  const action = bot.decideAction(engine);

  // MPが0のため、近傍COINではなくPOTION回収（またはPOTIONへ向かう行動）が優先され、COINのために鍵を置かないこと
  assert.ok(bot.currentTargetDesc.includes('ポーション') || bot.currentTargetDesc.includes('宝箱'),
    `Expected POTION or CHEST priority under low MP, got: ${bot.currentTargetDesc}`);
  assert.strictEqual(bot.currentTargetDesc.includes('コイン'), false, 'Should not prioritize COIN when MP is 0');

  console.log('✓ 2. POTION priority and coin restriction verified.');
}

// 3. ドラゴン首攻撃前の安全確認（HP低下時の我が家回復・MP低下時の補給優先）
{
  console.log('Testing 3: Dragon slay safety check (home heal on low HP, potion on low MP)...');
  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  const engine = new GameEngine({ headless: true });
  engine.startGame();
  const player = engine.getPlayer();
  const map = engine.getMap();
  const dragon = engine.getDragon();

  player.hasSword = true;
  player.strength = 500000;
  player.experience = 500000;
  player.canDiagonal = true;

  // 首の斜め隣接マスに配置
  const head = dragon.heads[0];
  player.pos = { x: head.pos.x - 1, y: head.pos.y - 1 };

  // A. HPが低い場合 (30%): 首を殴らず我が家へ帰還行動
  player.hp = 300;
  player.maxHp = 1000;
  player.magic = 3;

  bot.setPhase('DRAGON_SLAY');
  const actionLowHp = (bot as any).actDragonSlay(player, map, dragon, []);
  assert.ok(bot.currentTargetDesc.includes('我が家'), `Should retreat to HOME when HP is low, got: ${bot.currentTargetDesc}`);

  // B. HP満タンだが MPが0の場合: 首を殴らず近傍POTION回収
  player.hp = 1000;
  player.magic = 0;
  player.holdItem = 'NONE';
  map.setItem({ x: player.pos.x + 2, y: player.pos.y }, 'POTION');

  const actionLowMp = (bot as any).actDragonSlay(player, map, dragon, []);
  assert.ok(bot.currentTargetDesc.includes('MP補給') || bot.currentTargetDesc.includes('ポーション'),
    `Should prioritize MP supply before slaying dragon, got: ${bot.currentTargetDesc}`);

  // C. HP・MPともに十分な場合: 首への直接攻撃を実行！
  player.magic = 3;
  const actionReady = (bot as any).actDragonSlay(player, map, dragon, []);
  assert.strictEqual(actionReady.type, 'MOVE', 'Should execute attack move on dragon head');
  assert.strictEqual(actionReady.dir, 'DOWN_RIGHT', 'Direction should point to diagonal dragon head');

  console.log('✓ 3. Dragon slay safety checks verified successfully.');
}

console.log('--- ✓ All AutoPlayBot Threat & POTION Verification Tests PASSED! ---');
