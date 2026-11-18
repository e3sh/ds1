import assert from 'assert';
import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { Dragon } from '../src/models/Dragon.js';
import { GameEngine } from '../src/core/GameEngine.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { MapTacticalMetadata, TreasureZoneHint, GravePuzzleHint } from '../src/systems/generator/ThemeBlockTypes.js';
import { SpatialKnowledge } from '../src/ai/perception/SpatialKnowledge.js';
import { SituationalPerception } from '../src/ai/perception/SituationalPerception.js';
import { EpisodicMemory } from '../src/ai/perception/EpisodicMemory.js';
import { TacticalSnapshot } from '../src/ai/perception/TacticalSnapshot.js';
import { StrategicPlanner } from '../src/ai/strategy/StrategicPlanner.js';
import { DynamicBotParameters } from '../src/ai/BotTypes.js';
import { AdaptiveNavigator } from '../src/ai/AdaptiveNavigator.js';
import { HarvestPowerStoneMission } from '../src/ai/strategy/missions/HarvestPowerStoneMission.js';
import { CrownEscapeMission } from '../src/ai/strategy/missions/CrownEscapeMission.js';
import { CashInGoldMission } from '../src/ai/strategy/missions/CashInGoldMission.js';
import { PrepareDragonAssaultMission } from '../src/ai/strategy/missions/PrepareDragonAssaultMission.js';
import { RelocateHomeMission } from '../src/ai/strategy/missions/RelocateHomeMission.js';
import { TacticalExecutor } from '../src/ai/tactics/TacticalExecutor.js';
import { TacticalCombat } from '../src/ai/tactics/TacticalCombat.js';
import { EightStepController } from '../src/ai/EightStepController.js';
import { MapSituationEvaluator } from '../src/ai/perception/MapSituationEvaluator.js';

console.log('================================================================');
console.log('  Testing PST Step 1: Perception & Strategic Planner Units     ');
console.log('================================================================');

function createEmptyMap(w = 64, h = 64): WorldMap {
  const map = new WorldMap(w, h);
  map.clearWarpPairs();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      map.setBaseTile({ x, y }, 'EMPTY');
      map.setObject({ x, y }, 'NONE');
      map.setItem({ x, y }, 'NONE');
    }
  }
  return map;
}

const mockParams: DynamicBotParameters = {
  targetStr: 25000,
  targetDefenseExp: 20000,
  maxTargetMagic: 14,
  minDragonMagic: 3,
  emergencyHpRatio: 0.4,
  enableHomeRelocation: true,
  homeRelocateDistMin: 15,
  graveSealPolicy: 'HIGH_PRIORITY_ONLY',
  graveSealTiming: 'EARLY',
  graveSealEarlyStr: 2500,
  coinSearchDist: 10,
  potionSearchDist: 8,
  stoneSearchDist: 15,
  keySearchDist: 20,
};

// -------------------------------------------------------------
// Test 1: SpatialKnowledge のメタデータ統合とリアルタイム同期
// -------------------------------------------------------------
console.log('Testing 1: SpatialKnowledge integration with MapTacticalMetadata...');
{
  const map = createEmptyMap();
  map.setObject({ x: 10, y: 10 }, 'CHEST');
  map.setObject({ x: 12, y: 12 }, 'CHEST');
  map.setObject({ x: 20, y: 20 }, 'BLOCK'); // ショートカット候補マス

  const treasureHint: TreasureZoneHint = {
    id: 'ZONE_VAULT_1',
    bounds: { x1: 8, y1: 8, x2: 15, y2: 15 },
    entryPorts: [{ x: 8, y: 10 }],
    chestCount: 2,
    isEightStepOptimal: true,
  };

  const graveHint: GravePuzzleHint = {
    gravePos: { x: 30, y: 30 },
    themeId: 'GRAVE_PUZZLE_A',
    sealMode: 'BOX_EXITS',
    sealTargetPositions: [{ x: 30, y: 28 }, { x: 30, y: 32 }],
    recommendedPushes: [{
      blockPos: { x: 29, y: 28 },
      dir: 'RIGHT',
      destinationPos: { x: 30, y: 28 },
    }],
    priority: 'HIGH',
  };

  const metadata: MapTacticalMetadata = {
    dragonLairStyle: 'STANDARD_FORTRESS',
    recommendedBotTuning: {},
    recommendedRelocateAnchors: [{ x: 32, y: 25 }],
    gravePuzzleHints: [graveHint],
    treasureZoneHints: [treasureHint],
    breachShortcutPositions: [{ x: 20, y: 20 }],
  };

  const spatial = new SpatialKnowledge(map, metadata);

  // 1-1. ゾーン認識
  const zone = spatial.treasureZones.get('ZONE_VAULT_1');
  assert.ok(zone, '宝物庫ゾーンが登録されていること');
  assert.strictEqual(zone.remainingChests, 2, 'ゾーン内宝箱数が2個と認識されること');
  assert.strictEqual(zone.isCleared, false, '未攻略状態であること');

  // 1-2. ショートカット認識
  assert.strictEqual(spatial.breachShortcuts.length, 1, 'ショートカットが登録されていること');
  assert.strictEqual(spatial.breachShortcuts[0].isBreached, false, '未開削状態であること');

  // 1-3. リアルタイム状態同期: 宝箱を開けた場合
  map.setObject({ x: 10, y: 10 }, 'NONE');
  map.setObject({ x: 12, y: 12 }, 'NONE');
  spatial.update(map);
  assert.strictEqual(zone.remainingChests, 0, '宝箱開封後に残存0個に更新されること');
  assert.strictEqual(zone.isCleared, true, '残存0個で攻略完了になること');

  // 1-4. リアルタイム状態同期: ショートカットを開削した場合
  map.setObject({ x: 20, y: 20 }, 'NONE');
  spatial.update(map);
  assert.strictEqual(spatial.breachShortcuts[0].isBreached, true, 'ブロック消失で開削済みに更新されること');

  console.log('✓ 1. SpatialKnowledge metadata integration verified.');
}

// -------------------------------------------------------------
// Test 2: SituationalPerception マイルストーン＆脅威評価
// -------------------------------------------------------------
console.log('Testing 2: SituationalPerception milestone and threat evaluation...');
{
  const map = createEmptyMap();
  const player = new Player({ x: 10, y: 10, hp: 1000, maxHp: 1000 });
  player.hasSword = true;
  player.experience = 4500;
  player.strength = 1000;
  player.magic = 5;

  const milestones = SituationalPerception.evaluateMilestones(player, mockParams);
  assert.strictEqual(milestones.hasSword, true);
  assert.strictEqual(milestones.canBreak, true, 'EXP 4500 なので BREAK 解禁');
  assert.strictEqual(milestones.canDiagonal, false, 'EXP < 12000 なので斜め不可');
  assert.strictEqual(milestones.hasTargetStr, false, 'STR < 25000 なので未達');

  // 直角隣接の即死敵
  const enemies: EnemyInstance[] = [
    {
      id: 'e1',
      type: 'SUPER_DEMON',
      name: 'Super Demon',
      pos: { x: 10, y: 11 }, // マンハッタン距離1
      hp: 5000,
      maxHp: 5000,
      atk: 10000,
      def: 1000,
      exp: 1000,
      isAlive: true,
      isPermanentlyFrozen: false,
    } as any,
  ];

  const threats = SituationalPerception.evaluateThreats(player, map, enemies, undefined, mockParams);
  assert.strictEqual(threats.isLethalDanger, true, '直角隣接の強敵が即死危機として検知されること');
  assert.strictEqual(threats.adjacentLethalEnemies.length, 1);

  console.log('✓ 2. SituationalPerception evaluated successfully.');
}

// -------------------------------------------------------------
// Test 3: EpisodicMemory のブラックリスト＆ピンポン検知
// -------------------------------------------------------------
console.log('Testing 3: EpisodicMemory unreachable marking and ping-pong detection...');
{
  const memory = new EpisodicMemory();
  const targetPos = { x: 5, y: 5 };

  // 10ターン間ブラックリスト登録 (currentTurn = 10 -> expireTurn = 20)
  memory.markTargetUnreachable(targetPos, 10, 10);
  assert.strictEqual(memory.isTargetUnreachable(targetPos, 15), true, '期限内は到達不能');
  assert.strictEqual(memory.isTargetUnreachable(targetPos, 20), false, '期限後は解除');

  // 2マス往復 (Ping-Pong) 検知
  memory.recordStep({ x: 1, y: 1 }, 1);
  memory.recordStep({ x: 1, y: 2 }, 2);
  memory.recordStep({ x: 1, y: 1 }, 3);
  memory.recordStep({ x: 1, y: 2 }, 4);
  const cycle = memory.movement.detectCycle();
  assert.strictEqual(cycle?.period, 2, '2マス往復が周期2として正しく検知されること');

  console.log('✓ 3. EpisodicMemory verified.');
}

// -------------------------------------------------------------
// Test 4: StrategicPlanner ミッション選定・コミットメント維持・緊急割り込み
// -------------------------------------------------------------
console.log('Testing 4: StrategicPlanner mission selection, commitment, and emergency interruption...');
{
  const map = createEmptyMap();
  map.setItem({ x: 15, y: 15 }, 'SWORD');

  const engine = new GameEngine();
  const player = engine.getPlayer();
  player.pos = { x: 10, y: 10 };
  player.hasSword = false;
  player.hp = 1000;
  player.maxHp = 1000;

  const spatial = new SpatialKnowledge(map);
  const memory = new EpisodicMemory();
  const planner = new StrategicPlanner();

  const createSnapshot = (threatsOverride?: any, enemiesOverride?: EnemyInstance[]): TacticalSnapshot => {
    const enemies = enemiesOverride ?? [];
    const milestones = SituationalPerception.evaluateMilestones(player, mockParams);
    const threats = threatsOverride ?? SituationalPerception.evaluateThreats(player, map, enemies, undefined, mockParams);
    const confinement = SituationalPerception.evaluateConfinement(player, map, enemies);
    const progress = memory.buildProgressWindow(0, map);
    return {
      spatial,
      milestones,
      threats,
      confinement,
      progress,
      player: {
        pos: { ...player.pos },
        hp: player.hp,
        maxHp: player.maxHp,
        strength: player.strength,
        experience: player.experience,
        magic: player.magic,
        gold: player.gold,
        holdItem: player.holdItem,
        hasSword: player.hasSword,
        isFlying: player.isFlying,
        canDiagonal: milestones.canDiagonal,
        hasDeath: player.hasDeath,
        stepCountSinceStone: player.stepCountSinceStone,
      },
      livingEnemies: enemies,
      memory,
      params: mockParams,
      map,
      totalTurns: 1,
    };
  };

  // 4-1. 剣未所持 -> BootstrapSwordMission が選ばれること
  const dir1 = planner.planTurn(createSnapshot(), engine);
  assert.ok(planner.activeMission, 'ミッションが設定されていること');
  assert.strictEqual(planner.activeMission!.id, 'BOOTSTRAP_SWORD', '初期ミッションはBootstrapSword');
  assert.strictEqual(planner.activeMission!.turnsElapsed, 1, '経過ターンが1');

  // 4-2. コミットメント維持: 2手目も同一ミッションが維持されること
  const dir2 = planner.planTurn(createSnapshot(), engine);
  assert.strictEqual(planner.activeMission!.id, 'BOOTSTRAP_SWORD', '同一ミッションがコミット維持されること');
  assert.strictEqual(planner.activeMission!.turnsElapsed, 2, '経過ターンがインクリメントされること');

  // 4-3. 緊急危機割り込み: 即死危機が発生すると EmergencyEvacuateMission に切り替わること
  const lethalThreats = {
    isPinchHp: false,
    isLethalDanger: true,
    maxNearEnemyAtk: 10000,
    adjacentLethalEnemies: [{ id: 'e1', atk: 10000 } as any],
    isOnDragonFireLine: false,
  };
  const dirEmergency = planner.planTurn(createSnapshot(lethalThreats), engine);
  assert.strictEqual(planner.activeMission!.id, 'EMERGENCY_EVACUATE', '緊急事態発生で緊急退避ミッションへ即時割り込み');

  // 4-4. 危機解除後、剣回収を再開
  const safeThreats = {
    isPinchHp: false,
    isLethalDanger: false,
    maxNearEnemyAtk: 0,
    adjacentLethalEnemies: [],
    isOnDragonFireLine: false,
  };
  planner.planTurn(createSnapshot(safeThreats), engine);
  assert.strictEqual(planner.activeMission!.id, 'BOOTSTRAP_SWORD', '危機解除で本来のミッションへ復帰');

  // 4-5. 剣を取得して完了 -> 次のミッション (EarlyBreakUnlockMission) へ進むこと
  player.hasSword = true;
  player.strength = 1000;
  player.experience = 1000;
  const safeEnemy: EnemyInstance = {
    id: 'safe-slime',
    name: 'Slime',
    type: 'SLIME',
    pos: { x: 12, y: 10 },
    hp: 50,
    maxHp: 50,
    atk: 100,
    def: 0,
    exp: 50,
    isAlive: true,
    isPermanentlyFrozen: false,
  } as any;
  const dirAfterSword = planner.planTurn(createSnapshot(safeThreats, [safeEnemy]), engine);
  assert.strictEqual(planner.activeMission!.id, 'EARLY_BREAK_UNLOCK', '剣回収後はEXP 4000未満のためBREAK解禁ミッションへ');

  console.log('✓ 4. StrategicPlanner commitment and transitions fully verified.');
}

