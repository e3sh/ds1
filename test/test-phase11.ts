import assert from 'node:assert';
import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { Ghost } from '../src/models/Ghost.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { ProceduralMapGenerator } from '../src/systems/ProceduralMapGenerator.js';
import { GhostAISystem } from '../src/systems/GhostAISystem.js';
import { EnemyAISystem } from '../src/systems/EnemyAISystem.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { TuningPresetResolver } from '../src/config/TuningPresetResolver.js';
import { DungeonArchetype } from '../src/models/Types.js';

console.log('--- Phase 11: Classic Tactics (Cross Barrier, Grave Lockdown, Armory & Warp Nexus) Verification ---');

// ============================================================================
// Test 1: 十字架クラウン防衛結界 (Cross Barrier & Ghost Crown Protection)
// ============================================================================
console.log('Testing 1: Cross barrier preventing ghosts from snatching the Crown...');
{
  const map = new WorldMap(64, 64);
  const report = ProceduralMapGenerator.generateDungeon(map, {
    seed: 77777,
    difficulty: 'NORMAL',
    topology: 'MULTI_SECTOR',
    archetype: 'SANCTUARY',
  });

  // 1-A. SANCTUARYテーマのダンジョンがソルバブルであること
  assert.strictEqual(report.isSolvable, true, 'SANCTUARY dungeon must be solvable');

  // 1-B. SANCTUARYテーマでは十字架がマップ上に多数配置されていること
  let crossCount = 0;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      if (map.getItem({ x, y }) === 'CROSS') {
        crossCount++;
      }
    }
  }
  assert.ok(crossCount >= 3, `SANCTUARY must have multiple crosses on floor, got ${crossCount}`);

  // 1-C. 十字架結界によるクラウン防衛シミュレーション
  // クラウンを (30, 30) に配置し、その周囲8マスを十字架 (CROSS) で包囲
  const crownPos = { x: 30, y: 30 };
  map.setItem(crownPos, 'CROWN');
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      map.setItem({ x: crownPos.x + dx, y: crownPos.y + dy }, 'CROSS');
    }
  }

  const dummyPlayer = new Player({ x: 10, y: 10 });
  const testGhost: Ghost = {
    id: 999,
    pos: { x: 30, y: 28 }, // 結界の北2マスから直進
    vx: 0,
    vy: 1, // 南へ向かって直進
    moveTimer: 0,
    moveIntervalMs: 200,
    carriedItem: 'NONE',
    carrySteps: 0,
    targetCarrySteps: 30,
    cruiseSteps: 0,
    targetCruiseSteps: 30,
  };

  // ゴーストを100ステップ実行。十字架結界により (30, 30) のクラウンには到達できないはず
  for (let step = 0; step < 100; step++) {
    GhostAISystem.stepGhost(testGhost, dummyPlayer, map);
    // クラウンのマスに侵入できていないことを確認
    assert.ok(
      !(testGhost.pos.x === crownPos.x && testGhost.pos.y === crownPos.y),
      `Ghost must not breach cross barrier into crown at step ${step}`
    );
    // ゴーストがクラウンを強奪していないことを確認
    assert.ok(
      testGhost.carriedItem !== 'CROWN',
      'Ghost must not snatch CROWN protected by crosses'
    );
  }

  // クラウンが床に無事残っていることを確認
  assert.strictEqual(map.getItem(crownPos), 'CROWN', 'Crown must remain intact on floor');

  console.log('✓ 1. Cross barrier & ghost crown defense verified.');
}

