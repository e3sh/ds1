import assert from 'node:assert';
import { TuningPresetResolver } from '../src/config/TuningPresetResolver.js';
import { ProceduralMapGenerator } from '../src/systems/ProceduralMapGenerator.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { Dragon } from '../src/models/Dragon.js';
import { Player } from '../src/models/Player.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { SpawnSystem } from '../src/systems/SpawnSystem.js';
import { CombatSystem } from '../src/systems/CombatSystem.js';
import { ThreatEvaluator } from '../src/systems/ThreatEvaluator.js';
import { ChestSystem } from '../src/systems/ChestSystem.js';
import { Ghost } from '../src/models/Ghost.js';
import { GameEngine } from '../src/core/GameEngine.js';
import {
  DungeonTopology,
  MapDifficulty,
  PlayPacingMode,
  DungeonTuningParams,
} from '../src/models/Types.js';

console.log('--- Phase 9: Procedural Variety & Tuning Architecture Verification ---');

// ==========================================
// Test 1: TuningPresetResolver 54通りプリセット合成とカスタムオーバーライド
// ==========================================
console.log('Testing 1: TuningPresetResolver preset resolution (54 configurations) & overrides...');
{
  const topologies: DungeonTopology[] = [
    'STANDARD_ROOMS',
    'PILLAR_GRID',
    'NARROW_MAZE',
    'SPIRAL_LABYRINTH',
    'FORTRESS_ARENA',
    'MULTI_SECTOR',
  ];
  const difficulties: MapDifficulty[] = ['EASY', 'NORMAL', 'HARD'];
  const pacings: PlayPacingMode[] = ['BLITZ', 'STANDARD', 'MARATHON'];

  let resolvedCount = 0;
  for (const topo of topologies) {
    for (const diff of difficulties) {
      for (const pacing of pacings) {
        const resolved = TuningPresetResolver.resolve(topo, diff, pacing);
        resolvedCount++;

        // 基本必須フィールドが存在すること
        assert.ok(resolved.spawnConfig.maxFieldEnemiesByPhase.length === 4);
        assert.ok(resolved.spawnConfig.homeSpawnReserveByPhase.length === 4);
        assert.strictEqual(typeof resolved.spawnConfig.evictDistantEnemyOnHomeSpawn, 'boolean');
        assert.ok(resolved.progressionConfig.powerStoneGrowthRate > 0);
        assert.ok(resolved.progressionConfig.expScaleFactor > 0);
        assert.ok(resolved.resourceCapConfig.cross.maxCap >= 1);
        assert.ok(resolved.resourceCapConfig.ghostCount >= 1);

        // トポロジー固有値の検証
        if (topo === 'NARROW_MAZE') {
          assert.strictEqual(resolved.resourceCapConfig.ghostCount, 1);
          if (diff === 'NORMAL') {
            assert.strictEqual(resolved.resourceCapConfig.cross.maxCap, 1);
          }
        } else if (topo === 'PILLAR_GRID') {
          assert.strictEqual(resolved.resourceCapConfig.ghostCount, 3);
        }

        // 難易度固有補正の検証
        if (diff === 'EASY') {
          assert.strictEqual(resolved.progressionConfig.enemyAtkRatio, 0.85);
          assert.strictEqual(resolved.progressionConfig.dragonDefRatio, 0.85);
        } else if (diff === 'HARD') {
          assert.strictEqual(resolved.progressionConfig.enemyAtkRatio, 1.15);
        } else {
          assert.strictEqual(resolved.progressionConfig.enemyAtkRatio, 1.0);
        }

        // プレイペース固有補正の検証
        if (pacing === 'BLITZ') {
          assert.strictEqual(resolved.progressionConfig.powerStoneGrowthRate, 0.55);
          assert.strictEqual(resolved.resourceCapConfig.chestCount, 65);
          assert.strictEqual(resolved.progressionConfig.expScaleFactor, 1.6);
        } else if (pacing === 'MARATHON') {
          assert.strictEqual(resolved.progressionConfig.powerStoneGrowthRate, 0.25);
          assert.strictEqual(resolved.resourceCapConfig.chestCount, 130);
          assert.strictEqual(resolved.progressionConfig.expCurveMode, 'PHASE_CAPPED');
        }
      }
    }
  }
  assert.strictEqual(resolvedCount, 54, 'Should resolve all 54 matrix permutations');

  // カスタムオーバーライドの検証
  const customOverride: DungeonTuningParams = {
    progressionConfig: {
      powerStoneGrowthRate: 0.99,
      enemyAtkRatio: 2.0,
    },
    resourceCapConfig: {
      ghostCount: 5,
    },
  };
  const overridden = TuningPresetResolver.resolve('STANDARD_ROOMS', 'NORMAL', 'STANDARD', customOverride);
  assert.strictEqual(overridden.progressionConfig.powerStoneGrowthRate, 0.99);
  assert.strictEqual(overridden.progressionConfig.enemyAtkRatio, 2.0);
  assert.strictEqual(overridden.resourceCapConfig.ghostCount, 5);
  // 指定していない項目はベースプリセットが維持されること
  assert.strictEqual(overridden.progressionConfig.powerStoneFlatBonus, 2000);

  // クラシック互換デフォルトの検証
  const classic = TuningPresetResolver.getClassicDefault();
  assert.strictEqual(classic.progressionConfig.expCurveMode, 'CLASSIC_LINEAR');
  assert.strictEqual(classic.resourceCapConfig.cross.maxCap, 99);

  console.log('✓ 1. TuningPresetResolver verified successfully across 54 permutations.');
}