// -------------------------------------------------------------
// Test 5: Step 4 能力・状態アフォーダンス（行動可否）の厳密化
// -------------------------------------------------------------
console.log('Testing 5: Affordance validation (canBreak, canCastMagic, canPickupFloorItem, canOpenChest)...');
{
  const player = new Player({ x: 5, y: 5, hp: 1000, maxHp: 1000 });
  player.experience = 5000;
  player.magic = 3;
  player.hasDeath = false;
  player.holdItem = 'NONE';

  // 通常状態: EXP >= 4000, MP >= 1, 死神なし -> canBreak === true, canCastMagic === true
  let ms = SituationalPerception.evaluateMilestones(player, mockParams);
  assert.strictEqual(ms.canBreak, true, '通常時は BREAK 可能');
  assert.strictEqual(ms.canCastMagic, true, '通常時は魔法詠唱可能');
  assert.strictEqual(ms.canPickupFloorItem, true, '手ぶら時は床アイテム回収可能');
  assert.strictEqual(ms.canOpenChest, false, '鍵未所持時は宝箱開錠不可');

  // 死神憑依時: 魔法封印により canBreak === false, canCastMagic === false
  player.hasDeath = true;
  ms = SituationalPerception.evaluateMilestones(player, mockParams);
  assert.strictEqual(ms.canBreak, false, '死神憑依時は BREAK 不可');
  assert.strictEqual(ms.canCastMagic, false, '死神憑依時は魔法詠唱不可');

  // 死神解除後、MP枯渇時 (MP = 0): canBreak === false, canCastMagic === false
  player.hasDeath = false;
  player.magic = 0;
  ms = SituationalPerception.evaluateMilestones(player, mockParams);
  assert.strictEqual(ms.canBreak, false, 'MP枯渇時は BREAK 不可');
  assert.strictEqual(ms.canCastMagic, false, 'MP枯渇時は魔法詠唱不可');

  // 鍵所持時: canPickupFloorItem === false, canOpenChest === true
  player.magic = 2;
  player.holdItem = 'KEY';
  ms = SituationalPerception.evaluateMilestones(player, mockParams);
  assert.strictEqual(ms.canPickupFloorItem, false, '鍵所持時は床アイテム拾い不可（手持ち制限）');
  assert.strictEqual(ms.canOpenChest, true, '鍵所持時は宝箱開錠可能');

  console.log('✓ 5. Affordance validation verified successfully.');
}

// -------------------------------------------------------------
// Test 6: Step 4 並行基本行動（Opportunistic Layer）と戦略調停器 (Directive Arbiter)
// -------------------------------------------------------------
console.log('Testing 6: Directive Arbiter & Opportunistic behaviors (pickup & combat)...');
{
  const map = createEmptyMap();
  const engine = new GameEngine();
  const player = engine.getPlayer();
  player.pos = { x: 10, y: 10 };
  player.hasSword = true;
  player.strength = 5000;
  player.experience = 5000;
  player.magic = 2;
  player.holdItem = 'NONE';

  const spatial = new SpatialKnowledge(map);
  const memory = new EpisodicMemory();
  const planner = new StrategicPlanner();

  const createSnapshotWithState = (enemies: EnemyInstance[] = []): TacticalSnapshot => {
    const milestones = SituationalPerception.evaluateMilestones(player, mockParams);
    const threats = SituationalPerception.evaluateThreats(player, map, enemies, undefined, mockParams);
    return {
      spatial,
      milestones,
      threats,
      player: {
        pos: { ...player.pos },
        hp: player.hp,
        maxHp: player.maxHp,
        strength: player.strength,
        experience: player.experience,
        magic: player.magic,
        gold: player.gold,
        holdItem: player.holdItem,
        hasSword: player.hasSword,
        isFlying: player.isFlying,
        canDiagonal: milestones.canDiagonal,
        hasDeath: player.hasDeath,
        stepCountSinceStone: player.stepCountSinceStone,
      },
      livingEnemies: enemies,
      memory,
      params: mockParams,
      map,
      totalTurns: 1,
    };
  };

  // 6-1. 動線上の足元アイテムついで拾い:
  // 主目標が遠くの移動 (priority: 50) であっても、足元にコインがあれば調停器が PICKUP_ITEM (priority: 92) を採択すること
  map.setItem(player.pos, 'COIN');
  const rawNavigateDirective = {
    type: 'NAVIGATE_TO_POSITION' as const,
    targetPos: { x: 25, y: 25 },
    priority: 50,
    reason: '遠くの目的地へ移動',
  };

  const arbitrated1 = planner.arbitrateDirectives(rawNavigateDirective, createSnapshotWithState(), engine);
  assert.strictEqual(arbitrated1.type, 'PICKUP_ITEM', '足元のコイン回収ディレクティブが採択されること');
  assert.strictEqual(arbitrated1.targetItemType, 'COIN');
  assert.strictEqual(arbitrated1.priority, 92);

  // 6-2. 鍵所持時は床コインに脱線しないこと (canPickupFloorItem === false):
  player.holdItem = 'KEY';
  const arbitrated2 = planner.arbitrateDirectives(rawNavigateDirective, createSnapshotWithState(), engine);
  assert.strictEqual(arbitrated2.type, 'NAVIGATE_TO_POSITION', '鍵所持中は床アイテムに脱線せず主作戦ディレクティブを維持');
  assert.strictEqual(arbitrated2.priority, 50);

  // 6-3. 近傍（2歩先）のアイテムついで拾い:
  player.holdItem = 'NONE';
  map.setItem(player.pos, 'NONE');
  map.setItem({ x: 11, y: 11 }, 'POTION'); // 距離2
  const arbitrated3 = planner.arbitrateDirectives(rawNavigateDirective, createSnapshotWithState(), engine);
  assert.strictEqual(arbitrated3.type, 'NAVIGATE_TO_POSITION', '近傍アイテムへの移動ディレクティブが採択');
  assert.strictEqual(arbitrated3.targetItemType, 'POTION');
  assert.strictEqual(arbitrated3.targetPos?.x, 11);
  assert.strictEqual(arbitrated3.targetPos?.y, 11);
  assert.ok(arbitrated3.priority > 50, '主作戦(50)より高い優先度');

  // 6-4. 動線上の安全敵ワンパン迎撃:
  map.setItem({ x: 11, y: 11 }, 'NONE');
  const safeEnemy: EnemyInstance = {
    id: 'e-slime',
    name: 'Slime',
    type: 'SLIME',
    pos: { x: 10, y: 11 }, // マンハッタン距離1（隣接）
    hp: 50,
    maxHp: 50,
    atk: 10,
    def: 0,
    exp: 50,
    isAlive: true,
    isPermanentlyFrozen: false,
  } as any;
  const arbitratedCombat = planner.arbitrateDirectives(rawNavigateDirective, createSnapshotWithState([safeEnemy]), engine);
  assert.strictEqual(arbitratedCombat.type, 'ATTACK_TARGET', '隣接安全敵のワンパン迎撃ディレクティブが採択されること');
  assert.strictEqual(arbitratedCombat.targetPos?.x, 10);
  assert.strictEqual(arbitratedCombat.targetPos?.y, 11);
  assert.strictEqual(arbitratedCombat.priority, 80);

  console.log('✓ 6. Directive Arbiter & Opportunistic behaviors verified successfully.');
}

// -------------------------------------------------------------
// Test 7: カテゴリ3 TacticalStallResolver & 8歩周期チェーン保護
// -------------------------------------------------------------
console.log('Testing 7: TacticalStallResolver & Eight-step chain protection...');
{
  const map = createEmptyMap();
  const engine = new GameEngine();
  const player = engine.getPlayer();
  player.pos = { x: 5, y: 5 };
  player.hasSword = true;
  player.magic = 3;
  player.experience = 5000;
  player.holdItem = 'KEY';
  player.stepCountSinceStone = 0;

  const nav = new AdaptiveNavigator();
  const spatial = new SpatialKnowledge(map);
  const memory = new EpisodicMemory();
  const planner = new StrategicPlanner();

  // 7-1. 8歩周期チェーン保護: 足元に石が出現した直後 (stepCountSinceStone === 0) で周辺に宝箱がある場合
  map.setItem(player.pos, 'POWER_STONE');
  map.setObject({ x: 7, y: 5 }, 'CHEST'); // 距離2に宝箱

  const harvestMission = new HarvestPowerStoneMission(player.pos);
  const snapshot: TacticalSnapshot = {
    spatial,
    milestones: SituationalPerception.evaluateMilestones(player, mockParams),
    threats: SituationalPerception.evaluateThreats(player, map, [], undefined, mockParams),
    player: {
      pos: { ...player.pos },
      hp: player.hp,
      maxHp: player.maxHp,
      strength: player.strength,
      experience: player.experience,
      magic: player.magic,
      gold: player.gold,
      holdItem: player.holdItem,
      hasSword: player.hasSword,
      isFlying: player.isFlying,
      canDiagonal: false,
      hasDeath: false,
      stepCountSinceStone: player.stepCountSinceStone,
    },
    livingEnemies: [],
    memory,
    params: mockParams,
    map,
    totalTurns: 1,
  };

  const chainDirective = harvestMission.generateDirective(snapshot, engine);
  assert.strictEqual(chainDirective.type, 'UNLOCK_CHEST_8STEP', 'チェーン可能な場合は足元石回収より8歩周期開錠を優先指示すること');
  assert.strictEqual(chainDirective.priority, 93);

  // 7-2. 袋小路拘束打開 (RETURN / JUMP): 四方を壁で囲まれた場合
  map.setBaseTile({ x: 5, y: 4 }, 'WALL_STATIC');
  map.setBaseTile({ x: 5, y: 6 }, 'WALL_STATIC');
  map.setBaseTile({ x: 4, y: 5 }, 'WALL_STATIC');
  map.setBaseTile({ x: 6, y: 5 }, 'WALL_STATIC');
  snapshot.confinement = SituationalPerception.evaluateConfinement(player, map, []);

  const rawDirective = {
    type: 'NAVIGATE_TO_POSITION' as const,
    targetPos: { x: 20, y: 20 },
    priority: 50,
    reason: '目的地へ移動',
  };

  const stallDirective = planner.arbitrateDirectives(rawDirective, snapshot, engine);
  assert.strictEqual(stallDirective.type, 'CAST_MAGIC', '袋小路拘束時に魔法脱出ディレクティブが発行されること');
  assert.strictEqual(stallDirective.magicToCast, 'RETURN', 'RETURNが優先されること');
  assert.ok(stallDirective.priority >= 98, '高優先度で即座に打開されること');

  console.log('✓ 7. TacticalStallResolver & Eight-step chain protection verified successfully.');
}

