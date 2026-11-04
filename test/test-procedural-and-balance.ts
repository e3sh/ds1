import assert from 'node:assert';
import { Dragon } from '../src/models/Dragon.js';
import { Player } from '../src/models/Player.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { ChestSystem } from '../src/systems/ChestSystem.js';
import { CombatSystem } from '../src/systems/CombatSystem.js';
import { ProceduralMapGenerator } from '../src/systems/ProceduralMapGenerator.js';
import { GameEngine } from '../src/core/GameEngine.js';

console.log('--- Phase 8 & Procedural Standard Dungeon Verification ---');

// ==========================================
// 1. ドラゴン本番パラメータ（Level 2.0仕様）の検証
// ==========================================
console.log('Testing 1: Authentic Level 2.0 Dragon parameters...');
{
  const dragon = new Dragon({ x: 32, y: 32 });

  // 胴体: HP 655,340 / DEF 655,350
  assert.strictEqual(dragon.body.hp, 655340);
  assert.strictEqual(dragon.body.def, 655350);

  // 左首: HP 650,000 / ATK 600,000 / DEF 300,000
  const left = dragon.heads[0];
  assert.strictEqual(left.hp, 650000);
  assert.strictEqual(left.atk, 600000);
  assert.strictEqual(left.def, 300000);

  // 中首: HP 650,000 / ATK 500,000 / DEF 400,000
  const center = dragon.heads[1];
  assert.strictEqual(center.hp, 650000);
  assert.strictEqual(center.atk, 500000);
  assert.strictEqual(center.def, 400000);

  // 右首: HP 650,000 / ATK 500,000 / DEF 380,000
  const right = dragon.heads[2];
  assert.strictEqual(right.hp, 650000);
  assert.strictEqual(right.atk, 500000);
  assert.strictEqual(right.def, 380000);

  console.log('✓ 1. Authentic Level 2.0 Dragon parameters verified.');
}

// ==========================================
// 2. パワーストーンのインフレSTR成長曲線とドラゴン討伐検証
// ==========================================
console.log('Testing 2: Power Stone STR inflation curve & Dragon defeat solvability...');
{
  const player = new Player({ x: 7, y: 7, hp: 1000, experience: 15000, strength: 10 });
  player.hasSword = true;
  player.canDiagonal = true;

  // 1個目のパワーストーンは +1,000 (10 -> 1,010)
  player.holdItem = 'POWER_STONE';
  const res1 = player.healAtHome();
  assert.strictEqual(res1.strGained, 1000);
  assert.strictEqual(player.strength, 1010);

  // 2個目〜15個目まで奉納（合計15個）
  for (let i = 2; i <= 15; i++) {
    player.holdItem = 'POWER_STONE';
    player.healAtHome();
  }

  // 15個奉納時点でドラゴンの中首 DEF 400,000 を超えていること
  assert.ok(
    player.strength > 450000,
    `After 15 Power Stones, STR should exceed 450,000 (got ${player.strength})`
  );

  // さらに数個奉納すると 16bit 上限値 655,350 でキャップされること
  for (let i = 0; i < 5; i++) {
    player.holdItem = 'POWER_STONE';
    player.healAtHome();
  }
  assert.strictEqual(player.strength, 655350, 'STR should cap at 655,350');

  // 本番ドラゴンの中首 (DEF 400,000 / HP 650,000) を斜め攻撃で確実に撃破できること
  const map = new WorldMap(64, 64);
  const dragon = new Dragon({ x: 32, y: 32 });
  const centerHead = dragon.heads[1];
  let turnsToKill = 0;
  while (centerHead.isAlive && turnsToKill < 20) {
    turnsToKill++;
    const combat = CombatSystem.resolvePlayerAttackDragon(player, dragon, centerHead, 'UP_LEFT', map);
    assert.strictEqual(combat.damageToPlayer, 0, 'Diagonal attack takes 0 counter damage');
    assert.ok(combat.damageToEnemy >= 250000, 'Deals massive damage to Dragon head');
  }
  assert.strictEqual(centerHead.isAlive, false, 'Dragon center head defeated');
  assert.ok(turnsToKill <= 3, `Defeated 650,000 HP head in ${turnsToKill} turns`);

  console.log(`✓ 2. Power Stone inflation curve & Dragon defeat verified (15 stones -> STR > 450k, max 655,350).`);
}

