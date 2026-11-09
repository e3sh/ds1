import assert from 'node:assert';
import { SeedRandom } from '../src/core/SeedRandom.js';
import { GameEventBus } from '../src/core/GameEventBus.js';
import { GameEngine } from '../src/core/GameEngine.js';
import { InMemoryStorageDriver } from '../src/services/SaveStorageDriver.js';
import { SaveManager, CURRENT_SAVE_VERSION, FullSaveData } from '../src/services/SaveManager.js';
import { SimulationRunner } from '../src/simulation/SimulationRunner.js';
import { SimulationTelemetry } from '../src/simulation/SimulationTelemetry.js';

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
// Test 4: SimulationRunner & Telemetry バッチ実行と課題1/2/3定量KPI集計検証
// ============================================================================
console.log('Testing 4: SimulationRunner batch execution & KPI telemetry report...');
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

  console.log('✓ 4. SimulationRunner batch execution & telemetry KPI metrics verified successfully.');
}

console.log('--- ✓ All Phase 10 Tests Passed Successfully! ---');