// -------------------------------------------------------------
// Test 8: カテゴリ2 ReadinessEvaluator & PrepareDragonAssaultMission
// -------------------------------------------------------------
console.log('Testing 8: ReadinessEvaluator & PrepareDragonAssaultMission...');
{
  const map = createEmptyMap();
  map.setItem({ x: 12, y: 12 }, 'POTION');

  const engine = new GameEngine();
  const player = engine.getPlayer();
  player.pos = { x: 10, y: 10 };
  player.hasSword = true;
  player.strength = 300000;
  player.experience = 15000;
  player.magic = 1; // MP不足
  player.gold = 3;  // 未換金コインあり
  player.hp = 10000;
  player.maxHp = 10000;

  const dragon = new Dragon();
  const spatial = new SpatialKnowledge(map);
  const memory = new EpisodicMemory();
  const planner = new StrategicPlanner();

  const snapshot: TacticalSnapshot = {
    spatial,
    milestones: SituationalPerception.evaluateMilestones(player, mockParams, dragon),
    threats: SituationalPerception.evaluateThreats(player, map, [], dragon, mockParams),
    player: {
      pos: { ...player.pos },
      hp: player.hp,
      maxHp: player.maxHp,
      strength: player.strength,
      experience: player.experience,
      magic: player.magic,
      gold: player.gold,
      holdItem: player.holdItem,
      hasSword: player.hasSword,
      isFlying: player.isFlying,
      canDiagonal: true,
      hasDeath: false,
      stepCountSinceStone: player.stepCountSinceStone,
    },
    livingEnemies: [],
    memory,
    params: mockParams,
    map,
    totalTurns: 1,
  };

  // 8-1. STR達成時、未換金コインや残存ポーションがあるなら即突撃せず PrepareDragonAssaultMission が選ばれること
  const nextMission = planner.selectNextMission(snapshot, engine);
  assert.strictEqual(nextMission.id, 'PREPARE_DRAGON_ASSAULT', '決戦前準備ミッションが選定されること');

  // 8-2. コイン所持中は我が家への換金帰還ディレクティブが優先されること
  const dirGold = nextMission.generateDirective(snapshot, engine);
  assert.strictEqual(dirGold.type, 'NAVIGATE_TO_POSITION');
  assert.strictEqual(dirGold.targetPos?.x, map.realHomePos.x);
  assert.strictEqual(dirGold.targetPos?.y, map.realHomePos.y);

  // 8-3. コイン換金後、残存ポーションがあればポーション回収ディレクティブが発行されること
  player.gold = 0;
  const dirPotion = nextMission.generateDirective(snapshot, engine);
  assert.strictEqual(dirPotion.type, 'NAVIGATE_TO_POSITION');
  assert.strictEqual(dirPotion.targetPos?.x, 12);
  assert.strictEqual(dirPotion.targetPos?.y, 12);
  assert.strictEqual(dirPotion.targetItemType, 'POTION');

  // 8-4. ポーション回収・換金完了後は準備完了となり SlayDragonMission が選定されること
  player.magic = 10;
  player.experience = mockParams.targetDefenseExp; // コイン換金により防御EXP達成
  snapshot.player.experience = player.experience;
  map.setItem({ x: 12, y: 12 }, 'NONE');
  const finalMission = planner.selectNextMission(snapshot, engine);
  assert.strictEqual(finalMission.id, 'SLAY_DRAGON', '準備完了後にドラゴン決戦ミッションが選定されること');

  console.log('✓ 8. ReadinessEvaluator & PrepareDragonAssaultMission verified successfully.');
}

// -------------------------------------------------------------
// Test 9: カテゴリ1 CrownEscapeMission 先読み自衛・事前スタン・一時ドロップ
// -------------------------------------------------------------
console.log('Testing 9: CrownEscapeMission pre-pickup FLASH, safe temporary drop & evade...');
{
  const map = createEmptyMap();
  const engine = new GameEngine();
  const player = engine.getPlayer();
  player.pos = { x: 10, y: 10 };
  player.hasSword = true;
  player.strength = 500000;
  player.experience = 20000;
  player.magic = 3;
  player.holdItem = 'NONE';
  player.hp = 10000;
  player.maxHp = 10000;

  map.setItem(player.pos, 'CROWN');

  const escapeMission = new CrownEscapeMission();
  const spatial = new SpatialKnowledge(map);
  const memory = new EpisodicMemory();

  // 9-1. 周囲2マスに未凍結即死敵がいる場合: 王冠を拾う前に FREEZE または FLASH 詠唱が発行されること
  const lethalEnemy: EnemyInstance = {
    id: 'e-demon',
    name: 'Demon',
    type: 'SUPER_DEMON',
    pos: { x: 10, y: 12 }, // マンハッタン距離2
    hp: 10000,
    maxHp: 10000,
    atk: 30000, // プレイヤーEXP 20000 超過 -> 即死/大ダメージ
    def: 1000,
    exp: 1000,
    isAlive: true,
    isPermanentlyFrozen: false,
    frozenTimer: 0,
  } as any;

  const snapshotWithEnemy: TacticalSnapshot = {
    spatial,
    milestones: SituationalPerception.evaluateMilestones(player, mockParams),
    threats: SituationalPerception.evaluateThreats(player, map, [lethalEnemy], undefined, mockParams),
    player: {
      pos: { ...player.pos },
      hp: player.hp,
      maxHp: player.maxHp,
      strength: player.strength,
      experience: player.experience,
      magic: player.magic,
      gold: player.gold,
      holdItem: player.holdItem,
      hasSword: player.hasSword,
      isFlying: player.isFlying,
      canDiagonal: true,
      hasDeath: false,
      stepCountSinceStone: 0,
    },
    livingEnemies: [lethalEnemy],
    memory,
    params: mockParams,
    map,
    totalTurns: 1,
  };

  const prePickupDir = escapeMission.generateDirective(snapshotWithEnemy, engine);
  assert.strictEqual(prePickupDir.type, 'CAST_MAGIC', '王冠を無防備に拾わず、手ぶらのうちに魔法自衛すること');
  assert.ok(prePickupDir.magicToCast === 'FREEZE' || prePickupDir.magicToCast === 'FLASH');

  // 9-2. 敵が凍結・無力化された後: 安全に王冠を取得 (PICKUP_ITEM) すること
  lethalEnemy.isPermanentlyFrozen = true;
  const safeSnapshot = {
    ...snapshotWithEnemy,
    livingEnemies: [lethalEnemy],
  };
  const pickupDir = escapeMission.generateDirective(safeSnapshot, engine);
  assert.strictEqual(pickupDir.type, 'PICKUP_ITEM', '安全確認後に王冠を取得すること');
  assert.strictEqual(pickupDir.targetItemType, 'CROWN');

  // 9-3. 王冠運搬中、近傍（距離2）に即死敵が接近: 安全距離で王冠を一時ドロップして手ぶらに戻ること
  player.holdItem = 'CROWN';
  map.setItem(player.pos, 'NONE');
  const activeLethal: EnemyInstance = {
    id: 'e-demon-2',
    name: 'Demon 2',
    type: 'SUPER_DEMON',
    pos: { x: 10, y: 12 }, // 距離2
    hp: 1000000, // ワンパン不可の強敵
    maxHp: 1000000,
    atk: 30000,
    def: 1000,
    exp: 1000,
    isAlive: true,
    isPermanentlyFrozen: false,
    frozenTimer: 0,
  } as any;

  const carryingSnapshot: TacticalSnapshot = {
    ...snapshotWithEnemy,
    player: {
      ...snapshotWithEnemy.player,
      holdItem: 'CROWN',
    },
    livingEnemies: [activeLethal],
  };

  const dropDir = escapeMission.generateDirective(carryingSnapshot, engine);
  assert.strictEqual(dropDir.type, 'DROP_HOLD_ITEM', '即死敵接近時に安全距離で王冠を一時ドロップすること');

  // 9-4. 直角隣接（距離1）に即死敵がいる場合: 自殺ドロップせず、緊急退避すること
  activeLethal.pos = { x: 10, y: 11 }; // 距離1
  const adjacentLethalSnapshot: TacticalSnapshot = {
    ...carryingSnapshot,
    livingEnemies: [activeLethal],
  };
  const evadeDir = escapeMission.generateDirective(adjacentLethalSnapshot, engine);
  assert.strictEqual(evadeDir.type, 'EVADE_DANGER', '隣接即死敵に対して自殺ドロップを絶対防止し緊急退避すること');

  // 9-5. 遠方岩開削ロックによるピンポン防止
  {
    const e95 = new GameEngine();
    const d95 = e95.getDragon();
    if (d95) {
      d95.defeatedHeadsCount = 3;
      d95.heads.forEach(h => (h.isAlive = false));
    }
    const m95 = createEmptyMap();
    for (const h of m95.getAllHomePositions()) {
      m95.setBaseTile(h, 'EMPTY');
    }
    const home95 = { x: 5, y: 10 };
    m95.setBaseTile(home95, 'HOME');
    m95.homePos = { ...home95 };
    m95.setRealHomePos(home95);
    m95.spawnHomePos = { ...home95 };

    // (5,10) と (6,10) を WALL_STATIC で囲み、唯一の入口 (7,10) にのみ BLOCK を配置
    for (let y = 9; y <= 11; y++) {
      m95.setBaseTile({ x: 4, y }, 'WALL_STATIC');
    }
    for (let x = 5; x <= 7; x++) {
      m95.setBaseTile({ x, y: 9 }, 'WALL_STATIC');
      m95.setBaseTile({ x, y: 11 }, 'WALL_STATIC');
    }
    m95.setObject({ x: 7, y: 10 }, 'BLOCK');
    m95.setItem({ x: 10, y: 10 }, 'CROWN');

    const p95 = e95.getPlayer();
    p95.pos = { x: 10, y: 10 };
    p95.holdItem = 'NONE';
    p95.hasSword = true;
    p95.experience = 20000;
    p95.magic = 5;
    p95.hp = 1000;
    p95.maxHp = 1000;

    const spatial95 = new SpatialKnowledge(m95);
    const memory95 = new EpisodicMemory();
    const mission95 = new CrownEscapeMission();

    const makeSnap95 = (turn: number): TacticalSnapshot => ({
      spatial: spatial95,
      milestones: SituationalPerception.evaluateMilestones(p95, mockParams),
      threats: SituationalPerception.evaluateThreats(p95, m95, [], undefined, mockParams),
      player: {
        pos: { ...p95.pos },
        hp: p95.hp,
        maxHp: p95.maxHp,
        strength: p95.strength,
        experience: p95.experience,
        magic: p95.magic,
        gold: p95.gold,
        holdItem: p95.holdItem,
        hasSword: p95.hasSword,
        isFlying: p95.isFlying,
        canDiagonal: true,
        hasDeath: false,
        stepCountSinceStone: 0,
      },
      livingEnemies: [],
      memory: memory95,
      params: mockParams,
      map: m95,
      totalTurns: turn,
    });

    const dirTurn1 = mission95.generateDirective(makeSnap95(1), e95);
    assert.strictEqual(dirTurn1.type, 'BREACH_SHORTCUT', '直通路がない場合は王冠の上で BREACH_SHORTCUT を指示すること');
    assert.deepStrictEqual(dirTurn1.targetPos, { x: 7, y: 10 }, '開削対象が (7, 10) であること');

    // 次ターン: プレイヤーが (9, 10) へ 1歩前進（王冠から離脱、まだ岩は未破壊）
    p95.pos = { x: 9, y: 10 };
    const dirTurn2 = mission95.generateDirective(makeSnap95(2), e95);
    assert.strictEqual(dirTurn2.type, 'BREACH_SHORTCUT', '王冠から離れても clearingBlockPos ロックにより BREACH_SHORTCUT を維持すること');
    assert.deepStrictEqual(dirTurn2.targetPos, { x: 7, y: 10 }, '王冠 (10, 10) に引き返さず (7, 10) へ進み続けること');
  }

  // 9-6. 四方包囲時の王冠自殺ドロップ根絶と決死的突破 MOVE
  {
    const e96 = new GameEngine();
    const d96 = e96.getDragon();
    if (d96) {
      d96.defeatedHeadsCount = 3;
      d96.heads.forEach(h => (h.isAlive = false));
    }
    const m96 = createEmptyMap();
    const p96 = e96.getPlayer();
    p96.pos = { x: 10, y: 10 };
    p96.holdItem = 'CROWN';
    p96.hasSword = true;
    p96.strength = 500000;
    p96.experience = 20000;
    p96.magic = 5;
    p96.hasDeath = false;
    p96.hp = 500;
    p96.maxHp = 1000;

    const wallNeighbors = [
      { x: 9, y: 9 }, { x: 10, y: 9 }, { x: 11, y: 9 },
      { x: 9, y: 10 },                 { x: 11, y: 10 },
      { x: 9, y: 11 },                 { x: 11, y: 11 },
    ];
    for (const w of wallNeighbors) {
      m96.setBaseTile(w, 'WALL_STATIC');
    }

    const trapEnemy: EnemyInstance = {
      id: 'e-trap',
      name: 'TrapDemon',
      type: 'SUPER_DEMON',
      pos: { x: 10, y: 11 },
      hp: 10000,
      maxHp: 10000,
      atk: 30000,
      def: 1000,
      exp: 1000,
      isAlive: true,
      isPermanentlyFrozen: false,
      frozenTimer: 0,
    } as any;

    const mem96 = new EpisodicMemory();
    const snap96: TacticalSnapshot = {
      spatial: new SpatialKnowledge(m96),
      milestones: SituationalPerception.evaluateMilestones(p96, mockParams),
      threats: SituationalPerception.evaluateThreats(p96, m96, [trapEnemy], undefined, mockParams),
      confinement: SituationalPerception.evaluateConfinement(p96, m96, [trapEnemy]),
      progress: mem96.buildProgressWindow(5, m96),
      player: {
        pos: { ...p96.pos },
        hp: p96.hp,
        maxHp: p96.maxHp,
        strength: p96.strength,
        experience: p96.experience,
        magic: p96.magic,
        gold: p96.gold,
        holdItem: p96.holdItem,
        hasSword: p96.hasSword,
        isFlying: p96.isFlying,
        canDiagonal: true,
        hasDeath: false,
        stepCountSinceStone: 0,
      },
      livingEnemies: [trapEnemy],
      memory: mem96,
      params: mockParams,
      map: m96,
      totalTurns: 5,
    };

    const nav96 = new AdaptiveNavigator();
    const executor96 = new TacticalExecutor(nav96, new EightStepController(nav96));
    const execRes96 = executor96.execute(
      { type: 'EVADE_DANGER', priority: 100, reason: '四方包囲テスト' },
      snap96,
      e96
    );
    assert.strictEqual(execRes96.action.type, 'MOVE', '四方包囲時でも王冠保持のまま決死的突破 MOVE を返すこと');
    assert.notStrictEqual(execRes96.action.type, 'SPACE', '王冠の自殺ドロップ SPACE を絶対に返さないこと');
  }

  // 9-7. 我が家(HOME)遮断時のブラックリスト化防止と CROWN_ESCAPE 維持
  {
    const e97 = new GameEngine();
    const d97 = e97.getDragon();
    if (d97) {
      d97.defeatedHeadsCount = 3;
      d97.heads.forEach(h => (h.isAlive = false));
    }
    const m97 = createEmptyMap();
    for (const h of m97.getAllHomePositions()) {
      m97.setBaseTile(h, 'EMPTY');
    }
    const home97 = { x: 5, y: 10 };
    m97.setBaseTile(home97, 'HOME');
    m97.homePos = { ...home97 };
    m97.setRealHomePos(home97);
    m97.spawnHomePos = { ...home97 };

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        m97.setBaseTile({ x: home97.x + dx, y: home97.y + dy }, 'WALL_STATIC');
      }
    }

    const p97 = e97.getPlayer();
    p97.pos = { x: 10, y: 10 };
    p97.holdItem = 'CROWN';
    p97.hasSword = true;
    p97.experience = 20000;
    p97.magic = 5;
    p97.hp = 1000;
    p97.maxHp = 1000;

    const memory97 = new EpisodicMemory();
    const snap97: TacticalSnapshot = {
      spatial: new SpatialKnowledge(m97),
      milestones: SituationalPerception.evaluateMilestones(p97, mockParams),
      threats: SituationalPerception.evaluateThreats(p97, m97, [], undefined, mockParams),
      player: {
        pos: { ...p97.pos },
        hp: p97.hp,
        maxHp: p97.maxHp,
        strength: p97.strength,
        experience: p97.experience,
        magic: p97.magic,
        gold: p97.gold,
        holdItem: p97.holdItem,
        hasSword: p97.hasSword,
        isFlying: p97.isFlying,
        canDiagonal: true,
        hasDeath: false,
        stepCountSinceStone: 0,
      },
      livingEnemies: [],
      memory: memory97,
      params: mockParams,
      map: m97,
      totalTurns: 10,
    };

    const nav97 = new AdaptiveNavigator();
    const executor97 = new TacticalExecutor(nav97, new EightStepController(nav97));
    const navDirective97 = {
      type: 'NAVIGATE_TO_POSITION' as const,
      targetPos: { ...m97.realHomePos },
      priority: 100,
      reason: '王冠帰還',
    };
    const res97 = executor97.execute(navDirective97, snap97, e97);
    assert.strictEqual(res97.status, 'PATH_BLOCKED', '完全封鎖された HOME への移動は PATH_BLOCKED を返すこと');
    assert.strictEqual(memory97.isTargetUnreachable(m97.realHomePos, 10), false, 'EpisodicMemory に realHomePos がブラックリスト登録されないこと');

    const planner97 = new StrategicPlanner();
    planner97.planTurn(snap97, e97);
    assert.strictEqual(planner97.activeMission?.id, 'CROWN_ESCAPE');
    planner97.recordExecutionResult(navDirective97, res97, snap97);
    planner97.recordExecutionResult(navDirective97, res97, snap97);
    assert.strictEqual(planner97.activeMission?.status, 'ACTIVE', 'CROWN_ESCAPE は PATH_BLOCKED が連続しても ABORTED にならないこと');
    assert.strictEqual(memory97.isTargetUnreachable(m97.realHomePos, 10), false, 'Planner でも realHomePos はブラックリスト化されないこと');
  }

  console.log('✓ 9. CrownEscapeMission pre-pickup FLASH, safe temporary drop & evade verified successfully.');
}

