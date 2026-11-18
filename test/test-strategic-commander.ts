import assert from 'node:assert';
import { GameEngine } from '../src/core/GameEngine.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { MovementLedger } from '../src/ai/perception/MovementLedger.js';
import { ProgressLedger, ProgressWindow, TurnSample } from '../src/ai/perception/ProgressLedger.js';
import { TacticalSnapshot } from '../src/ai/perception/TacticalSnapshot.js';
import { StrategicCommander } from '../src/ai/strategy/command/StrategicCommander.js';
import { MissionReport } from '../src/ai/strategy/command/CommanderTypes.js';
import { SpatialKnowledge } from '../src/ai/perception/SpatialKnowledge.js';
import { SituationalPerception } from '../src/ai/perception/SituationalPerception.js';
import { EpisodicMemory } from '../src/ai/perception/EpisodicMemory.js';
import { DynamicBotParameters } from '../src/ai/BotTypes.js';
import { ExploreFrontierMission } from '../src/ai/strategy/missions/ExploreFrontierMission.js';

console.log('================================================================');
console.log('   StrategicCommander (Meta-Strategy & Audit) Test Suite        ');
console.log('================================================================');

const mockParams: DynamicBotParameters = {
  targetStr: 11000,
  targetDefenseExp: 15000,
  graveSealEarlyStr: 500,
  maxTargetMagic: 8,
  minDragonMagic: 2,
  emergencyHpRatio: 0.4,
  dangerHpRatio: 0.3,
  magicReserveThreshold: 1,
  huntDistance: 0,
  potionSearchDist: 15,
  keySearchDist: 15,
  stoneSearchDist: 15,
  coinSearchDist: 15,
  allowBreakAsRoad: true,
  breakCostMultiplier: 1.5,
  warpAvoidanceCost: 200,
  maxBfsSteps: 3000,
  enableHomeRelocation: false,
  homeRelocateDistMin: 10,
  homeRelocateDistMax: 20,
  graveSealPolicy: 'NONE',
  enableGiveUp: true,
};

function clearMapToFloor(map: WorldMap): void {
  map.tacticalMetadata = undefined;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const p = { x, y };
      map.setBaseTile(p, 'FLOOR');
      map.setObject(p, 'NONE');
      map.setItem(p, 'NONE');
    }
  }
  map.setBaseTile({ x: 2, y: 2 }, 'HOME');
}

function buildRingMaze(map: WorldMap, withOuterKeyAndChest: boolean): void {
  clearMapToFloor(map);
  // 20マスの環状通路 (x=5..10, y=5..10 の外周1マス幅)
  for (let y = 4; y <= 11; y++) {
    for (let x = 4; x <= 11; x++) {
      const isOuterWall = x === 4 || x === 11 || y === 4 || y === 11;
      const isInnerWall = x >= 6 && x <= 9 && y >= 6 && y <= 9;
      if (isOuterWall || isInnerWall) {
        map.setBaseTile({ x, y }, 'WALL_STATIC');
      }
    }
  }
  // 出口 (11, 7) を岩 (BLOCK) 1個で塞ぐ
  map.setBaseTile({ x: 11, y: 7 }, 'FLOOR');
  map.setObject({ x: 11, y: 7 }, 'BLOCK');

  if (withOuterKeyAndChest) {
    map.setItem({ x: 14, y: 7 }, 'KEY');
    map.setObject({ x: 16, y: 7 }, 'CHEST');
  }
}

// -----------------------------------------------------------------------------
// 1. 単体: MovementLedger に 20 マスの周回を 3 周分入れる
// -----------------------------------------------------------------------------
console.log('Testing 1: MovementLedger 20-tile cycle detection...');
{
  const ledger = new MovementLedger();
  const loop20: { x: number; y: number }[] = [];
  for (let x = 5; x <= 10; x++) loop20.push({ x, y: 5 });
  for (let y = 6; y <= 10; y++) loop20.push({ x: 10, y });
  for (let x = 9; x >= 5; x--) loop20.push({ x, y: 10 });
  for (let y = 9; y >= 6; y--) loop20.push({ x: 5, y });
  assert.strictEqual(loop20.length, 20);

  let turn = 0;
  for (let rep = 0; rep < 3; rep++) {
    for (const p of loop20) {
      turn++;
      ledger.recordPosition(p, turn);
    }
  }

  const cycle = ledger.detectCycle(48);
  assert.ok(cycle !== null, '20マス周回が検知されること');
  assert.strictEqual(cycle!.period, 20, '周期が20であること');
  assert.strictEqual(ledger.countNewTilesSince(turn - 39), 0, '2周目・3周目は新規マス0であること');
  console.log('✓ 1. MovementLedger 20-tile cycle detection verified.');
}

