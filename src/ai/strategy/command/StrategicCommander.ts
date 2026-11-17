import { GameEngine } from '../../../core/GameEngine.js';
import { Position } from '../../../models/Types.js';
import { MagicSystem } from '../../../systems/MagicSystem.js';
import { CommanderConfig } from '../../BotTypes.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import {
  CommanderOrders,
  CommanderVerdict,
  DEFAULT_COMMANDER_CONFIG,
  EscalationLevel,
  ForcedMissionOrder,
  MissionReport,
  PhaseWaiver,
  ProgressAudit,
} from './CommanderTypes.js';
import { ProgressAuditor } from './ProgressAuditor.js';

const ESCALATION_ORDER: readonly EscalationLevel[] = [
  'NOMINAL',
  'RETARGET',
  'MISSION_TABOO',
  'FRONTIER_EXPEDITION',
  'BREACH',
  'RELOCATE',
  'PHASE_WAIVER',
  'TERMINAL',
];

const PROBATION_TURNS: Record<EscalationLevel, number> = {
  NOMINAL: 0,
  RETARGET: 14,
  MISSION_TABOO: 18,
  FRONTIER_EXPEDITION: 24,
  BREACH: 12,
  RELOCATE: 14,
  PHASE_WAIVER: 20,
  TERMINAL: 0,
};

const WAIVER_PRIORITY: readonly PhaseWaiver[] = [
  'DEFENSE_EXP',
  'HP_FULL',
  'RELOCATION',
  'MAGIC_STOCK',
];

/**
 * StrategicCommander (上位指揮官 / 作戦監察ユニット)
 *
 * 戦術層・ミッション内部の局所最適に介入せず、時間経過と戦果（ProgressWindow）だけを監査し、
 * 停滞（LOOP / CHURN / FRUITLESS / CONFINED）を検知した際に段階的打開命令（L1〜L7）を発行する。
 */
export class StrategicCommander {
  public level: EscalationLevel = 'NOMINAL';
  public readonly verdicts: CommanderVerdict[] = [];

  private levelEnteredTurn: number = 0;
  private suspectTurns: number = 0;
  private confinedTurns: number = 0;
  private lastRecoveryTurn: number = -999;
  private lastRecoveredLevelIdx: number = 0;
  private graceMultiplier: number = 1;

  private tabooMissions: Map<string, number> = new Map();
  private tabooTargets: { pos: Position; untilTurn: number }[] = [];
  private tabooZones: { zoneId: string; untilTurn: number }[] = [];
  private waivers: Set<PhaseWaiver> = new Set();
  private currentForcedMission: ForcedMissionOrder | null = null;

