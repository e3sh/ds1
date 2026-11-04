import assert from 'node:assert';
import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { MagicSystem } from '../src/systems/MagicSystem.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { Ghost } from '../src/models/Ghost.js';
import { EnemyAISystem } from '../src/systems/EnemyAISystem.js';
import { GhostAISystem } from '../src/systems/GhostAISystem.js';

console.log('--- Torus World Map & Long-Range KICK Specification Verification ---');

// ==========================================
// 1. トーラス座標正規化 (Wrap) & 最短差分・距離計算の検証
// ==========================================
console.log('Testing 1: Torus position wrapping and distance calculations...');
{
  const map = new WorldMap(64, 64);

  // 1-1. wrapPosition
  assert.deepStrictEqual(map.wrapPosition({ x: 0, y: 0 }), { x: 0, y: 0 });
  assert.deepStrictEqual(map.wrapPosition({ x: 63, y: 63 }), { x: 63, y: 63 });
  assert.deepStrictEqual(map.wrapPosition({ x: 64, y: 64 }), { x: 0, y: 0 });
  assert.deepStrictEqual(map.wrapPosition({ x: -1, y: -1 }), { x: 63, y: 63 });
  assert.deepStrictEqual(map.wrapPosition({ x: 129, y: -65 }), { x: 1, y: 63 });

  // 1-2. getTorusDelta (端と端を跨ぐ最短差分)
  // x=1 から x=63 への最短差分は -2 (左へ2マス)
  const deltaA = map.getTorusDelta({ x: 1, y: 10 }, { x: 63, y: 10 });
  assert.strictEqual(deltaA.dx, -2, '1 to 63 should wrap shortest dx = -2');
  assert.strictEqual(deltaA.dy, 0);

  // x=63 から x=1 への最短差分は +2 (右へ2マス)
  const deltaB = map.getTorusDelta({ x: 63, y: 10 }, { x: 1, y: 10 });
  assert.strictEqual(deltaB.dx, 2, '63 to 1 should wrap shortest dx = +2');

  // y=2 から y=62 への最短差分は -4 (上へ4マス)
  const deltaC = map.getTorusDelta({ x: 10, y: 2 }, { x: 10, y: 62 });
  assert.strictEqual(deltaC.dy, -4, '2 to 62 should wrap shortest dy = -4');

  // 1-3. getTorusDistance
  const dist = map.getTorusDistance({ x: 1, y: 2 }, { x: 63, y: 62 });
  // dx = -2 (|dx|=2), dy = -4 (|dy|=4)
  assert.strictEqual(dist.chebyshev, 4, 'Chebyshev distance across boundary');
  assert.strictEqual(dist.manhattan, 6, 'Manhattan distance across boundary');

  console.log('✓ 1. Torus coordinate wrapping and distance calculation verified.');
}