// -------------------------------------------------------------
// Test 10: HarvestPowerStoneMission の偽完了防止とステータス検証
// -------------------------------------------------------------
console.log('Testing 10: HarvestPowerStoneMission fake completion guard & STR delta verification...');
{
  const e10 = new GameEngine();
  const m10 = createEmptyMap();
  for (const h of m10.getAllHomePositions()) {
    m10.setBaseTile(h, 'EMPTY');
  }
  const home10 = { x: 8, y: 8 };
  m10.setBaseTile(home10, 'HOME');
  m10.homePos = { ...home10 };
  m10.setRealHomePos(home10);
  m10.spawnHomePos = { ...home10 };

  const p10 = e10.getPlayer();
  p10.pos = { x: 15, y: 15 };
  p10.strength = 500;
  p10.holdItem = 'POWER_STONE';

  const spatial10 = new SpatialKnowledge(m10);
  const memory10 = new EpisodicMemory();
  const makeSnap10 = (turn: number): TacticalSnapshot => ({
    spatial: spatial10,
    milestones: SituationalPerception.evaluateMilestones(p10, mockParams),
    threats: SituationalPerception.evaluateThreats(p10, m10, [], undefined, mockParams),
    player: {
      pos: { ...p10.pos },
      hp: p10.hp,
      maxHp: p10.maxHp,
      strength: p10.strength,
      experience: p10.experience,
      magic: p10.magic,
      gold: p10.gold,
      holdItem: p10.holdItem,
      hasSword: p10.hasSword,
      isFlying: p10.isFlying,
      canDiagonal: p10.canDiagonal,
      hasDeath: p10.hasDeath,
      stepCountSinceStone: p10.stepCountSinceStone,
    },
    livingEnemies: [],
    memory: memory10,
    params: mockParams,
    map: m10,
    totalTurns: turn,
  });

  const mission10 = new HarvestPowerStoneMission({ x: 15, y: 15 });
  assert.strictEqual(mission10.evaluateStatus(makeSnap10(1), e10), 'ACTIVE');
  assert.strictEqual(mission10.subMode, 'DELIVERING_TO_HOME');

  // 納品せずに道中でドロップ（strength = 500 のまま増加していない）
  p10.pos = { x: 12, y: 12 };
  p10.holdItem = 'NONE';
  m10.setItem({ x: 12, y: 12 }, 'POWER_STONE');
  assert.strictEqual(mission10.evaluateStatus(makeSnap10(2), e10), 'ACTIVE', '道中ドロップ時に偽の COMPLETED にならないこと');
  assert.strictEqual(mission10.subMode, 'APPROACHING_STONE', '石再回収サブモードに戻ること');

  // STR未増加のまま HOME に立っても石がマップに残っていれば再回収継続
  p10.pos = { ...home10 };
  assert.strictEqual(mission10.evaluateStatus(makeSnap10(3), e10), 'ACTIVE', 'strength未増加のままHOMEに居ても偽完了しないこと');

  // 石がゴースト等に奪われてマップからも消失した場合
  m10.setItem({ x: 12, y: 12 }, 'NONE');
  assert.strictEqual(mission10.evaluateStatus(makeSnap10(4), e10), 'FAILED', '石消失時は FAILED になること');
  assert.strictEqual(mission10.completionReason, 'TARGET_LOST', '石消失時の理由は TARGET_LOST であること');

  // 正常に HOME で納品して strength が増加した場合のみ COMPLETED (OBJECTIVE_ACHIEVED)
  const p10b = e10.getPlayer();
  p10b.pos = { x: 15, y: 15 };
  p10b.strength = 500;
  p10b.holdItem = 'POWER_STONE';
  const mission10b = new HarvestPowerStoneMission({ x: 15, y: 15 });
  assert.strictEqual(mission10b.evaluateStatus(makeSnap10(5), e10), 'ACTIVE');
  p10b.pos = { ...home10 };
  p10b.holdItem = 'NONE';
  p10b.strength = 1000;
  assert.strictEqual(mission10b.evaluateStatus(makeSnap10(6), e10), 'COMPLETED', 'STR増加確認時のみ COMPLETED になること');
  assert.strictEqual(mission10b.completionReason, 'OBJECTIVE_ACHIEVED');

  console.log('✓ 10. HarvestPowerStoneMission fake completion guard & STR delta verified.');
}

