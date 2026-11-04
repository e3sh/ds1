import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { Ghost } from '../src/models/Ghost.js';
import { GhostAISystem } from '../src/systems/GhostAISystem.js';
import { MagicSystem } from '../src/systems/MagicSystem.js';

export function runPhase6Tests() {
  console.log('--- Phase 6: Authentic Ghost System Verification ---');

  // ==========================================
  // 1. Ghost モデルの初期化と速度ベクトル & シリアライズ
  // ==========================================
  console.log('Testing 1: Ghost model velocity vectors & serialization...');
  const ghostDefault = new Ghost({ pos: { x: 5, y: 5 } });
  console.assert(ghostDefault.moveIntervalMs === 90, 'Default ghost moveIntervalMs should be 90ms for authentic high speed');
  console.assert(ghostDefault.vx !== 0 && ghostDefault.vy !== 0, 'Default velocity must be diagonal');

  const ghost1 = new Ghost({ pos: { x: 10, y: 10 }, vx: 1, vy: -1 });
  console.assert(ghost1.vx === 1 && ghost1.vy === -1, 'Ghost should have specified vx and vy');

  // シリアライズ & 復元
  ghost1.carriedItem = 'RING';
  ghost1.cruiseSteps = 12;
  ghost1.targetCruiseSteps = 28;
  const serialized = ghost1.serialize();
  console.assert(serialized.vx === 1 && serialized.vy === -1, 'Serialized ghost must include vx and vy');
  console.assert(serialized.carriedItem === 'RING', 'Serialized ghost must include carriedItem');
  console.assert(serialized.cruiseSteps === 12, 'Serialized ghost must include cruiseSteps');
  console.assert(serialized.targetCruiseSteps === 28, 'Serialized ghost must include targetCruiseSteps');

  const restored = Ghost.fromJSON(serialized);
  console.assert(restored.vx === 1 && restored.vy === -1, 'Restored ghost must preserve vx and vy');
  console.assert(restored.carriedItem === 'RING', 'Restored ghost must preserve carriedItem');
  console.assert(restored.cruiseSteps === 12, 'Restored ghost must preserve cruiseSteps');
  console.assert(restored.targetCruiseSteps === 28, 'Restored ghost must preserve targetCruiseSteps');
  console.log('✓ 1. Ghost model & serialization tests passed.');

  // ==========================================
  // 2. 直線滑空（壁・岩の完全無視）
  // ==========================================
  console.log('Testing 2: Linear gliding through BLOCK and WALL_STATIC...');
  const mapGlide = new WorldMap(30, 30);
  const dummyPlayer = new Player({ x: 28, y: 28, hp: 1000 });

  // (10, 10) から (1, 1) 方向へ直進。間に岩(11, 11)と壁(12, 12)を配置
  mapGlide.setTile({ x: 11, y: 11 }, 'BLOCK');
  mapGlide.setTile({ x: 12, y: 12 }, 'WALL_STATIC');

  const glider = new Ghost({ pos: { x: 10, y: 10 }, vx: 1, vy: 1 });

  // 1歩目: (11, 11) の BLOCK を無視して通過
  GhostAISystem.stepGhost(glider, dummyPlayer, mapGlide);
  console.assert(glider.pos.x === 11 && glider.pos.y === 11, 'Ghost should pass directly into BLOCK at (11, 11)');

  // 2歩目: (12, 12) の WALL_STATIC を無視して通過
  GhostAISystem.stepGhost(glider, dummyPlayer, mapGlide);
  console.assert(glider.pos.x === 12 && glider.pos.y === 12, 'Ghost should pass directly into WALL_STATIC at (12, 12)');

  // 3歩目: (13, 13) へ直進
  GhostAISystem.stepGhost(glider, dummyPlayer, mapGlide);
  console.assert(glider.pos.x === 13 && glider.pos.y === 13, 'Ghost should continue straight to (13, 13)');
  console.log('✓ 2. Linear gliding through obstacles tests passed.');

  // ==========================================
  // 3. マップ外枠での反射（Bounce）
  // ==========================================
  console.log('Testing 3: Outer border straight loop (torus)...');
  const mapBounce = new WorldMap(20, 20);
  // 右下端 (19, 19) から vx: 1, vy: 1 で滑空
  const bouncer = new Ghost({ pos: { x: 19, y: 19 }, vx: 1, vy: 1 });

  // 1歩進むとマップ端を突き抜けて (0, 0) へ直進ループ
  GhostAISystem.stepGhost(bouncer, dummyPlayer, mapBounce);
  console.assert(bouncer.pos.x === 0 && bouncer.pos.y === 0, 'Ghost must loop through border to (0, 0)');
  console.assert(bouncer.vx === 1 && bouncer.vy === 1, 'Ghost velocity vector must remain unchanged');
  console.log('✓ 3. Outer border straight loop tests passed.');

  // ==========================================
  // 4. 十字架（CROSS）結界マスの侵入不可 & 散乱反射
  // ==========================================
  console.log('Testing 4: Ground CROSS tile barrier & scatter reflection...');
  const mapCross = new WorldMap(20, 20);
  // (10, 10) から東 (1, 0) へ進む先に十字架 (11, 10) を設置
  mapCross.setItem({ x: 11, y: 10 }, 'CROSS');

  const crossGhost = new Ghost({ pos: { x: 10, y: 10 }, vx: 1, vy: 0 });
  GhostAISystem.stepGhost(crossGhost, dummyPlayer, mapCross);

  console.assert(
    !(crossGhost.pos.x === 11 && crossGhost.pos.y === 10),
    'Ghost must NOT enter ground CROSS tile at (11, 10)'
  );
  // 十字架マスに向かわない新しいベクトルに散乱していること
  const headingToCross = crossGhost.pos.x === 11 && crossGhost.pos.y === 10;
  console.assert(!headingToCross, 'Ghost should scatter away from CROSS tile');
  console.log('✓ 4. Ground CROSS barrier & reflection tests passed.');

  // ==========================================
  // 5. プレイヤー手持ちアイテムのひったくり（十字架含む）
  // ==========================================
  console.log('Testing 5: Stealing player holdItem (including CROSS)...');
  const mapSteal = new WorldMap(20, 20);
  const playerWithCross = new Player({ x: 5, y: 5, hp: 1000 });
  playerWithCross.holdItem = 'CROSS';

  const thiefGhost = new Ghost({ pos: { x: 4, y: 5 }, vx: 1, vy: 0 });
  // (5, 5) のプレイヤーに重なる
  GhostAISystem.stepGhost(thiefGhost, playerWithCross, mapSteal);

  console.assert(thiefGhost.pos.x === 5 && thiefGhost.pos.y === 5, 'Ghost reached player tile');
  console.assert(playerWithCross.holdItem === 'NONE', 'Player holdItem must be snatched');
  console.assert(thiefGhost.carriedItem === 'CROSS', 'Ghost must now carry the stolen CROSS');
  console.log('✓ 5. Player item snatching tests passed.');

  // ==========================================
  // 6. 床アイテムの自動吸引
  // ==========================================
  console.log('Testing 6: Floor item automatic suction...');
  const mapItem = new WorldMap(20, 20);
  mapItem.setItem({ x: 8, y: 8 }, 'KEY');

  const suctionGhost = new Ghost({ pos: { x: 7, y: 8 }, vx: 1, vy: 0 });
  GhostAISystem.stepGhost(suctionGhost, dummyPlayer, mapItem);

  console.assert(suctionGhost.pos.x === 8 && suctionGhost.pos.y === 8, 'Ghost stepped on KEY tile');
  console.assert(suctionGhost.carriedItem === 'KEY', 'Ghost should have picked up KEY');
  console.assert(mapItem.getItem({ x: 8, y: 8 }) === 'NONE', 'Floor item should be removed from map');
  console.assert(
    suctionGhost.targetCarrySteps >= GhostAISystem.MIN_CARRY_STEPS &&
    suctionGhost.targetCarrySteps <= GhostAISystem.MAX_CARRY_STEPS,
    'Target carry steps must be set between 25 and 45'
  );
  console.assert(suctionGhost.carrySteps === 0, 'Carry steps must be reset to 0 on pickup');
  console.log('✓ 6. Floor item suction tests passed.');

  // ==========================================
  // 7. 空床（EMPTY floor）限定ポイ捨て & 最低運搬ノルマ保証
  // ==========================================
  console.log('Testing 7: Item dropping strictly restricted to empty floor & min carry steps...');
  const mapDrop = new WorldMap(30, 30);
  // (18, 10) は岩、(18, 11) は静的外壁、(18, 12) は何もない空床
  mapDrop.setTile({ x: 18, y: 10 }, 'BLOCK');
  mapDrop.setTile({ x: 18, y: 11 }, 'WALL_STATIC');
  mapDrop.setTile({ x: 18, y: 12 }, 'EMPTY');

  const dropperGhost = new Ghost({ pos: { x: 18, y: 9 }, vx: 0, vy: 1 });
  dropperGhost.carriedItem = 'POWER_STONE';
  dropperGhost.targetCarrySteps = 3; // 3歩運搬ノルマを設定

  // 1歩目: (18, 10) の BLOCK の上に乗る -> 岩の上なのでドロップしてはいけない！
  GhostAISystem.stepGhost(dropperGhost, dummyPlayer, mapDrop);
  console.assert(dropperGhost.pos.x === 18 && dropperGhost.pos.y === 10, 'Ghost at (18, 10)');
  console.assert(dropperGhost.carriedItem === 'POWER_STONE', 'Ghost must NOT drop item on BLOCK');
  console.assert(dropperGhost.carrySteps === 1, 'Carry steps should be 1');
  console.assert(mapDrop.getItem({ x: 18, y: 10 }) === 'NONE', 'No item on BLOCK tile');

  // 2歩目: (18, 11) の WALL_STATIC の上に乗る -> 壁の上なのでドロップしてはいけない！
  GhostAISystem.stepGhost(dropperGhost, dummyPlayer, mapDrop);
  console.assert(dropperGhost.pos.x === 18 && dropperGhost.pos.y === 11, 'Ghost at (18, 11)');
  console.assert(dropperGhost.carriedItem === 'POWER_STONE', 'Ghost must NOT drop item on WALL_STATIC');
  console.assert(dropperGhost.carrySteps === 2, 'Carry steps should be 2');
  console.assert(mapDrop.getItem({ x: 18, y: 11 }) === 'NONE', 'No item on WALL_STATIC tile');

  // 3歩目: (18, 12) の EMPTY 床の上に乗る -> ノルマ達成(carrySteps=3 >= targetCarrySteps=3) かつ空床なのでドロップ！
  GhostAISystem.stepGhost(dropperGhost, dummyPlayer, mapDrop);
  console.assert(dropperGhost.pos.x === 18 && dropperGhost.pos.y === 12, 'Ghost at (18, 12)');
  console.assert(dropperGhost.carriedItem === null, 'Ghost dropped item on pure empty floor after meeting carry goal');
  console.assert(dropperGhost.carrySteps === 0, 'Carry steps should reset to 0');
  console.assert(mapDrop.getItem({ x: 18, y: 12 }) === 'POWER_STONE', 'Item correctly placed on empty floor');

  // 追加検証: ノルマ未達成の場合は空床（EMPTY）を踏んでも落とさないこと
  const prematureGhost = new Ghost({ pos: { x: 5, y: 5 }, vx: 1, vy: 0 });
  prematureGhost.carriedItem = 'SWORD';
  prematureGhost.targetCarrySteps = 10;
  mapDrop.setTile({ x: 6, y: 5 }, 'EMPTY');
  GhostAISystem.stepGhost(prematureGhost, dummyPlayer, mapDrop);
  console.assert(prematureGhost.pos.x === 6 && prematureGhost.pos.y === 5, 'Ghost at (6, 5)');
  console.assert(prematureGhost.carriedItem === 'SWORD', 'Ghost must retain item on empty floor before reaching carry goal');
  console.assert(prematureGhost.carrySteps === 1, 'Carry steps should be 1');
  console.assert(mapDrop.getItem({ x: 6, y: 5 }) === 'NONE', 'No item dropped on premature floor');
  console.log('✓ 7. Empty floor item dropping tests passed.');

  // ==========================================
  // 8. JUMP 魔法とゴーストの連携 & 壁通過時の安全着地
  // ==========================================
  console.log('Testing 8: JUMP spell ghost synergy and safe wall fallback...');
  const mapJump = new WorldMap(30, 30);
  const jumpPlayer = new Player({ x: 2, y: 2, hp: 1000, experience: 30000 });
  jumpPlayer.magic = 5; // MAGICストックを設定

  // 8-1. 空床にいるゴーストへ直接ワープ
  const ghostOnFloor = new Ghost({ pos: { x: 20, y: 20 } });
  const result1 = MagicSystem.cast(jumpPlayer, 'JUMP', mapJump, [], [ghostOnFloor]);
  console.assert(result1.success, `JUMP should succeed: ${result1.message}`);
  console.assert(jumpPlayer.pos.x === 20 && jumpPlayer.pos.y === 20, 'Player teleported directly to ghost on floor');

  // 8-2. 壁（WALL_STATIC）の中にいるゴーストへのJUMP（最寄り安全床へ着地）
  mapJump.setTile({ x: 15, y: 15 }, 'WALL_STATIC');
  const ghostInWall = new Ghost({ pos: { x: 15, y: 15 } });

  const result2 = MagicSystem.cast(jumpPlayer, 'JUMP', mapJump, [], [ghostInWall]);
  console.assert(result2.success, `JUMP should succeed: ${result2.message}`);
  console.assert(mapJump.isPassable(jumpPlayer.pos), 'Player must land on a passable tile, not inside the wall');
  const dist = Math.abs(jumpPlayer.pos.x - 15) + Math.abs(jumpPlayer.pos.y - 15);
  console.assert(dist >= 1 && dist <= 2, 'Player landed near the ghost in wall');
  console.log('✓ 8. JUMP spell ghost synergy tests passed.');

  console.log('--- ✓ All Phase 6 Authentic Ghost System Tests Passed Successfully! ---');
}

// 実行
runPhase6Tests();
