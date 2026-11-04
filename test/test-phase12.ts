import assert from 'node:assert';
import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { Dragon } from '../src/models/Dragon.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { ProceduralMapGenerator, SeededRandom } from '../src/systems/ProceduralMapGenerator.js';
import { MapPresetManager, CURATED_PRESETS } from '../src/services/MapPresetManager.js';
import { GameEngine } from '../src/core/GameEngine.js';

console.log('--- Phase 12: Compact Prefabs, 9-Sector Layout & Map Presets Verification ---');

// ============================================================================
// Test 1: コンパクト・プレハブ（スタンプ）機能の幾何学的・防衛構造検証
// ============================================================================
console.log('Testing 1: Compact Dragon & Home Prefab geometries and barriers...');
{
  const rng = new SeededRandom(12345);
  const map = new WorldMap(64, 64);
  const center = { x: 20, y: 20 };

  // 1-A. COMPACT_5x5 ドラゴンプレハブの検証
  ProceduralMapGenerator.applyDragonPrefab(map, center, 'COMPACT_5x5', rng);

  // ドラゴン中心・首・尻尾はすべて EMPTY
  assert.strictEqual(map.getBaseTile(center), 'EMPTY');
  assert.strictEqual(map.getObject(center), 'NONE');
  assert.strictEqual(map.getObject({ x: center.x, y: center.y - 1 }), 'NONE', 'UP head empty');
  assert.strictEqual(map.getObject({ x: center.x - 1, y: center.y }), 'NONE', 'LEFT head empty');
  assert.strictEqual(map.getObject({ x: center.x + 1, y: center.y }), 'NONE', 'RIGHT head empty');
  assert.strictEqual(map.getObject({ x: center.x, y: center.y + 1 }), 'NONE', 'TAIL empty');

  // 王冠スポーンマス4箇所に CHEST_DRAGON
  assert.strictEqual(map.getObject({ x: center.x - 1, y: center.y - 1 }), 'CHEST_DRAGON');
  assert.strictEqual(map.getObject({ x: center.x + 1, y: center.y - 1 }), 'CHEST_DRAGON');
  assert.strictEqual(map.getObject({ x: center.x - 1, y: center.y + 1 }), 'CHEST_DRAGON');
  assert.strictEqual(map.getObject({ x: center.x + 1, y: center.y + 1 }), 'CHEST_DRAGON');

  // 3首正面アンチ・ブロック押し込みバリア
  assert.strictEqual(map.getItem({ x: center.x, y: center.y - 2 }), 'POTION', 'UP front has POTION');
  assert.strictEqual(map.getObject({ x: center.x - 2, y: center.y }), 'CHEST', 'LEFT front has CHEST');
  assert.strictEqual(map.getObject({ x: center.x + 2, y: center.y }), 'CHEST', 'RIGHT front has CHEST');

  // バリアの左右・上下は BLOCK で挟み込まれ、直線押し込み不可
  assert.strictEqual(map.getObject({ x: center.x - 1, y: center.y - 2 }), 'BLOCK');
  assert.strictEqual(map.getObject({ x: center.x + 1, y: center.y - 2 }), 'BLOCK');
  assert.strictEqual(map.getObject({ x: center.x - 2, y: center.y - 1 }), 'BLOCK');
  assert.strictEqual(map.getObject({ x: center.x - 2, y: center.y + 1 }), 'BLOCK');

  // 南側進入路 (ENT) は空床
  assert.strictEqual(map.getBaseTile({ x: center.x, y: center.y + 2 }), 'EMPTY');
  assert.strictEqual(map.getObject({ x: center.x, y: center.y + 2 }), 'NONE');
  assert.strictEqual(map.getObject({ x: center.x - 1, y: center.y + 2 }), 'BLOCK');
  assert.strictEqual(map.getObject({ x: center.x + 1, y: center.y + 2 }), 'BLOCK');

  // 1-B. 我が家（HOME）プレハブの検証 (COMPACT_3x3)
  const homeAnchor = { x: 45, y: 45 };
  const { homePos, playerStart } = ProceduralMapGenerator.applyHomePrefab(
    map,
    homeAnchor,
    'COMPACT_3x3',
    'NORMAL',
    'STANDARD',
    rng
  );
  assert.strictEqual(map.getBaseTile(homePos), 'HOME');
  assert.strictEqual(map.getBaseTile(playerStart), 'EMPTY');
  assert.strictEqual(map.getItem({ x: homeAnchor.x, y: homeAnchor.y - 1 }), 'POTION');
  assert.strictEqual(map.getItem({ x: homeAnchor.x, y: homeAnchor.y + 1 }), 'COIN');
  assert.strictEqual(map.getObject({ x: homeAnchor.x - 1, y: homeAnchor.y }), 'BLOCK');

  // 1-C. WorldMap の動的座標保持とシリアライズ・デシリアライズ検証
  assert.strictEqual(map.dragonCenter.x, center.x);
  assert.strictEqual(map.dragonCenter.y, center.y);
  assert.strictEqual(map.initialHomePos.x, homePos.x);

  const serialized = map.serialize();
  assert.strictEqual(serialized.dragonCenter?.x, center.x);
  assert.strictEqual(serialized.homePos.x, homePos.x);

  const restoredMap = new WorldMap(64, 64);
  restoredMap.deserialize(serialized);
  assert.strictEqual(restoredMap.dragonCenter.x, center.x);
  assert.strictEqual(restoredMap.homePos.x, homePos.x);
  assert.strictEqual(restoredMap.getBaseTile(homePos), 'HOME');

  console.log('✓ 1. Compact Dragon & Home Prefabs verified successfully.');
}

