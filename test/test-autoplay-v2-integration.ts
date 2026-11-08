import assert from 'assert';
import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { Dragon } from '../src/models/Dragon.js';
import { GameEngine } from '../src/core/GameEngine.js';
import { SeedRandom } from '../src/core/SeedRandom.js';
import { GameEventBus } from '../src/core/GameEventBus.js';
import { TacticalContext } from '../src/ai/v2/TacticalContext.js';
import { AdaptiveNavigator } from '../src/ai/v2/AdaptiveNavigator.js';
import { AdaptiveAutoPlayBot } from '../src/ai/v2/AdaptiveAutoPlayBot.js';
import { MapTacticalMetadata, GravePuzzleHint } from '../src/systems/generator/ThemeBlockTypes.js';
import { GraveSealBehavior } from '../src/ai/v2/behaviors/GraveSealBehavior.js';

console.log('================================================================');
console.log('   AdaptiveAutoPlayBot (v2) Integration & Scale Verification   ');
console.log('================================================================');

// Test 1: マップサイズ正規化距離スケーリング (TacticalScale) の検証
console.log('Testing 1: Dynamic TacticalScale normalization on various map sizes...');
{
  const map32 = new WorldMap(32, 32);
  const ctx32 = new TacticalContext(map32);
  assert.strictEqual(ctx32.scale.maxToroidalDist, 32, '32x32のトーラス最大距離は32');
  assert.strictEqual(ctx32.scale.nearRadius, 5, '32x32の近傍半径は約5');

  const map64 = new WorldMap(64, 64);
  const ctx64 = new TacticalContext(map64);
  assert.strictEqual(ctx64.scale.maxToroidalDist, 64, '64x64のトーラス最大距離は64');
  assert.strictEqual(ctx64.scale.nearRadius, 10, '64x64の近傍半径は約10');

  const player = new Player({ x: 10, y: 10, hp: 1000, maxHp: 1000 });
  const params32 = ctx32.resolveParameters('RESOURCE_FARM', player);
  const params64 = ctx64.resolveParameters('RESOURCE_FARM', player);

  assert.ok(params64.keySearchDist > params32.keySearchDist, '64x64マップの探索距離は32x32より適切に拡大すること');
  console.log(`✓ 1. Scale verified: 32x32(near:${ctx32.scale.nearRadius}, far:${params32.keySearchDist}) vs 64x64(near:${ctx64.scale.nearRadius}, far:${params64.keySearchDist})`);
}

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

// Test 2: MapTacticalMetadata (箱型墓出口チョークポイント) の解釈検証
console.log('Testing 2: Metadata interpretation for choke-point grave sealing...');
{
  const map = createEmptyMap();
  const gravePos = { x: 15, y: 15 };
  map.setBaseTile(gravePos, 'GRAVE');

  const exitPositions = [
    { x: 15, y: 11 },
    { x: 15, y: 19 },
    { x: 11, y: 15 },
    { x: 19, y: 15 },
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

  const ctx = new TacticalContext(map);
  const player = new Player({ x: 10, y: 10, hp: 1000, maxHp: 1000, strength: 50000 });
  const params = ctx.resolveParameters('GRAVE_SEAL', player);

  // 4出口未封鎖時は出口4箇所が返る
  const spots1 = GraveSealBehavior.getTargetSealSpots(map, [], ctx, params);
  assert.strictEqual(spots1.length, 4, 'メタデータで指定された4出口がターゲットになること');

  // 1箇所塞ぐと残る3箇所のみになる
  map.setObject(exitPositions[0], 'BLOCK');
  const spots2 = GraveSealBehavior.getTargetSealSpots(map, [], ctx, params);
  assert.strictEqual(spots2.length, 3, '塞がれたマスは自動除外されること');

  console.log('✓ 2. Metadata-driven grave choke point sealing targets verified.');
}

// Test 3: 一元化されたスタック・ピンポン追跡 (AdaptiveNavigator) の検証
console.log('Testing 3: Unified AdaptiveNavigator ping-pong and loop tracking...');
{
  const nav = new AdaptiveNavigator();

  // A -> B -> A 往復
  nav.updateTurn({ x: 5, y: 5 });
  nav.updateTurn({ x: 6, y: 5 });
  assert.strictEqual(nav.pingPongCount, 0);

  nav.updateTurn({ x: 5, y: 5 });
  assert.strictEqual(nav.pingPongCount, 1, 'A->B->A往復でピンポンカウント+1');

  nav.updateTurn({ x: 6, y: 5 });
  assert.strictEqual(nav.pingPongCount, 2, '継続往復でピンポンカウント+2');

  // レスキュー発動でリセット
  nav.triggerRescue(4);
  assert.strictEqual(nav.forceWanderTurns, 4, 'レスキュー待機ターンが設定されること');
  assert.strictEqual(nav.pingPongCount, 0, 'ピンポンカウントがリセットされること');

  console.log('✓ 3. Unified tracker and rescue triggered successfully.');
}

// Test 4: プロシージャルゲームでの AdaptiveAutoPlayBot 実機走行検証
console.log('Testing 4: AdaptiveAutoPlayBot step execution in procedural game...');
{
  const rng = new SeedRandom(4242);
  const eventBus = new GameEventBus();
  const engine = new GameEngine({ rng, eventBus });

  engine.startProceduralGame({
    seed: 4242,
    topology: 'STANDARD_ROOMS',
    difficulty: 'NORMAL',
    pacing: 'STANDARD',
  });

  const bot = new AdaptiveAutoPlayBot({ profile: 'STANDARD' });

  // 100ターン自走テスト
  let turns = 0;
  for (let i = 0; i < 100; i++) {
    if (engine.getState() !== 'PLAYING') break;
    turns++;
    engine.stepFrame(100);
    bot.step(engine);
  }

  assert.ok(turns >= 50, '最低50ターン以上問題なくスムーズに自走すること');
  const player = engine.getPlayer();
  console.log(`✓ 4. Bot survived ${turns} turns, Phase: ${bot.currentPhase}, Player STR: ${player.strength}, HP: ${player.hp}/${player.maxHp}`);
}

console.log('================================================================');
console.log('   ALL AdaptiveAutoPlayBot (v2) TESTS PASSED SUCCESSFULLY!     ');
console.log('================================================================');