// -------------------------------------------------------------
// Test 11: StrategicPlanner の canTransitionToPrep チャタリング防止
// -------------------------------------------------------------
console.log('Testing 11: StrategicPlanner maintains CashInGold & PrepareDragonAssault without chattering...');
{
  const e11 = new GameEngine();
  const m11 = createEmptyMap();
  for (const h of m11.getAllHomePositions()) {
    m11.setBaseTile(h, 'EMPTY');
  }
  const home11 = { x: 8, y: 8 };
  m11.setBaseTile(home11, 'HOME');
  m11.homePos = { ...home11 };
  m11.setRealHomePos(home11);
  m11.spawnHomePos = { ...home11 };

  const p11 = e11.getPlayer();
  p11.hasSword = true;
  p11.strength = 30000;
  p11.experience = 25000; // canTransitionToPrep = true
  p11.canDiagonal = true;
  p11.magic = 5;
  p11.hp = 25000;
  p11.maxHp = 25000;
  p11.gold = 5;
  p11.pos = { x: 20, y: 20 };
  p11.holdItem = 'NONE';

  const spatial11 = new SpatialKnowledge(m11);
  const memory11 = new EpisodicMemory();
  const makeSnap11 = (turn: number): TacticalSnapshot => {
    memory11.recordTurn({
      turn,
      pos: p11.pos,
      hp: p11.hp,
      maxHp: p11.maxHp,
      strength: p11.strength,
      experience: p11.experience,
      magic: p11.magic,
      gold: p11.gold,
      holdItem: p11.holdItem,
      hasSword: p11.hasSword,
      remainingChests: 0,
      dragonTotalHeadHp: 0,
      dragonDefeatedHeads: 0,
      crownsDelivered: p11.crowns,
      homePos: m11.realHomePos,
    });
    return {
      spatial: spatial11,
      milestones: SituationalPerception.evaluateMilestones(p11, mockParams),
      threats: SituationalPerception.evaluateThreats(p11, m11, [], undefined, mockParams),
      confinement: SituationalPerception.evaluateConfinement(p11, m11, []),
      progress: memory11.buildProgressWindow(turn, m11),
      player: {
        pos: { ...p11.pos },
        hp: p11.hp,
        maxHp: p11.maxHp,
        strength: p11.strength,
        experience: p11.experience,
        magic: p11.magic,
        gold: p11.gold,
        holdItem: p11.holdItem,
        hasSword: p11.hasSword,
        isFlying: p11.isFlying,
        canDiagonal: p11.canDiagonal,
        hasDeath: p11.hasDeath,
        stepCountSinceStone: p11.stepCountSinceStone,
      },
      livingEnemies: [],
      memory: memory11,
      params: mockParams,
      map: m11,
      totalTurns: turn,
    };
  };

  const planner11 = new StrategicPlanner();
  const cashMission = new CashInGoldMission(5);
  planner11.activeMission = cashMission;
  planner11.planTurn(makeSnap11(1), e11);
  assert.strictEqual(planner11.activeMission, cashMission, '1ターン目で CASH_IN_GOLD が強制終了されないこと');

  p11.pos = { x: 19, y: 20 };
  planner11.planTurn(makeSnap11(2), e11);
  assert.strictEqual(planner11.activeMission, cashMission, '2ターン目も同一の CASH_IN_GOLD インスタンスが維持されること');
  assert.strictEqual(cashMission.turnsElapsed, 2);
  assert.strictEqual(planner11.missionHistory.length, 0);

  // 換金達成 (gold = 0, experience 増加) で初めて COMPLETED (OBJECTIVE_ACHIEVED) になる
  p11.pos = { ...home11 };
  p11.gold = 0;
  p11.experience = 28000;
  planner11.planTurn(makeSnap11(3), e11);
  assert.ok(
    planner11.missionHistory.some(
      h => h.missionId === 'CASH_IN_GOLD' && h.status === 'COMPLETED' && h.reason === 'OBJECTIVE_ACHIEVED'
    ),
    '換金達成時に OBJECTIVE_ACHIEVED として履歴記録されること'
  );

  // PrepareDragonAssaultMission もポーション回収完了まで強制リセットされないこと
  m11.setItem({ x: 15, y: 8 }, 'POTION');
  p11.pos = { x: 20, y: 20 };
  p11.magic = 2;
  const planner11b = new StrategicPlanner();
  const prepMission = new PrepareDragonAssaultMission();
  planner11b.activeMission = prepMission;
  planner11b.planTurn(makeSnap11(1), e11);
  assert.strictEqual(planner11b.activeMission, prepMission);
  planner11b.planTurn(makeSnap11(2), e11);
  assert.strictEqual(planner11b.activeMission, prepMission, 'PREPARE_DRAGON_ASSAULT が毎ターン強制リセットされないこと');
  assert.strictEqual(prepMission.turnsElapsed, 2);

  console.log('✓ 11. StrategicPlanner mission continuity without chattering verified.');
}

// -------------------------------------------------------------
// Test 12: CrownEscapeMission の !canReachWithCrown 時ループ根絶
// -------------------------------------------------------------
console.log('Testing 12: CrownEscapeMission prevents FLASH-pickup-drop MP depletion loop when blocked...');
{
  // 12-A: 岩(BLOCK)閉塞時は FLASH を誤射せず BREAK 開削を維持、開通まで再拾得しない
  const e12 = new GameEngine();
  const d12 = e12.getDragon();
  if (d12) {
    d12.defeatedHeadsCount = 3;
    d12.heads.forEach(h => (h.isAlive = false));
  }
  const m12 = createEmptyMap();
  for (const h of m12.getAllHomePositions()) {
    m12.setBaseTile(h, 'EMPTY');
  }
  const home12 = { x: 5, y: 10 };
  m12.setBaseTile(home12, 'HOME');
  m12.homePos = { ...home12 };
  m12.setRealHomePos(home12);
  m12.spawnHomePos = { ...home12 };

  for (let y = 9; y <= 11; y++) {
    m12.setBaseTile({ x: 4, y }, 'WALL_STATIC');
  }
  for (let x = 5; x <= 7; x++) {
    m12.setBaseTile({ x, y: 9 }, 'WALL_STATIC');
    m12.setBaseTile({ x, y: 11 }, 'WALL_STATIC');
  }
  m12.setObject({ x: 7, y: 10 }, 'BLOCK');
  m12.setItem({ x: 10, y: 10 }, 'CROWN');

  const p12 = e12.getPlayer();
  p12.pos = { x: 10, y: 10 };
  p12.holdItem = 'NONE';
  p12.hasSword = true;
  p12.experience = 20000;
  p12.magic = 2; // BREAK保護下限付近
  p12.hp = 5000;
  p12.maxHp = 5000;

  const spatial12 = new SpatialKnowledge(m12);
  const memory12 = new EpisodicMemory();
  const makeSnap12 = (turn: number, enemies: EnemyInstance[] = []): TacticalSnapshot => ({
    spatial: spatial12,
    milestones: SituationalPerception.evaluateMilestones(p12, mockParams),
    threats: SituationalPerception.evaluateThreats(p12, m12, enemies, undefined, mockParams),
    confinement: SituationalPerception.evaluateConfinement(p12, m12, enemies),
    progress: memory12.buildProgressWindow(turn, m12),
    player: {
      pos: { ...p12.pos },
      hp: p12.hp,
      maxHp: p12.maxHp,
      strength: p12.strength,
      experience: p12.experience,
      magic: p12.magic,
      gold: p12.gold,
      holdItem: p12.holdItem,
      hasSword: p12.hasSword,
      isFlying: p12.isFlying,
      canDiagonal: true,
      hasDeath: false,
      stepCountSinceStone: 0,
    },
    livingEnemies: enemies,
    memory: memory12,
    params: mockParams,
    map: m12,
    totalTurns: turn,
  });

  const mission12 = new CrownEscapeMission();
  for (let t = 1; t <= 3; t++) {
    const dir = mission12.generateDirective(makeSnap12(t), e12);
    assert.notStrictEqual(dir.type, 'PICKUP_ITEM', 'BLOCK閉塞中に王冠を再拾得しないこと');
    assert.ok(
      !(dir.type === 'CAST_MAGIC' && dir.magicToCast === 'FLASH'),
      'BLOCK閉塞時に無意味な FLASH を誤射しないこと'
    );
    assert.strictEqual(mission12.subMode, 'CLEARING_RETURN_BLOCK');
  }

  // 12-B: 危険敵閉塞時も同一座標での連続 FLASH 乱射 ＆ 拾う⇄落とすループを起こさない
  m12.setObject({ x: 7, y: 10 }, 'NONE');
  const blockingDemon: EnemyInstance = {
    id: 'e-gate-demon',
    name: 'Gate Demon',
    type: 'SUPER_DEMON',
    pos: { x: 6, y: 10 }, // HOME (5,10) への一本道を塞ぐ
    hp: 1000000,
    maxHp: 1000000,
    atk: 30000,
    def: 1000,
    exp: 1000,
    isAlive: true,
    isPermanentlyFrozen: false,
    frozenTimer: 0,
  } as any;

  p12.pos = { x: 10, y: 10 };
  p12.holdItem = 'NONE';
  p12.magic = 3;
  const mission12b = new CrownEscapeMission();
  const dTurn1 = mission12b.generateDirective(makeSnap12(1, [blockingDemon]), e12);
  assert.strictEqual(dTurn1.type, 'CAST_MAGIC');
  assert.strictEqual(dTurn1.magicToCast, 'FLASH');
  p12.magic--; // 消費を反映

  // 万一まだ未開通のまま同座標に居ても2ターン目に連続 FLASH を撃たず、王冠も誤拾得しない
  const dTurn2 = mission12b.generateDirective(makeSnap12(2, [blockingDemon]), e12);
  assert.ok(
    !(dTurn2.type === 'CAST_MAGIC' && dTurn2.magicToCast === 'FLASH'),
    '同一座標で連続 FLASH 空撃ちを行わないこと'
  );
  assert.notStrictEqual(dTurn2.type, 'PICKUP_ITEM', '帰還路未開通のまま王冠を拾わないこと');

  // 王冠所持状態で同座標・DANGEROUS_ENEMY閉塞でも FLASH クールダウン中は無意味ドロップしない
  p12.holdItem = 'CROWN';
  m12.setItem({ x: 10, y: 10 }, 'NONE');
  const dTurn3 = mission12b.generateDirective(makeSnap12(3, [blockingDemon]), e12);
  assert.notStrictEqual(dTurn3.type, 'DROP_HOLD_ITEM', 'FLASHクールダウン中に拾う⇄落とすループへ入らないこと');

  console.log('✓ 12. CrownEscapeMission anti-loop gate & FLASH cooldown verified.');
}