// ==========================================
// Test 2: ProceduralMapGenerator 全6トポロジー生成・解法性・ギミック検証
// ==========================================
console.log('Testing 2: ProceduralMapGenerator all 6 topologies & solvability...');
{
  const topologies: DungeonTopology[] = [
    'STANDARD_ROOMS',
    'PILLAR_GRID',
    'NARROW_MAZE',
    'SPIRAL_LABYRINTH',
    'FORTRESS_ARENA',
    'MULTI_SECTOR',
  ];

  for (const topo of topologies) {
    const map = new WorldMap(64, 64);
    const report = ProceduralMapGenerator.generateDungeon(map, {
      topology: topo,
      seed: 888888,
      difficulty: 'NORMAL',
      pacing: 'STANDARD',
    });

    assert.strictEqual(report.isSolvable, true, `${topo} must be solvable. Issues: ${report.issues.join(', ')}`);
    assert.strictEqual(report.hasZeroOverlaps, true, `${topo} must have 0 overlaps`);
    assert.strictEqual(report.internalWallsAreBlocks, true, `${topo} internal walls must be BLOCK`);
    assert.strictEqual(report.dragonArenaValid, true, `${topo} dragon arena must be clear`);
    assert.strictEqual(report.bootstrapValid, true, `${topo} bootstrap items & open graves valid`);
    assert.strictEqual(report.resourceSufficient, true, `${topo} resource sufficiency valid`);
    assert.ok(report.counts.chests >= 75, `${topo} should have >= 75 chests (got ${report.counts.chests})`);

    // 決定論的再現性の検証
    const mapClone = new WorldMap(64, 64);
    ProceduralMapGenerator.generateDungeon(mapClone, {
      topology: topo,
      seed: 888888,
      difficulty: 'NORMAL',
      pacing: 'STANDARD',
    });
    for (let y = 0; y < 64; y += 4) {
      for (let x = 0; x < 64; x += 4) {
        assert.strictEqual(
          map.getTile({ x, y }),
          mapClone.getTile({ x, y }),
          `Deterministic match failed for ${topo} at (${x},${y})`
        );
      }
    }
  }

  // BLITZ モードの Solvability 検証 (宝箱65個でも高成長率によりクリア可能)
  const blitzMap = new WorldMap(64, 64);
  const blitzReport = ProceduralMapGenerator.generateDungeon(blitzMap, {
    topology: 'MULTI_SECTOR',
    seed: 777123,
    difficulty: 'NORMAL',
    pacing: 'BLITZ',
  });
  assert.strictEqual(blitzReport.isSolvable, true, `BLITZ pacing must be solvable. Issues: ${blitzReport.issues.join(', ')}`);
  assert.strictEqual(blitzReport.resourceSufficient, true, 'BLITZ pacing resource must be sufficient');

  console.log('✓ 2. All 6 topologies & BLITZ pacing generation & solvability verified.');
}

