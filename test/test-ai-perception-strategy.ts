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
import { TacticalExecutor } from '../src/ai/tactics/TacticalExecutor.js';
import { EightStepController } from '../src/ai/EightStepController.js';

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
  assert.ok(memory.pingPongCount >= 1, '2マス往復が正しくカウントされること');

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
    const stagnation = {
      currentHeat: 0,
      neighborhoodHeat: 0,
      turnsSinceNewTile: 0,
      isStagnated: false,
      isPhysicallyTrapped: false,
      isEarlySwordTrapped: false,
    };
    return {
      spatial,
      milestones,
      threats,
      stagnation,
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

    const snap96: TacticalSnapshot = {
      spatial: new SpatialKnowledge(m96),
      milestones: SituationalPerception.evaluateMilestones(p96, mockParams),
      threats: SituationalPerception.evaluateThreats(p96, m96, [trapEnemy], undefined, mockParams),
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
      memory: new EpisodicMemory(),
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
    assert.strictEqual(nav97.isTargetUnreachable(m97.realHomePos), false, 'AdaptiveNavigator に realHomePos がブラックリスト登録されないこと');

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

console.log('================================================================');
console.log('  ALL PST STEP 1, 4, CATEGORY 3, 2 & 1 TESTS PASSED!             ');
console.log('================================================================');