// =========================================================================
// Test 13: 段階的脅威度評価（経路探索・緊急退避・王冠帰還判定）
// =========================================================================
console.log('Testing 13: Graded threat evaluation in pathfinding, evade, and crown escape...');
{
  // 13-A: executeBfs の段階的コスト比較（弱い敵 vs 強敵）
  const m13 = createEmptyMap(32, 32);
  for (const h of m13.getAllHomePositions()) {
    m13.setBaseTile(h, 'EMPTY');
  }
  const home13 = { x: 5, y: 10 };
  m13.setBaseTile(home13, 'HOME');
  m13.homePos = { ...home13 };
  m13.setRealHomePos(home13);
  m13.spawnHomePos = { ...home13 };

  const p13 = new Player({ x: 10, y: 10 });
  p13.hp = 1000;
  p13.maxHp = 1000;
  p13.experience = 5000;
  p13.str = 3000;
  p13.hasSword = true;
  p13.holdItem = 'CROWN';
  p13.canDiagonal = false;

  // 通路の上下・両端を壁で塞ぎ、(10,10)->(5,10) の一本道を作る
  for (let x = 4; x <= 11; x++) {
    m13.setBaseTile({ x, y: 9 }, 'WALL_STATIC');
    m13.setBaseTile({ x, y: 11 }, 'WALL_STATIC');
  }
  m13.setBaseTile({ x: 4, y: 10 }, 'WALL_STATIC');
  m13.setBaseTile({ x: 11, y: 10 }, 'WALL_STATIC');
  // 敵を配置する横ポケット（(7,9) は壁にせず敵を置く）
  m13.setBaseTile({ x: 7, y: 9 }, 'EMPTY');
  m13.setBaseTile({ x: 7, y: 8 }, 'WALL_STATIC');
  m13.setBaseTile({ x: 6, y: 8 }, 'WALL_STATIC');
  m13.setBaseTile({ x: 8, y: 8 }, 'WALL_STATIC');

  const nav13 = new AdaptiveNavigator();
  const weakEnemy: EnemyInstance = {
    id: 'e-weak-13',
    name: 'Weak Slime',
    type: 'SLIME',
    pos: { x: 7, y: 9 }, // 帰還路 (8,10)-(7,10)-(6,10) のすぐ隣
    hp: 2000,
    maxHp: 2000,
    atk: 5001, // 被ダメ 1
    def: 100,
    exp: 10,
    isAlive: true,
    isPermanentlyFrozen: false,
    frozenTimer: 0,
  } as any;

  const strongEnemy: EnemyInstance = {
    id: 'e-strong-13',
    name: 'Strong Demon',
    type: 'DEMON',
    pos: { x: 7, y: 9 },
    hp: 2000,
    maxHp: 2000,
    atk: 5400, // 被ダメ 400 (HPの40%, DANGER)
    def: 100,
    exp: 500,
    isAlive: true,
    isPermanentlyFrozen: false,
    frozenTimer: 0,
  } as any;

  const navParams: DynamicBotParameters = {
    ...mockParams,
    dangerHpRatio: 0.3,
    magicReserveThreshold: 1,
    huntDistance: 10,
    allowBreakAsRoad: false,
    breakCostMultiplier: 3,
    warpAvoidanceCost: 100,
    maxBfsSteps: 2000,
    homeRelocateDistMax: 25,
  };

  const weakRoute = nav13.executeBfs(
    { x: 10, y: 10 },
    { x: 5, y: 10 },
    m13,
    p13,
    [weakEnemy],
    navParams,
    { isEscapePhase: true }
  );
  const strongRoute = nav13.executeBfs(
    { x: 10, y: 10 },
    { x: 5, y: 10 },
    m13,
    p13,
    [strongEnemy],
    navParams,
    { isEscapePhase: true }
  );

  assert.ok(weakRoute !== null, '弱い敵が隣にいても帰還ルートが見つかること');
  assert.ok(strongRoute !== null, '非致死の強敵でも経路自体は見つかること');
  assert.ok(
    weakRoute.cost < 500,
    `弱い敵(被ダメ1)の通過コストは軽微であること (actual: ${weakRoute.cost})`
  );
  assert.ok(
    strongRoute.cost > weakRoute.cost * 5,
    `強敵(被ダメ40%)の通過コストは弱い敵より十分に高いこと (weak: ${weakRoute.cost}, strong: ${strongRoute.cost})`
  );

  // 13-B: findEvadeDirection の段階的ペナルティ比較（弱い敵を許容し、強敵の直線・斜め隣接を避ける）
  const mEvade = createEmptyMap(32, 32);
  const pEvade = new Player({ x: 10, y: 10 });
  pEvade.hp = 1000;
  pEvade.maxHp = 1000;
  pEvade.experience = 5000;
  pEvade.str = 3000;
  pEvade.hasSword = true;
  pEvade.holdItem = 'CROWN';
  pEvade.canDiagonal = false;

  // DOWN(10,11) と LEFT(9,10) を壁で塞ぎ、UP(10,9) と RIGHT(11,10) の2択にする
  mEvade.setBaseTile({ x: 10, y: 11 }, 'WALL_STATIC');
  mEvade.setBaseTile({ x: 9, y: 10 }, 'WALL_STATIC');

  // UP(10,9) の隣 (10,8) に弱い敵（被ダメ1）
  const weakEvadeTarget: EnemyInstance = {
    id: 'e-evade-weak',
    name: 'Weak Bat',
    type: 'BAT',
    pos: { x: 10, y: 8 },
    hp: 2000,
    maxHp: 2000,
    atk: 5001, // 被ダメ 1
    def: 100,
    exp: 10,
    isAlive: true,
    isPermanentlyFrozen: false,
    frozenTimer: 0,
  } as any;

  // RIGHT(11,10) の斜め隣 (12,9) に強敵（被ダメ400, DANGER）
  const strongDiagTarget: EnemyInstance = {
    id: 'e-evade-strong-diag',
    name: 'Strong Knight',
    type: 'KNIGHT',
    pos: { x: 12, y: 9 },
    hp: 2000,
    maxHp: 2000,
    atk: 5400, // 被ダメ 400
    def: 100,
    exp: 500,
    isAlive: true,
    isPermanentlyFrozen: false,
    frozenTimer: 0,
  } as any;

  const navEvade = new AdaptiveNavigator();
  const evadeDir = navEvade.findEvadeDirection(
    pEvade.pos,
    mEvade,
    [weakEvadeTarget, strongDiagTarget],
    pEvade
  );
  assert.strictEqual(
    evadeDir,
    'UP',
    '強敵の斜め隣接(RIGHT)より、被ダメ1の弱い敵の隣接(UP)を許容して退避すること'
  );

  // 13-C: CrownEscapeMission で弱い敵が帰還路近傍にいても不要な王冠ドロップをしないこと
  const e13 = new GameEngine();
  const d13 = e13.getDragon();
  if (d13) {
    d13.defeatedHeadsCount = 3;
    d13.heads.forEach(h => (h.isAlive = false));
  }
  (e13 as any).map = m13;
  (e13 as any).player = p13;
  (e13 as any).enemies = [weakEnemy];
  p13.magic = 3;

  const snap13: TacticalSnapshot = {
    spatial: new SpatialKnowledge(m13),
    milestones: {
      hasSword: true,
      canBreak: true,
      canReturn: true,
      canDiagonal: false,
      dragonHeadsRemaining: 0,
      allHeadsDefeated: true,
      crownsCollected: 0,
    },
    threats: {
      isLethalDanger: false,
      isEmergencyHp: false,
      adjacentLethalEnemies: [],
      nearbyThreats: [],
      dragonThreat: false,
    },
    player: {
      pos: p13.pos,
      hp: p13.hp,
      maxHp: p13.maxHp,
      str: p13.str,
      effectiveAttack: 5000,
      experience: p13.experience,
      magic: p13.magic,
      gold: p13.gold,
      holdItem: 'CROWN',
      hasSword: true,
      isFlying: false,
      canDiagonal: false,
      hasDeath: false,
      stepCountSinceStone: 0,
    },
    livingEnemies: [weakEnemy],
    memory: new EpisodicMemory(),
    params: navParams,
    map: m13,
    totalTurns: 10,
  };

  const sit13 = MapSituationEvaluator.get(snap13, e13, nav13);
  assert.strictEqual(
    sit13.homeReachability.canReachWithCrown,
    true,
    '弱い敵が帰還路の近くにいても canReachWithCrown が true であること'
  );

  const mission13 = new CrownEscapeMission();
  const dir13 = mission13.generateDirective(snap13, e13);
  assert.strictEqual(
    dir13.type,
    'NAVIGATE_TO_POSITION',
    '弱い敵がいても不要な王冠ドロップをせず我が家へ直行すること'
  );

  console.log('✓ 13. Graded threat evaluation in pathfinding, evade, and crown escape verified.');
}