// -----------------------------------------------------------------------------
// 2. 単体: ProgressLedger が HP自然回復・スワップを戦果に数えないこと
// -----------------------------------------------------------------------------
console.log('Testing 2: ProgressLedger ignores HP regen and item swap...');
{
  const map = new WorldMap(16, 16);
  const mov = new MovementLedger();
  const prog = new ProgressLedger();

  const baseSample = (turn: number, overrides: Partial<TurnSample> = {}): TurnSample => ({
    turn,
    pos: { x: 5, y: 5 },
    hp: 500,
    maxHp: 1000,
    strength: 100,
    experience: 4000,
    magic: 2,
    gold: 0,
    holdItem: 'NONE',
    hasSword: true,
    remainingChests: 3,
    dragonTotalHeadHp: 0,
    dragonDefeatedHeads: 0,
    crownsDelivered: 0,
    homePos: { x: 2, y: 2 },
    ...overrides,
  });

  prog.recordTurn(baseSample(1), mov.recordPosition({ x: 5, y: 5 }, 1));
  prog.recordTurn(baseSample(2, { hp: 550 }), mov.recordPosition({ x: 5, y: 5 }, 2));
  prog.recordTurn(baseSample(3, { holdItem: 'KEY' }), mov.recordPosition({ x: 5, y: 5 }, 3));
  // 鍵を置いてすぐ拾い直す（宝箱開錠なし）
  prog.recordTurn(baseSample(4, { holdItem: 'NONE' }), mov.recordPosition({ x: 5, y: 5 }, 4));
  prog.recordTurn(baseSample(5, { holdItem: 'KEY' }), mov.recordPosition({ x: 5, y: 5 }, 5));

  const win = prog.buildWindow(5, mov, map);
  // T3 の KEY_ACQUIRED のみカウントされ、T2(HP回復) と T5(スワップ再取得) は無視される
  assert.strictEqual(win.substantiveGainsSince(1).length, 1, '初回鍵取得のみが戦果として数えられること');
  assert.strictEqual(win.substantiveGainsSince(4).length, 0, 'スワップ再取得は戦果0件であること');
  console.log('✓ 2. ProgressLedger pseudo-progress filtering verified.');
}