// ============================================================================
// Test 2: 墓の十字架封鎖 (Grave Lockdown via Cross Tactics)
// ============================================================================
console.log('Testing 2: Grave lockdown preventing monster emergence with crosses...');
{
  const map = new WorldMap(64, 64);
  const gravePos = { x: 20, y: 20 };
  map.setBaseTile(gravePos, 'GRAVE');

  // 墓の周囲8マスを十字架 (CROSS) で包囲
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      map.setItem({ x: gravePos.x + dx, y: gravePos.y + dy }, 'CROSS');
    }
  }

  // 墓マス上にモンスターが出現
  const enemy: EnemyInstance = {
    id: 1,
    typeId: 5,
    name: 'Orc',
    displayName: 'オーク',
    pos: { ...gravePos },
    hp: 50,
    maxHp: 50,
    atk: 10,
    def: 5,
    gold: 20,
    exp: 15,
    isAlive: true,
    speed: 1,
  };

  // プレイヤーは東にいる（マンハッタン距離5で追跡モードを誘発）
  const player = new Player({ x: 25, y: 20 });
  const enemies = [enemy];

  // CHASEモードおよびWANDERモードで敵行動を50手シミュレーション
  for (let step = 0; step < 50; step++) {
    EnemyAISystem.stepEnemy(enemy, 'CHASE', player, map, enemies);
    // 十字架マスには入れないため、敵は墓(20, 20)から一歩も脱出できない
    assert.strictEqual(
      enemy.pos.x,
      gravePos.x,
      `Enemy must not leave grave X via crosses (step ${step})`
    );
    assert.strictEqual(
      enemy.pos.y,
      gravePos.y,
      `Enemy must not leave grave Y via crosses (step ${step})`
    );
  }

  console.log('✓ 2. Grave lockdown via cross perimeter verified.');
}

// ============================================================================
// Test 3: 複数剣所持・予備武器復帰 (Multiple Swords & Backup Armory Depot)
// ============================================================================
console.log('Testing 3: Multiple swords generation & backup weapon recovery in ARMORY...');
{
  const map = new WorldMap(64, 64);
  const report = ProceduralMapGenerator.generateDungeon(map, {
    seed: 88888,
    difficulty: 'NORMAL',
    topology: 'MULTI_SECTOR',
    archetype: 'ARMORY',
  });

  // 3-A. ARMORYテーマの解法性検証
  assert.strictEqual(report.isSolvable, true, 'ARMORY dungeon must be solvable');

  // 3-B. ARMORYテーマでは床置きの予備剣（SWORD）が複数配置されていること
  const swordPositions: { x: number; y: number }[] = [];
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      if (map.getItem({ x, y }) === 'SWORD') {
        swordPositions.push({ x, y });
      }
    }
  }
  assert.ok(
    swordPositions.length >= 2,
    `ARMORY must have multiple swords on floor, got ${swordPositions.length}`
  );

  // 3-C. プレイヤーが剣を失った状態から予備の剣を拾って復帰するシミュレーション
  const player = new Player({ x: 5, y: 5 });
  player.strength = 500;
  player.hasSword = false;
  assert.strictEqual(player.effectiveAttack, 10, 'Bare-handed attack should be 10 without sword');

  // 予備の剣をプレイヤーの右隣 (6, 5) に配置
  map.setBaseTile({ x: 6, y: 5 }, 'EMPTY');
  map.setObject({ x: 6, y: 5 }, 'NONE');
  map.setItem({ x: 6, y: 5 }, 'SWORD');

  // プレイヤーが右へ一歩移動（剣の上に乗る）
  const moved = MovementSystem.tryMove(player, 'RIGHT', map);
  assert.strictEqual(moved, true, 'Player should move to sword tile');
  assert.strictEqual(player.pos.x, 6);
  assert.strictEqual(player.pos.y, 5);

  // 足元の剣をSPACEキーで拾う
  const spaceResult = MovementSystem.executeSpaceAction(player, map);
  assert.strictEqual(spaceResult.action, 'PICKUP', 'Player should pick up floor item');
  assert.strictEqual(spaceResult.item, 'SWORD', 'Picked item should be SWORD');
  assert.strictEqual(player.hasSword, true, 'Player should re-equip sword');
  assert.strictEqual(player.effectiveAttack, 500, 'Player attack should be restored to full STR');
  assert.strictEqual(map.getItem({ x: 6, y: 5 }), 'NONE', 'Floor sword should be consumed');

  console.log('✓ 3. ARMORY multiple swords & recovery verified.');
}

