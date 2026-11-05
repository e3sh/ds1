import assert from 'assert';
import { GameEngine } from '../src/core/GameEngine.js';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { Dragon } from '../src/models/Dragon.js';
import { MapTacticalMetadata, GravePuzzleHint } from '../src/systems/generator/ThemeBlockTypes.js';

console.log('--- Phase 14 Step 4: AutoPlayBot Tactical Metadata Verification ---');

function createEmptyMap(): WorldMap {
  const map = new WorldMap(64, 64);
  map.clearWarpPairs();
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      map.setBaseTile({ x, y }, 'EMPTY');
      map.setObject({ x, y }, 'NONE');
      map.setItem({ x, y }, 'NONE');
    }
  }
  return map;
}

// Test 1: BOX_EXITS モードの 8x8 箱型墓封鎖判定検証
console.log('Testing 1: BOX_EXITS mode choke point sealing verification...');
{
  const map = createEmptyMap();
  const bot = new AutoPlayBot({ profile: 'STANDARD' });

  // (10, 10) に墓を配置
  const gravePos = { x: 10, y: 10 };
  map.setBaseTile(gravePos, 'GRAVE');

  // 4つの出口チョークポイントを定義
  const exitPositions = [
    { x: 10, y: 6 },
    { x: 10, y: 14 },
    { x: 6, y: 10 },
    { x: 14, y: 10 },
  ];

  const hint: GravePuzzleHint = {
    gravePos,
    themeId: 'GRAVE_8x8_BOX',
    sealMode: 'BOX_EXITS',
    sealTargetPositions: exitPositions,
    recommendedPushes: [],
    priority: 'HIGH',
  };

  const metadata: MapTacticalMetadata = {
    dragonLairStyle: 'STANDARD_FORTRESS',
    recommendedBotTuning: {},
    recommendedRelocateAnchors: [],
    gravePuzzleHints: [hint],
    treasureZoneHints: [],
    breachShortcutPositions: [],
  };
  map.tacticalMetadata = metadata;

  // 初期状態: 4つの出口すべて未封鎖 -> openSpots に 4 箇所返ること
  const openSpots1 = bot.getTargetOpenGraves(map, []).find(g => g.grave.x === 10 && g.grave.y === 10)?.openSpots;
  assert.ok(openSpots1, '墓 (10, 10) が見つかること');
  assert.strictEqual(openSpots1.length, 4, '全出口未封鎖時は4つの出口がターゲットになること');

  // 出口を3箇所 BLOCK で塞ぐ
  map.setObject(exitPositions[0], 'BLOCK');
  map.setObject(exitPositions[1], 'BLOCK');
  map.setObject(exitPositions[2], 'BLOCK');

  const openSpots2 = bot.getTargetOpenGraves(map, []).find(g => g.grave.x === 10 && g.grave.y === 10)?.openSpots;
  assert.ok(openSpots2, '墓 (10, 10) が見つかること');
  assert.strictEqual(openSpots2.length, 1, '3箇所封鎖時は残る1出口のみがターゲットになること');
  assert.strictEqual(openSpots2[0].x, exitPositions[3].x);
  assert.strictEqual(openSpots2[0].y, exitPositions[3].y);

  // 最後の1箇所を CROSS で塞ぐ
  map.setItem(exitPositions[3], 'CROSS');

  const openGraves3 = bot.getTargetOpenGraves(map, []).find(g => g.grave.x === 10 && g.grave.y === 10);
  assert.strictEqual(openGraves3, undefined, '4出口すべて塞がれたら墓は完全封鎖済みと判定されること');

  console.log('✓ 1. BOX_EXITS mode choke point sealing verified.');
}

// Test 2: recommendedPushes による最短手パズル岩押し検証
console.log('Testing 2: recommendedPushes tactical instant push action verification...');
{
  const map = createEmptyMap();
  const dragon = new Dragon({ x: 32, y: 32 });
  const player = new Player({ x: 10, y: 8, hp: 1000, maxHp: 1000, experience: 20000, strength: 50000 });
  player.holdItem = 'RING';

  const gravePos = { x: 10, y: 10 };
  map.setBaseTile(gravePos, 'GRAVE');

  // ブロック (10, 9) を南へ押して (10, 10) の北隣 (10, 9) を塞ぐパズル
  // push: blockPos (10, 9), dir 'DOWN', dest (10, 10) ... ではなく、
  // 墓の隣マス (10, 9) にあるブロックを南へ押して (10, 9) の位置から墓の直近 (10, 9) を塞ぐ、または
  // ブロック (10, 8) にあるブロックを南へ押して (10, 9) を塞ぐ
  map.setObject({ x: 10, y: 9 }, 'BLOCK'); // プレイヤーは (10, 8) に立ち、南 (DOWN) へ押すと (10, 9) のブロックが (10, 10) の手前 (10, 9) から (10, 10) へ...
  // 実際には 墓は (10, 10)、目的の封鎖マスは (10, 9)。
  // ブロック初期位置 (10, 8) を南 (DOWN) へ押すと (10, 9) が埋まる。
  map.setObject({ x: 10, y: 9 }, 'NONE');
  map.setObject({ x: 10, y: 8 }, 'BLOCK');
  player.pos = { x: 10, y: 7 }; // プレイヤーはブロックの北隣 (10, 7) に立つ

  const hint: GravePuzzleHint = {
    gravePos,
    themeId: 'GRAVE_4x4_PUZZLE',
    sealMode: 'DIRECT_8WAY',
    sealTargetPositions: [{ x: 10, y: 9 }],
    recommendedPushes: [
      {
        blockPos: { x: 10, y: 8 },
        dir: 'DOWN',
        destinationPos: { x: 10, y: 9 },
      },
    ],
    priority: 'HIGH',
  };

  const metadata: MapTacticalMetadata = {
    dragonLairStyle: 'STANDARD_FORTRESS',
    recommendedBotTuning: {},
    recommendedRelocateAnchors: [],
    gravePuzzleHints: [hint],
    treasureZoneHints: [],
    breachShortcutPositions: [],
  };
  map.tacticalMetadata = metadata;

  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  const openGraves = bot.getTargetOpenGraves(map, []).filter(g => g.grave.x === 10 && g.grave.y === 10);
  assert.strictEqual(openGraves.length, 1);

  // プレイヤーが pushFromPos (10, 7) にいるため、推奨プッシュにより即座に DOWN が返されること
  const pushAction = bot.findBlockPushForGraves(player, map, [], dragon, openGraves);
  assert.ok(pushAction !== null, '推奨プッシュアクションが取得できること');
  assert.strictEqual(pushAction.type, 'MOVE');
  assert.strictEqual(pushAction.dir, 'DOWN', '即座に DOWN プッシュが決定されること');

  console.log('✓ 2. recommendedPushes tactical instant push action verified.');
}

