import {
  GameEventBus,
} from '../core/GameEventBus.js';
import {
  DeathInfo,
  DungeonTopology,
  MapDifficulty,
  PlayPacingMode,
  ResolvedDungeonTuningParams,
} from '../models/Types.js';
import { BotSkillProfile } from '../ai/BotTypes.js';

export interface SingleRunRecord {
  runIndex: number;
  seed: number;
  won: boolean;
  totalTurns: number;
  deathInfo?: DeathInfo;
  reachedMilestones: {
    gotSword: boolean;
    unlockedBreakMagic: boolean;
    unlockedDiagonalMove: boolean;
    killedHead1: boolean;
    killedAllHeads: boolean;
    deliveredAtLeastOneCrown: boolean;
  };
  homeSpawnAttempts: number;
  homeSpawnSuccessCount: number;
  homeSpawnBlockedCount: number;
  distantEnemyEvictionCount: number;
  escapePhaseNearbyEnemyTotal: number;
  escapePhaseTurns: number;
  maxSingleKillExpJump: number;
  totalCombatTurns: number;
  zeroDamageCombats: number;
  moderateDamageCombats: number;
  lethalDeaths: number;
  crossesSpawned: number;
  ringsSpawned: number;
  keysSpawned: number;
  powerStonesSpawned: number;
  chestCapFallbackCount: number;
  gravesSealedCount: number;
  ghostItemsPickedUp: number;
  ghostItemsStolen: number;
  turnSeriesSnapshots: { turn: number; exp: number; str: number }[];
}

export interface SimulationSummaryReport {
  config: {
    topology: DungeonTopology;
    difficulty: MapDifficulty;
    pacing: PlayPacingMode;
    runs: number;
    maxTurnsLimit: number;
    botProfile: BotSkillProfile;
    tuningParams?: ResolvedDungeonTuningParams;
  };
  overall: {
    winRate: number;                  // クリア率 (0.0 〜 1.0)
    avgClearTurns: number;            // クリア時の平均ターン数
    medianClearTurns: number;         // 中央値
    estimatedPlayTimeMinutes: number; // 人間換算の推定プレイ時間 (分)
    milestoneReachRates: {
      gotSword: number;
      unlockedBreakMagic: number;
      unlockedDiagonalMove: number;
      killedHead1: number;
      killedAllHeads: number;
      deliveredAtLeastOneCrown: number;
    };
    deathCauses: Record<string, number>;
  };
  homeSpawnMetrics: {
    totalHomeSpawnAttempts: number;
    homeSpawnSuccessRate: number;     // %
    blockedByGlobalCapRate: number;   // % ★改善目標: 0%近く
    evictedDistantEnemyCount: number;
    escapePhaseHomeThreatDensity: number;
  };
  progressionMetrics: {
    maxSingleKillExpJump: number;
    combatOutcomeDistribution: {
      zeroDamageTakenRatio: number;
      moderateDamageRatio: number;
      lethalOneShotDeathRatio: number;
    };
    turnSeries: Array<{ turn: number; medianExp: number; p90Exp: number; medianStr: number }>;
  };
  resourceAndGhostMetrics: {
    avgItemsSpawnedPerRun: {
      cross: number;
      ring: number;
      key: number;
      powerStone: number;
    };
    chestCapFallbackCount: number;
    gravesSealedByCrossRatio: number;
    ghostInteractions: {
      itemsPickedUp: number;
      itemsStolenFromPlayer: number;
    };
  };
}

/**
 * GameEventBus からのイベントをリアルタイム集計するテレメトリレコーダー
 */
export class SimulationTelemetry {
  private currentRecord: SingleRunRecord;
  private readonly allRecords: SingleRunRecord[] = [];

  constructor(runIndex: number = 0, seed: number = 0) {
    this.currentRecord = this.createEmptyRecord(runIndex, seed);
  }

