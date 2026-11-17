import { CommanderConfig } from '../../BotTypes.js';
import { ProgressWindow } from '../../perception/ProgressLedger.js';
import { ConfinementState } from '../../perception/SituationalPerception.js';
import { MissionReport, ProgressAudit, StallKind } from './CommanderTypes.js';

/**
 * ProgressAuditor (戦果監査ユニット - 純粋関数)
 *
 * 認知層の ProgressWindow と ConfinementState、戦略層の MissionReport だけを入力として、
 * 現在の停滞種別（LOOP / CHURN / FRUITLESS / CONFINED）を客観的に判定する。
 */
export class ProgressAuditor {
  public static audit(
    turn: number,
    progress: ProgressWindow,
    confinement: ConfinementState,
    report: MissionReport,
    config: CommanderConfig,
    graceMultiplier: number = 1
  ): ProgressAudit {
    const baseGrace = report.activeAuditProfile?.graceTurns ?? config.defaultGraceTurns;
    const grace = baseGrace * graceMultiplier;
    const uniqueTileRatio =
      progress.windowSize > 0 ? progress.uniqueTilesInWindow / progress.windowSize : 1;

    // 1. CHURN 判定: 直近 churnWindowTurns 内にミッションが頻繁に切り替わり、同じIDが反復
    const windowStart = Math.max(0, turn - config.churnWindowTurns + 1);
    const recentSwitches = report.recentHistory.filter(h => h.endTurn >= windowStart);
    const idCounts = new Map<string, number>();
    for (const h of recentSwitches) {
      idCounts.set(h.missionId, (idCounts.get(h.missionId) ?? 0) + 1);
    }
    const recurringMissionIds: string[] = [];
    for (const [id, count] of idCounts.entries()) {
      if (count >= 2) {
        recurringMissionIds.push(id);
      }
    }

    const isConfinedTerminal = confinement.kind !== 'NONE' && confinement.escapeMeans.length === 0;
    const isLoop =
      progress.turnsSinceSubstantiveGain >= grace &&
      progress.turnsSinceNewTile >= config.loopNewTileTurns &&
      (progress.cycle !== null || uniqueTileRatio <= config.loopUniqueRatio);

    const isChurn =
      recentSwitches.length >= config.churnSwitchCount &&
      recurringMissionIds.length >= 1 &&
      progress.turnsSinceSubstantiveGain >= grace;

    const isFruitless = progress.turnsSinceSubstantiveGain >= grace * 2;

    let stallKind: StallKind | null = null;
    if (isConfinedTerminal) {
      stallKind = 'CONFINED';
    } else if (isLoop) {
      stallKind = 'LOOP';
    } else if (isChurn) {
      stallKind = 'CHURN';
    } else if (isFruitless) {
      stallKind = 'FRUITLESS';
    }

    return {
      turn,
      stallKind,
      turnsSinceSubstantiveGain: progress.turnsSinceSubstantiveGain,
      turnsSinceNewTile: progress.turnsSinceNewTile,
      uniqueTileRatio,
      cyclePeriod: progress.cycle?.period ?? null,
      missionSwitchesInWindow: recentSwitches.length,
      recurringMissionIds,
    };
  }
}