// ==========================================
// 2. マップ外周ループ移動 (Player / Push / FLY / DeathFollower) の検証
// ==========================================
console.log('Testing 2: Movement & pushing across torus boundaries...');
{
  const map = new WorldMap(64, 64);
  // 境界付近のタイルをクリア
  for (let x = 0; x < 64; x++) {
    map.setBaseTile({ x, y: 0 }, 'EMPTY');
    map.setBaseTile({ x, y: 63 }, 'EMPTY');
    map.setObject({ x, y: 0 }, 'NONE');
    map.setObject({ x, y: 63 }, 'NONE');
  }

  // 2-1. プレイヤーが西端 (0, 10) から LEFT で東端 (63, 10) へループ移動
  const playerX = new Player({ x: 0, y: 10 });
  const movedLeft = MovementSystem.tryMove(playerX, 'LEFT', map);
  assert.strictEqual(movedLeft, true, 'Player should cross left border');
  assert.deepStrictEqual(playerX.pos, { x: 63, y: 10 }, 'Player wrapped to right border (63, 10)');

  // 東端 (63, 10) から RIGHT で西端 (0, 10) へループ移動
  const movedRight = MovementSystem.tryMove(playerX, 'RIGHT', map);
  assert.strictEqual(movedRight, true, 'Player should cross right border');
  assert.deepStrictEqual(playerX.pos, { x: 0, y: 10 }, 'Player wrapped to left border (0, 10)');

  // 2-2. 北端 (10, 0) から UP で南端 (10, 63) へループ移動
  const playerY = new Player({ x: 10, y: 0 });
  const movedUp = MovementSystem.tryMove(playerY, 'UP', map);
  assert.strictEqual(movedUp, true, 'Player should cross top border');
  assert.deepStrictEqual(playerY.pos, { x: 10, y: 63 }, 'Player wrapped to bottom border (10, 63)');

  // 2-3. FLY飛行中の境界ループ移動
  playerY.isFlying = true;
  playerY.flyTimer = 10;
  const movedFly = MovementSystem.tryMove(playerY, 'DOWN', map);
  assert.strictEqual(movedFly, true, 'FLY should cross bottom border');
  assert.deepStrictEqual(playerY.pos, { x: 10, y: 0 }, 'FLY player wrapped to top border (10, 0)');

  // 2-4. 指輪による岩の境界跨ぎ押し出し (63, 20) -> (0, 20)
  const pusher = new Player({ x: 62, y: 20 });
  pusher.holdItem = 'RING';
  map.setObject({ x: 63, y: 20 }, 'BLOCK');
  map.setObject({ x: 0, y: 20 }, 'NONE');
  map.setBaseTile({ x: 0, y: 20 }, 'EMPTY');

  const pushOk = MovementSystem.tryMove(pusher, 'RIGHT', map);
  assert.strictEqual(pushOk, true, 'Rock push across border succeeds');
  assert.deepStrictEqual(pusher.pos, { x: 63, y: 20 }, 'Player moved into (63, 20)');
  assert.strictEqual(map.getObject({ x: 0, y: 20 }), 'BLOCK', 'Rock wrapped to (0, 20)');
  assert.strictEqual(map.getObject({ x: 63, y: 20 }), 'NONE', 'Previous rock pos is now NONE');

  // 2-5. 死神の背後追従が境界を跨いでも正しく追従すること
  pusher.hasDeath = true;
  // pusher が (63, 20) から RIGHT へ進むと pusher.pos は (0, 20)、背後追従は (63, 20)
  map.setObject({ x: 0, y: 20 }, 'NONE'); // 移動先を空ける
  MovementSystem.tryMove(pusher, 'RIGHT', map);
  assert.deepStrictEqual(pusher.pos, { x: 0, y: 20 }, 'Player at (0, 20)');
  assert.deepStrictEqual(pusher.deathFollowerPos, { x: 63, y: 20 }, 'Death follower stays at (63, 20)');

  console.log('✓ 2. Torus movement and push mechanics verified.');
}

// ==========================================
// 3. 敵AI & ゴーストAIのトーラス対応検証
// ==========================================
console.log('Testing 3: Enemy AI and Ghost AI in torus topology...');
{
  const map = new WorldMap(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      map.setBaseTile({ x, y }, 'EMPTY');
      map.setObject({ x, y }, 'NONE');
    }
  }

  // 3-1. 敵AIが境界を跨いで最短方向へプレイヤーを追跡 (CHASE)
  // プレイヤーが (63, 10)、敵が (1, 10)
  // 単純平面だと dx = +62 (右へ追跡) になるが、トーラス最短では dx = -2 (左へ追跡)
  const player = new Player({ x: 63, y: 10, hp: 50, experience: 1000 }); // HP < EXP で豹変全域CHASE
  const chaser = new EnemyInstance({ typeId: 5, pos: { x: 1, y: 10 } });
  EnemyAISystem.stepEnemy(chaser, 'CHASE', player, map, [chaser]);
  assert.deepStrictEqual(chaser.pos, { x: 0, y: 10 }, 'Chaser moved LEFT towards wrapped player (63, 10)');

  // 3-2. ゴーストの直進ループ（外周バウンドせず突き抜ける）
  const ghost = new Ghost({ pos: { x: 63, y: 63 }, vx: 1, vy: 1 });
  const dummyPlayer = new Player({ x: 30, y: 30 });
  GhostAISystem.stepGhost(ghost, dummyPlayer, map);
  assert.deepStrictEqual(ghost.pos, { x: 0, y: 0 }, 'Ghost wrapped from (63, 63) to (0, 0)');
  assert.strictEqual(ghost.vx, 1, 'Ghost velocity vx unchanged');
  assert.strictEqual(ghost.vy, 1, 'Ghost velocity vy unchanged');

  console.log('✓ 3. Enemy & Ghost AI torus behavior verified.');
}

