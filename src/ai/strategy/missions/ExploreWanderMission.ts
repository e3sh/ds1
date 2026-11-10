import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { IStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';

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

  public evaluateStatus(_snapshot: TacticalSnapshot, _engine: GameEngine): MissionStatus {
    if (this.turnsElapsed >= this.maxTurns) {
      return 'COMPLETED';
    }
    return 'ACTIVE';
  }

  public generateDirective(_snapshot: TacticalSnapshot, _engine: GameEngine): StrategicDirective {
    return {
      type: 'WANDER_SAFELY',
      priority: 10,
      reason: '🧭 安全なマスを選んで索敵徘徊',
    };
  }
}
