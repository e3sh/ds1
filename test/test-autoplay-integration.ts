import assert from 'assert';
import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { Dragon } from '../src/models/Dragon.js';
import { GameEngine } from '../src/core/GameEngine.js';
import { SeedRandom } from '../src/core/SeedRandom.js';
import { GameEventBus } from '../src/core/GameEventBus.js';
import { TacticalContext } from '../src/ai/TacticalContext.js';
import { AdaptiveNavigator } from '../src/ai/AdaptiveNavigator.js';
import { AutoPlayBot, AdaptiveAutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { MapTacticalMetadata, GravePuzzleHint } from '../src/systems/generator/ThemeBlockTypes.js';
import { GraveSealBehavior } from '../src/ai/behaviors/GraveSealBehavior.js';
import { RelocateBehavior } from '../src/ai/behaviors/RelocateBehavior.js';
import { ResourceFarmBehavior } from '../src/ai/behaviors/ResourceFarmBehavior.js';
import { CombatBehavior } from '../src/ai/behaviors/CombatBehavior.js';
import { EscapeBehavior } from '../src/ai/behaviors/EscapeBehavior.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { BotAction } from '../src/ai/BotTypes.js';

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

// Test 11: CROWN_ESCAPE におけるスタン中 (frozenTimer > 0) の敵への FLASH 無駄撃ち抑止の検証
console.log('Testing 11: Suppression of redundant FLASH casting on stunned enemies during CROWN_ESCAPE...');
{
  const map = createEmptyMap();
  map.setBaseTile({ x: 8, y: 8 }, 'HOME');
  map.homePos = { x: 8, y: 8 };
  map.setRealHomePos({ x: 8, y: 8 });

  // プレイヤー: FLASH 習得済み (EXP 20,000), MP=5, 足元 (10, 8) に王冠
  const player = new Player({ x: 10, y: 8, hp: 20000, strength: 400000, experience: 20000 });
  player.hasSword = true;
  player.magic = 5;
  player.holdItem = 'NONE';
  map.setItem({ x: 10, y: 8 }, 'CROWN');

  // 隣接マス (10, 9) に即死級の強敵 (typeId: 20, ATK 60000) を配置
  const lethalEnemy = new EnemyInstance({ typeId: 20, pos: { x: 10, y: 9 }, atk: 60000, def: 500000, hp: 50000 });
  const enemies = [lethalEnemy];

  const dragon = new Dragon({ x: 32, y: 32 });
  for (const h of dragon.heads) {
    h.isAlive = false;
    h.hp = 0;
  }

  const bot = new AdaptiveAutoPlayBot();
  bot.setPhase('CROWN_ESCAPE');
  const ctx = new TacticalContext(map);
  const params = ctx.resolveParameters('CROWN_ESCAPE', player, dragon, enemies);

  // 1ターン目: 敵が未スタン (frozenTimer === 0) のため、自衛の FREEZE または FLASH を詠唱する
  const res1 = EscapeBehavior.execute(player, map, enemies, dragon, [], bot.nav, ctx, params);
  assert.ok(res1 !== null, '1ターン目の行動が決定されること');
  assert.strictEqual(res1.action.type, 'MAGIC', '未スタンの即死敵に対しては魔法自衛を行うこと');

  // FLASH 発動後をシミュレート: 敵がスタン中 (frozenTimer = 8)
  lethalEnemy.frozenTimer = 8;

  // 2ターン目: 敵がスタン中なので FLASH を空撃ちせず、即座に足元の王冠を取得 (SPACE) すること
  const res2 = EscapeBehavior.execute(player, map, enemies, dragon, [], bot.nav, ctx, params);
  assert.ok(res2 !== null, '2ターン目の行動が決定されること');
  assert.strictEqual(res2.action.type, 'SPACE', 'スタン中の敵に対してFLASHを再詠唱せず、王冠を取得(SPACE)すること');
  assert.ok(res2.description.includes('王冠を取得'), '行動説明が王冠取得であること');

  // 3ターン目: 王冠所持後 (holdItem = 'CROWN')、スタン中の敵が隣接していても王冠をドロップせず我が家 (8, 8) へ移動 (LEFT) すること
  player.holdItem = 'CROWN';
  map.setItem({ x: 10, y: 8 }, 'NONE');
  const res3 = EscapeBehavior.execute(player, map, enemies, dragon, [], bot.nav, ctx, params);
  assert.ok(res3 !== null, '3ターン目の行動が決定されること');
  assert.strictEqual(res3.action.type, 'MOVE', 'スタン中の敵に怯えず我が家へ移動すること');
  assert.strictEqual((res3.action as any).dir, 'LEFT', '我が家(8,8)の方向(LEFT)へ移動すること');

  console.log('✓ 11. Stunned enemy exclusion & crown pickup/escape during FLASH stun verified.');
}

// Test 12: 宝箱開け効率化（スワップ廃止・連続開錠＆宝箱枯渇後の鍵手放し回収）の検証
console.log('Testing 12: Post-targetStr chest unlocking, continuous opening without COIN swap, and batch cash-in return...');
{
  const map = createEmptyMap();
  map.setBaseTile({ x: 8, y: 8 }, 'HOME');
  map.homePos = { x: 8, y: 8 };
  map.setRealHomePos({ x: 8, y: 8 });

  const dragon = new Dragon({ x: 32, y: 32 });
  const ctx = new TacticalContext(map);

  // プレイヤー: STRは目標達成済み (600,000 >= targetStr)、しかし防御EXPが未達 (16,000 < 40,000)
  const player = new Player({ x: 12, y: 8, hp: 16000, strength: 600000, experience: 16000 });
  player.hasSword = true;
  player.magic = 5;
  player.holdItem = 'KEY';

  const bot = new AdaptiveAutoPlayBot();
  const params = ctx.resolveParameters('RESOURCE_FARM', player, dragon, []);
  const swapState = { itemToPickupPos: null, tempDroppedKeyPos: null, swapTurns: 0 };

  // A. 宝箱の上にいて鍵所持 (stepCountSinceStone = 3 < 8):
  // STR達成済みなので8歩周期ピボット待機をせず、即座に開錠 (SPACE) すること
  map.setObject({ x: 12, y: 8 }, 'CHEST');
  player.stepCountSinceStone = 3;
  const resOpen = ResourceFarmBehavior.execute(player, map, [], dragon, bot.nav, ctx, params, swapState, bot);
  assert.ok(resOpen !== null);
  assert.strictEqual(resOpen.action.type, 'SPACE', 'STR達成後はピボット待機せず即座に宝箱を開錠すること');

  // B1. 宝箱から COIN が出現し、別の宝箱 (16, 8) がある状態:
  // 足元のCOINをスワップ回収せず、床に残したまま次の未開封宝箱へ向かうこと
  map.setObject({ x: 12, y: 8 }, 'NONE');
  map.setItem({ x: 12, y: 8 }, 'COIN');
  map.setObject({ x: 16, y: 8 }, 'CHEST');
  const resNextChest = ResourceFarmBehavior.execute(player, map, [], dragon, bot.nav, ctx, params, swapState, bot);
  assert.ok(resNextChest !== null);
  assert.strictEqual(resNextChest.action.type, 'MOVE', '次の宝箱へ移動すること');
  assert.strictEqual(swapState.itemToPickupPos, null, '足元COINに対する一時置きスワップは発生しないこと');
  assert.ok(resNextChest.description.includes('宝箱へ移動'), '行動説明が宝箱へ移動であること');

  // B2. 他に宝箱が存在しない場合: 鍵を床に置いて手放すこと
  map.setObject({ x: 16, y: 8 }, 'NONE');
  const resDropKey = ResourceFarmBehavior.execute(player, map, [], dragon, bot.nav, ctx, params, swapState, bot);
  assert.ok(resDropKey !== null);
  // 足元が COIN なので、隣接安全マスへ移動して置くか、置く処理が発火
  assert.ok(resDropKey.description.includes('鍵'), '鍵を手放すための処理が発火すること');

  // C. コインが4枚貯まった状態: 我が家 (8, 8) へ徒歩帰還して一括換金を行うこと
  swapState.itemToPickupPos = null;
  swapState.tempDroppedKeyPos = null;
  map.setItem({ x: 12, y: 8 }, 'NONE');
  player.gold = 4;
  const resCashIn = ResourceFarmBehavior.execute(player, map, [], dragon, bot.nav, ctx, params, swapState, bot);
  assert.ok(resCashIn !== null);
  assert.strictEqual(resCashIn.action.type, 'MOVE', '我が家へ徒歩帰還すること');
  assert.strictEqual((resCashIn.action as any).dir, 'LEFT', '我が家(8,8)へ向かうこと');
  assert.ok(resCashIn.description.includes('コイン一括換金'), '行動説明にコイン一括換金が含まれること');

  console.log('✓ 12. Post-targetStr chest continuous opening and batch cash-in verified.');
}

// Test 13: 序盤の剣回収前ハマり（物理的詰み）のヒートマップ検知と GiveUP 発火の検証
console.log('Testing 13: Heatmap-based early sword trap detection and GiveUP termination...');
{
  const rng = new SeedRandom(9999);
  const eventBus = new GameEventBus();
  const engine = new GameEngine({ rng, eventBus });
  engine.startClassicGame();

  const map = createEmptyMap();
  engine.setMap(map);
  engine.setEnemies([]);
  engine.setGhosts([]);

  // プレイヤーを (5, 5) の小部屋に配置し、周囲をすべて外壁 (WALL_STATIC) で完全に囲む
  for (let x = 3; x <= 7; x++) {
    map.setBaseTile({ x, y: 3 }, 'WALL_STATIC');
    map.setBaseTile({ x, y: 7 }, 'WALL_STATIC');
  }
  for (let y = 3; y <= 7; y++) {
    map.setBaseTile({ x: 3, y }, 'WALL_STATIC');
    map.setBaseTile({ x: 7, y }, 'WALL_STATIC');
  }
  // 剣は小部屋の外 (20, 20) に配置（到達不能）
  map.setItem({ x: 20, y: 20 }, 'SWORD');

  const player = engine.getPlayer();
  player.pos = { x: 5, y: 5 };
  player.hasSword = false;
  player.experience = 1000; // BREAK未習得
  player.magic = 0;

  const bot = new AdaptiveAutoPlayBot();
  let steps = 0;
  while (steps < 50 && engine.getState() === 'PLAYING' && !bot.isGivenUp) {
    steps++;
    bot.step(engine);
  }

  assert.strictEqual(bot.isGivenUp, true, '物理的詰みを検知して bot.isGivenUp が true になること');
  assert.strictEqual(engine.getState(), 'GAMEOVER', 'ギブアップによりゲーム状態が即座に GAMEOVER になること');
  assert.strictEqual(player.deathInfo?.cause, 'GIVE_UP_UNSOLVABLE', '死因に GIVE_UP_UNSOLVABLE が記録されること');
  assert.ok(bot.currentTargetDesc.includes('詰み検知'), '行動説明に詰み検知ギブアップが記録されること');
  assert.ok(steps <= 25, `3,000ターンを待たず早期（${steps}ターン）にギブアップ終了すること`);

  console.log(`✓ 13. Early sword trap detected and GiveUP triggered in ${steps} turns.`);
}

// Test 14: 家移動モード (RELOCATE_HOME) 移行時の手ぶら化処理の検証
console.log('Testing 14: RelocateBehavior hands-free drop and RING pickup...');
{
  const map = createEmptyMap();
  map.setBaseTile({ x: 10, y: 10 }, 'HOME');
  map.homePos = { x: 10, y: 10 };
  map.setRealHomePos({ x: 10, y: 10 });
  const dragon = new Dragon({ x: 30, y: 30 });
  const ctx = new TacticalContext(map);
  const bot = new AdaptiveAutoPlayBot();
  const params = ctx.resolveParameters('RELOCATE_HOME', new Player({ x: 10, y: 11 }), dragon, []);

  // RING を (12, 10) に配置
  map.setItem({ x: 12, y: 10 }, 'RING');

  // プレイヤーが KEY を持っている状態で (11, 10) にいる
  const player = new Player({ x: 11, y: 10 });
  player.holdItem = 'KEY';
  const anchor = { x: 25, y: 25 };

  // 1手目: KEY を安全な床に置く処理が発火すること（null を返さない）
  const resDrop = RelocateBehavior.execute(player, map, [], dragon, bot.nav, ctx, params, anchor);
  assert.ok(resDrop !== null, '手持ちKEYがある場合は手ぶら化アクションが返ること');
  assert.strictEqual(resDrop.action.type, 'SPACE', '床に置くSPACEアクションが返ること');
  assert.ok(resDrop.description.includes('RING回収準備'), '行動説明に手ぶら化準備が含まれること');

  // 手ぶら化をシミュレート
  player.holdItem = 'NONE';
  map.setItem({ x: 11, y: 10 }, 'KEY');

  // 2手目: RING (12, 10) に向かって移動すること
  const resMove = RelocateBehavior.execute(player, map, [], dragon, bot.nav, ctx, params, anchor);
  assert.ok(resMove !== null);
  assert.strictEqual(resMove.action.type, 'MOVE', 'RINGへ向かって移動すること');
  assert.strictEqual((resMove.action as any).dir, 'RIGHT');

  // 3手目: RING のマスに到着したら SPACE で RING を取得すること
  player.pos = { x: 12, y: 10 };
  const resPickup = RelocateBehavior.execute(player, map, [], dragon, bot.nav, ctx, params, anchor);
  assert.ok(resPickup !== null);
  assert.strictEqual(resPickup.action.type, 'SPACE', 'RINGを取得するSPACEアクションが返ること');
  assert.ok(resPickup.description.includes('RINGを取得'), '行動説明にRING取得が含まれること');

  console.log('✓ 14. RelocateBehavior hands-free drop and RING pickup verified.');
}

// Test 15: 墓封鎖 (GRAVE_SEAL) におけるKEY所持時の手ぶら化と起動保証の検証
console.log('Testing 15: GraveSealBehavior hands-free drop and non-null execution with KEY...');
{
  const map = createEmptyMap();
  map.setBaseTile({ x: 10, y: 10 }, 'GRAVE');
  // 未使用十字架を (15, 10) に配置
  map.setItem({ x: 15, y: 10 }, 'CROSS');

  const dragon = new Dragon({ x: 32, y: 32 });
  const ctx = new TacticalContext(map);
  const bot = new AdaptiveAutoPlayBot();
  const params = ctx.resolveParameters('GRAVE_SEAL', new Player({ x: 12, y: 10 }), dragon, []);

  // プレイヤーが KEY を所持している状態
  const player = new Player({ x: 12, y: 10 });
  player.holdItem = 'KEY';

  // 1手目: null で即座に終了せず、手ぶら化アクションを返すこと
  const resDrop = GraveSealBehavior.execute(player, map, [], dragon, bot.nav, ctx, params);
  assert.ok(resDrop !== null, '封鎖手段がある場合はKEY所持でもnullを返さず手ぶら化すること');
  assert.strictEqual(resDrop.action.type, 'SPACE', '所持品を置くSPACEアクションが返ること');
  assert.ok(resDrop.description.includes('墓封鎖準備'), '行動説明に墓封鎖準備が含まれること');

  // 手ぶら化後: 十字架回収へ向かうこと
  player.holdItem = 'NONE';
  const resMove = GraveSealBehavior.execute(player, map, [], dragon, bot.nav, ctx, params);
  assert.ok(resMove !== null);
  assert.strictEqual(resMove.action.type, 'MOVE', '十字架回収へ移動すること');
  assert.ok(resMove.description.includes('十字架'), '行動説明に十字架回収が含まれること');

  console.log('✓ 15. GraveSealBehavior hands-free drop and non-null execution verified.');
}

// Test 16: RING所持時の岩押し保護と墓封鎖ブロックの破壊保護の検証
console.log('Testing 16: RING block push preservation and grave block break protection...');
{
  const map = createEmptyMap();
  const bot = new AdaptiveAutoPlayBot();

  // 16-1. RING所持時: 前方に岩があり押し先が空いている場合、BREAK変換せずMOVE(岩押し)を実行
  const player1 = new Player({ x: 5, y: 5, magic: 10, experience: 10000 }); // BREAK使用可能
  player1.holdItem = 'RING';
  map.setObject({ x: 6, y: 5 }, 'BLOCK');
  // (7, 5) は空きマス
  const pushAction: BotAction = { type: 'MOVE', dir: 'RIGHT' };
  const resolvedPush = bot.resolveMoveOrBreak(pushAction, player1, map);
  assert.strictEqual(resolvedPush.type, 'MOVE', 'RING所持で岩が押せる場合はBREAK変換せずMOVEのままであること');

  // 16-2. 墓の周囲8マスのBLOCKに対する破壊保護: 手ぶらでBREAKが使える場合でもBREAK変換しない
  map.setBaseTile({ x: 10, y: 10 }, 'GRAVE');
  map.setObject({ x: 11, y: 10 }, 'BLOCK'); // 墓の右隣の岩
  const player2 = new Player({ x: 12, y: 10, magic: 10, experience: 10000 });
  player2.holdItem = 'NONE';
  const moveTowardsGraveBlock: BotAction = { type: 'MOVE', dir: 'LEFT' }; // (11, 10) の岩に向かう
  const resolvedProtected = bot.resolveMoveOrBreak(moveTowardsGraveBlock, player2, map);
  assert.strictEqual(resolvedProtected.type, 'MOVE', '墓封鎖岩はBREAK変換されず保護されること');

  // 16-3. AdaptiveNavigator の allowBreakAsRoad による経路探索で墓周囲の岩が開削対象から除外されること
  const params = new TacticalContext(map).resolveParameters('RESOURCE_FARM', player2, undefined, []);
  params.allowBreakAsRoad = true;
  // (10, 10)が墓、周囲8マス(11, 10)が岩
  const isProtected = AdaptiveNavigator.isProtectedGraveBlock({ x: 11, y: 10 }, map);
  assert.strictEqual(isProtected, true, '墓の隣接岩が isProtectedGraveBlock で true と判定されること');

  console.log('✓ 16. RING push preservation and grave block break protection verified.');
}

console.log('================================================================');

// Test 17: 決戦前のポーション備蓄＆手ぶら一括スイープ回収と決戦移行条件の検証
console.log('Testing 17: Pre-dragon potion reserve sweep and defenseReady transition...');
{
  const map = createEmptyMap();
  map.setBaseTile({ x: 8, y: 8 }, 'HOME');
  map.homePos = { x: 8, y: 8 };
  map.setRealHomePos({ x: 8, y: 8 });

  const dragon = new Dragon({ x: 32, y: 32 });
  const ctx = new TacticalContext(map);
  const bot = new AdaptiveAutoPlayBot();

  // プレイヤー: STR達成済み、手ぶら、MP=5 (目標18未満)、EXP=30,000 (目標40,000未満)
  const player = new Player({ x: 12, y: 8, hp: 30000, strength: 600000, experience: 30000 });
  player.hasSword = true;
  player.magic = 5;
  player.holdItem = 'NONE';

  // マップ上に宝箱はなく、(14, 8) に POTION、(16, 8) に COIN を配置
  map.setItem({ x: 14, y: 8 }, 'POTION');
  map.setItem({ x: 16, y: 8 }, 'COIN');

  const params = ctx.resolveParameters('RESOURCE_FARM', player, dragon, []);
  assert.strictEqual(params.maxTargetMagic, 14, 'デフォルト目標MPは18であること');
  assert.ok(params.potionSearchDist >= 20, 'STR達成後のポーション探索半径は20以上(広域)であること');

  // 17-1. hasRemainingDefenseFarmResources が床の POTION を認識して true を返すこと
  const hasRes = (bot as any).hasRemainingDefenseFarmResources(map, player);
  assert.strictEqual(hasRes, true, '床にPOTIONが残っているため回収資源ありと判定されること');

  // 17-2. 手ぶらスイープモードが発動し、最寄りの POTION (14, 8) へ移動すること
  const swapState = { itemToPickupPos: null, tempDroppedKeyPos: null, swapTurns: 0 };
  const resSweep = ResourceFarmBehavior.execute(player, map, [], dragon, bot.nav, ctx, params, swapState, bot);
  assert.ok(resSweep !== null);
  assert.strictEqual(resSweep.action.type, 'MOVE');
  assert.strictEqual((resSweep.action as any).dir, 'RIGHT', '最寄りのPOTION(14,8)へ向かうこと');
  assert.ok(resSweep.description.includes('一括スイープ回収'), '行動説明に一括スイープ回収が含まれること');

  // 17-3. ポーションマス上に到達した時、SPACEでポーションを取得すること
  player.pos = { x: 14, y: 8 };
  const resPickup = ResourceFarmBehavior.execute(player, map, [], dragon, bot.nav, ctx, params, swapState, bot);
  assert.ok(resPickup !== null);
  assert.strictEqual(resPickup.action.type, 'SPACE', '足元のPOTIONを取得すること');

  // 17-4. MP未達 (MP=5) の間は床に資源があるため defenseReady は false のままであること
  (bot as any).params = params;
  (bot as any).currentPhase = 'RESOURCE_FARM';
  (bot as any).updatePhase(player, dragon, map, []);
  assert.strictEqual(bot.defenseReady, false, 'ポーション残存＆目標MP未達時は決戦へ移行しないこと');

  // 17-5. 目標MP (18) かつ 目標EXP (40,000) 達成時に defenseReady = true となること
  player.magic = 14;
  player.experience = 40000;
  (bot as any).updatePhase(player, dragon, map, []);
  assert.strictEqual(bot.defenseReady, true, '目標MP・EXP達成で決戦準備完了となること');

  console.log('✓ 17. Pre-dragon potion sweep and defenseReady transition verified.');
}

console.log('   ALL AdaptiveAutoPlayBot (v2) TESTS PASSED SUCCESSFULLY!     ');
console.log('================================================================');
