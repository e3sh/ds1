import {
  DungeonTopology,
  DungeonTuningParams,
  MapDifficulty,
  PlayPacingMode,
  DungeonArchetype,
  ResolvedDungeonTuningParams,
} from '../models/Types.js';

export class TuningPresetResolver {
  /**
   * 静的テストベッド・回帰テスト用の基準デフォルトパラメータ（無減衰モード）を返す
   */
  public static getClassicDefault(): ResolvedDungeonTuningParams {
    return {
      spawnConfig: {
        maxFieldEnemiesByPhase: [7, 9, 11, 13],
        homeSpawnReserveByPhase: [0, 2, 3, 4],
        evictDistantEnemyOnHomeSpawn: true,
      },
      progressionConfig: {
        expCurveMode: 'CLASSIC_LINEAR',
        expDampingExponent: 0.75,
        expScaleFactor: 1.0,
        expPhaseCaps: [15000, 35000, 70000, 150000],
        expDefenseMitigationRatio: 1.0,
        powerStoneGrowthRate: 0.36,
        powerStoneFlatBonus: 2000,
        dragonDefRatio: 1.0,
        enemyAtkRatio: 1.0,
      },
      resourceCapConfig: {
        cross: { initial: 1, maxCap: 99 },
        ring: { initial: 2, maxCap: 99 },
        key: { initial: 2, maxCap: 99 },
        sword: { initial: 1, maxCap: 99 },
        chestCount: 100,
        graveCount: 20,
        ghostCount: 2,
        ghostMoveIntervalMs: 90,
      },
    };
  }

