import assert from 'node:assert';
import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { Ghost } from '../src/models/Ghost.js';
import { GhostAISystem } from '../src/systems/GhostAISystem.js';

console.log('--- Ghost AI Cruise, Direction Turn & U-Turn Suppression Verification ---');

// ==========================================
// 1. turnToRandomOtherDirection の検証
//    現在と同じ向き (vx, vy) および正反対 (180度反転) (-vx, -vy) を選ばないこと
// ==========================================
console.log('Testing 1: turnToRandomOtherDirection excludes current & opposite direction...');
{
  for (const dir of GhostAISystem.DIRECTIONS_8) {
    const ghost = new Ghost({ pos: { x: 10, y: 10 }, vx: dir.vx, vy: dir.vy });
    const visitedDirections = new Set<string>();

    for (let i = 0; i < 200; i++) {
      ghost.vx = dir.vx;
      ghost.vy = dir.vy;
      GhostAISystem.turnToRandomOtherDirection(ghost);

      // 同一方向の禁止
      assert.ok(
        !(ghost.vx === dir.vx && ghost.vy === dir.vy),
        `Direction turn should never select the current direction (${dir.vx}, ${dir.vy})`
      );

      // 正反対方向（180度Uターン）の禁止
      assert.ok(
        !(ghost.vx === -dir.vx && ghost.vy === -dir.vy),
        `Direction turn should never select the opposite direction (${-dir.vx}, ${-dir.vy})`
      );

      // 8方向のうち有効なものであること
      const isValid = GhostAISystem.DIRECTIONS_8.some(d => d.vx === ghost.vx && d.vy === ghost.vy);
      assert.ok(isValid, `Selected direction (${ghost.vx}, ${ghost.vy}) must be in DIRECTIONS_8`);

      visitedDirections.add(`${ghost.vx},${ghost.vy}`);
    }

    // 候補は8方向中6方向。200回の試行で残る6方向すべてが選ばれうることを確認
    assert.strictEqual(
      visitedDirections.size,
      6,
      `All 6 valid alternate directions should be covered for initial dir (${dir.vx}, ${dir.vy})`
    );
  }
  console.log('✓ 1. turnToRandomOtherDirection correctly eliminates same and opposite directions.');
}

// ==========================================
// 2. アイテム投棄（ドロップ）時の方向転換検証
//    アイテムをドロップした瞬間に進行方向ベクトル (vx, vy) が変化すること
// ==========================================
console.log('Testing 2: Direction changes upon dropping an item...');
{
  const map = new WorldMap(30, 30);
  const player = new Player({ x: 2, y: 2, hp: 1000 }); // ゴーストから遠い位置

  // (15, 14) から (0, 1) [南] に向けて滑空。 (15, 15) は何もない空床
  map.setTile({ x: 15, y: 15 }, 'EMPTY');

  const ghost = new Ghost({ pos: { x: 15, y: 14 }, vx: 0, vy: 1 });
  ghost.carriedItem = 'POWER_STONE';
  ghost.carrySteps = 10;
  ghost.targetCarrySteps = 10; // ドロップ条件を満たしている状態

  const origVx = ghost.vx;
  const origVy = ghost.vy;

  GhostAISystem.stepGhost(ghost, player, map);

  // ドロップされたこと
  assert.strictEqual(ghost.pos.x, 15);
  assert.strictEqual(ghost.pos.y, 15);
  assert.strictEqual(ghost.carriedItem, null, 'Ghost must drop carried item');
  assert.strictEqual(map.getItem({ x: 15, y: 15 }), 'POWER_STONE', 'Item should be placed on floor');

  // ドロップ直後に向きが変わっていること（同一でも180度反転でもないこと）
  assert.ok(
    !(ghost.vx === origVx && ghost.vy === origVy),
    `Velocity should change upon item drop (was ${origVx}, ${origVy}, now ${ghost.vx}, ${ghost.vy})`
  );
  assert.ok(
    !(ghost.vx === -origVx && ghost.vy === -origVy),
    `Velocity should not reverse 180 degrees upon item drop`
  );

  // ドロップ後は通常巡回へ移行するため cruiseSteps=0 かつ targetCruiseSteps が 20〜35 に設定されていること
  assert.strictEqual(ghost.cruiseSteps, 0, 'cruiseSteps should reset to 0 after drop');
  assert.ok(
    ghost.targetCruiseSteps >= GhostAISystem.MIN_CRUISE_STEPS &&
    ghost.targetCruiseSteps <= GhostAISystem.MAX_CRUISE_STEPS,
    `targetCruiseSteps should be between ${GhostAISystem.MIN_CRUISE_STEPS} and ${GhostAISystem.MAX_CRUISE_STEPS} (got ${ghost.targetCruiseSteps})`
  );
  console.log('✓ 2. Direction abruptly changes on item drop & cruise goal is reset.');
}

