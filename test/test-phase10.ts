import assert from 'node:assert';
import { SeedRandom } from '../src/core/SeedRandom.js';
import { GameEventBus } from '../src/core/GameEventBus.js';
import { GameEngine } from '../src/core/GameEngine.js';
import { InMemoryStorageDriver } from '../src/services/SaveStorageDriver.js';
import { SaveManager, CURRENT_SAVE_VERSION, FullSaveData } from '../src/services/SaveManager.js';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { SimulationRunner } from '../src/simulation/SimulationRunner.js';
import { SimulationTelemetry } from '../src/simulation/SimulationTelemetry.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { ThreatEvaluator } from '../src/systems/ThreatEvaluator.js';

console.log('--- Phase 10: Headless Bot Simulator & Telemetry Verification ---');

// ============================================================================
// Test 1: 決定論的擬似乱数生成器 (SeedRandom) の検証
// ============================================================================
console.log('Testing 1: Deterministic SeedRandom (Mulberry32) reproducibility & DI...');
{
  const seed = 123456789;
  const rng1 = new SeedRandom(seed);
  const rng2 = new SeedRandom(seed);
  const rng3 = new SeedRandom(987654321);

  // 1-A. 同一シードから生成される浮動小数点および整数乱数が100%同一であること
  for (let i = 0; i < 50; i++) {
    assert.strictEqual(rng1.next(), rng2.next(), `Float random mismatch at iteration ${i}`);
    assert.strictEqual(rng1.nextInt(1, 100), rng2.nextInt(1, 100), `Int random mismatch at iteration ${i}`);
  }

  // 1-B. 異なるシードでは乱数列が分散すること
  assert.notStrictEqual(rng1.next(), rng3.next(), 'Different seeds must produce different sequences');

  // 1-C. choice, shuffle, fork の決定論性
  const arr = ['A', 'B', 'C', 'D', 'E'];
  const baseRng1 = new SeedRandom(99999);
  const baseRng2 = new SeedRandom(99999);
  const rngFork1 = baseRng1.fork('sub1');
  const rngFork2 = baseRng2.fork('sub1');
  assert.deepStrictEqual(rngFork1.shuffle(arr), rngFork2.shuffle(arr), 'Forked PRNG with same seed must shuffle identically');
  assert.strictEqual(rngFork1.choice(arr), rngFork2.choice(arr), 'Forked PRNG must choose identically');

  // 1-D. GameEngine への SeedRandom DI による完全決定論的挙動
  const engine1 = new GameEngine({ seed: 77777 });
  const engine2 = new GameEngine({ seed: 77777 });
  engine1.startGame();
  engine2.startGame();

  // 30ターン同一コマンドを入力し、毎ターンのプレイヤーHP・EXP・座標が100%一致することを検証
  const dirs = ['RIGHT', 'DOWN', 'LEFT', 'UP', 'RIGHT', 'RIGHT', 'DOWN', 'DOWN'];
  for (let t = 0; t < 30; t++) {
    const d = dirs[t % dirs.length] as any;
    engine1.stepFrame(100);
    engine2.stepFrame(100);
    engine1.executeTurn(d);
    engine2.executeTurn(d);

    const p1 = engine1.getPlayer();
    const p2 = engine2.getPlayer();
    assert.strictEqual(p1.pos.x, p2.pos.x, `Player X mismatch at turn ${t}`);
    assert.strictEqual(p1.pos.y, p2.pos.y, `Player Y mismatch at turn ${t}`);
    assert.strictEqual(p1.hp, p2.hp, `Player HP mismatch at turn ${t}`);
    assert.strictEqual(p1.experience, p2.experience, `Player EXP mismatch at turn ${t}`);
  }

  console.log('✓ 1. SeedRandom deterministic reproducibility & GameEngine DI verified successfully.');
}