// -----------------------------------------------------------------------------
// 3. 単体: StrategicCommander の段階上昇・回復・段階記憶
// -----------------------------------------------------------------------------
console.log('Testing 3: StrategicCommander escalation, hysteresis recovery & level memory...');
{
  const map = new WorldMap(16, 16);
  const spatial = new SpatialKnowledge(map);
  const memory = new EpisodicMemory();
  const commander = new StrategicCommander();

  const makeFakeProgress = (
    turn: number,
    turnsSinceGain: number,
    turnsSinceNew: number,
    newIn16: number
  ): ProgressWindow => ({
    windowSize: 48,
    uniqueTilesInWindow: 10,
    newTilesInWindow: newIn16,
    turnsSinceNewTile: turnsSinceNew,
    turnsSinceSubstantiveGain: turnsSinceGain,
    lastSubstantiveGain: null,
    displacement: 2,
    cycle: { period: 20, repetitions: 2, tiles: [{ x: 1, y: 1 }, { x: 2, y: 1 }] },
    substantiveGainsSince: () => (turnsSinceGain === 0 ? [{ turn, kind: 'EXP_UP' }] : []),
    newTilesSince: () => newIn16,
  });

  const makeSnap = (turn: number, progress: ProgressWindow): TacticalSnapshot => ({
    spatial,
    milestones: {
      hasSword: true, canBreak: true, canDiagonal: false, hasTargetStr: false,
      hasTargetDefenseExp: false, hasSufficientMagic: true, hasMaxMagic: false,
      canCastMagic: true, canPickupFloorItem: true, canOpenChest: false, isStrCapped: false,
    },
    threats: { isPinchHp: false, isLethalDanger: false, maxNearEnemyAtk: 0, adjacentLethalEnemies: [], isOnDragonFireLine: false },
    confinement: { kind: 'NONE', reachableSafeTiles: 10, escapeMeans: [], isStaticallySealed: false },
    progress,
    player: {
      pos: { x: 5, y: 5 }, hp: 1000, maxHp: 1000, strength: 100, experience: 4000,
      magic: 2, gold: 0, holdItem: 'NONE', hasSword: true, isFlying: false,
      canDiagonal: false, hasDeath: false, stepCountSinceStone: 0,
    },
    livingEnemies: [],
    memory,
    params: mockParams,
    map,
    totalTurns: turn,
  });

  const report: MissionReport = {
    activeMissionId: 'CLEAR_TREASURE_ZONE',
    activeAuditProfile: { graceTurns: 32, tabooable: true, maxEscalation: 'TERMINAL' },
    activeTarget: { x: 10, y: 10 },
    activeZoneId: 'ZONE_A',
    recentHistory: [],
  };

  // デバウンス 8T で L1 (RETARGET) へ
  for (let t = 1; t <= 7; t++) {
    const o = commander.review(makeSnap(t, makeFakeProgress(t, 35, 35, 0)), report);
    assert.strictEqual(o.level, 'NOMINAL', `T${t} ではデバウンス中のため NOMINAL`);
  }
  const o8 = commander.review(makeSnap(8, makeFakeProgress(8, 35, 35, 0)), report);
  assert.strictEqual(o8.level, 'RETARGET', '8T連続停滞で L1 RETARGET へ移行');

  // 観察期間 (14T) 経過で L2 (MISSION_TABOO) へ
  const o22 = commander.review(makeSnap(22, makeFakeProgress(22, 49, 49, 0)), report);
  assert.strictEqual(o22.level, 'MISSION_TABOO', '観察期間後に L2 MISSION_TABOO へ移行');

  // 戦果1件で NOMINAL へ復帰
  const o23 = commander.review(makeSnap(23, makeFakeProgress(23, 0, 0, 1)), report);
  assert.strictEqual(o23.level, 'NOMINAL', '実質戦果で NOMINAL へ復帰');

  // 64T 以内の再停滞時は L1 を飛ばして L2-1 = L1 (L3 からの回復なら L2)
  // 確認のため L2 から回復しているので max(1, 2-1)=1。L3から回復したケースも確認:
  const reportNoTarget: MissionReport = { ...report, activeTarget: null, activeZoneId: null };
  for (let t = 24; t <= 31; t++) {
    commander.review(makeSnap(t, makeFakeProgress(t, 40, 40, 0)), reportNoTarget);
  }
  assert.strictEqual(commander.level, 'MISSION_TABOO', 'ターゲット無し時は L1 を飛ばして L2 へ');
  console.log('✓ 3. StrategicCommander escalation & hysteresis verified.');
}