// -------------------------------------------------------------
// Test 14: 遠距離 FREEZE 空撃ち防止 & 弱い敵への FLASH 無駄打ち防止 & P/S/T責務確認
// -------------------------------------------------------------
console.log('Testing 14: Preventing long-range FREEZE whiffs and wasteful FLASH against weak enemies...');
{
  // 14-A: enemyNearSpawnHome はプレイヤー周囲1マス(Chebyshev <= 1)に敵がいる場合のみ検出すること
  const m14a = createEmptyMap(32, 32);
  for (const h of m14a.getAllHomePositions()) {
    m14a.setBaseTile(h, 'EMPTY');
  }
  const spawnHome14 = { x: 10, y: 10 };
  const realHome14 = { x: 24, y: 24 };
  m14a.setBaseTile(spawnHome14, 'HOME');
  m14a.setBaseTile(realHome14, 'HOME');
  m14a.spawnHomePos = { ...spawnHome14 };
  m14a.homePos = { ...realHome14 };
  m14a.setRealHomePos(realHome14);

  const e14a = new GameEngine();
  const d14a = e14a.getDragon();
  if (d14a) {
    d14a.defeatedHeadsCount = 3;
    d14a.heads.forEach(h => (h.isAlive = false));
  }
  const p14a = e14a.getPlayer();
  p14a.pos = { x: 10, y: 12 }; // spawnHomePos(10,10)から Chebyshev=2 (isNearSpawnHome=true)
  p14a.hp = 1000;
  p14a.maxHp = 1000;
  p14a.experience = 20000;
  p14a.str = 5000;
  p14a.hasSword = true;
  p14a.magic = 5;
  p14a.holdItem = 'NONE';
  p14a.hasDeath = false;

  // spawnHomePos から Chebyshev=2 だが、プレイヤーからは Chebyshev=4 の遠い敵
  const farSpawnEnemy: EnemyInstance = {
    id: 'e-far-spawn-14',
    name: 'FarSpawnDemon',
    type: 'DEMON',
    pos: { x: 10, y: 8 },
    hp: 2000,
    maxHp: 2000,
    atk: 5100,
    def: 100,
    exp: 100,
    isAlive: true,
    isPermanentlyFrozen: false,
    frozenTimer: 0,
  } as any;

  (e14a as any).map = m14a;
  (e14a as any).player = p14a;
  (e14a as any).enemies = [farSpawnEnemy];

  const makeSnap14a = (enemiesList: EnemyInstance[]): TacticalSnapshot => ({
    spatial: new SpatialKnowledge(m14a),
    milestones: {
      hasSword: true,
      canBreak: true,
      canReturn: true,
      canDiagonal: true,
      dragonHeadsRemaining: 0,
      allHeadsDefeated: true,
      crownsCollected: 0,
    },
    threats: SituationalPerception.evaluateThreats(p14a, m14a, enemiesList, d14a, mockParams),
    player: {
      pos: { ...p14a.pos },
      hp: p14a.hp,
      maxHp: p14a.maxHp,
      str: p14a.str,
      effectiveAttack: 5000,
      experience: p14a.experience,
      magic: p14a.magic,
      gold: p14a.gold,
      holdItem: p14a.holdItem,
      hasSword: true,
      isFlying: false,
      canDiagonal: true,
      hasDeath: false,
      stepCountSinceStone: 0,
    },
    livingEnemies: enemiesList,
    memory: new EpisodicMemory(),
    params: mockParams,
    map: m14a,
    totalTurns: 10,
  });

  const nav14a = new AdaptiveNavigator();
  const sitFar = MapSituationEvaluator.get(makeSnap14a([farSpawnEnemy]), e14a, nav14a);
  assert.strictEqual(
    sitFar.surroundings.enemyNearSpawnHome,
    null,
    'プレイヤーから Chebyshev >= 2 の敵は enemyNearSpawnHome として検出しないこと'
  );
  const mission14a = new CrownEscapeMission();
  const dirFar = mission14a.generateDirective(makeSnap14a([farSpawnEnemy]), e14a);
  assert.ok(
    !(dirFar.type === 'CAST_MAGIC' && dirFar.magicToCast === 'FREEZE'),
    '届かない遠方の湧き家周辺敵に対して FREEZE 空撃ち指令を出さないこと'
  );

  // プレイヤーから Chebyshev=1 かつ spawnHomePos から Chebyshev=1 の敵なら検出＆FREEZE すること
  const closeSpawnEnemy: EnemyInstance = {
    ...farSpawnEnemy,
    id: 'e-close-spawn-14',
    pos: { x: 10, y: 11 },
  } as any;
  (e14a as any).enemies = [closeSpawnEnemy];
  const sitClose = MapSituationEvaluator.get(makeSnap14a([closeSpawnEnemy]), e14a, nav14a);
  assert.ok(
    sitClose.surroundings.enemyNearSpawnHome !== null,
    'プレイヤー周囲1マスかつ spawnHomePos 近傍の敵は enemyNearSpawnHome として検出すること'
  );
  const dirClose = mission14a.generateDirective(makeSnap14a([closeSpawnEnemy]), e14a);
  assert.strictEqual(dirClose.type, 'CAST_MAGIC');
  assert.strictEqual(dirClose.magicToCast, 'FREEZE', 'FREEZE 射程内の湧き家周辺敵には FREEZE を出すこと');

  // 14-B: TacticalCombat.tryBreakCirclingLoop が Chebyshev >= 2 の敵に FREEZE を空撃ちしないこと
  const m14b = createEmptyMap(32, 32);
  m14b.setObject({ x: 10, y: 9 }, 'GRAVE');
  const p14b = new Player({ x: 10, y: 10 });
  p14b.hp = 1000;
  p14b.maxHp = 1000;
  p14b.experience = 20000;
  p14b.magic = 5;
  p14b.hasDeath = false;

  const mem14b = new EpisodicMemory();
  const nav14b = new AdaptiveNavigator(mem14b);
  // 現在地 (10,10) と周辺にヒートを蓄積させて detectObstacleCircling を発火させる
  for (let i = 0; i < 40; i++) {
    mem14b.recordStep(i % 2 === 0 ? { x: 9, y: 10 } : p14b.pos, i + 1);
  }
  p14b.pos = { x: 10, y: 10 };

  const graveFarEnemy: EnemyInstance = {
    id: 'e-grave-far-14',
    name: 'GraveGhost',
    type: 'GHOST',
    pos: { x: 10, y: 8 }, // プレイヤー(10,10)から距離2、墓(10,9)から距離1
    hp: 5000,
    maxHp: 5000,
    atk: 25000,
    def: 1000,
    exp: 500,
    isAlive: true,
    isPermanentlyFrozen: false,
    frozenTimer: 0,
  } as any;
  const d14b = new Dragon({ x: 25, y: 25 }, m14b);
  const combatRes = TacticalCombat.tryBreakCirclingLoop(p14b, m14b, [graveFarEnemy], d14b, nav14b, mockParams);
  assert.ok(combatRes !== null, '周回打開アクション自体は返ること');
  assert.ok(
    !(combatRes.action.type === 'MAGIC' && combatRes.action.magic === 'FREEZE'),
    'プレイヤー周囲1マスに敵がいない周回打開で FREEZE を空撃ちしないこと'
  );

  // 14-C: 被ダメ1・ワンパン不可の弱い敵に対して FLASH を無駄打ちしないこと＆遠方帰還時 disallowFreezeNearHome が付かないこと
  const m14c = createEmptyMap(32, 32);
  const home14c = { x: 25, y: 25 };
  for (const h of m14c.getAllHomePositions()) {
    m14c.setBaseTile(h, 'EMPTY');
  }
  m14c.setBaseTile(home14c, 'HOME');
  m14c.homePos = { ...home14c };
  m14c.setRealHomePos(home14c);
  m14c.spawnHomePos = { ...home14c };
  m14c.setItem({ x: 10, y: 10 }, 'CROWN');

  const e14c = new GameEngine();
  const d14c = e14c.getDragon();
  if (d14c) {
    d14c.defeatedHeadsCount = 3;
    d14c.heads.forEach(h => (h.isAlive = false));
  }
  const p14c = e14c.getPlayer();
  p14c.pos = { x: 10, y: 10 };
  p14c.hp = 1000;
  p14c.maxHp = 1000;
  p14c.experience = 5000; // effectiveDef = 5000
  p14c.str = 2000;
  p14c.hasSword = true;
  p14c.magic = 5;
  p14c.holdItem = 'NONE';
  p14c.hasDeath = false;

  // 被ダメ1 (atk=5001) だが HP が高くワンパン不可の雑魚敵（隣接）
  const weakToughEnemy: EnemyInstance = {
    id: 'e-weak-tough-14',
    name: 'ToughSlime',
    type: 'SLIME',
    pos: { x: 11, y: 10 },
    hp: 9000,
    maxHp: 9000,
    atk: 5001, // damageToPlayer = 1
    def: 100,
    exp: 10,
    isAlive: true,
    isPermanentlyFrozen: false,
    frozenTimer: 0,
  } as any;

  (e14c as any).map = m14c;
  (e14c as any).player = p14c;
  (e14c as any).enemies = [weakToughEnemy];

  const snap14c: TacticalSnapshot = {
    spatial: new SpatialKnowledge(m14c),
    milestones: {
      hasSword: true,
      canBreak: true,
      canReturn: true,
      canDiagonal: false,
      dragonHeadsRemaining: 0,
      allHeadsDefeated: true,
      crownsCollected: 0,
    },
    threats: SituationalPerception.evaluateThreats(p14c, m14c, [weakToughEnemy], d14c, mockParams),
    player: {
      pos: { ...p14c.pos },
      hp: p14c.hp,
      maxHp: p14c.maxHp,
      str: p14c.str,
      effectiveAttack: 2000,
      experience: p14c.experience,
      magic: p14c.magic,
      gold: p14c.gold,
      holdItem: 'NONE',
      hasSword: true,
      isFlying: false,
      canDiagonal: false,
      hasDeath: false,
      stepCountSinceStone: 0,
    },
    livingEnemies: [weakToughEnemy],
    memory: new EpisodicMemory(),
    params: mockParams,
    map: m14c,
    totalTurns: 20,
  };

  const nav14c = new AdaptiveNavigator();
  const sit14c = MapSituationEvaluator.get(snap14c, e14c, nav14c);
  assert.strictEqual(
    sit14c.surroundings.nearbyDangerousEnemies.length,
    0,
    '被ダメ1・ワンパン不可の敵を nearbyDangerousEnemies に含めないこと'
  );
  assert.strictEqual(
    sit14c.surroundings.chebyshev1ActiveDangerousEnemies.length,
    0,
    '被ダメ1・ワンパン不可の敵を chebyshev1ActiveDangerousEnemies に含めないこと'
  );

  const mission14c = new CrownEscapeMission();
  const dir14c = mission14c.generateDirective(snap14c, e14c);
  assert.strictEqual(
    dir14c.type,
    'PICKUP_ITEM',
    '被ダメ1の弱い敵が隣にいても王冠上で FLASH せず PICKUP_ITEM すること'
  );

  // TacticalExecutor の 0-B 緊急自衛でも FLASH/FREEZE を暴発しないこと
  const exec14c = new TacticalExecutor(nav14c, new EightStepController(nav14c));
  const execRes14c = exec14c.execute(
    {
      type: 'NAVIGATE_TO_POSITION',
      targetPos: { x: 10, y: 15 },
      priority: 90,
      policy: { disallowFreezeNearHome: true },
      reason: 'テスト移動',
    },
    snap14c,
    e14c
  );
  assert.strictEqual(
    execRes14c.action.type,
    'MOVE',
    `被ダメ1の弱い敵が隣接していても 0-B 緊急自衛で FLASH/FREEZE を暴発せず MOVE すること (actual: ${execRes14c.action.type}, desc: ${execRes14c.description})`
  );

  // 王冠所持中かつ我が家から遠い場合は disallowFreezeNearHome を付けないこと
  p14c.holdItem = 'CROWN';
  const snap14cCrown: TacticalSnapshot = {
    ...snap14c,
    player: { ...snap14c.player, holdItem: 'CROWN' },
    totalTurns: 21,
  };
  const dir14cCrown = mission14c.generateDirective(snap14cCrown, e14c);
  assert.strictEqual(dir14cCrown.type, 'NAVIGATE_TO_POSITION');
  assert.strictEqual(
    dir14cCrown.policy?.disallowFreezeNearHome,
    undefined,
    '我が家から遠い帰還時に disallowFreezeNearHome を常時付与しないこと'
  );

  console.log('✓ 14. Long-range FREEZE whiffs and weak-enemy FLASH waste prevented.');
}

// -------------------------------------------------------------
// Test 15: パッシブスキャン0-BFS・ターゲットロック維持・局所敵ZOC(enemyZocRadius)分離検証
// -------------------------------------------------------------
{
  const m15 = createEmptyMap(32, 32);
  for (const h of m15.getAllHomePositions()) {
    m15.setBaseTile(h, 'EMPTY');
  }
  const home15 = { x: 4, y: 10 };
  m15.setBaseTile(home15, 'HOME');
  m15.homePos = { ...home15 };
  m15.setRealHomePos(home15);
  m15.spawnHomePos = { ...home15 };

  // マップ上に4つの王冠を配置
  const crownPositions = [
    { x: 14, y: 10 },
    { x: 20, y: 10 },
    { x: 10, y: 20 },
    { x: 25, y: 25 },
  ];
  for (const cp of crownPositions) {
    m15.setItem(cp, 'CROWN');
  }

  const e15 = new GameEngine();
  const d15 = e15.getDragon();
  if (d15) {
    d15.defeatedHeadsCount = 3;
    d15.heads.forEach(h => (h.isAlive = false));
  }
  const p15 = e15.getPlayer();
  p15.pos = { x: 10, y: 10 };
  p15.hp = 1000;
  p15.maxHp = 1000;
  p15.strength = 500000;
  p15.experience = 20000;
  p15.magic = 5;
  p15.hasSword = true;
  p15.holdItem = 'NONE';
  p15.hasDeath = false;

  (e15 as any).map = m15;
  (e15 as any).player = p15;
  (e15 as any).enemies = [];

  const mem15 = new EpisodicMemory();
  const spatial15 = new SpatialKnowledge(m15);
  const nav15 = new AdaptiveNavigator(mem15);

  const origExecuteBfs = AdaptiveNavigator.prototype.executeBfs;
  let spyBfsCount = 0;
  AdaptiveNavigator.prototype.executeBfs = function (...args: any[]) {
    spyBfsCount++;
    return origExecuteBfs.apply(this, args as any);
  };

  try {
    // 15-A. 4王冠存在下での MapSituationEvaluator.evaluate (パッシブスキャン) は executeBfs を 0 回に抑える
    spyBfsCount = 0;
    const passiveSummary = MapSituationEvaluator.evaluate(
      p15,
      m15,
      [],
      d15,
      [],
      nav15,
      mem15,
      mockParams,
      1,
      undefined,
      spatial15
    );
    assert.strictEqual(
      passiveSummary.items.crowns.allFloorCrowns.length,
      4,
      '4つの王冠すべてがパッシブスキャンで検出されること'
    );
    assert.strictEqual(
      passiveSummary.homeReachability.canReachStaticallyWithCrown,
      true,
      '1-pass Dial BFS で我が家への静的到達性が判定されること'
    );
    assert.strictEqual(
      spyBfsCount,
      0,
      `4王冠存在時のパッシブスキャン evaluate() で executeBfs が 0 回であること (actual: ${spyBfsCount})`
    );

    // 15-B. CrownEscapeMission は初回のみ selectBestCrownTarget を呼び、ロック後の移動ターンは BFS 0 回で直行する
    const makeSnap15 = (turn: number): TacticalSnapshot => ({
      spatial: spatial15,
      milestones: {
        hasSword: true,
        canBreak: true,
        canReturn: true,
        canDiagonal: true,
        dragonHeadsRemaining: 0,
        allHeadsDefeated: true,
        crownsCollected: 0,
      },
      threats: SituationalPerception.evaluateThreats(p15, m15, [], d15, mockParams),
      confinement: SituationalPerception.evaluateConfinement(p15, m15, []),
      progress: mem15.buildProgressWindow(turn, m15),
      player: {
        pos: { ...p15.pos },
        hp: p15.hp,
        maxHp: p15.maxHp,
        str: p15.strength,
        strength: p15.strength,
        effectiveAttack: p15.strength,
        experience: p15.experience,
        magic: p15.magic,
        gold: p15.gold,
        holdItem: p15.holdItem,
        hasSword: true,
        isFlying: false,
        canDiagonal: true,
        hasDeath: false,
        stepCountSinceStone: 0,
      } as any,
      livingEnemies: [],
      memory: mem15,
      params: mockParams,
      map: m15,
      totalTurns: turn,
    });

    const mission15 = new CrownEscapeMission();
    spyBfsCount = 0;
    const dir15_t1 = mission15.generateDirective(makeSnap15(10), e15);
    assert.strictEqual(dir15_t1.type, 'NAVIGATE_TO_POSITION');
    assert.strictEqual(mission15.subMode, 'ACQUIRING_CROWN');
    assert.ok(spyBfsCount >= 1, '初回ロック時は selectBestCrownTarget によりアクティブスキャンが実行されること');

    // 2ターン目: 王冠へ向かって1歩前進（まだ未到達）
    p15.pos = { x: 11, y: 10 };
    spyBfsCount = 0;
    const dir15_t2 = mission15.generateDirective(makeSnap15(11), e15);
    assert.strictEqual(dir15_t2.type, 'NAVIGATE_TO_POSITION');
    assert.strictEqual(mission15.subMode, 'ACQUIRING_CROWN');
    assert.deepStrictEqual(
      dir15_t2.targetPos,
      dir15_t1.targetPos,
      'ロック済み王冠ターゲットが2ターン目も維持されること'
    );
    assert.strictEqual(
      spyBfsCount,
      0,
      `ロック済み王冠へ移動中の generateDirective() で executeBfs が 0 回であること (actual: ${spyBfsCount})`
    );

    // 15-C. enemyZocRadius による遠方動的敵ZOCと近傍脅威ZOCの分離検証
    const m15z = createEmptyMap(32, 32);
    // (4,10)〜(16,10) を唯一の1本道コリドーとして上下を壁で封鎖
    for (let x = 4; x <= 16; x++) {
      m15z.setBaseTile({ x, y: 9 }, 'WALL_STATIC');
      m15z.setBaseTile({ x, y: 11 }, 'WALL_STATIC');
    }
    m15z.setBaseTile({ x: 4, y: 10 }, 'WALL_STATIC');
    m15z.setBaseTile({ x: 16, y: 10 }, 'WALL_STATIC');

    const p15z = new Player({ x: 5, y: 10 });
    p15z.hp = 100;
    p15z.maxHp = 100;
    p15z.experience = 0;
    p15z.magic = 0;
    p15z.canDiagonal = false;

    const corridorLethalEnemy: EnemyInstance = {
      id: 'e-corridor-15',
      name: 'CorridorDemon',
      type: 'SUPER_DEMON',
      pos: { x: 10, y: 10 }, // 始点 (5,10) から Chebyshev 距離 5
      hp: 100000,
      maxHp: 100000,
      atk: 10000,
      def: 100,
      exp: 1000,
      isAlive: true,
      isPermanentlyFrozen: false,
      frozenTimer: 0,
    } as any;

    const nav15z = new AdaptiveNavigator();
    const resDefaultZoc = origExecuteBfs.call(
      nav15z,
      { x: 5, y: 10 },
      { x: 15, y: 10 },
      m15z,
      p15z,
      [corridorLethalEnemy],
      mockParams
    );
    assert.strictEqual(
      resDefaultZoc,
      null,
      'デフォルト(enemyZocRadius=Infinity)では遠方距離5の即死敵ZOCによりコリドー通路が遮断判定されること'
    );

    const resLocalZocFar = origExecuteBfs.call(
      nav15z,
      { x: 5, y: 10 },
      { x: 15, y: 10 },
      m15z,
      p15z,
      [corridorLethalEnemy],
      mockParams,
      { enemyZocRadius: 3 }
    );
    assert.ok(
      resLocalZocFar !== null,
      'enemyZocRadius=3 指定時は距離5(>3)の遠方敵ZOCを無視して経路を返すこと'
    );

    corridorLethalEnemy.pos = { x: 7, y: 10 }; // 始点 (5,10) から Chebyshev 距離 2 (<= 3)
    const resLocalZocNear = origExecuteBfs.call(
      nav15z,
      { x: 5, y: 10 },
      { x: 15, y: 10 },
      m15z,
      p15z,
      [corridorLethalEnemy],
      mockParams,
      { enemyZocRadius: 3 }
    );
    assert.strictEqual(
      resLocalZocNear,
      null,
      'enemyZocRadius=3 指定時でも距離2(<=3)の近傍即死敵ZOCは正しく回避・遮断すること'
    );
  } finally {
    AdaptiveNavigator.prototype.executeBfs = origExecuteBfs;
  }

  console.log('✓ 15. Passive scan 0-BFS, Crown target lock BFS suppression, and local enemyZocRadius verified.');
}

