import assert from 'node:assert';
import { WorldMap } from '../../src/models/WorldMap.js';
import { MapProfiler, GeometricMetrics } from '../../src/systems/generator/MapProfiler.js';
import { HierarchicalThemeBlockGenerator } from '../../src/systems/generator/HierarchicalThemeBlockGenerator.js';
import { MapPresetManager, MapPresetData } from '../../src/services/MapPresetManager.js';
import { DungeonTopology } from '../../src/models/Types.js';

console.log('--- Phase 15: Seed Observatory & MapProfiler Verification ---');

// 1. 幾何学的メトリクスの計測テスト
console.log('Testing 1: Geometric metrics calculation (openness, mazeIndex, sword distance, graves)...');
{
  const map = new WorldMap(64, 64);
  // タイルとオブジェクトを全てクリアしてプレーンなテストフィールドを作成
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      map.setBaseTile({ x, y }, 'EMPTY');
      map.setObject({ x, y }, 'NONE');
      map.setItem({ x, y }, 'NONE');
    }
  }
  map.homePos = { x: 10, y: 10 };
  map.setBaseTile({ x: 10, y: 10 }, 'HOME');
  map.dragonCenter = { x: 32, y: 32 };

  // 我が家から距離5の位置にSWORDを配置
  map.setItem({ x: 10, y: 15 }, 'SWORD');

  // 我が家周囲（距離2〜4）に未封鎖の墓を3基配置
  map.setTile({ x: 10, y: 12 }, 'GRAVE');
  map.setObject({ x: 10, y: 12 }, 'NONE');
  map.setTile({ x: 12, y: 10 }, 'GRAVE');
  map.setObject({ x: 12, y: 10 }, 'NONE');
  map.setTile({ x: 8, y: 10 }, 'GRAVE');
  map.setObject({ x: 8, y: 10 }, 'NONE');

  // 1基はBLOCKで封鎖
  map.setTile({ x: 10, y: 8 }, 'GRAVE');
  map.setObject({ x: 10, y: 8 }, 'BLOCK');

  const metrics = MapProfiler.measureGeometricMetrics(map);

  assert.ok(typeof metrics.opennessScore === 'number', 'opennessScore should be a number');
  assert.ok(typeof metrics.mazeIndex === 'number', 'mazeIndex should be a number');
  assert.ok(metrics.opennessScore >= 0 && metrics.opennessScore <= 1, 'opennessScore in [0, 1]');
  assert.ok(metrics.mazeIndex >= 0 && metrics.mazeIndex <= 1, 'mazeIndex in [0, 1]');
  assert.strictEqual(metrics.swordWalkDistance, 5, 'swordWalkDistance should be 5 steps');
  assert.strictEqual(metrics.nearHomeGraves, 3, 'nearHomeGraves should count only unblocked graves (3)');
  assert.ok(metrics.lairAccessibility.entranceCount > 0, 'lair entrance count should be > 0');

  console.log('✓ 1. Geometric metrics calculation verified successfully.');
}

// 2. トポロジー事後推定テスト
console.log('Testing 2: Topology post-hoc estimation logic...');
{
  const map = new WorldMap(64, 64);
  map.homePos = { x: 10, y: 10 };
  map.dragonCenter = { x: 32, y: 32 };

  // 迷路性が極めて高く部屋が少ないメトリクス -> SPIRAL_LABYRINTH
  const spiralMetrics: GeometricMetrics = {
    opennessScore: 0.05,
    mazeIndex: 0.65,
    roomCount: 2,
    swordWalkDistance: 25,
    nearHomeGraves: 2,
    lairAccessibility: { entranceCount: 2, safeSpacesCount: 4, score: 0.3 },
    sectorPartitionScore: 0.3,
  };
  const topoSpiral = MapProfiler.estimateTopology(map, spiralMetrics);
  assert.strictEqual(topoSpiral, 'SPIRAL_LABYRINTH', 'Should estimate SPIRAL_LABYRINTH');

  // 開放度が高く要塞アクセス良好 -> FORTRESS_ARENA
  const arenaMetrics: GeometricMetrics = {
    opennessScore: 0.25,
    mazeIndex: 0.20,
    roomCount: 4,
    swordWalkDistance: 10,
    nearHomeGraves: 1,
    lairAccessibility: { entranceCount: 8, safeSpacesCount: 6, score: 0.7 },
    sectorPartitionScore: 0.2,
  };
  const topoArena = MapProfiler.estimateTopology(map, arenaMetrics);
  assert.strictEqual(topoArena, 'FORTRESS_ARENA', 'Should estimate FORTRESS_ARENA');

  // 4セクター分断度が高く部屋が多い -> MULTI_SECTOR
  const sectorMetrics: GeometricMetrics = {
    opennessScore: 0.10,
    mazeIndex: 0.40,
    roomCount: 5,
    swordWalkDistance: 18,
    nearHomeGraves: 2,
    lairAccessibility: { entranceCount: 4, safeSpacesCount: 4, score: 0.5 },
    sectorPartitionScore: 0.65,
  };
  const topoMultiSector = MapProfiler.estimateTopology(map, sectorMetrics);
  assert.strictEqual(topoMultiSector, 'MULTI_SECTOR', 'Should estimate MULTI_SECTOR');

  console.log('✓ 2. Topology post-hoc estimation verified.');
}

