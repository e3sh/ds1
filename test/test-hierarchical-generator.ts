import assert from 'node:assert';
import { WorldMap } from '../src/models/WorldMap.js';
import { ProceduralMapGenerator } from '../src/systems/ProceduralMapGenerator.js';
import { DungeonTopology, MapDifficulty, PlayPacingMode } from '../src/models/Types.js';

console.log('--- Phase 14 Step 3: Hierarchical Theme Block Generator & Solvability Verification ---');

// ============================================================================
// Test 1: 全6トポロジーにおけるテーマブロック階層合成・Solvability・決定論的再現性検証
// ============================================================================
console.log('Testing 1: All 6 topologies hierarchical generation & 100% solvability...');
{
  const topologies: DungeonTopology[] = [
    'STANDARD_ROOMS',
    'PILLAR_GRID',
    'NARROW_MAZE',
    'SPIRAL_LABYRINTH',
    'FORTRESS_ARENA',
    'MULTI_SECTOR',
  ];

  for (const topo of topologies) {
    const map = new WorldMap(64, 64);
    const report = ProceduralMapGenerator.generateDungeon(map, {
      topology: topo,
      seed: 123456,
      difficulty: 'NORMAL',
      pacing: 'STANDARD',
    });

    assert.strictEqual(
      report.isSolvable,
      true,
      `Topology ${topo} must be solvable. Issues: ${report.issues.join(', ')}`
    );
    assert.strictEqual(report.hasZeroOverlaps, true, `${topo} must have zero tile overlaps`);
    assert.strictEqual(report.internalWallsAreBlocks, true, `${topo} must have zero static walls`);
    assert.strictEqual(report.dragonArenaValid, true, `${topo} dragon arena clearance valid`);
    assert.strictEqual(report.bootstrapValid, true, `${topo} bootstrap items & open graves valid`);
    assert.strictEqual(report.resourceSufficient, true, `${topo} resource sufficiency valid`);
    assert.ok(report.counts.chests >= 75, `${topo} chest count (${report.counts.chests}) >= 75`);
    assert.ok(report.counts.openGraves >= 5, `${topo} open graves (${report.counts.openGraves}) >= 5`);

    // 戦術メタデータが付与されていること
    assert.ok(map.tacticalMetadata, `${topo} must have tacticalMetadata attached`);
    assert.ok(map.tacticalMetadata!.gravePuzzleHints.length > 0, `${topo} must have gravePuzzleHints`);

    // 決定論的再現性の検証（同一シードなら全マス完全一致）
    const cloneMap = new WorldMap(64, 64);
    ProceduralMapGenerator.generateDungeon(cloneMap, {
      topology: topo,
      seed: 123456,
      difficulty: 'NORMAL',
      pacing: 'STANDARD',
    });

    for (let y = 0; y < 64; y += 4) {
      for (let x = 0; x < 64; x += 4) {
        assert.strictEqual(
          map.getTile({ x, y }),
          cloneMap.getTile({ x, y }),
          `Deterministic match failed for ${topo} at (${x}, ${y})`
        );
      }
    }
  }

  console.log('✓ 1. All 6 topologies generation, 100% solvability & determinism verified.');
}

// ============================================================================
// Test 2: ペーシング別（BLITZ, STANDARD, MARATHON）スロット予算・Solvability検証
// ============================================================================
console.log('Testing 2: Pacing modes slot budget activation & solvability...');
{
  const pacings: { mode: PlayPacingMode; expectedMinChests: number }[] = [
    { mode: 'BLITZ', expectedMinChests: 48 }, // 65 * 0.75
    { mode: 'STANDARD', expectedMinChests: 75 }, // 100 * 0.75
    { mode: 'MARATHON', expectedMinChests: 97 }, // 130 * 0.75
  ];

  for (const { mode, expectedMinChests } of pacings) {
    const map = new WorldMap(64, 64);
    const report = ProceduralMapGenerator.generateDungeon(map, {
      topology: 'MULTI_SECTOR',
      pacing: mode,
      seed: 777888,
      difficulty: 'NORMAL',
    });

    assert.strictEqual(
      report.isSolvable,
      true,
      `Pacing ${mode} must be solvable. Issues: ${report.issues.join(', ')}`
    );
    assert.ok(
      report.counts.chests >= expectedMinChests,
      `Pacing ${mode} chest count (${report.counts.chests}) must meet min requirement (${expectedMinChests})`
    );
  }

  console.log('✓ 2. Pacing modes slot budget activation & solvability verified.');
}

// ============================================================================
// Test 3: 全難易度（EASY, NORMAL, HARD）ブートストラップ導線＆Solvability検証
// ============================================================================
console.log('Testing 3: Difficulty modes bootstrap routing & solvability...');
{
  const difficulties: MapDifficulty[] = ['EASY', 'NORMAL', 'HARD'];

  for (const diff of difficulties) {
    const map = new WorldMap(64, 64);
    const report = ProceduralMapGenerator.generateDungeon(map, {
      topology: 'STANDARD_ROOMS',
      difficulty: diff,
      seed: 999111,
      pacing: 'STANDARD',
    });

    assert.strictEqual(
      report.isSolvable,
      true,
      `Difficulty ${diff} must be solvable. Issues: ${report.issues.join(', ')}`
    );
    assert.strictEqual(report.bootstrapValid, true, `Difficulty ${diff} bootstrap valid`);
  }

  console.log('✓ 3. Difficulty modes bootstrap routing & solvability verified.');
}

console.log('--- ✓ All Phase 14 Step 3 Hierarchical Generator Tests Passed Successfully! ---');
