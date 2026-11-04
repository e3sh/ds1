import { GameEngine } from '../core/GameEngine.js';
import { SeedRandom } from '../core/SeedRandom.js';
import { GameEventBus } from '../core/GameEventBus.js';
import { AutoPlayBot, BotSkillProfile, BotStrategyTuning } from '../ai/AutoPlayBot.js';
import { SimulationTelemetry, SimulationSummaryReport } from './SimulationTelemetry.js';
import {
  DungeonTopology,
  MapDifficulty,
  PlayPacingMode,
} from '../models/Types.js';

export interface SimulationConfig {
  runs?: number;
  maxTurnsLimit?: number;
  topology?: DungeonTopology;
  difficulty?: MapDifficulty;
  pacing?: PlayPacingMode;
  botProfile?: BotSkillProfile;
  baseSeed?: number;
  strategyTuning?: BotStrategyTuning;
}

/**
 * ヘッドレス自動プレイバッチシミュレータ (SimulationRunner)
 * 指定されたトポロジー・難易度・Botプロファイルで自律高速プレイを実行し、
 * 統計KPIサマリーレポートを生成する。
 */
export class SimulationRunner {
  public static runBatch(config: SimulationConfig = {}): SimulationSummaryReport {
    const runs = config.runs ?? 10;
    const maxTurnsLimit = config.maxTurnsLimit ?? 1500;
    const topology = config.topology ?? 'STANDARD_ROOMS';
    const difficulty = config.difficulty ?? 'NORMAL';
    const pacing = config.pacing ?? 'STANDARD';
    const botProfile = config.botProfile ?? 'STANDARD';
    const baseSeed = config.baseSeed ?? 10000;

    const masterRng = new SeedRandom(baseSeed);
    const telemetry = new SimulationTelemetry(0, baseSeed);

    for (let r = 0; r < runs; r++) {
      const runSeed = masterRng.nextInt(1, 0x7fffffff);
      telemetry.startNewRun(r, runSeed);

      const eventBus = new GameEventBus();
      telemetry.bindToEventBus(eventBus);

      const runRng = new SeedRandom(runSeed);
      const engine = new GameEngine({
        rng: runRng,
        eventBus,
      });

      // プロシージャルマップでゲーム開始
      engine.startProceduralGame({
        seed: runSeed,
        topology,
        difficulty,
        pacing,
      });

      const bot = new AutoPlayBot({
        profile: botProfile,
        maxTurnsLimit,
        strategyTuning: config.strategyTuning,
      });

      let turns = 0;
      while (turns < maxTurnsLimit && engine.getState() === 'PLAYING') {
        turns++;
        // リアルタイムタイマー更新（フレーム進行）
        engine.stepFrame(100);

        // Bot による自律手番行動
        bot.step(engine);

        // スナップショット記録
        const player = engine.getPlayer();
        telemetry.recordTurnSnapshot(turns, player.experience, player.strength, player.hasSword);
      }

      const won = engine.getState() === 'STAGECLEAR';
      const player = engine.getPlayer();
      telemetry.finalizeCurrentRun(turns, won, player.deathInfo ?? undefined);
    }

    return this.generateSummaryReport(telemetry, {
      runs,
      maxTurnsLimit,
      topology,
      difficulty,
      pacing,
      botProfile,
    });
  }