  public review(
    snapshot: TacticalSnapshot,
    report: MissionReport,
    engine?: GameEngine
  ): CommanderOrders {
    const turn = snapshot.totalTurns;
    const config: CommanderConfig = {
      ...DEFAULT_COMMANDER_CONFIG,
      ...(snapshot.params as { commander?: Partial<CommanderConfig> }).commander,
    };

    this.purgeExpiredTaboos(turn);

    const audit = ProgressAuditor.audit(
      turn,
      snapshot.progress,
      snapshot.confinement,
      report,
      config,
      this.graceMultiplier
    );

    // 0. 序盤の剣到達不能（物理的詰み）または四方閉塞で脱出手段皆無 -> 即時または連続確認後に TERMINAL
    const situation = MapSituationEvaluator.get(snapshot, engine);
    const isEarlySwordTrapped = !snapshot.player.hasSword && situation.items.isEarlySwordTrapped;
    if (audit.stallKind === 'CONFINED') {
      this.confinedTurns++;
    } else {
      this.confinedTurns = 0;
    }
    const isConfirmedConfined =
      audit.stallKind === 'CONFINED' &&
      (snapshot.confinement.isStaticallySealed || this.confinedTurns >= 6);

    if (isConfirmedConfined || isEarlySwordTrapped) {
      if (this.level !== 'TERMINAL') {
        const reason = isEarlySwordTrapped
          ? '💀 剣への到達経路が完全に遮断されているため続行不能'
          : `💀 四方閉塞・小閉域に拘束され脱出手段なし (safeTiles=${snapshot.confinement.reachableSafeTiles})`;
        this.transitionTo('TERMINAL', turn, audit.stallKind ?? 'CONFINED', reason);
        return this.buildOrders(audit, snapshot, reason);
      }
      return this.buildOrders(audit, snapshot, '💀 物理的詰みにより終了判定');
    }

    // 1. L1〜L6 滞在中: 回復判定（ヒステリシス解除条件）
    if (this.level !== 'NOMINAL' && this.level !== 'TERMINAL') {
      const recoveredByGain = snapshot.progress.turnsSinceSubstantiveGain === 0;
      const recoveredByExplore =
        snapshot.progress.newTilesSince(Math.max(0, turn - 15)) >= config.recoveryNewTiles16;

      if (recoveredByGain || recoveredByExplore) {
        const prevIdx = ESCALATION_ORDER.indexOf(this.level);
        this.lastRecoveryTurn = turn;
        this.lastRecoveredLevelIdx = prevIdx;
        this.suspectTurns = 0;
        this.graceMultiplier = 1;
        this.waivers.clear();
        this.currentForcedMission = null;
        this.transitionTo(
          'NOMINAL',
          turn,
          audit.stallKind,
          recoveredByGain ? '実質戦果を確認したため通常監察へ復帰' : '新規領域を十分開拓したため通常監察へ復帰'
        );
        return this.buildOrders(audit, snapshot);
      }
    }

    // 2. L0 (NOMINAL): 停滞確定までのデバウンス監視
    if (this.level === 'NOMINAL') {
      if (audit.stallKind !== null) {
        this.suspectTurns++;
        if (this.suspectTurns >= config.debounceTurns) {
          this.suspectTurns = 0;
          const hasMemory =
            this.lastRecoveryTurn >= 0 && turn - this.lastRecoveryTurn <= config.memoryTurns;
          const startIdx = hasMemory && this.lastRecoveredLevelIdx >= 2 ? this.lastRecoveredLevelIdx - 1 : 1;
          this.escalateFromIndex(startIdx, snapshot, report, audit, config, engine);
        }
      } else {
        this.suspectTurns = 0;
      }
      return this.buildOrders(audit, snapshot);
    }

    // 3. L1〜L6 滞在中: 観察期間満了による次段階へのエスカレーション
    if (this.level !== 'TERMINAL') {
      const curIdx = ESCALATION_ORDER.indexOf(this.level);
      const probation = PROBATION_TURNS[this.level];
      const forcedDone = this.isForcedMissionNoLongerActive(report);
      if (turn - this.levelEnteredTurn >= probation || forcedDone) {
        this.escalateFromIndex(curIdx + 1, snapshot, report, audit, config, engine);
      }
    }

    // 4. L7 (TERMINAL) で enableGiveUp === false の場合はリセットして粘り強く継続
    if (this.level === 'TERMINAL' && snapshot.params.enableGiveUp === false) {
      this.tabooMissions.clear();
      this.tabooTargets = [];
      this.tabooZones = [];
      this.waivers.clear();
      this.currentForcedMission = null;
      this.graceMultiplier = Math.min(4, this.graceMultiplier * 2);
      this.transitionTo('RETARGET', turn, audit.stallKind, 'enableGiveUp=false のため猶予を倍増して再挑戦');
      this.tryApplyLevel('RETARGET', snapshot, report, audit, config, engine);
    }

    return this.buildOrders(audit, snapshot);
  }

  private isForcedMissionNoLongerActive(report: MissionReport): boolean {
    if (!this.currentForcedMission) return false;
    if (this.currentForcedMission.kind === 'EXPLORE_FRONTIER') {
      return report.activeMissionId !== 'EXPLORE_FRONTIER';
    }
    return report.activeMissionId !== 'STRATEGIC_BREAK';
  }