// ============================================================================
// Test 4: WARP_NEXUS ワープ迷宮パズル (Dense Warp Nexus & Solvability)
// ============================================================================
console.log('Testing 4: Dense warp nexus generation, teleportation & block constraints...');
{
  const map = new WorldMap(64, 64);
  const report = ProceduralMapGenerator.generateDungeon(map, {
    seed: 99999,
    difficulty: 'NORMAL',
    topology: 'MULTI_SECTOR',
    archetype: 'WARP_NEXUS',
  });

  // 4-A. WARP_NEXUSテーマの解法性検証
  assert.strictEqual(report.isSolvable, true, 'WARP_NEXUS dungeon must be solvable');

  // 4-B. ワープマスが高密度（13ペア以上 = 26マス以上）に生成されていること
  const warpPositions: { x: number; y: number }[] = [];
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      if (map.getBaseTile({ x, y }) === 'WARP') {
        warpPositions.push({ x, y });
      }
    }
  }
  assert.ok(
    warpPositions.length >= 26,
    `WARP_NEXUS must generate at least 26 warp tiles (13 pairs), got ${warpPositions.length}`
  );

  // 4-C. ワープゾーンを踏むと即座に対のワープ先へテレポートすること
  const p1 = warpPositions[0];
  const target = map.getWarpDestination(p1);
  assert.ok(target !== null, 'Every warp tile must have a valid destination target');

  // 進入元を空床にし、プレイヤーを p1 の左隣に配置
  const startPos = { x: p1.x - 1, y: p1.y };
  map.setBaseTile(startPos, 'EMPTY');
  map.setObject(startPos, 'NONE');
  map.setObject(p1, 'NONE'); // ワープマス上のオブジェクトなしを確認
  const player = new Player(startPos);

  // 右に移動してワープを踏む
  const moved = MovementSystem.tryMove(player, 'RIGHT', map);
  assert.strictEqual(moved, true, 'Player should enter warp tile');
  assert.strictEqual(MovementSystem.lastWarped, true, 'MovementSystem must detect warp transition');
  assert.strictEqual(player.pos.x, target!.x, 'Player must be teleported to target X');
  assert.strictEqual(player.pos.y, target!.y, 'Player must be teleported to target Y');

  // 4-D. 空のワープゾーンの上には可動岩（BLOCK）を押し込める（倉庫番の道としても利用可能）こと
  assert.strictEqual(
    map.isPushDestinationValid(p1),
    true,
    'Empty warp tile allows push if not blocked by object/item'
  );

  console.log('✓ 4. Dense WARP_NEXUS generation & teleportation verified.');
}

// ============================================================================
// Test 5: アーキタイプ設定とチューニングプリセット連動検証
// ============================================================================
console.log('Testing 5: TuningPresetResolver archetype integration...');
{
  const archetypes: DungeonArchetype[] = ['BALANCED', 'SANCTUARY', 'WARP_NEXUS', 'ARMORY'];

  for (const arch of archetypes) {
    const params = TuningPresetResolver.resolve('MULTI_SECTOR', 'NORMAL', 'STANDARD', undefined, arch);
    assert.ok(params.resourceCapConfig, `Archetype ${arch} must resolve resourceCapConfig`);

    if (arch === 'SANCTUARY') {
      assert.strictEqual(params.resourceCapConfig.cross.maxCap, 8, 'SANCTUARY must raise cross cap to 8');
      assert.strictEqual(params.resourceCapConfig.ghostCount, 4, 'SANCTUARY must have 4 field ghosts');
    } else if (arch === 'ARMORY') {
      assert.strictEqual(params.resourceCapConfig.sword.maxCap, 4, 'ARMORY must allow up to 4 swords');
    } else if (arch === 'WARP_NEXUS') {
      assert.strictEqual(params.resourceCapConfig.key.maxCap, 6, 'WARP_NEXUS must provide 6 keys');
      assert.strictEqual(params.resourceCapConfig.ring.maxCap, 5, 'WARP_NEXUS must provide 5 rings');
    }
  }

  console.log('✓ 5. All archetype preset resolutions verified.');
}

console.log('--- Phase 11: All Classic Tactics Tests PASSED! ---');