  private static generateSummaryReport(
    telemetry: SimulationTelemetry,
    config: {
      runs: number;
      maxTurnsLimit: number;
      topology: DungeonTopology;
      difficulty: MapDifficulty;
      pacing: PlayPacingMode;
      botProfile: BotSkillProfile;
    }
  ): SimulationSummaryReport {
    const records = telemetry.getRecords();
    const runsCount = records.length;
    if (runsCount === 0) {
      throw new Error('SimulationRunner: No records to generate report from');
    }

    const wins = records.filter(r => r.won);
    const winRate = wins.length / runsCount;

    const clearTurnsList = wins.map(w => w.totalTurns).sort((a, b) => a - b);
    const avgClearTurns = clearTurnsList.length > 0
      ? clearTurnsList.reduce((acc, t) => acc + t, 0) / clearTurnsList.length
      : 0;
    const medianClearTurns = clearTurnsList.length > 0
      ? clearTurnsList[Math.floor(clearTurnsList.length / 2)]
      : 0;

    // 人間プレイ推定時間 (分): 1ターンあたり約0.7秒操作と仮定
    const estimatedPlayTimeMinutes = Math.round((avgClearTurns * 0.7) / 60 * 10) / 10;

    const deathCauses: Record<string, number> = {};
    for (const r of records) {
      if (!r.won) {
        const cause = r.deathInfo?.cause ?? (r.totalTurns >= config.maxTurnsLimit ? 'TIMEOUT_STALL' : 'UNKNOWN');
        deathCauses[cause] = (deathCauses[cause] || 0) + 1;
      }
    }

    // マイルストーン達成率
    const milestoneReachRates = {
      gotSword: records.filter(r => r.reachedMilestones.gotSword || r.won).length / runsCount,
      unlockedBreakMagic: records.filter(r => r.reachedMilestones.unlockedBreakMagic || r.won).length / runsCount,
      unlockedDiagonalMove: records.filter(r => r.reachedMilestones.unlockedDiagonalMove || r.won).length / runsCount,
      killedHead1: records.filter(r => r.reachedMilestones.killedHead1 || r.won).length / runsCount,
      killedAllHeads: records.filter(r => r.reachedMilestones.killedAllHeads || r.won).length / runsCount,
      deliveredAtLeastOneCrown: records.filter(r => r.reachedMilestones.deliveredAtLeastOneCrown || r.won).length / runsCount,
    };

    // 課題1: スポーン健全性
    const totalHomeSpawnAttempts = records.reduce((acc, r) => acc + r.homeSpawnAttempts, 0);
    const totalHomeSpawnSuccess = records.reduce((acc, r) => acc + r.homeSpawnSuccessCount, 0);
    const totalHomeSpawnBlocked = records.reduce((acc, r) => acc + r.homeSpawnBlockedCount, 0);
    const totalEvicted = records.reduce((acc, r) => acc + r.distantEnemyEvictionCount, 0);

    const homeSpawnSuccessRate = totalHomeSpawnAttempts > 0 ? (totalHomeSpawnSuccess / totalHomeSpawnAttempts) * 100 : 100;
    const blockedByGlobalCapRate = totalHomeSpawnAttempts > 0 ? (totalHomeSpawnBlocked / totalHomeSpawnAttempts) * 100 : 0;

    // 課題2: EXP/STR成長と戦闘二極化
    const maxSingleKillExpJump = Math.max(...records.map(r => r.maxSingleKillExpJump), 0);
    const totalCombats = records.reduce((acc, r) => acc + r.totalCombatTurns, 0);
    const totalZeroDmg = records.reduce((acc, r) => acc + r.zeroDamageCombats, 0);
    const totalModerate = records.reduce((acc, r) => acc + r.moderateDamageCombats, 0);
    const totalLethal = records.reduce((acc, r) => acc + r.lethalDeaths, 0);

    const combatOutcomeDistribution = {
      zeroDamageTakenRatio: totalCombats > 0 ? Math.round((totalZeroDmg / totalCombats) * 100) / 100 : 0,
      moderateDamageRatio: totalCombats > 0 ? Math.round((totalModerate / totalCombats) * 100) / 100 : 0,
      lethalOneShotDeathRatio: totalCombats > 0 ? Math.round((totalLethal / totalCombats) * 100) / 100 : 0,
    };

    // 課題3: 資源とゴースト影響
    const avgItemsSpawnedPerRun = {
      cross: Math.round((records.reduce((acc, r) => acc + r.crossesSpawned, 0) / runsCount) * 10) / 10,
      ring: Math.round((records.reduce((acc, r) => acc + r.ringsSpawned, 0) / runsCount) * 10) / 10,
      key: Math.round((records.reduce((acc, r) => acc + r.keysSpawned, 0) / runsCount) * 10) / 10,
      powerStone: Math.round((records.reduce((acc, r) => acc + r.powerStonesSpawned, 0) / runsCount) * 10) / 10,
    };

    const chestCapFallbackCount = Math.round(records.reduce((acc, r) => acc + r.chestCapFallbackCount, 0) / runsCount);

    return {
      config: {
        topology: config.topology,
        difficulty: config.difficulty,
        pacing: config.pacing,
        runs: config.runs,
        maxTurnsLimit: config.maxTurnsLimit,
        botProfile: config.botProfile,
      },
      overall: {
        winRate: Math.round(winRate * 100) / 100,
        avgClearTurns: Math.round(avgClearTurns),
        medianClearTurns,
        estimatedPlayTimeMinutes,
        milestoneReachRates,
        deathCauses,
      },
      homeSpawnMetrics: {
        totalHomeSpawnAttempts,
        homeSpawnSuccessRate: Math.round(homeSpawnSuccessRate * 10) / 10,
        blockedByGlobalCapRate: Math.round(blockedByGlobalCapRate * 10) / 10,
        evictedDistantEnemyCount: totalEvicted,
        escapePhaseHomeThreatDensity: 0,
      },
      progressionMetrics: {
        maxSingleKillExpJump,
        combatOutcomeDistribution,
        turnSeries: [],
      },
      resourceAndGhostMetrics: {
        avgItemsSpawnedPerRun,
        chestCapFallbackCount,
        gravesSealedByCrossRatio: 0,
        ghostInteractions: {
          itemsPickedUp: Math.round(records.reduce((acc, r) => acc + r.ghostItemsPickedUp, 0) / runsCount),
          itemsStolenFromPlayer: Math.round(records.reduce((acc, r) => acc + r.ghostItemsStolen, 0) / runsCount),
        },
      },
    };
  }
}