  public bindToEventBus(eventBus: GameEventBus): void {
    eventBus.on('combat:playerAttack', (payload) => {
      if (payload.expGained > this.currentRecord.maxSingleKillExpJump) {
        this.currentRecord.maxSingleKillExpJump = payload.expGained;
      }
    });

    eventBus.on('combat:enemyAttack', (payload) => {
      this.currentRecord.totalCombatTurns++;
      if (payload.damage === 0) {
        this.currentRecord.zeroDamageCombats++;
      } else if (payload.damage < 300) {
        this.currentRecord.moderateDamageCombats++;
      }
      if (payload.killed) {
        this.currentRecord.lethalDeaths++;
      }
    });

    eventBus.on('spawn:home', (payload) => {
      this.currentRecord.homeSpawnAttempts++;
      if (payload.success) {
        this.currentRecord.homeSpawnSuccessCount++;
      }
      if (payload.blockedByCap) {
        this.currentRecord.homeSpawnBlockedCount++;
      }
      if (payload.evictedDistantEnemy) {
        this.currentRecord.distantEnemyEvictionCount++;
      }
    });

    eventBus.on('chest:open', (payload) => {
      if (payload.itemSpawned === 'CROSS') this.currentRecord.crossesSpawned++;
      else if (payload.itemSpawned === 'RING') this.currentRecord.ringsSpawned++;
      else if (payload.itemSpawned === 'KEY') this.currentRecord.keysSpawned++;
      else if (payload.itemSpawned === 'POWER_STONE') this.currentRecord.powerStonesSpawned++;

      if (payload.cappedFallbackFrom) {
        this.currentRecord.chestCapFallbackCount++;
      }
    });

    eventBus.on('ghost:action', (payload) => {
      if (payload.type === 'PICKUP') this.currentRecord.ghostItemsPickedUp++;
      else if (payload.type === 'STEAL_FROM_PLAYER') this.currentRecord.ghostItemsStolen++;
    });

    eventBus.on('dragon:headKilled', (payload) => {
      if (payload.remainingHeads === 2) {
        this.currentRecord.reachedMilestones.killedHead1 = true;
      }
      if (payload.remainingHeads === 0) {
        this.currentRecord.reachedMilestones.killedAllHeads = true;
      }
    });

    eventBus.on('player:homeReturn', (payload) => {
      if (payload.result.crownConverted) {
        this.currentRecord.reachedMilestones.deliveredAtLeastOneCrown = true;
      }
    });

    eventBus.on('game:stateChange', (payload) => {
      if (payload.current === 'STAGECLEAR') {
        this.currentRecord.won = true;
      }
      if (payload.current === 'GAMEOVER') {
        this.currentRecord.deathInfo = payload.deathInfo;
      }
    });
  }

  public recordTurnSnapshot(turn: number, exp: number, str: number, hasSword: boolean = false): void {
    if (hasSword) {
      this.currentRecord.reachedMilestones.gotSword = true;
    }
    if (exp >= 4000) {
      this.currentRecord.reachedMilestones.unlockedBreakMagic = true;
    }
    if (exp >= 12000) {
      this.currentRecord.reachedMilestones.unlockedDiagonalMove = true;
    }

    if (turn % 200 === 0) {
      this.currentRecord.turnSeriesSnapshots.push({ turn, exp, str });
    }
  }

  public finalizeCurrentRun(totalTurns: number, won: boolean, deathInfo?: DeathInfo): void {
    this.currentRecord.totalTurns = totalTurns;
    this.currentRecord.won = won;
    if (deathInfo) this.currentRecord.deathInfo = deathInfo;
    this.allRecords.push(this.currentRecord);
  }

  public startNewRun(runIndex: number, seed: number): void {
    this.currentRecord = this.createEmptyRecord(runIndex, seed);
  }

  public getRecords(): SingleRunRecord[] {
    return this.allRecords;
  }

  private createEmptyRecord(runIndex: number, seed: number): SingleRunRecord {
    return {
      runIndex,
      seed,
      won: false,
      totalTurns: 0,
      reachedMilestones: {
        gotSword: false,
        unlockedBreakMagic: false,
        unlockedDiagonalMove: false,
        killedHead1: false,
        killedAllHeads: false,
        deliveredAtLeastOneCrown: false,
      },
      homeSpawnAttempts: 0,
      homeSpawnSuccessCount: 0,
      homeSpawnBlockedCount: 0,
      distantEnemyEvictionCount: 0,
      escapePhaseNearbyEnemyTotal: 0,
      escapePhaseTurns: 0,
      maxSingleKillExpJump: 0,
      totalCombatTurns: 0,
      zeroDamageCombats: 0,
      moderateDamageCombats: 0,
      lethalDeaths: 0,
      crossesSpawned: 0,
      ringsSpawned: 0,
      keysSpawned: 0,
      powerStonesSpawned: 0,
      chestCapFallbackCount: 0,
      gravesSealedCount: 0,
      ghostItemsPickedUp: 0,
      ghostItemsStolen: 0,
      turnSeriesSnapshots: [],
    };
  }
}