// -----------------------------------------------------------------------------
// 4. 単体: enableGiveUp=false で TERMINAL に達してもギブアップせず猶予倍増で再挑戦
// -----------------------------------------------------------------------------
console.log('Testing 4: StrategicCommander enableGiveUp=false resilience...');
{
  const map = new WorldMap(16, 16);
  const spatial = new SpatialKnowledge(map);
  const memory = new EpisodicMemory();
  const commander = new StrategicCommander();
  const paramsNoGiveUp: DynamicBotParameters = { ...mockParams, enableGiveUp: false };

  const fakeProgress: ProgressWindow = {
    windowSize: 48, uniqueTilesInWindow: 1, newTilesInWindow: 0,
    turnsSinceNewTile: 50, turnsSinceSubstantiveGain: 80, lastSubstantiveGain: null,
    displacement: 0, cycle: null, substantiveGainsSince: () => [], newTilesSince: () => 0,
  };
  const snap: TacticalSnapshot = {
    spatial,
    milestones: SituationalPerception.evaluateMilestones({ hasSword: true, experience: 1000, magic: 0, strength: 10, hasDeath: false } as any, paramsNoGiveUp),
    threats: { isPinchHp: false, isLethalDanger: false, maxNearEnemyAtk: 0, adjacentLethalEnemies: [], isOnDragonFireLine: false },
    confinement: { kind: 'NONE', reachableSafeTiles: 10, escapeMeans: [], isStaticallySealed: false },
    progress: fakeProgress,
    player: {
      pos: { x: 5, y: 5 }, hp: 1000, maxHp: 1000, strength: 10, experience: 1000,
      magic: 0, gold: 0, holdItem: 'NONE', hasSword: true, isFlying: false,
      canDiagonal: false, hasDeath: false, stepCountSinceStone: 0,
    },
    livingEnemies: [],
    memory,
    params: paramsNoGiveUp,
    map,
    totalTurns: 1,
  };
  const report: MissionReport = {
    activeMissionId: 'CLEAR_TREASURE_ZONE',
    activeAuditProfile: { graceTurns: 32, tabooable: true, maxEscalation: 'TERMINAL' },
    activeTarget: { x: 10, y: 10 },
    activeZoneId: null,
    recentHistory: [],
  };

  let orders = commander.review(snap, report);
  for (let t = 2; t <= 120; t++) {
    snap.totalTurns = t;
    orders = commander.review(snap, report);
    assert.strictEqual(orders.giveUp, null, 'enableGiveUp=false のときは絶対に giveUp を出さない');
  }
  console.log('✓ 4. enableGiveUp=false resilience verified.');
}

// -----------------------------------------------------------------------------
// 5. 単体: CHURN 検知で往復している両方のミッションを禁止する
// -----------------------------------------------------------------------------
console.log('Testing 5: CHURN detection taboos recurring missions...');
{
  const map = new WorldMap(16, 16);
  const spatial = new SpatialKnowledge(map);
  const memory = new EpisodicMemory();
  const commander = new StrategicCommander();
  const fakeProgress: ProgressWindow = {
    windowSize: 48, uniqueTilesInWindow: 30, newTilesInWindow: 15,
    turnsSinceNewTile: 2, turnsSinceSubstantiveGain: 40, lastSubstantiveGain: null,
    displacement: 10, cycle: null, substantiveGainsSince: () => [], newTilesSince: () => 15,
  };
  const snap: TacticalSnapshot = {
    spatial,
    milestones: {
      hasSword: true, canBreak: false, canDiagonal: false, hasTargetStr: false,
      hasTargetDefenseExp: false, hasSufficientMagic: false, hasMaxMagic: false,
      canCastMagic: false, canPickupFloorItem: true, canOpenChest: false, isStrCapped: false,
    },
    threats: { isPinchHp: false, isLethalDanger: false, maxNearEnemyAtk: 0, adjacentLethalEnemies: [], isOnDragonFireLine: false },
    confinement: { kind: 'NONE', reachableSafeTiles: 10, escapeMeans: [], isStaticallySealed: false },
    progress: fakeProgress,
    player: {
      pos: { x: 5, y: 5 }, hp: 1000, maxHp: 1000, strength: 10, experience: 1000,
      magic: 0, gold: 0, holdItem: 'NONE', hasSword: true, isFlying: false,
      canDiagonal: false, hasDeath: false, stepCountSinceStone: 0,
    },
    livingEnemies: [],
    memory,
    params: mockParams,
    map,
    totalTurns: 50,
  };
  const report: MissionReport = {
    activeMissionId: 'CLEAR_TREASURE_ZONE',
    activeAuditProfile: { graceTurns: 32, tabooable: true, maxEscalation: 'TERMINAL' },
    activeTarget: null,
    activeZoneId: null,
    recentHistory: [
      { missionId: 'CLEAR_TREASURE_ZONE', status: 'ABORTED', reason: 'INTERRUPTED_BY_EMERGENCY', turns: 5, startTurn: 20, endTurn: 25, substantiveGains: 0 },
      { missionId: 'PREPARE_DRAGON_ASSAULT', status: 'COMPLETED', reason: 'PARTIAL_PROGRESS', turns: 5, startTurn: 25, endTurn: 30, substantiveGains: 0 },
      { missionId: 'CLEAR_TREASURE_ZONE', status: 'ABORTED', reason: 'INTERRUPTED_BY_EMERGENCY', turns: 5, startTurn: 30, endTurn: 35, substantiveGains: 0 },
      { missionId: 'PREPARE_DRAGON_ASSAULT', status: 'COMPLETED', reason: 'PARTIAL_PROGRESS', turns: 5, startTurn: 35, endTurn: 40, substantiveGains: 0 },
    ],
  };

  let orders = commander.review(snap, report);
  for (let t = 51; t <= 60; t++) {
    snap.totalTurns = t;
    orders = commander.review(snap, report);
  }
  assert.strictEqual(orders.audit.stallKind, 'CHURN', 'CHURN が検知されること');
  assert.ok(orders.tabooMissions.has('CLEAR_TREASURE_ZONE') && orders.tabooMissions.has('PREPARE_DRAGON_ASSAULT'), '反復している両ミッションが禁止されること');
  console.log('✓ 5. CHURN detection & dual mission taboo verified.');
}

