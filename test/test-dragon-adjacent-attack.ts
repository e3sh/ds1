import assert from 'node:assert';
import { Player } from '../src/models/Player.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { Dragon } from '../src/models/Dragon.js';
import { CombatSystem } from '../src/systems/CombatSystem.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { GameEngine } from '../src/core/GameEngine.js';

console.log('--- Dragon Head Adjacent Attack & Tail Strategy Verification ---');

// =========================================================================
// Case 1: 宝箱の上 (cx - 1, cy - 1) 等から首へ直線攻撃した際に反撃ダメージを受けること
// =========================================================================
console.log('Testing Case 1: Straight attack from chest positions takes counter damage...');
{
  const map = new WorldMap(64, 64);
  const dragon = new Dragon({ x: 32, y: 32 });
  // 左上宝箱: (31, 31)
  // 左首: (31, 32), 中央首: (32, 31)

  // 1-A. 左上宝箱 (31, 31) から左首 (31, 32) への直線攻撃 (DOWN)
  const player1 = new Player({ x: 31, y: 31, hp: 500000, experience: 100000 });
  player1.hasSword = true;
  player1.strength = 400000;
  const leftHead = dragon.heads[0]; // atk: 600,000, def: 300,000
  const expectedCounter1 = Math.max(0, leftHead.atk - player1.experience); // 600,000 - 100,000 = 500,000

  const combat1 = CombatSystem.resolvePlayerAttackDragon(player1, dragon, leftHead, 'DOWN', map);
  assert.strictEqual(combat1.attacked, true);
  assert.strictEqual(combat1.damageToPlayer, expectedCounter1, '直線方向(DOWN)からの攻撃は反撃ダメージを受けること');
  assert.strictEqual(player1.hp, 0, 'HPが反撃により0になること');
  assert.strictEqual(player1.deathInfo?.cause, 'DRAGON_HEAD');
  assert.strictEqual(player1.deathInfo?.dragonPartType, 'LEFT_HEAD');

  // 1-B. 左上宝箱 (31, 31) から中央首 (32, 31) への直線攻撃 (RIGHT)
  const player2 = new Player({ x: 31, y: 31, hp: 600000, experience: 200000 });
  player2.hasSword = true;
  player2.strength = 500000;
  const centerHead = dragon.heads[1]; // atk: 500,000, def: 400,000
  const expectedCounter2 = Math.max(0, centerHead.atk - player2.experience); // 500,000 - 200,000 = 300,000

  const combat2 = CombatSystem.resolvePlayerAttackDragon(player2, dragon, centerHead, 'RIGHT', map);
  assert.strictEqual(combat2.attacked, true);
  assert.strictEqual(combat2.damageToPlayer, expectedCounter2, '直線方向(RIGHT)からの攻撃は反撃ダメージを受けること');
  assert.strictEqual(player2.hp, 600000 - expectedCounter2);

  // 1-C. MovementSystem.tryMove 経由での宝箱上からの体当たり攻撃
  const player3 = new Player({ x: 31, y: 31, hp: 600000, experience: 200000 });
  player3.hasSword = true;
  player3.strength = 500000;
  const moved = MovementSystem.tryMove(player3, 'DOWN', map, [], dragon);
  assert.strictEqual(moved, true);
  assert.ok(MovementSystem.lastCombatResult !== null);
  assert.strictEqual(MovementSystem.lastCombatResult.damageToPlayer, 600000 - 200000, 'MovementSystem経由でも反撃ダメージを受けること');

  console.log('✓ Case 1 tests passed.');
}

