import { GameEngine } from '../core/GameEngine.js';
import { SeedRandom } from '../core/SeedRandom.js';
import { GameEventBus } from '../core/GameEventBus.js';
import { AutoPlayBot, BotSkillProfile, BotStrategyTuning } from '../ai/AutoPlayBot.js';
import {
  SimulationTelemetry,
  SimulationSummaryReport,
  RunDiagnosticDetail,
  MilestoneTurnStat,
  FailedRunSample,
} from './SimulationTelemetry.js';
import {
  DungeonTopology,
  MapDifficulty,
  PlayPacingMode,
  RuleMode,
} from '../models/Types.js';

export interface SimulationConfig {
  runs?: number;
  maxTurnsLimit?: number;
  topology?: DungeonTopology;
  difficulty?: MapDifficulty;
  pacing?: PlayPacingMode;
  ruleMode?: RuleMode;
  botProfile?: BotSkillProfile;
  baseSeed?: number;
  strategyTuning?: BotStrategyTuning;
  includeRunDetails?: boolean;
}

/**
 * ヘッドレス自動プレイバッチシミュレータ (SimulationRunner)
 * 指定されたトポロジー・難易度・Botプロファイルで自律高速プレイを実行し、
 * 統計KPIサマリーレポートを生成する。
 */