// -----------------------------------------------------------------------------
// 6. 統合（再現）: 20マス環状通路 + 岩1個 + 外側の鍵と宝箱 (EXP 4000, MP 2)
// -----------------------------------------------------------------------------
console.log('Testing 6: Integration - 20-tile ring loop breakout & chest unlock...');
{
  const engine = new GameEngine();
  (engine as any).state = 'PLAYING';
  const player = engine.getPlayer();
  const map = engine.getMap();
  buildRingMaze(map, true);

  player.pos = { x: 5, y: 5 };
  player.hasSword = true;
  player.strength = 10;
  player.experience = 4000;
  player.magic = 2;
  player.hp = 1000;
  player.maxHp = 1000;
  (engine as any).enemies = [];

  const bot = new AutoPlayBot({ enableGiveUp: true });
  let escaped = false;
  let openedChest = false;
  for (let t = 0; t < 150; t++) {
    bot.step(engine);
    const p = engine.getPlayer().pos;
    if (p.x > 11 || p.x < 4 || p.y < 4 || p.y > 11) {
      escaped = true;
    }
    if (map.getObject({ x: 16, y: 7 }) !== 'CHEST') {
      openedChest = true;
      console.log(`✓ 6. Escaped 20-tile ring and opened outer chest by turn ${t + 1}`);
      break;
    }
  }
  assert.strictEqual(escaped, true, '150T以内に環状通路の外へ出ること');
  assert.strictEqual(openedChest, true, '150T以内に外側の宝箱を開けること');
}

// -----------------------------------------------------------------------------
// 7. 統合: 環状通路から出られない状態 (MP 0, enableGiveUp=true) -> TERMINAL -> GIVE_UP
// -----------------------------------------------------------------------------
console.log('Testing 7: Integration - Unbreakable ring loop with MP=0 leads to TERMINAL GIVE_UP...');
{
  const engine = new GameEngine();
  (engine as any).state = 'PLAYING';
  const player = engine.getPlayer();
  const map = engine.getMap();
  buildRingMaze(map, false);

  player.pos = { x: 5, y: 5 };
  player.hasSword = true;
  player.strength = 10;
  player.experience = 1000;
  player.magic = 0;
  player.hp = 1000;
  player.maxHp = 1000;
  (engine as any).enemies = [];

  const bot = new AutoPlayBot({ enableGiveUp: true });
  let gaveUp = false;
  for (let t = 0; t < 200; t++) {
    const act = bot.step(engine);
    if (act.type === 'GIVE_UP' || bot.isGivenUp) {
      gaveUp = true;
      assert.strictEqual(bot.commander.level, 'TERMINAL', 'Commander が TERMINAL に到達して GIVE_UP すること');
      assert.ok(player.deathInfo !== null, 'deathInfo が記録されていること');
      assert.notStrictEqual(
        player.deathInfo.cause,
        'GIVE_UP_UNSOLVABLE',
        `細分化された GIVE_UP 要因が記録されること (actual: ${player.deathInfo.cause})`
      );
      assert.strictEqual(player.deathInfo.commanderLevel, 'TERMINAL');
      assert.ok((player.deathInfo.commanderTransitions?.length ?? 0) > 0, 'Commander 遷移履歴が記録されること');
      console.log(`✓ 7. Unbreakable ring loop triggered TERMINAL GIVE_UP (${player.deathInfo.cause}) at turn ${t + 1}`);
      break;
    }
  }
  assert.strictEqual(gaveUp, true, '200T以内に GIVE_UP すること');
}