// ==========================================
// 3. 飛行距離（巡回歩数）による周期的な方向転換検証
//    アイテム未保持のまま targetCruiseSteps 歩飛行した時点で、自動的に方向転換 & リセット
// ==========================================
console.log('Testing 3: Periodic direction turn after targetCruiseSteps...');
{
  const map = new WorldMap(50, 50);
  const player = new Player({ x: 45, y: 45, hp: 1000 }); // 干渉しない離れた位置

  const ghost = new Ghost({ pos: { x: 10, y: 10 }, vx: 1, vy: 0 });
  GhostAISystem.resetCruiseGoal(ghost);
  const targetSteps = ghost.targetCruiseSteps;

  assert.ok(
    targetSteps >= GhostAISystem.MIN_CRUISE_STEPS && targetSteps <= GhostAISystem.MAX_CRUISE_STEPS,
    `Initial targetCruiseSteps must be between 20 and 35, got ${targetSteps}`
  );
  assert.strictEqual(ghost.cruiseSteps, 0, 'Initial cruiseSteps must be 0');

  // targetSteps - 1 歩進める間は、向き (1, 0) が変化せず、歩数がインクリメントされる
  for (let step = 1; step < targetSteps; step++) {
    GhostAISystem.stepGhost(ghost, player, map);
    assert.strictEqual(ghost.vx, 1, `vx should remain 1 at step ${step}`);
    assert.strictEqual(ghost.vy, 0, `vy should remain 0 at step ${step}`);
    assert.strictEqual(ghost.cruiseSteps, step, `cruiseSteps should equal ${step}`);
  }

  // targetSteps 歩目: 向きが自動的に転換され、cruiseSteps が 0 にリセットされ、新たな targetCruiseSteps が設定される
  const prevVx = ghost.vx;
  const prevVy = ghost.vy;
  GhostAISystem.stepGhost(ghost, player, map);

  // 向きが変化したこと（同じ向きや真後ろでないこと）
  assert.ok(
    !(ghost.vx === prevVx && ghost.vy === prevVy),
    `Velocity should change at targetCruiseSteps (${targetSteps})`
  );
  assert.ok(
    !(ghost.vx === -prevVx && ghost.vy === -prevVy),
    `Velocity should not reverse 180 degrees at cruise turn`
  );

  // リセットの検証
  assert.strictEqual(ghost.cruiseSteps, 0, 'cruiseSteps should reset to 0 after cruise direction turn');
  assert.ok(
    ghost.targetCruiseSteps >= GhostAISystem.MIN_CRUISE_STEPS &&
    ghost.targetCruiseSteps <= GhostAISystem.MAX_CRUISE_STEPS,
    `New targetCruiseSteps must be between 20 and 35, got ${ghost.targetCruiseSteps}`
  );

  console.log('✓ 3. Periodic direction turn after targetCruiseSteps successfully verified.');
}

// ==========================================
// 4. アイテム取得時の cruiseSteps リセット検証
// ==========================================
console.log('Testing 4: cruiseSteps resets on item pickup (suction & steal)...');
{
  const map = new WorldMap(30, 30);
  const player = new Player({ x: 20, y: 20, hp: 1000 });

  // 4-1. 床アイテム吸引時
  map.setItem({ x: 12, y: 10 }, 'SWORD');
  const floorGhost = new Ghost({ pos: { x: 10, y: 10 }, vx: 1, vy: 0 });
  floorGhost.targetCruiseSteps = 30;
  floorGhost.cruiseSteps = 15; // 途中の歩数

  // 1歩目 (11, 10): アイテムなし -> cruiseSteps = 16
  GhostAISystem.stepGhost(floorGhost, player, map);
  assert.strictEqual(floorGhost.pos.x, 11);
  assert.strictEqual(floorGhost.cruiseSteps, 16);

  // 2歩目 (12, 10): SWORD を吸い上げ -> cruiseSteps が 0 にリセット
  GhostAISystem.stepGhost(floorGhost, player, map);
  assert.strictEqual(floorGhost.pos.x, 12);
  assert.strictEqual(floorGhost.carriedItem, 'SWORD');
  assert.strictEqual(floorGhost.cruiseSteps, 0, 'cruiseSteps must reset to 0 on floor item suction');

  // 4-2. プレイヤーからのひったくり時
  player.holdItem = 'KEY';
  const thiefGhost = new Ghost({ pos: { x: 19, y: 20 }, vx: 1, vy: 0 });
  thiefGhost.targetCruiseSteps = 30;
  thiefGhost.cruiseSteps = 22;

  GhostAISystem.stepGhost(thiefGhost, player, map);
  assert.strictEqual(thiefGhost.pos.x, 20);
  assert.strictEqual(thiefGhost.carriedItem, 'KEY');
  assert.strictEqual(thiefGhost.cruiseSteps, 0, 'cruiseSteps must reset to 0 on player item steal');
  assert.strictEqual(player.holdItem, 'NONE');

  console.log('✓ 4. cruiseSteps correctly resets on item suction and player steal.');
}

console.log('--- ✓ All Ghost AI Cruise & Direction Turn Tests Passed Successfully! ---');