  private escalateFromIndex(
    startIdx: number,
    snapshot: TacticalSnapshot,
    report: MissionReport,
    audit: ProgressAudit,
    config: CommanderConfig,
    engine?: GameEngine
  ): void {
    const maxLevel = report.activeAuditProfile?.maxEscalation ?? 'TERMINAL';
    const maxIdx = ESCALATION_ORDER.indexOf(maxLevel);

    for (let idx = startIdx; idx < ESCALATION_ORDER.length; idx++) {
      const candidate = ESCALATION_ORDER[idx];
      if (idx > maxIdx && candidate !== 'TERMINAL') {
        continue;
      }
      if (candidate === 'TERMINAL') {
        if (maxLevel !== 'TERMINAL') {
          this.currentForcedMission = null;
          this.transitionTo(
            'NOMINAL',
            snapshot.totalTurns,
            audit.stallKind,
            `${report.activeMissionId ?? 'MISSION'} は終端ギブアップ対象外のため通常監察へリセット`
          );
          return;
        }
        this.currentForcedMission = null;
        this.transitionTo(
          'TERMINAL',
          snapshot.totalTurns,
          audit.stallKind,
          `全打開段階が奏功せず終端判定 (${audit.stallKind ?? 'STALL'})`
        );
        return;
      }
      if (this.tryApplyLevel(candidate, snapshot, report, audit, config, engine)) {
        this.transitionTo(
          candidate,
          snapshot.totalTurns,
          audit.stallKind,
          `段階 ${candidate} へ引き上げ (${audit.stallKind ?? 'STALL'})`
        );
        return;
      }
    }
  }

  private tryApplyLevel(
    candidate: EscalationLevel,
    snapshot: TacticalSnapshot,
    report: MissionReport,
    audit: ProgressAudit,
    config: CommanderConfig,
    engine?: GameEngine
  ): boolean {
    const turn = snapshot.totalTurns;
    this.currentForcedMission = null;

    switch (candidate) {
      case 'RETARGET': {
        let applied = false;
        if (report.activeTarget) {
          this.tabooTargets.push({ pos: { ...report.activeTarget }, untilTurn: turn + config.retargetTabooTurns });
          applied = true;
        }
        if (report.activeZoneId && report.activeZoneId !== 'GLOBAL_ALL') {
          this.tabooZones.push({ zoneId: report.activeZoneId, untilTurn: turn + config.retargetTabooTurns });
          applied = true;
        }
        return applied;
      }

      case 'MISSION_TABOO': {
        let applied = false;
        if (audit.stallKind === 'CHURN' && audit.recurringMissionIds.length > 0) {
          for (const id of audit.recurringMissionIds) {
            if (id !== 'EMERGENCY_EVACUATE' && id !== 'CROWN_ESCAPE') {
              this.tabooMissions.set(id, turn + config.missionTabooTurns);
              applied = true;
            }
          }
        }
        if (report.activeMissionId && (report.activeAuditProfile?.tabooable ?? true)) {
          this.tabooMissions.set(report.activeMissionId, turn + config.missionTabooTurns);
          applied = true;
        }
        return applied;
      }

      case 'FRONTIER_EXPEDITION': {
        const situation = MapSituationEvaluator.get(snapshot, engine);
        const candidates = situation.exploration.frontierTargets.filter(
          p => !this.tabooTargets.some(t => t.pos.x === p.x && t.pos.y === p.y)
        );
        if (candidates.length === 0) return false;
        this.currentForcedMission = { kind: 'EXPLORE_FRONTIER', target: { ...candidates[0] } };
        return true;
      }

      case 'BREACH': {
        if (!snapshot.milestones.canBreak) return false;
        const target = this.findBreachTarget(snapshot, engine);
        if (!target) return false;
        this.currentForcedMission = { kind: 'STRATEGIC_BREAK', mode: 'BREACH', target };
        return true;
      }

      case 'RELOCATE': {
        if (snapshot.player.holdItem === 'CROWN') return false;
        const player = engine?.getPlayer();
        const canReturn = player
          ? MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying
          : !snapshot.player.hasDeath && snapshot.player.magic >= 1 && !snapshot.player.isFlying;
        const canJump = player
          ? MagicSystem.canCast(player, 'JUMP').allowed
          : !snapshot.player.hasDeath && snapshot.player.magic >= 1 && snapshot.player.experience >= 2000;
        if (canReturn) {
          this.currentForcedMission = { kind: 'STRATEGIC_BREAK', mode: 'RETURN' };
          return true;
        }
        if (canJump) {
          this.currentForcedMission = { kind: 'STRATEGIC_BREAK', mode: 'JUMP' };
          return true;
        }
        return false;
      }

      case 'PHASE_WAIVER': {
        if (!snapshot.player.hasSword || snapshot.player.strength < snapshot.params.targetStr) {
          return false;
        }
        for (const w of WAIVER_PRIORITY) {
          if (!this.waivers.has(w)) {
            this.waivers.add(w);
            return true;
          }
        }
        return false;
      }

      default:
        return false;
    }
  }

