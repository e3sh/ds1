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
import { ResourceFarmBehavior } from '../src/ai/v2/behaviors/ResourceFarmBehavior.js';
import { CombatBehavior } from '../src/ai/v2/behaviors/CombatBehavior.js';
import { EnemyInstance } from '../src/models/Enemy.js';

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

// Test 5: 墓封鎖の「十字架設置⇔回収」無限ループ防止の検証
console.log('Testing 5: Grave seal cross infinite pickup-drop loop prevention...');
{
  const map = createEmptyMap();
  const gravePos = { x: 10, y: 10 };
  map.setBaseTile(gravePos, 'GRAVE');

  const crossPos = { x: 10, y: 9 }; // 墓の上隣接
  map.setItem(crossPos, 'CROSS');

  const ctx = new TacticalContext(map);
  const isSealing = GraveSealBehavior.isCrossSealing(crossPos, map, ctx);
  assert.strictEqual(isSealing, true, '墓に隣接する十字架は使用済み(isCrossSealing=true)と判定されること');

  const distantPos = { x: 20, y: 20 };
  map.setItem(distantPos, 'CROSS');
  assert.strictEqual(GraveSealBehavior.isCrossSealing(distantPos, map, ctx), false, '離れた野良十字架は未使用(false)と判定されること');

  console.log('✓ 5. Cross sealing verification passed (no infinite pickup loop).');
}

// Test 6: MP=1 セーフティリザーブ保護の検証
console.log('Testing 6: MP=1 safety reserve protection (magicReserveThreshold)...');
{
  const bot = new AdaptiveAutoPlayBot();
  const player = new Player({ x: 5, y: 5, hp: 1000, maxHp: 1000 });

  // BREAK未習得 (EXP < 4000) の場合: MP=1 でも魔法消費許可
  player.magic = 1;
  player.experience = 1000;
  assert.strictEqual(bot.canSpendMagicReserve(player), true, 'BREAK未習得時はMP=1でも消費可');

  // BREAK習得後 (EXP >= 4000) の場合: MP=1 はコスト0壁掘り維持のため消費拒否
  player.experience = 5000;
  player.magic = 1;
  assert.strictEqual(bot.canSpendMagicReserve(player), false, 'BREAK習得後はMP=1を死守して消費拒否');

  // MP >= 2 の場合: 常に消費許可
  player.magic = 2;
  assert.strictEqual(bot.canSpendMagicReserve(player), true, 'MP>=2なら常に消費許可');

  // 逃げ場のない即死危機時: MP=1 でも緊急許可
  player.magic = 1;
  assert.strictEqual(bot.canSpendMagicReserve(player, { isLethalEmergency: true, hasEvadeRoute: false }), true, '逃げ場のない即死危機時はMP=1でも消費許可');

  console.log('✓ 6. MP=1 reserve safety protection verified.');
}

// Test 7: BFS直前マス逆戻りペナルティのインデックス検証
console.log('Testing 7: BFS reverse step penalty indexing verification...');
{
  const nav = new AdaptiveNavigator();
  const map = createEmptyMap();
  const ctx = new TacticalContext(map);
  const player = new Player({ x: 10, y: 10 });
  const params = ctx.resolveParameters('RESOURCE_FARM', player);

  nav.updateTurn({ x: 9, y: 10 });  // 2手前
  nav.updateTurn({ x: 10, y: 10 }); // 1手前 (直前)
  nav.updateTurn({ x: 11, y: 10 }); // 現在地

  // 目的地を (15, 10) とした時、直前マス (10, 10) への逆戻りペナルティが機能して右 (12, 10) に進むこと
  const dir = nav.findPath({ x: 11, y: 10 }, { x: 15, y: 10 }, map, player, [], params);
  assert.strictEqual(dir, 'RIGHT', '目的地へ直進し直前マスへ逆戻りしないこと');

  console.log('✓ 7. BFS reverse step penalty indexing verified.');
}

// Test 8: 8歩周期パワーストーン・チェーン・ファーミングの検証
console.log('Testing 8: 8-step cycle power stone chain farming verification...');
{
  const map = createEmptyMap();
  const player = new Player({ x: 10, y: 10, strength: 1000 });
  player.holdItem = 'KEY';
  player.stepCountSinceStone = 0;
  // 足元に石が出現した状態
  map.setItem({ x: 10, y: 10 }, 'POWER_STONE');

  // 斜め隣接 (11, 11) に未開封宝箱を配置
  map.setObject({ x: 11, y: 11 }, 'CHEST');

  const bot = new AdaptiveAutoPlayBot();
  const ctx = new TacticalContext(map);
  const dragon = new Dragon({ x: 32, y: 32 });
  const params = ctx.resolveParameters('RESOURCE_FARM', player, dragon);

  const swapState = { itemToPickupPos: null, tempDroppedKeyPos: null, swapTurns: 0 };
  const res = ResourceFarmBehavior.execute(player, map, [], dragon, bot.nav, ctx, params, swapState, bot);

  assert.ok(res !== null, '行動が決定されること');
  assert.ok(bot.eightStepController.eightStepTargetChestPos !== null, '周辺宝箱への8歩周期チェーンが起動すること');
  assert.strictEqual(bot.eightStepController.eightStepTargetChestPos.x, 11);
  assert.strictEqual(bot.eightStepController.eightStepTargetChestPos.y, 11);
  assert.strictEqual(res.action.type, 'MOVE', '足元の石回収ではなく次の宝箱へのアプローチ移動を行うこと');
  assert.ok(res.description.includes('8歩周期チェーン開始'), '行動説明にチェーン開始が含まれること');

  console.log('✓ 8. 8-step cycle power stone chain farming verified.');
}