// ============================================================================
// Test 2: GameEventBus と構造化ドメインイベント発行・購読検証
// ============================================================================
console.log('Testing 2: GameEventBus typed event publishing & subscribing...');
{
  const eventBus = new GameEventBus();
  const receivedEvents: string[] = [];

  eventBus.on('player:move', (payload) => {
    receivedEvents.push(`move:${payload.dir}`);
    assert.ok(payload.from !== undefined);
    assert.ok(payload.to !== undefined);
  });

  eventBus.on('combat:playerAttack', (payload) => {
    receivedEvents.push(`playerAttack:${payload.damage}`);
    assert.ok(payload.damage >= 0);
  });

  eventBus.on('game:stateChange', (payload) => {
    receivedEvents.push(`stateChange:${payload.prev}->${payload.current}`);
  });

  const engine = new GameEngine({ eventBus, seed: 44444 });
  engine.startGame(); // TITLE -> PLAYING
  assert.ok(receivedEvents.includes('stateChange:TITLE->PLAYING'), 'State change event should be published');

  // プレイヤー移動で player:move が発火すること
  const player = engine.getPlayer();
  const initPos = { ...player.pos };
  engine.executeTurn('RIGHT');
  assert.ok(receivedEvents.some(e => e.startsWith('move:')), 'Player move event should be recorded');

  // リスナー解除の検証
  eventBus.clear();
  assert.strictEqual(eventBus.getListenerCount(), 0, 'Listener count must be 0 after clear()');

  console.log('✓ 2. GameEventBus typed pub/sub and engine event bindings verified successfully.');
}

// ============================================================================
// Test 3: SaveStorageDriver インメモリ検証 (Node.js環境でのセーブ・ロード)
// ============================================================================
console.log('Testing 3: InMemoryStorageDriver & SaveManager decoupling...');
{
  const inMemory = new InMemoryStorageDriver();
  SaveManager.setDriver(inMemory);

  assert.strictEqual(SaveManager.hasSave(), false);
  assert.strictEqual(SaveManager.load(), null);

  const engine = new GameEngine({ seed: 55555 });
  engine.startGame();
  const p = engine.getPlayer();
  p.strength = 15000;
  p.experience = 25000;

  const testSaveData: FullSaveData = {
    version: CURRENT_SAVE_VERSION,
    savedAt: new Date().toISOString(),
    player: p.serialize(),
    map: engine.getMap().serialize(),
    enemies: engine.getEnemies().map(e => e.serialize()),
    dragon: engine.getDragon().serialize(),
    ghosts: engine.getGhosts().map(g => g.serialize()),
    system: {
      totalTurns: 50,
      paletteMode: 'NORMAL',
      selectedMagicIndex: 0,
      showMiniMap: false,
      spawnTurnCounter: 2,
    },
  };

  const saveSuccess = SaveManager.save(testSaveData);
  assert.strictEqual(saveSuccess, true, 'SaveManager.save must succeed with InMemoryStorageDriver');
  assert.strictEqual(SaveManager.hasSave(), true);

  const loaded = SaveManager.load();
  assert.ok(loaded !== null);
  assert.strictEqual(loaded?.player.strength, 15000);
  assert.strictEqual(loaded?.player.experience, 25000);

  SaveManager.clear();
  assert.strictEqual(SaveManager.hasSave(), false);

  // ドライバーをデフォルトに戻す
  SaveManager.setDriver(null);
  console.log('✓ 3. InMemoryStorageDriver headless save/load cycle verified successfully.');
}