  private findBreachTarget(snapshot: TacticalSnapshot, engine?: GameEngine): Position | null {
    if (engine) {
      const shortcuts = snapshot.spatial.getViableBreachShortcuts(
        engine.getPlayer(),
        snapshot.map
      );
      for (const sc of shortcuts) {
        const bp = sc.pos;
        if (
          snapshot.map.getObject(bp) === 'BLOCK' &&
          !this.tabooTargets.some(t => t.pos.x === bp.x && t.pos.y === bp.y)
        ) {
          return { ...bp };
        }
      }
    }

    const situation = MapSituationEvaluator.get(snapshot, engine);
    if (situation.homeReachability.firstBlockingBlockPos) {
      const bp = situation.homeReachability.firstBlockingBlockPos;
      if (!this.tabooTargets.some(t => t.pos.x === bp.x && t.pos.y === bp.y)) {
        return { ...bp };
      }
    }
    if (situation.surroundings.adjacentBlocks.length > 0) {
      for (const b of situation.surroundings.adjacentBlocks) {
        if (!this.tabooTargets.some(t => t.pos.x === b.pos.x && t.pos.y === b.pos.y)) {
          return { ...b.pos };
        }
      }
    }

    const nearest = situation.exploration.nearestBreakableBlock;
    if (nearest && !this.tabooTargets.some(t => t.pos.x === nearest.x && t.pos.y === nearest.y)) {
      return { ...nearest };
    }
    return null;
  }

  private purgeExpiredTaboos(turn: number): void {
    for (const [id, until] of this.tabooMissions.entries()) {
      if (turn >= until) this.tabooMissions.delete(id);
    }
    this.tabooTargets = this.tabooTargets.filter(t => turn < t.untilTurn);
    this.tabooZones = this.tabooZones.filter(z => turn < z.untilTurn);
  }

  private transitionTo(
    to: EscalationLevel,
    turn: number,
    stallKind: ProgressAudit['stallKind'],
    reason: string
  ): void {
    const from = this.level;
    if (from === to) return;
    this.level = to;
    this.levelEnteredTurn = turn;
    this.verdicts.push({ turn, from, to, stallKind, reason });
    if (this.verdicts.length > 64) {
      this.verdicts.shift();
    }
  }

  private buildOrders(
    audit: ProgressAudit,
    snapshot: TacticalSnapshot,
    terminalReason?: string
  ): CommanderOrders {
    const giveUp =
      this.level === 'TERMINAL' && snapshot.params.enableGiveUp !== false
        ? {
            reason:
              terminalReason ??
              `💀 停滞打開不能 (${audit.stallKind ?? 'STALL'}): 無戦果 ${audit.turnsSinceSubstantiveGain}T`,
          }
        : null;

    return {
      level: this.level,
      audit,
      tabooMissions: new Map(this.tabooMissions),
      tabooTargets: this.tabooTargets.map(t => ({ pos: { ...t.pos }, untilTurn: t.untilTurn })),
      tabooZones: this.tabooZones.map(z => ({ ...z })),
      forcedMission: this.currentForcedMission ? { ...this.currentForcedMission } : null,
      waivers: new Set(this.waivers),
      giveUp,
    };
  }
}