// -----------------------------------------------------------------------------
// 8. 統合: enableGiveUp=false で 400T 回しても例外なし＆GIVE_UPしない
// -----------------------------------------------------------------------------
console.log('Testing 8: Integration - Unbreakable ring loop with enableGiveUp=false runs 400T safely...');
{
  const engine = new GameEngine();
  (engine as any).state = 'PLAYING';
  const player = engine.getPlayer();
  const map = engine.getMap();
  buildRingMaze(map, false);

  player.pos = { x: 5, y: 5 };
  player.hasSword = true;
  player.strength = 10;
  player.experience = 1000;
  player.magic = 0;
  player.hp = 1000;
  player.maxHp = 1000;
  (engine as any).enemies = [];

  const bot = new AutoPlayBot({ enableGiveUp: false });
  for (let t = 0; t < 400; t++) {
    const act = bot.step(engine);
    assert.notStrictEqual(act.type, 'GIVE_UP', 'enableGiveUp=false では GIVE_UP しない');
    assert.strictEqual(bot.isGivenUp, false);
  }
  console.log('✓ 8. enableGiveUp=false ran 400 turns without exceptions or GIVE_UP.');
}

// -----------------------------------------------------------------------------
// 9. 統合: ExploreFrontierMission が 1マス移動だけで COMPLETED にならないこと
// -----------------------------------------------------------------------------
console.log('Testing 9: ExploreFrontierMission does not fake-complete on 1-tile move...');
{
  const engine = new GameEngine();
  const player = engine.getPlayer();
  const map = engine.getMap();
  clearMapToFloor(map);
  player.pos = { x: 5, y: 5 };

  const memory = new EpisodicMemory();
  const spatial = new SpatialKnowledge(map);
  const mission = new ExploreFrontierMission({ x: 6, y: 5 });
  mission.startTurn = 1;

  // 1マスだけ移動した状態（newTiles = 1 < 8）
  memory.recordStep({ x: 6, y: 5 }, 2);
  player.pos = { x: 6, y: 5 };
  mission.turnsElapsed = 2;

  const snap: TacticalSnapshot = {
    spatial,
    milestones: SituationalPerception.evaluateMilestones(player, mockParams),
    threats: SituationalPerception.evaluateThreats(player, map, [], undefined, mockParams),
    confinement: SituationalPerception.evaluateConfinement(player, map, []),
    progress: memory.buildProgressWindow(2, map),
    player: {
      pos: { ...player.pos }, hp: 1000, maxHp: 1000, strength: 10, experience: 0,
      magic: 0, gold: 0, holdItem: 'NONE', hasSword: false, isFlying: false,
      canDiagonal: false, hasDeath: false, stepCountSinceStone: 0,
    },
    livingEnemies: [],
    memory,
    params: mockParams,
    map,
    totalTurns: 2,
  };

  const status = mission.evaluateStatus(snap, engine);
  assert.strictEqual(status, 'ACTIVE', '1マス移動だけでは COMPLETED にならず ACTIVE を維持すること');
  console.log('✓ 9. ExploreFrontierMission anti-fake-completion verified.');
}

console.log('================================================================');
console.log('   ALL StrategicCommander Tests PASSED Successfully!            ');
console.log('================================================================');