// Test 3: MAZE_LAIR での我が家移転スキップ & GRAND_TREASURE_HALL 推奨アンカー選定
console.log('Testing 3: MAZE_LAIR relocation skip and GRAND_TREASURE_HALL anchor selection...');
{
  // 3-A. MAZE_LAIR での移転スキップ
  const mapMaze = createEmptyMap();
  mapMaze.tacticalMetadata = {
    dragonLairStyle: 'MAZE_LAIR',
    recommendedBotTuning: {
      enableHomeRelocation: false,
    },
    recommendedRelocateAnchors: [],
    gravePuzzleHints: [],
    treasureZoneHints: [],
    breachShortcutPositions: [],
  };

  const botMaze = new AutoPlayBot({ profile: 'STANDARD' });
  botMaze.assessMap(mapMaze);
  assert.strictEqual(
    botMaze.tuning.enableHomeRelocation,
    false,
    'MAZE_LAIR では enableHomeRelocation が false になること'
  );

  // 3-B. GRAND_TREASURE_HALL での推奨アンカー選定
  const mapHall = createEmptyMap();
  const dragon = new Dragon({ x: 32, y: 32 });
  const player = new Player({ x: 20, y: 20 });
  const recommendedAnchor = { x: 28, y: 26 };

  mapHall.tacticalMetadata = {
    dragonLairStyle: 'GRAND_TREASURE_HALL',
    recommendedBotTuning: {
      enableHomeRelocation: true,
    },
    recommendedRelocateAnchors: [recommendedAnchor],
    gravePuzzleHints: [],
    treasureZoneHints: [],
    breachShortcutPositions: [],
  };

  const botHall = new AutoPlayBot({ profile: 'STANDARD' });
  const selectedAnchor = botHall.findHomeRelocateAnchor(mapHall, dragon, [], player);
  assert.ok(selectedAnchor !== null, 'アンカーが選定されること');
  assert.strictEqual(selectedAnchor.x, recommendedAnchor.x, '推奨アンカー座標 x が最優先で選択されること');
  assert.strictEqual(selectedAnchor.y, recommendedAnchor.y, '推奨アンカー座標 y が最優先で選択されること');

  console.log('✓ 3. MAZE_LAIR relocation skip and GRAND_TREASURE_HALL anchor selection verified.');
}

// Test 4: isEightStepOptimal: true 宝物ゾーンの優先選定検証
console.log('Testing 4: isEightStepOptimal treasure zone candidate prioritization...');
{
  const map = createEmptyMap();
  const player = new Player({ x: 20, y: 20 });

  // 宝箱 A: (20, 24) -> 距離 4 (通常ゾーン外)
  map.setObject({ x: 20, y: 24 }, 'CHEST');

  // 宝箱 B: (20, 27) -> 距離 7 (通常は A より遠い)
  // ただし 8歩最適ゾーン内 (bounds: 18..22, 25..30)
  map.setObject({ x: 20, y: 27 }, 'CHEST');

  map.tacticalMetadata = {
    dragonLairStyle: 'STANDARD_FORTRESS',
    recommendedBotTuning: {},
    recommendedRelocateAnchors: [],
    gravePuzzleHints: [],
    treasureZoneHints: [
      {
        id: 'CHEST_CLUSTER_1',
        bounds: { x1: 18, y1: 25, x2: 22, y2: 30 },
        entryPorts: [],
        chestCount: 3,
        isEightStepOptimal: true,
      },
    ],
    breachShortcutPositions: [],
  };

  const bot = new AutoPlayBot({ profile: 'STANDARD' });

  // 未ロック時の宝箱候補取得
  const candidates = bot.findNearestChestCandidates(player.pos, map, [], player, 2, {
    tacticalMetadata: map.tacticalMetadata,
  });

  assert.strictEqual(candidates.length, 2);
  // 宝箱 B は距離7だが最適ゾーンボーナス (-6) により実効距離1となり、宝箱 A (距離4) より優先されること
  assert.strictEqual(candidates[0].x, 20);
  assert.strictEqual(candidates[0].y, 27, '8歩最適ゾーン内の宝箱が実質距離ボーナスで優先されること');

  console.log('✓ 4. isEightStepOptimal treasure zone candidate prioritization verified.');
}

console.log('--- ✓ All Phase 14 Step 4 AutoPlayBot Tactical Metadata Tests Passed Successfully! ---');