// ==========================================
// Test 3: SpawnSystem 家湧き専用枠 & 遠方敵パージ検証 (課題①対策)
// ==========================================
console.log('Testing 3: SpawnSystem home spawn reserve & distant enemy eviction...');
{
  SpawnSystem.reset();
  const map = new WorldMap(64, 64);
  map.setBaseTile({ x: 7, y: 7 }, 'HOME');
  map.homePos = { x: 7, y: 7 };
  const player = new Player({ x: 8, y: 8, hp: 1000, experience: 20000 });
  const dragon = new Dragon({ x: 32, y: 32 });

  // 首1本討伐状態を作成 (defeatedHeadsCount = 1)
  dragon.heads[0].hp = 0;
  dragon.heads[0].isAlive = false;
  dragon.defeatedHeadsCount = 1;

  // 通常フィールド上限 = 9体、家湧き専用枠 = 2体 (合計 11体まで許容)
  const params: DungeonTuningParams = {
    spawnConfig: {
      maxFieldEnemiesByPhase: [7, 9, 11, 13],
      homeSpawnReserveByPhase: [0, 2, 3, 4],
      evictDistantEnemyOnHomeSpawn: true,
    },
  };

  const enemies: EnemyInstance[] = [];
  // 通常上限（9体）まで敵を埋める（うち1体を遠方に配置）
  for (let i = 0; i < 8; i++) {
    enemies.push(new EnemyInstance({ typeId: 1, pos: { x: 20 + i, y: 20 } }));
  }
  const distantEnemy = new EnemyInstance({ typeId: 2, pos: { x: 55, y: 55 } });
  enemies.push(distantEnemy);
  assert.strictEqual(enemies.filter(e => e.isAlive).length, 9);

  // 通常上限（9体）に達しているが、首1本討伐時の家湧き専用枠（+2）により spawnFromHome は成功すること
  const homeSpawn1 = SpawnSystem.spawnFromHome(enemies, player, map, dragon, params);
  assert.ok(homeSpawn1 !== null, 'Spawn from home should succeed using reserve slots');
  assert.strictEqual(enemies.filter(e => e.isAlive).length, 10);

  const homeSpawn2 = SpawnSystem.spawnFromHome(enemies, player, map, dragon, params);
  assert.ok(homeSpawn2 !== null, 'Second spawn from home should succeed using reserve slots');
  assert.strictEqual(enemies.filter(e => e.isAlive).length, 11);

  // これで総上限 11体 (9 + 2) に到達
  // この状態で spawnFromHome を呼ぶと、最も遠い distantEnemy がパージされて枠が空き、新たな家湧き敵がスポーンすること
  const homeSpawnEvict = SpawnSystem.spawnFromHome(enemies, player, map, dragon, params);
  assert.ok(homeSpawnEvict !== null, 'Spawn should succeed by evicting distant enemy');
  assert.strictEqual(
    enemies.some(e => e.id === distantEnemy.id && e.isAlive),
    false,
    'Distant enemy should be evicted from alive pool'
  );
  assert.strictEqual(enemies.filter(e => e.isAlive).length, 11);

  console.log('✓ 3. SpawnSystem home spawn reserve & distant eviction verified successfully.');
}

// ==========================================
// Test 4: Enemy EXP減衰カーブ & 被ダメ軽減倍率一貫性 (課題②対策)
// ==========================================
console.log('Testing 4: Enemy EXP damping curves & mitigation ratio consistency...');
{
  // 1. CLASSIC_LINEAR vs DAMPED_POWER vs PHASE_CAPPED
  const highDefEnemy = new EnemyInstance({ typeId: 32, pos: { x: 10, y: 10 }, def: 520000 });

  // CLASSIC_LINEAR: floor(520000 / 2) + 50 = 260,050
  const linearExp = highDefEnemy.getExpReward({ expCurveMode: 'CLASSIC_LINEAR' });
  assert.strictEqual(linearExp, 260050);

  // DAMPED_POWER: 520,000^0.75 * 5.0 + 50 ≒ 94,239 (約63%減衰し極端な階段を抑制)
  const dampedExp = highDefEnemy.getExpReward({ expCurveMode: 'DAMPED_POWER', expDampingExponent: 0.75 });
  assert.ok(dampedExp < 100000, `DAMPED_POWER should tame 260k down to < 100k (got ${dampedExp})`);
  assert.ok(dampedExp > 80000, `DAMPED_POWER should remain substantial > 80k (got ${dampedExp})`);

  // PHASE_CAPPED: 首0本のときは最大 15,000 でキャップ
  const phaseCappedExp0 = highDefEnemy.getExpReward(
    { expCurveMode: 'PHASE_CAPPED', expPhaseCaps: [15000, 35000, 70000, 150000] },
    0
  );
  assert.strictEqual(phaseCappedExp0, 15000, 'Phase 0 capped at 15,000');

  // 首3本のときは最大 150,000 でキャップ（減衰値が94,239なので減衰値そのまま）
  const phaseCappedExp3 = highDefEnemy.getExpReward(
    { expCurveMode: 'PHASE_CAPPED', expPhaseCaps: [15000, 35000, 70000, 150000] },
    3
  );
  assert.strictEqual(phaseCappedExp3, dampedExp);

  // 2. 被ダメ軽減倍率 expDefenseMitigationRatio の一貫適用と ThreatEvaluator の完全同期
  const player = new Player({ x: 10, y: 10, hp: 10000, experience: 8000, strength: 5000 });
  player.hasSword = true;
  const testEnemy = new EnemyInstance({ typeId: 1, pos: { x: 10, y: 11 }, atk: 10000, def: 1000, hp: 5000 });

  // mitigationRatio = 1.0 の場合: 被ダメ = max(0, 10000 - 8000) = 2,000
  const dmgFull = 10000 - player.getEffectiveDefense(1.0);
  assert.strictEqual(dmgFull, 2000);

  // mitigationRatio = 0.5 の場合: 被ダメ = max(0, 10000 - 4000) = 6,000
  const dmgHalf = 10000 - player.getEffectiveDefense(0.5);
  assert.strictEqual(dmgHalf, 6000);

  // ThreatEvaluator 判定の同期確認
  const threatFull = ThreatEvaluator.evaluateThreat(player, testEnemy, 1.0);
  const threatHalf = ThreatEvaluator.evaluateThreat(player, testEnemy, 0.5);
  assert.strictEqual(threatFull, 'STALEMATE'); // 2,000ダメを受けつつ倒すトレード
  assert.strictEqual(threatHalf, 'STALEMATE');

  // HPが4,000の時、0.5倍率では被ダメ6,000で即死 (LETHAL) となること
  player.hp = 4000;
  const threatLethal = ThreatEvaluator.evaluateThreat(player, testEnemy, 0.5);
  assert.strictEqual(threatLethal, 'LETHAL', 'Should correctly identify fatal counter with reduced defense');

  console.log('✓ 4. Enemy EXP damping & defense mitigation ratio verified successfully.');
}