// =========================================================================
// Case 2: 宝箱の上（首の隣接横）で待機・滞在した際、敵ターンにドラゴンの首から攻撃を受けること
// =========================================================================
console.log('Testing Case 2: Staying on chest position takes dragon head attack in enemy turn...');
{
  const engine = new GameEngine();
  const player = (engine as any).player as Player;
  const map = (engine as any).map as WorldMap;
  const dragon = (engine as any).dragon as Dragon;
  const cx = dragon.centerPos.x;
  const cy = dragon.centerPos.y;

  // プレイヤーを左上宝箱 (cx - 1, cy - 1) に配置
  player.pos = { x: cx - 1, y: cy - 1 };
  player.hp = 1000000;
  player.experience = 100000; // EXP 100,000
  (engine as any).state = 'PLAYING';

  // 2-A. 通常状態での待機: 隣接首（LEFT_HEAD: ATK 600,000 または CENTER_HEAD: ATK 500,000）から攻撃
  // ATK最大である LEFT_HEAD (600,000) が選ばれ、被ダメは 600,000 - 100,000 = 500,000
  const hpBefore = player.hp;
  engine.executeEnemyTurn();
  const damageTaken = hpBefore - player.hp;
  assert.strictEqual(damageTaken, 500000, '宝箱上に留まっていると敵ターンに首から500,000ダメージを受けること');

  // 2-B. 致死ダメージによる死亡と死因記録 (cause: DRAGON_HEAD)
  player.hp = 100;
  engine.executeEnemyTurn();
  assert.strictEqual(player.hp, 0, 'HPが0になること');
  assert.strictEqual(player.deathInfo?.cause, 'DRAGON_HEAD');
  assert.strictEqual(player.deathInfo?.dragonPartType, 'LEFT_HEAD');

  // 2-C. 十字架所持（CROSS）時は無敵であり首からの攻撃を受けないこと
  player.hp = 100000;
  player.deathInfo = null;
  player.holdItem = 'CROSS';
  engine.executeEnemyTurn();
  assert.strictEqual(player.hp, 100000, '十字架所持時は首からのダメージを受けないこと');
  player.holdItem = 'NONE';

  // 2-D. 飛行中（FLY）は首からの攻撃を受けないこと
  player.isFlying = true;
  engine.executeEnemyTurn();
  assert.strictEqual(player.hp, 100000, 'FLY飛行中は首からのダメージを受けないこと');
  player.isFlying = false;

  // 2-E. 左首が撃破済みの場合は、もう一方の隣接首（CENTER_HEAD）が攻撃してくること
  dragon.heads[0].isAlive = false; // LEFT_HEAD撃破
  player.hp = 1000000;
  player.deathInfo = null;
  const hpBeforeCenter = player.hp;
  engine.executeEnemyTurn();
  const damageFromCenter = hpBeforeCenter - player.hp;
  assert.strictEqual(damageFromCenter, 500000 - 100000, '左首撃破後は中央首(ATK 500,000)から攻撃を受けること');

  console.log('✓ Case 2 tests passed.');
}

// =========================================================================
// Case 3: FLYでしっぽ (cx, cy + 1) に乗って着地した後、斜め攻撃で反撃0で攻撃できること
// =========================================================================
console.log('Testing Case 3: Landing on tail via FLY and attacking heads diagonally with zero counter...');
{
  const engine = new GameEngine();
  const player = (engine as any).player as Player;
  const map = (engine as any).map as WorldMap;
  const dragon = (engine as any).dragon as Dragon;
  const cx = dragon.centerPos.x;
  const cy = dragon.centerPos.y;
  (engine as any).state = 'PLAYING';

  // 3-A. 通常歩行ではしっぽに進入すると初期位置付近へ弾き飛ばされる
  player.pos = { x: cx, y: cy + 2 }; // しっぽの直下
  const repulsed = MovementSystem.tryMove(player, 'UP', map, [], dragon);
  assert.strictEqual(repulsed, true);
  assert.notStrictEqual(player.pos.x === cx && player.pos.y === cy + 1, true, '歩行進入はしっぽに弾き飛ばされること');

  // 3-B. FLY状態なら弾かれずにしっぽの上 (cx, cy + 1) に進入・着地できる
  player.isFlying = true;
  player.pos = { x: cx, y: cy + 2 };
  const flyMoved = MovementSystem.tryMove(player, 'UP', map, [], dragon);
  assert.strictEqual(flyMoved, true);
  assert.deepStrictEqual(player.pos, { x: cx, y: cy + 1 }, 'FLY中はしっぽの上に乗れること');

  // FLY解除（着地）
  player.isFlying = false;
  player.hp = 100000;
  player.experience = 30000; // EXP 30,000 (首のATK 600,000 / 500,000より圧倒的に低い)
  player.canDiagonal = true; // 斜め移動可能
  player.hasSword = true;
  player.strength = 655350;

  // 3-C. しっぽの上はどの首とも上下左右に隣接していないため、敵ターンで首から攻撃を受けないこと
  const hpOnTail = player.hp;
  engine.executeEnemyTurn();
  assert.strictEqual(player.hp, hpOnTail, 'しっぽの上に着地して待機しても首からの攻撃を受けないこと');

  // 3-D. しっぽの上 (cx, cy + 1) から斜め上 (UP_LEFT) で左首 (cx - 1, cy) を死角攻撃
  const hpBeforeAttackLeft = player.hp;
  const leftHead = dragon.heads[0];
  const combatLeft = CombatSystem.resolvePlayerAttackDragon(player, dragon, leftHead, 'UP_LEFT', map);
  assert.strictEqual(combatLeft.attacked, true);
  assert.strictEqual(combatLeft.damageToPlayer, 0, 'しっぽからのUP_LEFT攻撃は反撃ダメージ0であること');
  assert.strictEqual(player.hp, hpBeforeAttackLeft, 'プレイヤーのHPが減っていないこと');

  // 3-E. しっぽの上 (cx, cy + 1) から斜め上 (UP_RIGHT) で右首 (cx + 1, cy) を死角攻撃
  const rightHead = dragon.heads[2];
  const hpBeforeAttackRight = player.hp;
  const combatRight = CombatSystem.resolvePlayerAttackDragon(player, dragon, rightHead, 'UP_RIGHT', map);
  assert.strictEqual(combatRight.attacked, true);
  assert.strictEqual(combatRight.damageToPlayer, 0, 'しっぽからのUP_RIGHT攻撃は反撃ダメージ0であること');
  assert.strictEqual(player.hp, hpBeforeAttackRight, 'プレイヤーのHPが減っていないこと');

  // 3-F. MovementSystem.tryMove 経由でもしっぽ上からの斜め攻撃で反撃0
  const hpBeforeMoveAttack = player.hp;
  dragon.heads[0].isAlive = true;
  dragon.heads[0].hp = 650000;
  const moveAttack = MovementSystem.tryMove(player, 'UP_LEFT', map, [], dragon);
  assert.strictEqual(moveAttack, true);
  assert.ok(MovementSystem.lastCombatResult !== null);
  assert.strictEqual(MovementSystem.lastCombatResult.damageToPlayer, 0, 'MovementSystem経由の斜め攻撃も反撃0であること');
  assert.strictEqual(player.hp, hpBeforeMoveAttack);

  console.log('✓ Case 3 tests passed.');
}