// ============================================================================
// Test 2: 全域9セクター有機分割 & 動的アンカー埋め込み検証
// ============================================================================
console.log('Testing 2: 9-Sector layout, dynamic anchor selection & line-of-fire clearance...');
{
  const rng = new SeededRandom(54321);
  const sectors = ProceduralMapGenerator.generateDynamicSectors(rng);

  // 2-A. 全域9セクターが生成されること
  assert.strictEqual(sectors.length, 9, 'Should generate 9 dynamic sectors');
  const expectedNames = [
    'NORTH_WEST', 'NORTH_CENTER', 'NORTH_EAST',
    'WEST_CENTER', 'CENTER', 'EAST_CENTER',
    'SOUTH_WEST', 'SOUTH_CENTER', 'SOUTH_EAST',
  ];
  for (let i = 0; i < 9; i++) {
    assert.strictEqual(sectors[i].name, expectedNames[i]);
  }

  // 2-B. 動的ダンジョン生成における我が家とドラゴンの離隔選定
  const map = new WorldMap(64, 64);
  const report = ProceduralMapGenerator.generateDungeon(map, {
    seed: 88888,
    difficulty: 'NORMAL',
    topology: 'MULTI_SECTOR',
  });

  assert.strictEqual(report.isSolvable, true, 'Procedural dungeon must be solvable');
  assert.strictEqual(report.dragonArenaValid, true, 'Dragon arena must be cleared and valid');
  assert.strictEqual(report.bootstrapValid, true, 'Bootstrap items must be valid');

  // 我が家とドラゴンのトーラスマンハッタン距離が十分離れていること（>= 20）
  const dist = map.getTorusDistance(map.homePos, map.dragonCenter).manhattan;
  assert.ok(dist >= 20, `Home and Dragon must be well-separated in 9-sector layout (got ${dist})`);

  // 2-C. 火炎弾射線クリアランスの検証
  // 首正面から最低3マスの射線に壁（WALL_STATIC）やブロック（BLOCK）が塞がっていないこと
  const dc = map.dragonCenter;
  for (let dy = -5; dy >= -7; dy--) {
    const p = map.wrapPosition({ x: dc.x, y: dc.y + dy });
    assert.ok(map.getObject(p) !== 'BLOCK', `Fireball UP line must be clear at dy=${dy}`);
  }
  for (let dx = -5; dx >= -7; dx--) {
    const p = map.wrapPosition({ x: dc.x + dx, y: dc.y });
    assert.ok(map.getObject(p) !== 'BLOCK', `Fireball LEFT line must be clear at dx=${dx}`);
  }
  for (let dx = 5; dx <= 7; dx++) {
    const p = map.wrapPosition({ x: dc.x + dx, y: dc.y });
    assert.ok(map.getObject(p) !== 'BLOCK', `Fireball RIGHT line must be clear at dx=${dx}`);
  }

  console.log('✓ 2. 9-Sector layout, dynamic anchor selection & clearance verified.');
}

