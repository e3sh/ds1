import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { IStrategicMission, MissionCompletionReason, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { Position } from '../../../models/Types.js';

/**
 * ExploreWanderMission (安全探索・徘徊作戦)
 *
 * 他に緊急または高優先度の作戦がない場合に、安全なマスを選びながら探索する。
 */
export class ExploreWanderMission implements IStrategicMission {
  public readonly id = 'EXPLORE_WANDER';
  public readonly name = '🧭 安全徘徊探索作戦';
  public readonly maxTurns = 20;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';
  public completionReason?: MissionCompletionReason;
  public subMode: 'WANDERING' = 'WANDERING';
  private initialPos: Position | null = null;

  public evaluateStatus(_snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    const pos = engine.getPlayer().pos;
    if (this.initialPos === null) {
      this.initialPos = { ...pos };
    }
    if (this.turnsElapsed >= this.maxTurns) {
      const moved = pos.x !== this.initialPos.x || pos.y !== this.initialPos.y;
      this.completionReason = moved ? 'OBJECTIVE_ACHIEVED' : 'NO_PROGRESS_TIMEOUT';
      return moved ? 'COMPLETED' : 'ABORTED';
    }
    return 'ACTIVE';
  }

  public generateDirective(_snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    if (this.initialPos === null) {
      this.initialPos = { ...engine.getPlayer().pos };
    }
    this.subMode = 'WANDERING';
    return {
      type: 'WANDER_SAFELY',
      priority: 10,
      reason: '🧭 安全なマスを選んで索敵徘徊',
    };
  }
}