// =========================================================================
// Case 4: 首の外周斜めマスから斜め攻撃した際に反撃0で攻撃できること
// =========================================================================
console.log('Testing Case 4: Diagonal attacks from outer diagonal safe spots have zero counter...');
{
  const map = new WorldMap(64, 64);
  const dragon = new Dragon({ x: 32, y: 32 });
  const cx = 32;
  const cy = 32;

  // 4-A. 左首 (cx - 1, cy) の外周斜めマス (cx - 2, cy - 1) から DOWN_RIGHT 攻撃
  const player1 = new Player({ x: cx - 2, y: cy - 1, hp: 50000, experience: 20000 });
  player1.hasSword = true;
  player1.strength = 500000;
  const leftHead = dragon.heads[0];
  const c1 = CombatSystem.resolvePlayerAttackDragon(player1, dragon, leftHead, 'DOWN_RIGHT', map);
  assert.strictEqual(c1.attacked, true);
  assert.strictEqual(c1.damageToPlayer, 0, '(cx - 2, cy - 1) からの DOWN_RIGHT 攻撃は反撃0');
  assert.strictEqual(player1.hp, 50000);

  // 4-B. 中央首 (cx, cy - 1) の外周斜めマス (cx - 1, cy - 2) から DOWN_RIGHT 攻撃
  const player2 = new Player({ x: cx - 1, y: cy - 2, hp: 50000, experience: 20000 });
  player2.hasSword = true;
  player2.strength = 500000;
  const centerHead = dragon.heads[1];
  const c2 = CombatSystem.resolvePlayerAttackDragon(player2, dragon, centerHead, 'DOWN_RIGHT', map);
  assert.strictEqual(c2.attacked, true);
  assert.strictEqual(c2.damageToPlayer, 0, '(cx - 1, cy - 2) からの DOWN_RIGHT 攻撃は反撃0');
  assert.strictEqual(player2.hp, 50000);

  // 4-C. 中央首 (cx, cy - 1) の外周斜めマス (cx + 1, cy - 2) から DOWN_LEFT 攻撃
  const player3 = new Player({ x: cx + 1, y: cy - 2, hp: 50000, experience: 20000 });
  player3.hasSword = true;
  player3.strength = 500000;
  const c3 = CombatSystem.resolvePlayerAttackDragon(player3, dragon, centerHead, 'DOWN_LEFT', map);
  assert.strictEqual(c3.attacked, true);
  assert.strictEqual(c3.damageToPlayer, 0, '(cx + 1, cy - 2) からの DOWN_LEFT 攻撃は反撃0');
  assert.strictEqual(player3.hp, 50000);

  // 4-D. 右首 (cx + 1, cy) の外周斜めマス (cx + 2, cy - 1) から DOWN_LEFT 攻撃
  const player4 = new Player({ x: cx + 2, y: cy - 1, hp: 50000, experience: 20000 });
  player4.hasSword = true;
  player4.strength = 500000;
  const rightHead = dragon.heads[2];
  const c4 = CombatSystem.resolvePlayerAttackDragon(player4, dragon, rightHead, 'DOWN_LEFT', map);
  assert.strictEqual(c4.attacked, true);
  assert.strictEqual(c4.damageToPlayer, 0, '(cx + 2, cy - 1) からの DOWN_LEFT 攻撃は反撃0');
  assert.strictEqual(player4.hp, 50000);

  console.log('✓ Case 4 tests passed.');
}

console.log('--- ✓ All Dragon Adjacent Attack Tests Passed Successfully! ---');