// ============================================================================
// Test 3: シード＆設定プリセット保存・再プレイシステム (MapPresetManager)
// ============================================================================
console.log('Testing 3: MapPresetManager save, load, curated presets & share codes...');
{
  // 3-A. 公式おすすめプリセットの検証
  const curated = CURATED_PRESETS;
  assert.ok(curated.length >= 5, 'Should have at least 5 curated presets');
  const grandHall = curated.find(p => p.id === 'curated_grand_hall');
  assert.ok(grandHall !== undefined);
  assert.strictEqual(grandHall.seed, 777777);
  assert.strictEqual(grandHall.isCurated, true);

  // 3-B. プリセット保存・一覧・削除の検証
  const testPreset = MapPresetManager.savePreset({
    name: 'テスト用カスタム迷宮',
    seed: 1234567,
    options: {
      difficulty: 'HARD',
      pacing: 'BLITZ',
      topology: 'SPIRAL_LABYRINTH',
      archetype: 'SIEGE',
      dragonPrefab: 'COMPACT_5x5',
    },
    metrics: {
      cleared: true,
      clearTurns: 150,
      highScore: 5000,
    },
  });
  assert.ok(testPreset.id.startsWith('preset_'));
  assert.strictEqual(testPreset.name, 'テスト用カスタム迷宮');

  const allPresets = MapPresetManager.getAllPresets();
  const foundSaved = allPresets.find(p => p.id === testPreset.id);
  assert.ok(foundSaved !== undefined, 'Saved preset must be in allPresets list');

  // 3-C. 1行共有コードのエクスポートとインポート復元
  const shareCode = MapPresetManager.exportShareCode(testPreset);
  assert.ok(shareCode.startsWith('DS1MAP:'), 'Share code must start with DS1MAP:');

  const importedPreset = MapPresetManager.importShareCode(shareCode);
  assert.ok(importedPreset !== null, 'Imported preset must be valid');
  assert.strictEqual(importedPreset?.seed, 1234567);
  assert.strictEqual(importedPreset?.options.difficulty, 'HARD');
  assert.strictEqual(importedPreset?.options.pacing, 'BLITZ');
  assert.strictEqual(importedPreset?.options.topology, 'SPIRAL_LABYRINTH');
  assert.strictEqual(importedPreset?.options.archetype, 'SIEGE');
  assert.strictEqual(importedPreset?.options.dragonPrefab, 'COMPACT_5x5');

  // 無効な共有コードは null を返すこと
  assert.strictEqual(MapPresetManager.importShareCode('INVALID_CODE'), null);

  // プリセット削除
  const deleted = MapPresetManager.deletePreset(testPreset.id);
  assert.strictEqual(deleted, true, 'User preset should be deleted');
  const afterDelete = MapPresetManager.getAllPresets();
  assert.strictEqual(afterDelete.some(p => p.id === testPreset.id), false);

  // 公式プリセットの削除防止
  const deleteCurated = MapPresetManager.deletePreset('curated_grand_hall');
  assert.strictEqual(deleteCurated, false, 'Curated preset must not be deleted');

  // 3-D. GameEngine とのプリセット起動連携
  const engine = new GameEngine();
  engine.startPresetGame(grandHall);
  assert.strictEqual(engine.getState(), 'PLAYING');
  assert.strictEqual(engine.isProceduralMode, true);
  assert.strictEqual(engine.getProceduralOptions()?.seed, 777777);
  assert.strictEqual(engine.getProceduralOptions()?.topology, 'MULTI_SECTOR');

  // 現在のマップをプリセット保存
  const savedCurrent = engine.saveCurrentMapAsPreset('マイ・グランドホール');
  assert.ok(savedCurrent !== null);
  assert.strictEqual(savedCurrent?.seed, 777777);
  assert.strictEqual(savedCurrent?.name, 'マイ・グランドホール');

  console.log('✓ 3. MapPresetManager & GameEngine integration verified.');
}

console.log('--- ✓ All Phase 12 Tests Passed Successfully! ---');
