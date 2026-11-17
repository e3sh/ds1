import { Position } from '../../../models/Types.js';
import { CommanderConfig } from '../../BotTypes.js';
import type { MissionAuditProfile, MissionCompletionReason, MissionStatus } from '../StrategicMission.js';

export type EscalationLevel =
  | 'NOMINAL'
  | 'RETARGET'
  | 'MISSION_TABOO'
  | 'FRONTIER_EXPEDITION'
  | 'BREACH'
  | 'RELOCATE'
  | 'PHASE_WAIVER'
  | 'TERMINAL';

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
  giveUp: { reason: string } | null;
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
};