// ============================================================================
// Test 4: AutoPlayBot のフェーズ駆動＆ヒューリスティック判断検証
// ============================================================================
console.log('Testing 4: AutoPlayBot state machine, phase transition & decision making...');
{
  const botStandard = new AutoPlayBot({ profile: 'STANDARD' });
  const engine = new GameEngine({ seed: 88888 });
  engine.startGame();
  const player = engine.getPlayer();

  // 4-A. 初期状態は BOOTSTRAP フェーズ
  const action1 = botStandard.decideAction(engine);
  assert.strictEqual(botStandard.currentPhase, 'BOOTSTRAP', 'Initial phase must be BOOTSTRAP');
  assert.ok(action1.type === 'MOVE' || action1.type === 'SPACE' || action1.type === 'WAIT');

  // 4-B. 剣・鍵を入手したら POWER_RUSH (FARMING) フェーズへ遷移
  player.hasSword = true;
  player.holdItem = 'KEY';
  const action2 = botStandard.decideAction(engine);
  assert.ok(
    botStandard.currentPhase === 'POWER_RUSH' || botStandard.currentPhase === 'FARMING',
    'Phase must transition to POWER_RUSH / FARMING when sword and key held'
  );

  // 4-C. HPピンチ時 (HP < 35%) の緊急行動: 我が家への帰還を最優先
  player.hp = 100;
  player.maxHp = 1000;
  const emergencyAction = botStandard.decideAction(engine);
  assert.ok(emergencyAction.type === 'MOVE' || emergencyAction.type === 'MAGIC', 'Should navigate or cast return on pinch');

  // 4-D. ドラゴン討伐条件 (STR >= 350,000 & 防御力EXP育成 & MP備蓄完了) 達成時のフェーズ遷移
  player.hp = 1000;
  player.strength = 450000;
  player.experience = 15000; // 防御力育成前（新基準 targetDefense 40,000 未達）: 周囲に狩れる敵がいれば POWER_RUSH 継続
  player.magic = 5;
  botStandard.graveSealAborted = true; // 墓封鎖完了状態として移転/決戦進軍を検証
  const actionFarmExp = botStandard.decideAction(engine);
  assert.strictEqual(botStandard.currentPhase, 'POWER_RUSH', 'Should continue POWER_RUSH to build defense EXP');

  // 防御力育成完了（EXP >= 415,000）: 決戦・家移転フェーズへ遷移
  player.experience = 420000;
  const actionDragon = botStandard.decideAction(engine);
  assert.ok(
    botStandard.currentPhase === 'DRAGON_SLAY' || botStandard.currentPhase === 'RELOCATE_HOME',
    'Phase must transition to DRAGON_SLAY or RELOCATE_HOME when ready'
  );

  // 4-E. 全首撃破時の CROWN_ESCAPE フェーズ遷移
  const dragon = engine.getDragon();
  dragon.defeatedHeadsCount = 3;
  for (const h of dragon.heads) {
    h.hp = 0;
    h.isAlive = false;
  }
  const actionEscape = botStandard.decideAction(engine);
  assert.strictEqual(botStandard.currentPhase, 'CROWN_ESCAPE', 'Phase must transition to CROWN_ESCAPE when heads slain');

  console.log('✓ 4. AutoPlayBot phases, tactical combat & emergency reactions verified successfully.');
}

// ============================================================================
// Test 5: SimulationRunner & Telemetry バッチ実行と課題1/2/3定量KPI集計検証
// ============================================================================
console.log('Testing 5: SimulationRunner batch execution & KPI telemetry report...');
{
  const report = SimulationRunner.runBatch({
    runs: 4,
    maxTurnsLimit: 150,
    topology: 'STANDARD_ROOMS',
    difficulty: 'NORMAL',
    pacing: 'BLITZ',
    botProfile: 'STANDARD',
    baseSeed: 33333,
  });

  // レポート構造の完全性検証
  assert.strictEqual(report.config.runs, 4);
  assert.ok(typeof report.overall.winRate === 'number');
  assert.ok(typeof report.overall.avgClearTurns === 'number');
  assert.ok(typeof report.overall.estimatedPlayTimeMinutes === 'number');

  // 課題1: スポーンメトリクス
  assert.ok(typeof report.homeSpawnMetrics.totalHomeSpawnAttempts === 'number');
  assert.ok(typeof report.homeSpawnMetrics.blockedByGlobalCapRate === 'number');
  assert.ok(report.homeSpawnMetrics.blockedByGlobalCapRate <= 100);

  // 課題2: 成長・戦闘メトリクス
  assert.ok(typeof report.progressionMetrics.maxSingleKillExpJump === 'number');
  assert.ok(typeof report.progressionMetrics.combatOutcomeDistribution.zeroDamageTakenRatio === 'number');

  // 課題3: 資源メトリクス
  assert.ok(typeof report.resourceAndGhostMetrics.avgItemsSpawnedPerRun.cross === 'number');
  assert.ok(typeof report.resourceAndGhostMetrics.avgItemsSpawnedPerRun.powerStone === 'number');
  assert.ok(typeof report.resourceAndGhostMetrics.ghostInteractions.itemsPickedUp === 'number');

  console.log('✓ 5. SimulationRunner batch execution & telemetry KPI metrics verified successfully.');
}