export class SimulationRunner {
  public static runBatch(config: SimulationConfig = {}): SimulationSummaryReport {
    const runs = config.runs ?? 10;
    const maxTurnsLimit = config.maxTurnsLimit ?? 3000;
    const topology = config.topology ?? 'STANDARD_ROOMS';
    const difficulty = config.difficulty ?? 'NORMAL';
    const pacing = config.pacing ?? 'STANDARD';
    const botProfile = config.botProfile ?? 'STANDARD';
    const baseSeed = config.baseSeed ?? 10000;

    const masterRng = new SeedRandom(baseSeed);
    const telemetry = new SimulationTelemetry(0, baseSeed);
    const runDetails: RunDiagnosticDetail[] = [];

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
        ruleMode: config.ruleMode,
      });

      const bot = new AutoPlayBot({
        profile: botProfile,
        maxTurnsLimit,
        strategyTuning: config.strategyTuning,
      });

      let turns = 0;
      let redundantFlashCount = 0;
      let crownPickupDropLoops = 0;
      let maxTurnsWithoutSubstantiveGain = 0;
      let lastFlashTurn = -100;
      let lastFlashPos: { x: number; y: number } | null = null;
      let lastCrownPickupTurn = -100;
      let lastCrownPickupDeliveryCount = 0;
      const milestoneTurns: RunDiagnosticDetail['milestoneTurns'] = {};

      while (turns < maxTurnsLimit && engine.getState() === 'PLAYING') {
        turns++;
        // リアルタイムタイマー更新（フレーム進行）
        engine.stepFrame(100);

        const prevPlayer = engine.getPlayer();
        const prevPos = { x: prevPlayer.pos.x, y: prevPlayer.pos.y };
        const prevHold = prevPlayer.holdItem;
        const prevCrowns = prevPlayer.crowns;
        const hadUnfrozenEnemy = engine.getEnemies().some(e => e.isAlive && !e.isPermanentlyFrozen && e.frozenTimer <= 0);

        // Bot による自律手番行動
        const action = bot.step(engine);

        const afterPlayer = engine.getPlayer();
        if (action.type === 'MAGIC' && action.magic === 'FLASH') {
          const samePosRecent =
            lastFlashPos !== null &&
            lastFlashPos.x === prevPos.x &&
            lastFlashPos.y === prevPos.y &&
            turns - lastFlashTurn <= 8;
          if (!hadUnfrozenEnemy || samePosRecent) {
            redundantFlashCount++;
          }
          lastFlashTurn = turns;
          lastFlashPos = { x: prevPos.x, y: prevPos.y };
        }
        if (prevHold !== 'CROWN' && afterPlayer.holdItem === 'CROWN') {
          lastCrownPickupTurn = turns;
          lastCrownPickupDeliveryCount = prevCrowns;
        } else if (
          prevHold === 'CROWN' &&
          afterPlayer.holdItem !== 'CROWN' &&
          afterPlayer.crowns === lastCrownPickupDeliveryCount &&
          turns - lastCrownPickupTurn <= 3
        ) {
          crownPickupDropLoops++;
        }

        // スナップショット記録
        const player = afterPlayer;
        telemetry.recordTurnSnapshot(turns, player.experience, player.strength, player.hasSword);
        if (player.hasSword && milestoneTurns.gotSword === undefined) milestoneTurns.gotSword = turns;
        if (player.experience >= 4000 && milestoneTurns.unlockedBreak === undefined) milestoneTurns.unlockedBreak = turns;
        if (player.experience >= 12000 && milestoneTurns.unlockedDiagonal === undefined) milestoneTurns.unlockedDiagonal = turns;
        if (bot.params && player.strength >= bot.params.targetStr && milestoneTurns.reachedTargetStr === undefined) {
          milestoneTurns.reachedTargetStr = turns;
        }
        const d = engine.getDragon();
        if (d) {
          if (d.defeatedHeadsCount >= 1 && milestoneTurns.killedHead1 === undefined) milestoneTurns.killedHead1 = turns;
          if ((d.isAllHeadsDefeated || d.defeatedHeadsCount >= 3) && milestoneTurns.killedAllHeads === undefined) {
            milestoneTurns.killedAllHeads = turns;
          }
        }
        if (player.crowns >= 1 && milestoneTurns.deliveredFirstCrown === undefined) {
          milestoneTurns.deliveredFirstCrown = turns;
        }
        const curNoGain = bot.episodicMemory.buildProgressWindow(bot.totalTurns, engine.getMap()).turnsSinceSubstantiveGain;
        if (curNoGain > maxTurnsWithoutSubstantiveGain) {
          maxTurnsWithoutSubstantiveGain = curNoGain;
        }

        // Botが物理的詰みまたは停滞限界を検知してGiveUPした場合は即座に終了
        if ('isGivenUp' in bot && bot.isGivenUp) {
          if (!player.deathInfo) {
            const diag = bot.getDiagnosticSnapshot();
            player.deathInfo = {
              cause: 'GIVE_UP_UNSOLVABLE',
              message: '💀 詰み検知: 進行経路または打開手段が存在しないためギブアップ',
              damage: 0,
              turn: turns,
              giveUpCategory: 'OTHER',
              finalMissionId: diag.finalMissionId,
              finalMissionName: diag.finalMissionName,
              commanderLevel: diag.commanderLevel,
              commanderTransitions: diag.commanderTransitions,
            };
          }
          break;
        }
      }

      const won = engine.getState() === 'STAGECLEAR';
      const player = engine.getPlayer();

      // PST 3層アーキテクチャテレメトリ情報の収集
      let pstMetrics: any = undefined;
      {
        const missionTurns: Record<string, number> = {};
        const missionOutcomes: Record<string, { completed: number; aborted: number; failed: number }> = {};
        const missionCompletionReasons: Record<string, Record<string, number>> = {};
        let objectiveAchievedCount = 0;
        let noProgressSwitchCount = 0;

        for (const h of bot.strategicPlanner.missionHistory) {
          missionTurns[h.missionId] = (missionTurns[h.missionId] || 0) + h.turns;
          if (!missionOutcomes[h.missionId]) {
            missionOutcomes[h.missionId] = { completed: 0, aborted: 0, failed: 0 };
          }
          if (h.status === 'COMPLETED') missionOutcomes[h.missionId].completed++;
          else if (h.status === 'ABORTED') missionOutcomes[h.missionId].aborted++;
          else if (h.status === 'FAILED') missionOutcomes[h.missionId].failed++;

          const reasonKey = h.reason ?? (h.status === 'COMPLETED' ? 'OBJECTIVE_ACHIEVED' : 'UNKNOWN');
          if (!missionCompletionReasons[h.missionId]) {
            missionCompletionReasons[h.missionId] = {};
          }
          missionCompletionReasons[h.missionId][reasonKey] =
            (missionCompletionReasons[h.missionId][reasonKey] || 0) + 1;

          if (reasonKey === 'OBJECTIVE_ACHIEVED') {
            objectiveAchievedCount++;
          } else if (reasonKey === 'NO_PROGRESS_TIMEOUT' || reasonKey === 'NO_PROGRESS_BLOCKED') {
            noProgressSwitchCount++;
          }
        }

        // 現在実行中だったアクティブミッションのターンも加算
        const active = bot.strategicPlanner.activeMission;
        if (active) {
          missionTurns[active.id] = (missionTurns[active.id] || 0) + active.turnsElapsed;
        }

        const totalMissionSwitches = bot.strategicPlanner.missionHistory.length;
        const objectiveAchievedRate = totalMissionSwitches > 0
          ? Math.round((objectiveAchievedCount / totalMissionSwitches) * 1000) / 1000
          : 0;
        const breachShortcutsUsed = bot.spatialKnowledge?.breachShortcuts.filter(s => s.isBreached).length ?? 0;
        const terminalMissionId = active?.id ?? 'NONE';
        const terminalZoneId = active && 'zoneId' in active ? (active as any).zoneId : undefined;
        const commanderLevelCounts: Record<string, number> = {};
        for (const v of bot.commander.verdicts) {
          commanderLevelCounts[v.to] = (commanderLevelCounts[v.to] || 0) + 1;
        }
        const giveUpSource = bot.isGivenUp
          ? (bot.commander.level === 'TERMINAL' ? 'COMMANDER_TERMINAL' : 'OTHER')
          : undefined;

        pstMetrics = {
          missionTurns,
          missionOutcomes,
          missionCompletionReasons,
          objectiveAchievedRate,
          totalMissionSwitches,
          noProgressSwitchCount,
          redundantFlashCount,
          crownPickupDropLoops,
          breachShortcutsUsed,
          terminalMissionId,
          terminalZoneId,
          maxTurnsWithoutSubstantiveGain,
          commanderLevelCounts,
          commanderFinalLevel: bot.commander.level,
          recentVerdicts: bot.commander.verdicts.slice(-6).map(v => ({
            turn: v.turn,
            from: v.from,
            to: v.to,
            stallKind: v.stallKind,
            reason: v.reason,
          })),
          giveUpSource,
        };
      }

      telemetry.finalizeCurrentRun(turns, won, player.deathInfo ?? undefined, pstMetrics, milestoneTurns);

      if (config.includeRunDetails) {
        const deathCause = won
          ? undefined
          : (player.deathInfo?.cause ?? (turns >= maxTurnsLimit ? 'TIMEOUT_STALL' : 'UNKNOWN'));
        const gm = bot.context?.metrics;
        const rc = bot.context?.resourceCounts;
        const bp = bot.params;
        runDetails.push({
          runIndex: r,
          seed: runSeed,
          won,
          totalTurns: turns,
          deathCause,
          mapMetrics: gm
            ? {
                opennessScore: gm.opennessScore,
                mazeIndex: gm.mazeIndex,
                roomCount: gm.roomCount,
                swordWalkDistance: gm.swordWalkDistance,
                nearHomeGraves: gm.nearHomeGraves,
                sectorPartitionScore: gm.sectorPartitionScore,
                lairEntranceCount: gm.lairAccessibility.entranceCount,
                lairSafeSpacesCount: gm.lairAccessibility.safeSpacesCount,
              }
            : undefined,
          resourceCounts: rc ? { ...rc } : undefined,
          resolvedParamsSummary: bp
            ? {
                crownReserveMagic: bp.readiness?.crownReserveMagic ?? 0,
                prepBypassTurnsNoChest: bp.readiness?.prepBypassTurnsNoChest ?? 0,
                prepBypassTurnsWithChest: bp.readiness?.prepBypassTurnsWithChest ?? 0,
                defaultGraceTurns: bp.commander?.defaultGraceTurns ?? 0,
                huntDistNoDiag: bp.hunting?.huntDistNoDiag ?? 0,
                huntDistDiag: bp.hunting?.huntDistDiag ?? 0,
              }
            : undefined,
          milestoneTurns,
          missionTurns: pstMetrics.missionTurns,
          terminalMissionId: pstMetrics.terminalMissionId,
          maxTurnsWithoutSubstantiveGain,
          commanderVerdictsCount: bot.commander.verdicts.length,
          commanderFinalLevel: bot.commander.level,
          verdictsSummary: bot.commander.verdicts.slice(-12).map(v => ({
            turn: v.turn,
            from: v.from,
            to: v.to,
            stallKind: v.stallKind,
          })),
        });
      }
    }

    const summary = this.generateSummaryReport(telemetry, {
      runs,
      maxTurnsLimit,
      topology,
      difficulty,
      pacing,
      botProfile,
    });
    if (config.includeRunDetails) {
      summary.runDetails = runDetails;
    }
    return summary;
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
    const giveUpBreakdown = {
      swordTrapped: 0,
      confined: 0,
      churn: 0,
      loop: 0,
      fruitless: 0,
      other: 0,
    };
    const giveUpTurns: number[] = [];
    const failedRunSamples: FailedRunSample[] = [];

    for (const r of records) {
      if (!r.won) {
        const cause = r.deathInfo?.cause ?? (r.totalTurns >= config.maxTurnsLimit ? 'TIMEOUT_STALL' : 'UNKNOWN');
        deathCauses[cause] = (deathCauses[cause] || 0) + 1;

        if (cause.startsWith('GIVE_UP')) {
          giveUpTurns.push(r.totalTurns);
          if (cause === 'GIVE_UP_SWORD_TRAPPED') giveUpBreakdown.swordTrapped++;
          else if (cause === 'GIVE_UP_CONFINED') giveUpBreakdown.confined++;
          else if (cause === 'GIVE_UP_STALL_CHURN') giveUpBreakdown.churn++;
          else if (cause === 'GIVE_UP_STALL_LOOP') giveUpBreakdown.loop++;
          else if (cause === 'GIVE_UP_STALL_FRUITLESS') giveUpBreakdown.fruitless++;
          else giveUpBreakdown.other++;
        }

        if (failedRunSamples.length < 10) {
          const verdicts =
            r.deathInfo?.commanderTransitions ??
            r.pstMetrics?.recentVerdicts ??
            [];
          failedRunSamples.push({
            runIndex: r.runIndex,
            seed: r.seed,
            totalTurns: r.totalTurns,
            cause,
            giveUpCategory: r.deathInfo?.giveUpCategory,
            stallKind: r.deathInfo?.stallKind,
            finalMissionId: r.deathInfo?.finalMissionId ?? r.pstMetrics?.terminalMissionId,
            commanderLevel: r.deathInfo?.commanderLevel ?? r.pstMetrics?.commanderFinalLevel,
            recentVerdicts: verdicts.slice(-4).map(v => ({
              turn: v.turn,
              from: v.from,
              to: v.to,
              stallKind: v.stallKind,
            })),
          });
        }
      }
    }

    const earlyGiveUpStats = {
      under1000TurnsCount: giveUpTurns.filter(t => t < 1000).length,
      minGiveUpTurn: giveUpTurns.length > 0 ? Math.min(...giveUpTurns) : null,
      avgGiveUpTurn: giveUpTurns.length > 0
        ? Math.round(giveUpTurns.reduce((a, b) => a + b, 0) / giveUpTurns.length)
        : null,
    };

    const calcMilestoneStat = (
      selector: (r: (typeof records)[number]) => number | undefined
    ): MilestoneTurnStat => {
      const vals = records
        .map(selector)
        .filter((v): v is number => v !== undefined)
        .sort((a, b) => a - b);
      if (vals.length === 0) return { count: 0, avg: 0, median: 0 };
      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      const median = vals[Math.floor(vals.length / 2)];
      return { count: vals.length, avg, median };
    };

    const milestoneTurnStats = {
      gotSword: calcMilestoneStat(r => r.milestoneTurns?.gotSword),
      unlockedBreak: calcMilestoneStat(r => r.milestoneTurns?.unlockedBreak),
      unlockedDiagonal: calcMilestoneStat(r => r.milestoneTurns?.unlockedDiagonal),
      reachedTargetStr: calcMilestoneStat(r => r.milestoneTurns?.reachedTargetStr),
      killedHead1: calcMilestoneStat(r => r.milestoneTurns?.killedHead1),
      killedAllHeads: calcMilestoneStat(r => r.milestoneTurns?.killedAllHeads),
      deliveredFirstCrown: calcMilestoneStat(r => r.milestoneTurns?.deliveredFirstCrown),
    };

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

    // PST 3層アーキテクチャ & 構造テレメトリ集計
    let pstSummary: any = undefined;
    const pstRecords = records.map(r => r.pstMetrics).filter((m): m is NonNullable<typeof m> => !!m);
    if (pstRecords.length > 0) {
      const avgMissionTurns: Record<string, number> = {};
      const outcomeAgg: Record<string, { total: number; completed: number }> = {};
      const missionCompletionReasons: Record<string, Record<string, number>> = {};
      const terminalBreakdown: Record<string, number> = {};
      let totalShortcuts = 0;
      let sumObjectiveRate = 0;
      let sumMissionSwitches = 0;
      let sumNoProgressSwitches = 0;
      let sumRedundantFlash = 0;
      let sumCrownLoops = 0;
      let sumMaxNoGain = 0;
      const totalCommanderLevelCounts: Record<string, number> = {};
      const giveUpSources: Record<string, number> = {};

      for (const m of pstRecords) {
        totalShortcuts += m.breachShortcutsUsed;
        sumObjectiveRate += m.objectiveAchievedRate ?? 0;
        sumMissionSwitches += m.totalMissionSwitches ?? 0;
        sumNoProgressSwitches += m.noProgressSwitchCount ?? 0;
        sumRedundantFlash += m.redundantFlashCount ?? 0;
        sumCrownLoops += m.crownPickupDropLoops ?? 0;
        sumMaxNoGain += m.maxTurnsWithoutSubstantiveGain ?? 0;
        if (m.commanderLevelCounts) {
          for (const [lvl, cnt] of Object.entries(m.commanderLevelCounts)) {
            totalCommanderLevelCounts[lvl] = (totalCommanderLevelCounts[lvl] || 0) + (cnt as number);
          }
        }
        if (m.giveUpSource) {
          giveUpSources[m.giveUpSource] = (giveUpSources[m.giveUpSource] || 0) + 1;
        }

        if (m.terminalMissionId) {
          const key = m.terminalZoneId ? `${m.terminalMissionId} [Zone:${m.terminalZoneId}]` : m.terminalMissionId;
          terminalBreakdown[key] = (terminalBreakdown[key] || 0) + 1;
        }

        for (const [mid, turns] of Object.entries(m.missionTurns)) {
          avgMissionTurns[mid] = (avgMissionTurns[mid] || 0) + turns;
        }

        for (const [mid, out] of Object.entries(m.missionOutcomes)) {
          if (!outcomeAgg[mid]) outcomeAgg[mid] = { total: 0, completed: 0 };
          const tries = out.completed + out.aborted + out.failed;
          outcomeAgg[mid].total += tries;
          outcomeAgg[mid].completed += out.completed;
        }

        if (m.missionCompletionReasons) {
          for (const [mid, reasons] of Object.entries(m.missionCompletionReasons)) {
            if (!missionCompletionReasons[mid]) missionCompletionReasons[mid] = {};
            for (const [reason, count] of Object.entries(reasons)) {
              missionCompletionReasons[mid][reason] = (missionCompletionReasons[mid][reason] || 0) + count;
            }
          }
        }
      }

      for (const mid of Object.keys(avgMissionTurns)) {
        avgMissionTurns[mid] = Math.round(avgMissionTurns[mid] / pstRecords.length);
      }

      const missionCompletionRates: Record<string, { total: number; completed: number; rate: number }> = {};
      for (const [mid, data] of Object.entries(outcomeAgg)) {
        missionCompletionRates[mid] = {
          total: data.total,
          completed: data.completed,
          rate: data.total > 0 ? Math.round((data.completed / data.total) * 100) / 100 : 0,
        };
      }

      const killedAllRuns = records.filter(r => r.reachedMilestones.killedAllHeads || r.won);
      const crownEscapeSuccessRate = killedAllRuns.length > 0
        ? Math.round((killedAllRuns.filter(r => r.won).length / killedAllRuns.length) * 1000) / 1000
        : 0;

      pstSummary = {
        avgMissionTurns,
        missionCompletionRates,
        missionCompletionReasons,
        avgObjectiveAchievedRate: Math.round((sumObjectiveRate / pstRecords.length) * 1000) / 1000,
        avgMissionSwitches: Math.round((sumMissionSwitches / pstRecords.length) * 10) / 10,
        avgNoProgressSwitches: Math.round((sumNoProgressSwitches / pstRecords.length) * 10) / 10,
        avgRedundantFlashCount: Math.round((sumRedundantFlash / pstRecords.length) * 10) / 10,
        avgCrownPickupDropLoops: Math.round((sumCrownLoops / pstRecords.length) * 10) / 10,
        crownEscapeSuccessRate,
        avgBreachShortcutsUsed: Math.round((totalShortcuts / pstRecords.length) * 10) / 10,
        terminalMissionBreakdown: terminalBreakdown,
        avgMaxTurnsWithoutSubstantiveGain: Math.round(sumMaxNoGain / pstRecords.length),
        commanderLevelCounts: totalCommanderLevelCounts,
        giveUpSources,
      };
    }

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
        giveUpBreakdown,
        earlyGiveUpStats,
        milestoneTurnStats,
        failedRunSamples,
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
      pstMetrics: pstSummary,
    };
  }
}