  /**
   * トポロジー・難易度・プレイ時間ペースと任意のオーバーライドから確定パラメータを合成・解決する
   */
  public static resolve(
    topology: DungeonTopology = 'STANDARD_ROOMS',
    difficulty: MapDifficulty = 'NORMAL',
    pacing: PlayPacingMode = 'STANDARD',
    overrides?: DungeonTuningParams,
    archetype?: DungeonArchetype
  ): ResolvedDungeonTuningParams {
    if (topology === 'CLASSIC_FIXED') {
      const classic = this.getClassicDefault();
      if (overrides) {
        return this.applyOverrides(classic, overrides);
      }
      return classic;
    }

    // 1. トポロジー基準値の設定
    let maxFieldEnemies: [number, number, number, number] = [7, 9, 11, 13];
    let homeSpawnReserve: [number, number, number, number] = [0, 2, 3, 4];
    let crossCap = { initial: 1, maxCap: 2 };
    let ringCap = { initial: 2, maxCap: 2 };
    let keyCap = { initial: 2, maxCap: 3 };
    let swordCap = { initial: 1, maxCap: 1 };
    let ghostCount = 2;
    let expCurveMode: 'CLASSIC_LINEAR' | 'DAMPED_POWER' | 'PHASE_CAPPED' = 'DAMPED_POWER';

    switch (topology) {
      case 'PILLAR_GRID':
        maxFieldEnemies = [9, 11, 13, 15];
        homeSpawnReserve = [0, 3, 4, 5];
        crossCap = { initial: 1, maxCap: 3 };
        ringCap = { initial: 2, maxCap: 3 };
        keyCap = { initial: 2, maxCap: 4 };
        ghostCount = 3;
        break;
      case 'NARROW_MAZE':
        maxFieldEnemies = [5, 7, 8, 10];
        homeSpawnReserve = [0, 1, 2, 3];
        crossCap = { initial: 1, maxCap: 1 };
        ringCap = { initial: 2, maxCap: 2 };
        keyCap = { initial: 2, maxCap: 2 };
        ghostCount = 1;
        break;
      case 'SPIRAL_LABYRINTH':
        maxFieldEnemies = [7, 9, 11, 13];
        homeSpawnReserve = [0, 2, 3, 4];
        crossCap = { initial: 1, maxCap: 2 };
        ringCap = { initial: 2, maxCap: 3 };
        keyCap = { initial: 2, maxCap: 3 };
        ghostCount = 2;
        expCurveMode = 'PHASE_CAPPED';
        break;
      case 'FORTRESS_ARENA':
        maxFieldEnemies = [8, 10, 12, 14];
        homeSpawnReserve = [0, 3, 4, 5];
        crossCap = { initial: 1, maxCap: 2 };
        ringCap = { initial: 2, maxCap: 3 };
        keyCap = { initial: 2, maxCap: 3 };
        ghostCount = 2;
        break;
      case 'MULTI_SECTOR':
        maxFieldEnemies = [8, 10, 12, 14];
        homeSpawnReserve = [0, 2, 3, 4];
        crossCap = { initial: 1, maxCap: 2 };
        ringCap = { initial: 2, maxCap: 3 };
        keyCap = { initial: 2, maxCap: 3 };
        ghostCount = 2;
        break;
      case 'STANDARD_ROOMS':
      default:
        maxFieldEnemies = [7, 9, 11, 13];
        homeSpawnReserve = [0, 2, 3, 4];
        crossCap = { initial: 1, maxCap: 2 };
        ringCap = { initial: 2, maxCap: 2 };
        keyCap = { initial: 2, maxCap: 3 };
        ghostCount = 2;
        expCurveMode = 'DAMPED_POWER';
        break;
    }

    // 2. テーマ（シチュエーション・アーキタイプ）補正
    if (archetype === 'SANCTUARY') {
      crossCap = { initial: 3, maxCap: 8 };
      ghostCount = 4;
    } else if (archetype === 'WARP_NEXUS') {
      keyCap = { initial: 3, maxCap: 6 };
      ringCap = { initial: 3, maxCap: 5 };
    } else if (archetype === 'ARMORY') {
      swordCap = { initial: 2, maxCap: 4 };
      maxFieldEnemies = [10, 12, 14, 16];
    }

    // 3. 難易度補正 (EASY / NORMAL / HARD)
    let enemyAtkRatio = 1.0;
    let dragonDefRatio = 1.0;

    if (difficulty === 'EASY') {
      enemyAtkRatio = 0.85;
      crossCap.maxCap += 1;
      dragonDefRatio = 0.85;
    } else if (difficulty === 'HARD') {
      enemyAtkRatio = 1.15;
      crossCap.maxCap = Math.max(1, crossCap.maxCap - 1);
      homeSpawnReserve = [
        homeSpawnReserve[0] + 1,
        homeSpawnReserve[1] + 1,
        homeSpawnReserve[2] + 1,
        homeSpawnReserve[3] + 1,
      ];
    }

    // 3. プレイ時間・ペース補正 (BLITZ / STANDARD / MARATHON)
    let powerStoneGrowthRate = 0.36;
    let powerStoneFlatBonus = 2000;
    let chestCount = 100;
    let graveCount = 20;
    let expScaleFactor = 1.0;
    let ghostMoveIntervalMs = 90;

    if (pacing === 'BLITZ') {
      powerStoneGrowthRate = 0.55;
      powerStoneFlatBonus = 3000;
      chestCount = 65;
      graveCount = 14;
      expScaleFactor = 1.6;
      ghostMoveIntervalMs = 70;
    } else if (pacing === 'MARATHON') {
      powerStoneGrowthRate = 0.25;
      powerStoneFlatBonus = 1500;
      chestCount = 130;
      graveCount = 26;
      expCurveMode = 'PHASE_CAPPED';
      ghostMoveIntervalMs = 110;
    }

    if (difficulty === 'HARD') {
      ghostMoveIntervalMs = Math.round(ghostMoveIntervalMs * 0.85);
    } else if (difficulty === 'EASY') {
      ghostMoveIntervalMs = Math.round(ghostMoveIntervalMs * 1.15);
    }

    // 4. ベース確定オブジェクト構築
    const resolved: ResolvedDungeonTuningParams = {
      spawnConfig: {
        maxFieldEnemiesByPhase: maxFieldEnemies,
        homeSpawnReserveByPhase: homeSpawnReserve,
        evictDistantEnemyOnHomeSpawn: true,
      },
      progressionConfig: {
        expCurveMode,
        expDampingExponent: 0.75,
        expScaleFactor,
        expPhaseCaps: [15000, 35000, 70000, 150000],
        expDefenseMitigationRatio: 1.0,
        powerStoneGrowthRate,
        powerStoneFlatBonus,
        dragonDefRatio,
        enemyAtkRatio,
      },
      resourceCapConfig: {
        cross: { ...crossCap },
        ring: { ...ringCap },
        key: { ...keyCap },
        sword: { ...swordCap },
        chestCount,
        graveCount,
        ghostCount,
        ghostMoveIntervalMs,
      },
    };

    // 5. overrides の適用 (ディープ上書き)
    return this.applyOverrides(resolved, overrides);
  }