// ============================================================================
// Test 6: 死神（DEATH）行動評価の見直し＆POTION回収・スワップ・魔法活用検証
// ============================================================================
console.log('Testing 6: Death emergency priority & Potion pickup/swap with magic return verification...');
{
  // 6-A. 死神憑依時: MP=0 かつ 近くにCROSSなしならパニック帰宅せず通常の探索・行動を継続
  {
    const bot = new AutoPlayBot({ profile: 'STANDARD' });
    const engine = new GameEngine({ seed: 11111 });
    engine.startGame();
    const player = engine.getPlayer();
    const map = engine.getMap();

    player.hasSword = true;
    player.holdItem = 'KEY';
    player.hp = player.maxHp;
    player.magic = 0; // MP = 0
    player.hasDeath = true; // 死神憑依！

    // 全てのCROSSを一時的にNONEにして近くに十字架がない状況を作成
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.getItem({ x, y }) === 'CROSS') {
          map.setItem({ x, y }, 'NONE');
        }
      }
    }

    const action = bot.decideAction(engine);
    // パニック帰宅でなく POWER_RUSH フェーズで宝箱開錠や探索を行う
    assert.strictEqual(bot.currentPhase, 'POWER_RUSH', 'Should continue POWER_RUSH when magic is 0 even with death');
    assert.ok(action.type === 'MOVE' || action.type === 'SPACE', 'Should continue normal action rather than panic-freeze');
  }

  // 6-B. 死神憑依時: 近くに未使用の十字架があれば我が家より十字架を優先して浄化へ向かう
  {
    const bot = new AutoPlayBot({ profile: 'STANDARD' });
    const engine = new GameEngine({ seed: 22222 });
    engine.startGame();
    const player = engine.getPlayer();
    const map = engine.getMap();

    player.hasSword = true;
    player.holdItem = 'NONE';
    player.hp = player.maxHp;
    player.magic = 0;
    player.hasDeath = true;

    // 我が家から遠い安全な位置にプレイヤーを配置
    player.pos = { x: 10, y: 10 };
    // 周囲を安全な床にする
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        map.setBaseTile(map.wrapPosition({ x: 10 + dx, y: 10 + dy }), 'FLOOR');
        map.setObject(map.wrapPosition({ x: 10 + dx, y: 10 + dy }), 'NONE');
        map.setItem(map.wrapPosition({ x: 10 + dx, y: 10 + dy }), 'NONE');
      }
    }
    // プレイヤーのすぐ右（距離1）に未使用十字架を配置
    map.setItem({ x: 11, y: 10 }, 'CROSS');
    // 我が家は遠く (50, 50)
    map.setRealHomePos({ x: 50, y: 50 });

    const action = bot.decideAction(engine);
    // 十字架の方向（RIGHT）へ向かうはず
    assert.strictEqual(action.type, 'MOVE');
    assert.strictEqual((action as any).dir, 'RIGHT', 'Bot must head towards adjacent CROSS rather than distant HOME');
  }

  // 6-C. KEY所持中の安全な「一時置き → POTION回収 → KEY再回収」ルーチン
  {
    const bot = new AutoPlayBot({ profile: 'STANDARD' });
    const engine = new GameEngine({ seed: 33333 });
    engine.startGame();
    const player = engine.getPlayer();
    const map = engine.getMap();

    // プレイヤーに剣と鍵を持たせ、MP=0
    player.hasSword = true;
    player.holdItem = 'KEY';
    player.magic = 0;
    player.pos = { x: 15, y: 15 };

    // 周囲を安全な空床にする
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const p = map.wrapPosition({ x: 15 + dx, y: 15 + dy });
        map.setBaseTile(p, 'FLOOR');
        map.setObject(p, 'NONE');
        map.setItem(p, 'NONE');
      }
    }

    // プレイヤーの足元にPOTIONを配置（宝箱開錠後など）
    map.setItem({ x: 15, y: 15 }, 'POTION');

    // 1手目: 足元にPOTIONがあるので安全な隣接床へ移動を決定するはず
    const act1 = bot.step(engine);
    assert.strictEqual(act1.type, 'MOVE', 'Step 1: should move to adjacent safe tile to drop key');

    // 2手目: 安全床でSPACEを押して鍵をドロップするはず
    const act2 = bot.step(engine);
    assert.strictEqual(act2.type, 'SPACE', 'Step 2: should drop key on safe floor');
    assert.strictEqual(player.holdItem, 'NONE', 'Player should be empty-handed after dropping key');

    // 3手目: POTIONの位置へ戻る移動
    const act3 = bot.step(engine);
    assert.strictEqual(act3.type, 'MOVE', 'Step 3: should move back to POTION tile');

    // 4手目: POTIONを拾う（即座にMP+1、手ぶら維持）
    const act4 = bot.step(engine);
    assert.strictEqual(act4.type, 'SPACE', 'Step 4: should pick up POTION');
    assert.strictEqual(player.magic, 1, 'Player magic should increase to 1 after picking up POTION');
    assert.strictEqual(player.holdItem, 'NONE', 'Player should still be empty-handed after POTION');

    // 5手目: 鍵を置いたマスへ戻る移動
    const act5 = bot.step(engine);
    assert.strictEqual(act5.type, 'MOVE', 'Step 5: should move back to dropped KEY tile');

    // 6手目: 鍵を拾い直す
    const act6 = bot.step(engine);
    assert.strictEqual(act6.type, 'SPACE', 'Step 6: should pick up the KEY again');
    assert.strictEqual(player.holdItem, 'KEY', 'Player must safely hold KEY again after swap');
  }

  // 6-D. MP確保後の RETURN 魔法による瞬時帰還検証（遠隔地からの安全ワープ）
  {
    const bot = new AutoPlayBot({ profile: 'STANDARD' });
    const engine = new GameEngine({ seed: 44444 });
    engine.startGame();
    const player = engine.getPlayer();
    const map = engine.getMap();

    player.hasSword = true;
    player.holdItem = 'POWER_STONE';
    player.experience = 2000; // RETURN習得
    player.magic = 3;         // 序盤RETURN許可MP（>= 3）
    player.hasDeath = false;
    // しきい値制限検証: 我が家から離れた遠隔地（距離15マス以上）からのRETURN
    player.pos = map.wrapPosition({ x: map.realHomePos.x + 15, y: map.realHomePos.y + 15 });

    const action = bot.decideAction(engine);
    assert.strictEqual(action.type, 'MAGIC', 'Should cast RETURN magic when holding POWER_STONE with MP');
    assert.strictEqual((action as any).magic, 'RETURN');
  }

  console.log('✓ 6. Death emergency priority & Potion pickup/swap with magic return verified successfully.');

  // -------------------------------------------------------------------------
  // Test 7: POWER_RUSH フェーズにおける斜め宝箱の8歩周期開錠検証
  // -------------------------------------------------------------------------
  console.log('Testing 7: 8-Step diagonal chest cycle in POWER_RUSH phase...');
  {
    const bot = new AutoPlayBot({ profile: 'STANDARD' });
    const engine = new GameEngine({ seed: 12345 });
    engine.startGame();
    const player = engine.getPlayer();
    const map = engine.getMap();

    // プレイヤーの初期化: POWER_RUSH条件
    player.hasSword = true;
    player.strength = 10000; // < 350,000 なので POWER_RUSH
    player.holdItem = 'KEY';
    player.stepCountSinceStone = 0;

    // 現在地と周囲の地形をセットアップ
    // (10, 10) にプレイヤー、足元に POWER_STONE
    player.pos = { x: 10, y: 10 };
    map.setItem({ x: 10, y: 10 }, 'POWER_STONE');
    map.setObject({ x: 10, y: 10 }, 'NONE');

    // 斜め (11, 11) に未開封宝箱 CHEST を配置
    map.setObject({ x: 11, y: 11 }, 'CHEST');
    map.setItem({ x: 11, y: 11 }, 'NONE');

    // 中間マス (11, 10) と (10, 11) を安全な空床にする
    map.setBaseTile({ x: 10, y: 10 }, 'FLOOR');
    map.setBaseTile({ x: 11, y: 10 }, 'FLOOR');
    map.setBaseTile({ x: 10, y: 11 }, 'FLOOR');
    map.setBaseTile({ x: 11, y: 11 }, 'FLOOR');

    map.setObject({ x: 11, y: 10 }, 'NONE');
    map.setItem({ x: 11, y: 10 }, 'NONE');
    map.setObject({ x: 10, y: 11 }, 'NONE');
    map.setItem({ x: 10, y: 11 }, 'NONE');

    // 敵を遠ざけて安全にする
    for (const e of engine.getEnemies()) {
      e.pos = { x: 0, y: 0 };
    }

    // 1手目〜7手目: (10, 10) と (11, 10) の間を往復して歩数を稼ぐ
    // stepCountSinceStone は 0 から 7 へ
    for (let step = 1; step <= 7; step++) {
      const act = bot.step(engine);
      assert.strictEqual(act.type, 'MOVE', `Step ${step} must be MOVE`);
      assert.strictEqual(player.stepCountSinceStone, step, `stepCountSinceStone must be ${step} after step ${step}`);
    }

    // 7手目終了時点で現在地は (11, 10)、stepCountSinceStone === 7
    assert.strictEqual(player.pos.x, 11);
    assert.strictEqual(player.pos.y, 10);
    assert.strictEqual(player.stepCountSinceStone, 7);

    // 8手目: 宝箱 (11, 11) へ移動！
    const act8 = bot.step(engine);
    assert.strictEqual(act8.type, 'MOVE');
    assert.strictEqual(player.pos.x, 11);
    assert.strictEqual(player.pos.y, 11);
    assert.strictEqual(player.stepCountSinceStone, 8, 'Should reach chest at exactly step 8');

    // 9手目: 宝箱の上で SPACE を押して確定開錠！
    const act9 = bot.step(engine);
    assert.strictEqual(act9.type, 'SPACE', 'Must open chest with SPACE');
    // 開錠後、確定で POWER_STONE が排出され stepCountSinceStone が 0 にリセットされる
    assert.strictEqual(map.getItem({ x: 11, y: 11 }), 'POWER_STONE', 'Chest must yield POWER_STONE');
    assert.strictEqual(player.stepCountSinceStone, 0, 'stepCountSinceStone resets to 0');
    assert.strictEqual(map.getObject({ x: 11, y: 11 }), 'NONE', 'Chest object consumed');

    // 10手目: さらなる斜め宝箱はないので、通常の回収モード（安全床へ移動して鍵を置く）へ移行する
    const act10 = bot.step(engine);
    assert.strictEqual(act10.type, 'MOVE', 'Step 10: Should move to adjacent floor to drop key');

    // 振動検知が誤作動していないこと（oscillationCount が 3 以上になって強制 wander していないこと）
    assert.strictEqual((bot as any).oscillationCount, 0, 'oscillationCount should be 0 during 8-step mode');

    console.log('✓ 7. 8-Step diagonal chest cycle in POWER_RUSH verified successfully.');
  }

  // 7-B. 危険な敵が隣接している場合は8歩調整を発動せず安全第一で行動することの検証
  {
    const bot = new AutoPlayBot({ profile: 'STANDARD' });
    const engine = new GameEngine({ seed: 54321 });
    engine.startGame();
    const player = engine.getPlayer();
    const map = engine.getMap();

    player.hasSword = true;
    player.strength = 10000;
    player.holdItem = 'KEY';
    player.stepCountSinceStone = 0;

    player.pos = { x: 10, y: 10 };
    map.setItem({ x: 10, y: 10 }, 'POWER_STONE');
    map.setObject({ x: 10, y: 10 }, 'NONE');

    // 斜め (11, 11) に CHEST
    map.setObject({ x: 11, y: 11 }, 'CHEST');
    map.setItem({ x: 11, y: 11 }, 'NONE');

    // 隣接 (10, 9) に即死級 (LETHAL) の敵を配置
    const enemies = engine.getEnemies();
    const dangerousEnemy = enemies[0];
    dangerousEnemy.pos = { x: 10, y: 9 };
    dangerousEnemy.isAlive = true;
    dangerousEnemy.hp = 999999;
    dangerousEnemy.atk = 999999; // 即死級攻撃力

    // 危険な敵がいるため、8歩調整モード (eightStepTargetChestPos) はセットされず、即時回収/安全退避へ
    const act = bot.step(engine);
    assert.strictEqual((bot as any).eightStepTargetChestPos, null, 'Should not start 8-step cycle when lethal enemy is adjacent');
  }
}

console.log('--- ✓ All Phase 10 Tests Passed Successfully! ---');