// Test 9: 訪問ヒートマップによる岩周回検知と KICK スナイプ打開の検証
console.log('Testing 9: Heatmap-driven rock circling detection and KICK snipe resolution...');
{
  const map = createEmptyMap();
  const player = new Player({ x: 10, y: 10, strength: 2000, experience: 8000 });
  player.magic = 2; // 明示的にMPを設定 (Playerコンストラクタはmagicを0に初期化するため)

  // (11, 10) に岩 (BLOCK) を配置
  map.setObject({ x: 11, y: 10 }, 'BLOCK');

  // 岩の先の直線 (12, 10) に敵を配置
  const enemy = new EnemyInstance({ typeId: 1, pos: { x: 12, y: 10 } });
  const enemies = [enemy];

  const bot = new AdaptiveAutoPlayBot();
  const ctx = new TacticalContext(map);
  const dragon = new Dragon({ x: 32, y: 32 });
  const params = ctx.resolveParameters('RESOURCE_FARM', player, dragon);

  // プレイヤーが岩の周囲を4回周回してヒートマップ熱量を蓄積
  for (let i = 0; i < 4; i++) {
    bot.nav.updateTurn({ x: 10, y: 9 });
    bot.nav.updateTurn({ x: 10, y: 10 });
    bot.nav.updateTurn({ x: 10, y: 11 });
    bot.nav.updateTurn({ x: 9, y: 10 });
  }
  bot.nav.updateTurn({ x: 10, y: 10 }); // 現在地 (岩の左隣)

  const heat = bot.nav.getHeat({ x: 10, y: 10 });
  assert.ok(heat >= 12, '現在地の熱量が閾値(12)以上に蓄積されていること');

  const res = CombatBehavior.tryBreakCirclingLoop(player, map, enemies, dragon, bot.nav, params);
  assert.ok(res !== null, '周回打開アクションが決定されること');
  assert.strictEqual(res.action.type, 'MAGIC', 'KICK魔法が選択されること');
  assert.strictEqual((res.action as any).magic, 'KICK', 'KICKが選択されること');
  assert.ok(res.description.includes('KICKスナイプ'), 'KICKスナイプの記述が含まれること');

  console.log('✓ 9. Heatmap rock circling KICK snipe verified.');
}

// Test 10: 訪問ヒートマップによる墓周回検知と FREEZE 氷像化の検証
console.log('Testing 10: Heatmap-driven grave circling detection and FREEZE barricade resolution...');
{
  const map = createEmptyMap();
  const player = new Player({ x: 10, y: 10, strength: 2000, experience: 8000 });
  player.magic = 3; // 明示的にMPを設定

  // (11, 10) に墓 (GRAVE) を配置
  map.setObject({ x: 11, y: 10 }, 'GRAVE');

  // 墓の近傍 (11, 11) に敵を配置
  const enemy = new EnemyInstance({ typeId: 1, pos: { x: 11, y: 11 } });
  const enemies = [enemy];

  const bot = new AdaptiveAutoPlayBot();
  const ctx = new TacticalContext(map);
  const dragon = new Dragon({ x: 32, y: 32 });
  const params = ctx.resolveParameters('RESOURCE_FARM', player, dragon);

  // 墓の周囲を4回周回してヒートマップ熱量を蓄積
  for (let i = 0; i < 4; i++) {
    bot.nav.updateTurn({ x: 10, y: 9 });
    bot.nav.updateTurn({ x: 10, y: 10 });
    bot.nav.updateTurn({ x: 10, y: 11 });
    bot.nav.updateTurn({ x: 9, y: 10 });
  }
  bot.nav.updateTurn({ x: 10, y: 10 });

  const res = CombatBehavior.tryBreakCirclingLoop(player, map, enemies, dragon, bot.nav, params);
  assert.ok(res !== null, '周回打開アクションが決定されること');
  assert.strictEqual(res.action.type, 'MAGIC', '魔法が選択されること');
  assert.strictEqual((res.action as any).magic, 'FREEZE', 'FREEZE氷像化が選択されること');
  assert.ok(res.description.includes('FREEZE氷像化'), 'FREEZE氷像化の記述が含まれること');

  console.log('✓ 10. Heatmap grave circling FREEZE barricade verified.');
}

console.log('================================================================');
console.log('   ALL AdaptiveAutoPlayBot (v2) TESTS PASSED SUCCESSFULLY!     ');
console.log('================================================================');