// ==========================================
// 3. 宝箱枯渇防止リポップ機構の検証
// ==========================================
console.log('Testing 3: Chest replenishment mechanism...');
{
  const map = new WorldMap(64, 64);
  // 一旦すべての宝箱を消去し、3個だけ残す
  for (let y = 1; y < 63; y++) {
    for (let x = 1; x < 63; x++) {
      if (map.getObject({ x, y }) === 'CHEST') {
        map.setObject({ x, y }, 'NONE');
      }
    }
  }
  map.setObject({ x: 10, y: 10 }, 'CHEST');
  map.setObject({ x: 20, y: 20 }, 'CHEST');
  map.setObject({ x: 45, y: 45 }, 'CHEST');
  assert.strictEqual(ChestSystem.countChests(map), 3);

  const spawned = ChestSystem.replenishChestsIfNeeded(map, { x: 8, y: 8 }, { x: 32, y: 32 }, 10, 18);
  assert.strictEqual(spawned, 15, 'Should spawn 15 chests to reach targetChests=18');
  assert.strictEqual(ChestSystem.countChests(map), 18);

  console.log('✓ 3. Chest replenishment mechanism verified.');
}

// ==========================================
// 4. プロシージャル・スタンダードダンジョン生成 & クリア可能性検証
// ==========================================
console.log('Testing 4: Procedural Standard Map generation, determinism & solvability...');
{
  const seeds = [1001, 2026, 424242, 777777, 999999];
  const difficulties = ['EASY', 'NORMAL', 'HARD'] as const;

  for (const seed of seeds) {
    for (const diff of difficulties) {
      const map = new WorldMap(64, 64);
      const report = ProceduralMapGenerator.generateStandardDungeon(map, {
        seed,
        difficulty: diff,
        chestCount: 100,
        graveCount: 20,
      });

      assert.strictEqual(
        report.isSolvable,
        true,
        `Procedural map (seed=${seed}, diff=${diff}) must be solvable. Issues: ${report.issues.join(', ')}`
      );
      assert.ok(
        report.counts.chests >= 85,
        `Procedural map should have ~100 chests via Treasure Zones (got ${report.counts.chests})`
      );
      assert.strictEqual(report.hasZeroOverlaps, true, 'Zero overlaps required');
      assert.strictEqual(
        report.internalWallsAreBlocks,
        true,
        'All internal walls must be BLOCK (no internal WALL_STATIC)'
      );
      assert.strictEqual(report.dragonArenaValid, true, 'Dragon arena clearance required');
      assert.strictEqual(report.bootstrapValid, true, 'Bootstrap items & open graves required');
      assert.strictEqual(report.resourceSufficient, true, 'Sufficient chests & power stones required');
    }
  }

  // クラシック固定マップの宝物地帯（約90〜100個）とランダム開封期待値の検証
  const classicMap = new WorldMap(64, 64);
  const classicReport = ProceduralMapGenerator.validateSolvability(classicMap);
  assert.strictEqual(classicReport.hasZeroOverlaps, true, 'Classic map must have zero overlaps');
  assert.strictEqual(
    classicReport.resourceSufficient,
    true,
    `Classic map must also pass strict 1/8 random resource sufficiency. Issues: ${classicReport.issues.join(', ')}`
  );
  assert.ok(
    classicReport.counts.chests >= 85,
    `Classic map should have >= 85 chests with Treasure Zones (got ${classicReport.counts.chests})`
  );

  // 同一シードによる完全決定論的再現性の検証
  const mapA = new WorldMap(64, 64);
  const mapB = new WorldMap(64, 64);
  ProceduralMapGenerator.generateStandardDungeon(mapA, { seed: 123456 });
  ProceduralMapGenerator.generateStandardDungeon(mapB, { seed: 123456 });

  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      assert.strictEqual(mapA.getTile({ x, y }), mapB.getTile({ x, y }), `Tile mismatch at (${x},${y})`);
    }
  }

  // GameEngine.startProceduralGame() のヘッドレス起動検証
  const engine = new GameEngine();
  engine.startProceduralGame({ seed: 20261026 });
  assert.strictEqual(engine.getState(), 'PLAYING');
  const engineReport = ProceduralMapGenerator.validateSolvability(engine.getMap());
  assert.strictEqual(engineReport.isSolvable, true);

  console.log('✓ 4. Procedural Standard Map generation & solvability across 15 configurations verified.');
}

console.log('--- ✓ All Phase 8 & Procedural Dungeon Tests Passed Successfully! ---');
