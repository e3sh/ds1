import { Position } from '../../../models/Types.js';
import { CommanderConfig, CommanderEscalationLevel } from '../../BotTypes.js';
import type { MissionAuditProfile, MissionCompletionReason, MissionStatus } from '../StrategicMission.js';

export type EscalationLevel = CommanderEscalationLevel;

export type StallKind = 'LOOP' | 'CHURN' | 'FRUITLESS' | 'CONFINED';

export type PhaseWaiver = 'DEFENSE_EXP' | 'MAGIC_STOCK' | 'RELOCATION' | 'HP_FULL';

export type ForcedMissionOrder =
  | { kind: 'EXPLORE_FRONTIER'; target: Position }
  | { kind: 'STRATEGIC_BREAK'; mode: 'BREACH'; target: Position }
  | { kind: 'STRATEGIC_BREAK'; mode: 'RETURN' | 'JUMP' };

export interface ProgressAudit {
  turn: number;
  stallKind: StallKind | null;
  turnsSinceSubstantiveGain: number;
  turnsSinceNewTile: number;
  uniqueTileRatio: number;
  cyclePeriod: number | null;
  missionSwitchesInWindow: number;
  recurringMissionIds: string[];
}

export interface CommanderOrders {
  level: EscalationLevel;
  audit: ProgressAudit;
  tabooMissions: ReadonlyMap<string, number>;
  tabooTargets: readonly { pos: Position; untilTurn: number }[];
  tabooZones: readonly { zoneId: string; untilTurn: number }[];
  forcedMission: ForcedMissionOrder | null;
  waivers: ReadonlySet<PhaseWaiver>;
  giveUp: {
    reason: string;
    category: 'PHYSICAL_TRAP' | 'AI_STALL';
    stallKind: StallKind | 'SWORD_TRAPPED';
  } | null;
}

export interface CommanderVerdict {
  turn: number;
  from: EscalationLevel;
  to: EscalationLevel;
  stallKind: StallKind | null;
  reason: string;
}

export interface MissionHistoryEntry {
  missionId: string;
  status: MissionStatus;
  reason?: MissionCompletionReason;
  turns: number;
  startTurn: number;
  endTurn: number;
  substantiveGains: number;
}

export interface MissionReport {
  activeMissionId: string | null;
  activeAuditProfile: MissionAuditProfile | null;
  activeTarget: Position | null;
  activeZoneId: string | null;
  recentHistory: readonly MissionHistoryEntry[];
}

export const DEFAULT_COMMANDER_CONFIG: CommanderConfig = {
  windowSize: 48,
  defaultGraceTurns: 32,
  loopNewTileTurns: 32,
  loopUniqueRatio: 0.5,
  churnWindowTurns: 64,
  churnSwitchCount: 4,
  debounceTurns: 8,
  memoryTurns: 64,
  recoveryNewTiles16: 8,
  retargetTabooTurns: 30,
  missionTabooTurns: 60,
  confinedConfirmTurns: 6,
  probationTurns: {
    NOMINAL: 0,
    RETARGET: 14,
    MISSION_TABOO: 18,
    FRONTIER_EXPEDITION: 24,
    BREACH: 12,
    RELOCATE: 14,
    PHASE_WAIVER: 20,
    TERMINAL: 0,
  },
};