// -------------------------------------------------------------
// Test 16: RelocateHomeMission 押出BFS・ルート開拓・進捗ベース中断・アンカー選定
// -------------------------------------------------------------
console.log('Testing 16: RelocateHomeMission detour BFS, path clearing, progress-based abort & anchor selection...');
{
  // 16-1. 押出BFSの迂回検証 (WALL_STATIC, GRAVE, WARP, CHEST 回避)
  const m16 = createEmptyMap(20, 20);
  m16.setBaseTile({ x: 5, y: 5 }, 'HOME');
  m16.setRealHomePos({ x: 5, y: 5 });
  m16.initialHomePos = { x: 5, y: 5 };
  m16.setBaseTile({ x: 6, y: 5 }, 'WALL_STATIC');
  m16.setBaseTile({ x: 7, y: 5 }, 'GRAVE');
  m16.setBaseTile({ x: 8, y: 5 }, 'WARP');
  m16.setObject({ x: 7, y: 6 }, 'CHEST');

  const p16 = new Player({ x: 4, y: 5, hp: 5000, experience: 15000, strength: 2000, magic: 5 });
  p16.holdItem = 'RING';

  const detourPath = RelocateHomeMission.findHomePushPath(
    { x: 5, y: 5 },
    { x: 10, y: 5 },
    m16,
    p16,
    undefined,
    true
  );
  assert.ok(detourPath !== null && detourPath.length > 0, 'WALL/GRAVE/WARP/CHEST を迂回する押出経路が見つかること');
  for (const step of detourPath!) {
    const b = m16.getBaseTile(step.homeTo);
    const o = m16.getObject(step.homeTo);
    assert.ok(b !== 'WALL_STATIC' && b !== 'GRAVE' && b !== 'WARP', '迂回経路が禁止タイルを通らないこと');
    assert.notStrictEqual(o, 'CHEST', '迂回経路が宝箱を通らないこと');
  }

  // 16-2. ルート開拓: BLOCK (BREAK) と 床アイテム (DROP -> PICKUP)
  const engine16 = new GameEngine();
  engine16.startGame();
  const emap = engine16.getMap();
  emap.clearWarpPairs();
  for (let y = 0; y < emap.height; y++) {
    for (let x = 0; x < emap.width; x++) {
      emap.setBaseTile({ x, y }, 'EMPTY');
      emap.setObject({ x, y }, 'NONE');
      emap.setItem({ x, y }, 'NONE');
    }
  }
  emap.setBaseTile({ x: 10, y: 10 }, 'HOME');
  emap.setRealHomePos({ x: 10, y: 10 });
  emap.initialHomePos = { x: 10, y: 10 };
  // 上下と左奥を壁で挟み、右方向 (11, 10) -> (12, 10) の開拓が必須な通路を作る
  emap.setBaseTile({ x: 8, y: 10 }, 'WALL_STATIC');
  emap.setBaseTile({ x: 9, y: 9 }, 'WALL_STATIC');
  emap.setBaseTile({ x: 9, y: 11 }, 'WALL_STATIC');
  emap.setBaseTile({ x: 10, y: 9 }, 'WALL_STATIC');
  emap.setBaseTile({ x: 10, y: 11 }, 'WALL_STATIC');
  emap.setBaseTile({ x: 11, y: 9 }, 'WALL_STATIC');
  emap.setBaseTile({ x: 11, y: 11 }, 'WALL_STATIC');
  emap.setBaseTile({ x: 12, y: 9 }, 'WALL_STATIC');
  emap.setBaseTile({ x: 12, y: 11 }, 'WALL_STATIC');
  emap.setObject({ x: 11, y: 10 }, 'BLOCK');
  emap.setItem({ x: 12, y: 10 }, 'COIN');
  const ep = engine16.getPlayer();
  ep.pos = { x: 9, y: 10 };
  ep.experience = 15000;
  ep.magic = 5;
  ep.holdItem = 'RING';

  const spatial16 = new SpatialKnowledge(emap);
  const memory16 = new EpisodicMemory();
  const makeSnap16 = (turn: number): TacticalSnapshot => ({
    spatial: spatial16,
    milestones: SituationalPerception.evaluateMilestones(ep, mockParams),
    threats: SituationalPerception.evaluateThreats(ep, emap, [], undefined, mockParams),
    confinement: { kind: 'NONE', reachableSafeTiles: 100, escapeMeans: [], isStaticallySealed: false },
    progress: {
      windowSize: 10,
      uniqueTilesInWindow: 5,
      turnsSinceNewTile: 0,
      turnsSinceSubstantiveGain: 0,
      cycle: null,
    },
    player: {
      pos: { ...ep.pos },
      hp: ep.hp,
      maxHp: ep.maxHp,
      strength: ep.strength,
      experience: ep.experience,
      magic: ep.magic,
      gold: ep.gold,
      holdItem: ep.holdItem,
      hasSword: ep.hasSword,
      isFlying: ep.isFlying,
      canDiagonal: true,
      hasDeath: false,
      stepCountSinceStone: ep.stepCountSinceStone,
    },
    livingEnemies: [],
    memory: memory16,
    params: mockParams,
    map: emap,
    totalTurns: turn,
  });

  const snap16 = makeSnap16(10);

  // 16-2a. BLOCK がある場合 CLEARING_PATH -> BREACH_SHORTCUT
  const missionBlock = new RelocateHomeMission({ x: 14, y: 10 });
  const dirBlock = missionBlock.generateDirective(snap16, engine16);
  assert.strictEqual(missionBlock.subMode, 'CLEARING_PATH', '岩がある場合は CLEARING_PATH になること');
  assert.strictEqual(dirBlock.type, 'BREACH_SHORTCUT', '岩破壊のために BREACH_SHORTCUT が発行されること');

  // 岩破壊後の状態にして COIN 開拓を確認 (RING 一時退避)
  emap.setObject({ x: 11, y: 10 }, 'NONE');
  emap.setItem({ x: 11, y: 10 }, 'COIN');
  const snap16b = makeSnap16(11);
  const missionItem = new RelocateHomeMission({ x: 14, y: 10 });
  const dirDrop = missionItem.generateDirective(snap16b, engine16);
  assert.strictEqual(missionItem.subMode, 'CLEARING_PATH', '床アイテムがある場合は CLEARING_PATH になること');
  assert.strictEqual(dirDrop.type, 'DROP_HOLD_ITEM', 'RING所持中は手ぶらになるため DROP_HOLD_ITEM が発行されること');

  // 16-3. 進捗ベース中断判定: 45T 経過しても進捗があれば ACTIVE 維持、25T 無進展で ABORTED
  const missionProg = new RelocateHomeMission({ x: 14, y: 10 });
  emap.setItem({ x: 11, y: 10 }, 'NONE');
  emap.setItem({ x: 12, y: 10 }, 'NONE');
  missionProg.turnsElapsed = 46; // 旧45T制限超過
  const statusAt46 = missionProg.evaluateStatus(snap16b, engine16);
  assert.strictEqual(statusAt46, 'ACTIVE', '45T経過しても初回評価・進捗中は強制打ち切りされないこと');

  for (let i = 0; i < 26; i++) {
    missionProg.evaluateStatus(snap16b, engine16);
  }
  const statusStalled = missionProg.evaluateStatus(snap16b, engine16);
  assert.strictEqual(statusStalled, 'ABORTED', '一定ターン連続で進展がない場合のみ ABORTED になること');

  // 16-4. アンカー選定: initialHomePos から十分離れた安全かつ到達可能地点を選ぶこと
  const bestAnchor = RelocateHomeMission.selectBestAnchor(snap16b, engine16);
  assert.ok(bestAnchor !== null, '安全な到達可能アンカーが選定されること');
  const anchorDistFromSpawn = emap.getTorusDistance(emap.initialHomePos, bestAnchor!).manhattan;
  assert.ok(anchorDistFromSpawn >= 20, `アンカーは initialHomePos から十分離れていること (dist=${anchorDistFromSpawn})`);

  console.log('✓ 16. RelocateHomeMission detour BFS, path clearing, progress-based abort & anchor selection verified.');
}

console.log('================================================================');
console.log('  ALL PST STEP 1, 4, CATEGORY 3, 2 & 1 TESTS PASSED!             ');
console.log('================================================================');
