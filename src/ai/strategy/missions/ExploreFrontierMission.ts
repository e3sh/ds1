import { GameEngine } from '../../../core/GameEngine.js';
import { Position } from '../../../models/Types.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { StrategicDirective } from '../StrategicDirective.js';
import {
  BaseStrategicMission,
  MissionAuditProfile,
  MissionStatus,
} from '../StrategicMission.js';

/**
 * ExploreFrontierMission (未踏フロンティア遠征作戦)
 *
 * 従来の ExploreWanderMission（1マス移動で即 COMPLETED になる擬似完了）を置き換え、
 * 認知層が算出した未踏地/最古訪問地（frontierTargets）へ計画的に移動する。
 */
export class ExploreFrontierMission extends BaseStrategicMission {
  public readonly id = 'EXPLORE_FRONTIER';
  public readonly name = '🧭 未踏フロンティア遠征作戦';
  public readonly maxTurns = 24;
  public override subMode: 'NAVIGATING_FRONTIER' | 'WANDERING' = 'NAVIGATING_FRONTIER';

  public override readonly auditProfile: MissionAuditProfile = {
    graceTurns: 24,
    tabooable: false,
    maxEscalation: 'TERMINAL',
  };

  private resolvedTarget: Position | null;

  constructor(target: Position | null = null) {
    super();
    this.resolvedTarget = target ? { ...target } : null;
  }

  public override get currentTarget(): Position | null {
    return this.lockedTarget ? this.lockedTarget.pos : this.resolvedTarget;
  }

  private ensureTarget(snapshot: TacticalSnapshot, engine: GameEngine): Position | null {
    const pos = engine.getPlayer().pos;
    this.updateLockProgress(pos, snapshot.map);
    if (
      this.resolvedTarget &&
      (this.resolvedTarget.x !== pos.x || this.resolvedTarget.y !== pos.y) &&
      !snapshot.memory.isTargetUnreachable(this.resolvedTarget, snapshot.totalTurns) &&
      !(this.lockedTarget && this.lockedTarget.blockedCount >= 2)
    ) {
      this.lockTarget('FRONTIER', this.resolvedTarget, snapshot.totalTurns, pos, snapshot.map);
      return this.resolvedTarget;
    }
    const candidates = MapSituationEvaluator.get(snapshot, engine).exploration.frontierTargets;
    this.resolvedTarget = candidates.find(c => c.x !== pos.x || c.y !== pos.y) ?? null;
    if (this.resolvedTarget) {
      this.lockTarget('FRONTIER', this.resolvedTarget, snapshot.totalTurns, pos, snapshot.map);
    } else {
      this.clearTargetLock();
    }
    return this.resolvedTarget;
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    const start = this.startTurn ?? snapshot.totalTurns;
    const newTiles = snapshot.progress.newTilesSince(start);
    const gains = snapshot.progress.substantiveGainsSince(start).length;
    const target = this.ensureTarget(snapshot, engine);
    const pos = engine.getPlayer().pos;

    if (target && pos.x === target.x && pos.y === target.y && newTiles >= 8) {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }

    if (this.turnsElapsed >= this.maxTurns) {
      if (newTiles >= 8 || gains > 0) {
        this.completionReason = 'OBJECTIVE_ACHIEVED';
        return 'COMPLETED';
      }
      if (this.resolvedTarget) {
        snapshot.memory.markTargetUnreachable(this.resolvedTarget, 30, snapshot.totalTurns);
      }
      this.completionReason = 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    const target = this.ensureTarget(snapshot, engine);
    if (target) {
      this.subMode = 'NAVIGATING_FRONTIER';
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: target,
        priority: 25,
        reason: `🧭 未踏地 (${target.x}, ${target.y}) へ遠征移動`,
      };
    }

    this.subMode = 'WANDERING';
    return {
      type: 'WANDER_SAFELY',
      priority: 10,
      reason: '🧭 安全なマスを選んで索敵徘徊',
    };
  }
}