// ==========================================
// Test 5: ChestSystem 非消耗品上限キャップ & GameEngine ゴースト数制御 (課題③対策)
// ==========================================
console.log('Testing 5: ChestSystem resource caps & GameEngine ghost count control...');
{
  const map = new WorldMap(64, 64);
  // 全マスの床上アイテムを一旦クリアして所持アイテムのみのテスト環境を作成
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      map.setItem({ x, y }, 'NONE');
    }
  }
  const player = new Player({ x: 5, y: 5 });
  player.holdItem = 'CROSS'; // プレイヤーが既に1個所持

  // CROSS 上限 1 に設定
  const tuning: DungeonTuningParams = {
    resourceCapConfig: {
      cross: { initial: 1, maxCap: 1 },
      ring: { initial: 2, maxCap: 2 },
      key: { initial: 2, maxCap: 3 },
      ghostCount: 3,
    },
  };

  // ワールド内の十字架総数は 1 (player.holdItem)
  const crossInWorld = ChestSystem.countItemInWorld('CROSS', map, player);
  assert.strictEqual(crossInWorld, 1);

  // すでに上限1に達しているため、宝箱抽選（装備品枠）からCROSSが排出されず、フォールバックすること
  // 100回宝箱を開封しても CROSS は絶対に出現しないこと
  let crossSpawned = 0;
  for (let i = 0; i < 100; i++) {
    player.stepCountSinceStone = 0; // 8歩周期を回避
    const item = ChestSystem.rollChestItem(player, {
      map,
      resourceCapConfig: tuning.resourceCapConfig,
    });
    if (item === 'CROSS') {
      crossSpawned++;
    }
  }
  assert.strictEqual(crossSpawned, 0, 'CROSS must not be rolled when maxCap is reached');

  // GameEngine 統合の検証: PILLAR_GRID (ghostCount: 3)
  const engine = new GameEngine();
  engine.startProceduralGame({
    topology: 'PILLAR_GRID',
    seed: 55555,
  });
  assert.strictEqual(engine.getState(), 'PLAYING');
  assert.strictEqual(engine.getGhosts().length, 3, 'PILLAR_GRID should spawn exactly 3 ghosts');

  // GameEngine NARROW_MAZE (ghostCount: 1)
  engine.startProceduralGame({
    topology: 'NARROW_MAZE',
    seed: 55555,
  });
  assert.strictEqual(engine.getGhosts().length, 1, 'NARROW_MAZE should spawn exactly 1 ghost');

  console.log('✓ 5. ChestSystem resource caps & GameEngine ghost count verified.');
}

console.log('--- ✓ All Phase 9 Tests Passed Successfully! ---');