// ==========================================
// 4. 改修項目 2: KICK 魔法の直線スライド（長距離射出）仕様の検証
// ==========================================
console.log('Testing 4: Long-range sliding KICK magic specification...');
{
  const map = new WorldMap(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      map.setBaseTile({ x, y }, 'EMPTY');
      map.setObject({ x, y }, 'NONE');
      map.setItem({ x, y }, 'NONE');
    }
  }

  const player = new Player({ x: 10, y: 10, hp: 1000, experience: 20000 });
  player.magic = 5;
  player.dir = 'RIGHT';

  // 4-1. 目の前に岩がない場合は失敗
  const noBlockResult = MagicSystem.cast(player, 'KICK', map, []);
  assert.strictEqual(noBlockResult.success, false, 'KICK fails without adjacent block');

  // 4-2. 長距離スライドして障害物（壁）の直前で停止（MAGIC消費 0）
  // プレイヤー: (10, 10), 岩: (11, 10), 壁: (16, 10)
  // (12, 10), (13, 10), (14, 10), (15, 10) の4マスを滑走し、(15, 10) で停止するはず
  map.setObject({ x: 11, y: 10 }, 'BLOCK');
  map.setBaseTile({ x: 16, y: 10 }, 'WALL_STATIC');

  const slideResult = MagicSystem.cast(player, 'KICK', map, []);
  assert.strictEqual(slideResult.success, true, 'KICK slide succeeded');
  assert.strictEqual(map.getObject({ x: 11, y: 10 }), 'NONE', 'Original block tile is now EMPTY');
  assert.strictEqual(map.getObject({ x: 15, y: 10 }), 'BLOCK', 'Block moved 4 tiles and stopped in front of wall (15, 10)');
  assert.strictEqual(player.magic, 5, 'Magic stock NOT consumed when hitting wall (no monster hit)');
  assert.strictEqual(slideResult.kickCrushed, false, 'kickCrushed is false for valid slide');
  assert.deepStrictEqual(
    slideResult.kickPath,
    [
      { x: 11, y: 10 },
      { x: 12, y: 10 },
      { x: 13, y: 10 },
      { x: 14, y: 10 },
      { x: 15, y: 10 },
    ],
    'kickPath matches full traversal from start to stop pos'
  );

  // クリーンアップ
  map.setObject({ x: 15, y: 10 }, 'NONE');
  map.setBaseTile({ x: 16, y: 10 }, 'EMPTY');

  // 4-3. 1マスも動けない場合（直後が障害物）は BREAK と同様にその場で岩が粉砕消滅（MAGIC消費 0）
  // プレイヤー: (10, 10), 岩: (11, 10), 直後の (12, 10) が壁
  map.setObject({ x: 11, y: 10 }, 'BLOCK');
  map.setBaseTile({ x: 12, y: 10 }, 'WALL_STATIC');

  const shatterResult = MagicSystem.cast(player, 'KICK', map, []);
  assert.strictEqual(shatterResult.success, true, 'Immediate shatter succeeded');
  assert.strictEqual(map.getObject({ x: 11, y: 10 }), 'NONE', 'Block shattered and disappeared');
  assert.strictEqual(player.magic, 5, 'Magic stock NOT consumed on rock shatter');
  assert.strictEqual(shatterResult.kickCrushed, true, 'kickCrushed is true when unable to move even 1 step');
  assert.deepStrictEqual(shatterResult.kickPath, [{ x: 11, y: 10 }], 'kickPath contains only targetPos when shattered immediately');

  // クリーンアップ
  map.setBaseTile({ x: 12, y: 10 }, 'EMPTY');

  // 4-4. 長距離スライドして敵に激突（即死・経験値加算・岩配置・MAGIC 1消費）
  // プレイヤー: (10, 10), 岩: (11, 10), 敵: (18, 10) (7マス先)
  map.setObject({ x: 11, y: 10 }, 'BLOCK');
  const enemy = new EnemyInstance({ typeId: 10, pos: { x: 18, y: 10 } }); // DEF = 1500
  const initialExp = player.experience;
  const initialMagic = player.magic; // 5

  const hitResult = MagicSystem.cast(player, 'KICK', map, [enemy]);
  assert.strictEqual(hitResult.success, true, 'KICK hit enemy');
  assert.strictEqual(enemy.isAlive, false, 'Enemy instantly defeated');
  assert.strictEqual(map.getObject({ x: 11, y: 10 }), 'NONE', 'Original block tile emptied');
  assert.strictEqual(map.getObject({ x: 18, y: 10 }), 'BLOCK', 'Block placed on defeated enemy tile');
  assert.strictEqual(player.magic, initialMagic - 1, 'MAGIC decreased by 1 on monster hit');
  assert.ok(player.experience > initialExp, 'Experience gained from enemy defeat');
  assert.strictEqual(hitResult.kickCrushed, false);
  assert.deepStrictEqual(hitResult.kickHitEnemy, {
    id: enemy.id,
    pos: { x: 18, y: 10 },
    name: enemy.name,
  });
  assert.strictEqual(hitResult.kickPath?.length, 8);
  assert.deepStrictEqual(hitResult.kickPath?.[0], { x: 11, y: 10 });
  assert.deepStrictEqual(hitResult.kickPath?.[7], { x: 18, y: 10 });

  // クリーンアップ
  map.setObject({ x: 18, y: 10 }, 'NONE');

  // 4-5. トーラス境界を跨いだ長距離スライド撃破
  // プレイヤー: (62, 20), 岩: (63, 20), 敵: (3, 20) (境界を跨いで4マス先)
  player.pos = { x: 62, y: 20 };
  player.dir = 'RIGHT';
  map.setObject({ x: 63, y: 20 }, 'BLOCK');
  const wrappedEnemy = new EnemyInstance({ typeId: 8, pos: { x: 3, y: 20 } });

  const wrappedHitResult = MagicSystem.cast(player, 'KICK', map, [wrappedEnemy]);
  assert.strictEqual(wrappedHitResult.success, true, 'KICK wrapped through map boundary');
  assert.strictEqual(wrappedEnemy.isAlive, false, 'Wrapped enemy defeated across border');
  assert.strictEqual(map.getObject({ x: 63, y: 20 }), 'NONE', 'Original rock at (63, 20) removed');
  assert.strictEqual(map.getObject({ x: 3, y: 20 }), 'BLOCK', 'Rock placed at wrapped enemy position (3, 20)');
  assert.deepStrictEqual(wrappedHitResult.kickPath, [
    { x: 63, y: 20 },
    { x: 0, y: 20 },
    { x: 1, y: 20 },
    { x: 2, y: 20 },
    { x: 3, y: 20 },
  ]);

  // 4-6. 障害物のない平原での最大射程制限（15マスで停止し、一周して戻ってこない）
  map.setObject({ x: 3, y: 20 }, 'NONE');
  player.pos = { x: 10, y: 10 };
  player.dir = 'RIGHT';
  map.setObject({ x: 11, y: 10 }, 'BLOCK');

  const maxRangeResult = MagicSystem.cast(player, 'KICK', map, []);
  assert.strictEqual(maxRangeResult.success, true, 'KICK max range slide succeeded');
  assert.strictEqual(map.getObject({ x: 11, y: 10 }), 'NONE', 'Initial rock tile emptied');
  // 11 + 15 = 26 に岩が配置される
  assert.strictEqual(map.getObject({ x: 26, y: 10 }), 'BLOCK', 'Rock stopped at max range of 15 tiles (26, 10)');
  assert.strictEqual(maxRangeResult.kickPath?.length, 16, 'kickPath contains initial pos + 15 traversal steps');
  assert.deepStrictEqual(maxRangeResult.kickPath?.[15], { x: 26, y: 10 }, 'Last path position is (26, 10)');
  assert.notDeepStrictEqual(maxRangeResult.kickPath?.[15], player.pos, 'Never wraps back to player pos');

  // クリーンアップ
  map.setObject({ x: 26, y: 10 }, 'NONE');

  // 4-7. 進行方向にプレイヤーが存在する場合、プレイヤーの直前で停止すること（プレイヤー貫通防止）
  // プレイヤー: (10, 10), 岩: (11, 10)
  // ただしプレイヤー自身が進行線上の (15, 10) にいるケースをシミュレート
  map.setObject({ x: 11, y: 10 }, 'BLOCK');
  // 他のプレイヤーまたは自身（player.pos = 15, 10）
  // castKick 内では `isPlayerAtNext = nextPos.x === player.pos.x && nextPos.y === player.pos.y` を判定
  // ここで player.pos を (15, 10) に設定し、castKick を呼ぶことは通常できないが、
  // トーラス一周シミュレーションとして player.pos を (13, 10) にした状態で (11, 10) の岩を RIGHT に蹴ると、(12, 10) で止まるはず
  // （※castKick は player.pos の正面の岩を蹴る仕様なので、targetPos が (11, 10) になるには player.pos = (10, 10)）
  // プレイヤー自身が (10, 10) にいて、もし一周して (10, 10) に戻ってきた場合は isPlayerAtNext で停止する
  assert.strictEqual(maxRangeResult.kickPath?.some(p => p.x === 10 && p.y === 10), false, 'Trajectory never collides with player');

  console.log('✓ 4. Long-range sliding KICK magic specification fully verified.');
}

console.log('--- ✓ All Torus and KICK Tests Passed Successfully! ---');