  public static applyOverrides(
    base: ResolvedDungeonTuningParams,
    overrides?: DungeonTuningParams
  ): ResolvedDungeonTuningParams {
    const resolved: ResolvedDungeonTuningParams = {
      spawnConfig: {
        maxFieldEnemiesByPhase: [...base.spawnConfig.maxFieldEnemiesByPhase],
        homeSpawnReserveByPhase: [...base.spawnConfig.homeSpawnReserveByPhase],
        evictDistantEnemyOnHomeSpawn: base.spawnConfig.evictDistantEnemyOnHomeSpawn,
      },
      progressionConfig: {
        expCurveMode: base.progressionConfig.expCurveMode,
        expDampingExponent: base.progressionConfig.expDampingExponent,
        expScaleFactor: base.progressionConfig.expScaleFactor,
        expPhaseCaps: [...base.progressionConfig.expPhaseCaps],
        expDefenseMitigationRatio: base.progressionConfig.expDefenseMitigationRatio,
        powerStoneGrowthRate: base.progressionConfig.powerStoneGrowthRate,
        powerStoneFlatBonus: base.progressionConfig.powerStoneFlatBonus,
        dragonDefRatio: base.progressionConfig.dragonDefRatio,
        enemyAtkRatio: base.progressionConfig.enemyAtkRatio,
      },
      resourceCapConfig: {
        cross: { ...base.resourceCapConfig.cross },
        ring: { ...base.resourceCapConfig.ring },
        key: { ...base.resourceCapConfig.key },
        sword: { ...base.resourceCapConfig.sword },
        chestCount: base.resourceCapConfig.chestCount,
        graveCount: base.resourceCapConfig.graveCount,
        ghostCount: base.resourceCapConfig.ghostCount,
        ghostMoveIntervalMs: base.resourceCapConfig.ghostMoveIntervalMs,
      },
    };

    if (overrides) {
      if (overrides.spawnConfig) {
        if (overrides.spawnConfig.maxFieldEnemiesByPhase) {
          resolved.spawnConfig.maxFieldEnemiesByPhase = [...overrides.spawnConfig.maxFieldEnemiesByPhase];
        }
        if (overrides.spawnConfig.homeSpawnReserveByPhase) {
          resolved.spawnConfig.homeSpawnReserveByPhase = [...overrides.spawnConfig.homeSpawnReserveByPhase];
        }
        if (overrides.spawnConfig.evictDistantEnemyOnHomeSpawn !== undefined) {
          resolved.spawnConfig.evictDistantEnemyOnHomeSpawn = overrides.spawnConfig.evictDistantEnemyOnHomeSpawn;
        }
      }

      if (overrides.progressionConfig) {
        if (overrides.progressionConfig.expCurveMode) {
          resolved.progressionConfig.expCurveMode = overrides.progressionConfig.expCurveMode;
        }
        if (overrides.progressionConfig.expDampingExponent !== undefined) {
          resolved.progressionConfig.expDampingExponent = overrides.progressionConfig.expDampingExponent;
        }
        if (overrides.progressionConfig.expScaleFactor !== undefined) {
          resolved.progressionConfig.expScaleFactor = overrides.progressionConfig.expScaleFactor;
        }
        if (overrides.progressionConfig.expPhaseCaps) {
          resolved.progressionConfig.expPhaseCaps = [...overrides.progressionConfig.expPhaseCaps];
        }
        if (overrides.progressionConfig.expDefenseMitigationRatio !== undefined) {
          resolved.progressionConfig.expDefenseMitigationRatio = overrides.progressionConfig.expDefenseMitigationRatio;
        }
        if (overrides.progressionConfig.powerStoneGrowthRate !== undefined) {
          resolved.progressionConfig.powerStoneGrowthRate = overrides.progressionConfig.powerStoneGrowthRate;
        }
        if (overrides.progressionConfig.powerStoneFlatBonus !== undefined) {
          resolved.progressionConfig.powerStoneFlatBonus = overrides.progressionConfig.powerStoneFlatBonus;
        }
        if (overrides.progressionConfig.dragonDefRatio !== undefined) {
          resolved.progressionConfig.dragonDefRatio = overrides.progressionConfig.dragonDefRatio;
        }
        if (overrides.progressionConfig.enemyAtkRatio !== undefined) {
          resolved.progressionConfig.enemyAtkRatio = overrides.progressionConfig.enemyAtkRatio;
        }
      }

      if (overrides.resourceCapConfig) {
        if (overrides.resourceCapConfig.cross) {
          resolved.resourceCapConfig.cross = { ...overrides.resourceCapConfig.cross };
        }
        if (overrides.resourceCapConfig.ring) {
          resolved.resourceCapConfig.ring = { ...overrides.resourceCapConfig.ring };
        }
        if (overrides.resourceCapConfig.key) {
          resolved.resourceCapConfig.key = { ...overrides.resourceCapConfig.key };
        }
        if (overrides.resourceCapConfig.sword) {
          resolved.resourceCapConfig.sword = { ...overrides.resourceCapConfig.sword };
        }
        if (overrides.resourceCapConfig.chestCount !== undefined) {
          resolved.resourceCapConfig.chestCount = overrides.resourceCapConfig.chestCount;
        }
        if (overrides.resourceCapConfig.graveCount !== undefined) {
          resolved.resourceCapConfig.graveCount = overrides.resourceCapConfig.graveCount;
        }
        if (overrides.resourceCapConfig.ghostCount !== undefined) {
          resolved.resourceCapConfig.ghostCount = overrides.resourceCapConfig.ghostCount;
        }
        if (overrides.resourceCapConfig.ghostMoveIntervalMs !== undefined) {
          resolved.resourceCapConfig.ghostMoveIntervalMs = overrides.resourceCapConfig.ghostMoveIntervalMs;
        }
      }
    }

    return resolved;
  }
}