// 3. 難易度格付け・チャレンジレーティング統合テスト
console.log('Testing 3: Difficulty grading and challenge rating integration...');
{
  const map = new WorldMap(64, 64);
  HierarchicalThemeBlockGenerator.generate(map, {
    seed: 777777,
    topology: 'MULTI_SECTOR',
    difficulty: 'NORMAL',
    pacing: 'STANDARD',
  });

  const report = MapProfiler.profile(map, { seed: 777777 });

  assert.strictEqual(report.seed, 777777);
  assert.strictEqual(report.isSolvable, true, 'Seed 777777 should be solvable');
  assert.ok(report.challengeRating >= 1 && report.challengeRating <= 100, 'Rating should be 1..100');
  assert.ok(['EASY', 'NORMAL', 'HARD', 'NIGHTMARE'].includes(report.estimatedDifficulty));
  assert.ok(['BLITZ', 'STANDARD', 'MARATHON'].includes(report.estimatedPacing));
  assert.ok(report.summary.length > 0, 'Summary string should not be empty');

  console.log(`Profile summary: ${report.summary}`);
  console.log('✓ 3. Difficulty grading and challenge rating verified.');
}

// 4. ボット未踏破チャレンジシードの格付け・耐久指定テスト
console.log('Testing 4: UNBEATEN_BY_BOT rating and challenge classification...');
{
  const map = new WorldMap(64, 64);
  HierarchicalThemeBlockGenerator.generate(map, {
    seed: 833139,
    topology: 'FORTRESS_ARENA',
    difficulty: 'HARD',
    pacing: 'MARATHON',
  });

  // 短いターン制限でUNBEATEN_BY_BOTをシミュレート
  const report = MapProfiler.profile(map, {
    seed: 833139,
    runBotBenchmark: true,
    maxBotTurns: 10, // 意図的に早期タイムアウトさせて未踏破を検証
  });

  assert.strictEqual(report.botBenchmark?.status, 'UNBEATEN_BY_BOT', 'Should be UNBEATEN_BY_BOT on timeout');
  assert.strictEqual(report.estimatedDifficulty, 'NIGHTMARE', 'Unbeaten should be rated NIGHTMARE');
  assert.strictEqual(report.estimatedPacing, 'MARATHON', 'Unbeaten should have MARATHON pacing');
  assert.ok(report.tags.includes('UNBEATEN_BY_BOT'), 'Tags should contain UNBEATEN_BY_BOT');

  console.log('✓ 4. UNBEATEN_BY_BOT rating and challenge classification verified.');
}

// 5. プリセット管理・共有コード・クリア記録統合テスト
console.log('Testing 5: MapPresetManager metrics, share codes & clear recording...');
{
  const testPreset: MapPresetData = {
    id: 'test_obs_preset',
    name: '挑戦状：虚無の螺旋城塞',
    createdAt: Date.now(),
    seed: 833139,
    options: {
      difficulty: 'HARD',
      pacing: 'MARATHON',
      topology: 'FORTRESS_ARENA',
    },
    metrics: {
      estimatedTopology: 'FORTRESS_ARENA',
      estimatedDifficulty: 'NIGHTMARE',
      botStatus: 'UNBEATEN_BY_BOT',
      botTurns: 1600,
      challengeRating: 92,
      isUnbeatenChallenge: true,
      playerCleared: true,
      playerClearTurns: 1240,
    },
  };

  // 共有コードのエクスポートとインポート
  const shareCode = MapPresetManager.exportShareCode(testPreset);
  assert.ok(shareCode.startsWith('DS1MAP:'), 'Share code must start with DS1MAP:');

  const imported = MapPresetManager.importShareCode(shareCode);
  assert.ok(imported !== null, 'Imported preset must not be null');
  assert.strictEqual(imported.seed, 833139);
  assert.strictEqual(imported.metrics?.estimatedDifficulty, 'NIGHTMARE');
  assert.strictEqual(imported.metrics?.botStatus, 'UNBEATEN_BY_BOT');
  assert.strictEqual(imported.metrics?.isUnbeatenChallenge, true);
  assert.strictEqual(imported.metrics?.playerCleared, true);
  assert.strictEqual(imported.metrics?.playerClearTurns, 1240);

  // 公式プリセットに未踏破シードが含まれているか検証
  const curated = MapPresetManager.getAllPresets();
  const unbeatenCurated = curated.find(p => p.id === 'curated_unbeaten_nightmare');
  assert.ok(unbeatenCurated !== undefined, 'curated_unbeaten_nightmare should exist in CURATED_PRESETS');
  assert.strictEqual(unbeatenCurated.metrics?.isUnbeatenChallenge, true);
  assert.strictEqual(unbeatenCurated.metrics?.botStatus, 'UNBEATEN_BY_BOT');

  console.log('✓ 5. MapPresetManager metrics, share codes & clear recording verified.');
}

console.log('--- ✓ All Phase 15 MapProfiler & Observatory Tests PASSED! ---');
