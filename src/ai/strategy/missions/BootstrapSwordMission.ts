import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { IStrategicMission, MissionCompletionReason, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';

/**
 * BootstrapSwordMission (序盤の剣回収作戦)
 *
 * ゲーム開始直後、マップ上の剣（SWORD）を最速で回収し、戦闘能力を獲得する。
 */
export class BootstrapSwordMission implements IStrategicMission {
  public readonly id = 'BOOTSTRAP_SWORD';
  public readonly name = '⚔️ 序盤の剣回収作戦';
  public readonly maxTurns = 120;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';
  public completionReason?: MissionCompletionReason;
  public subMode: 'APPROACHING_SWORD' | 'PICKING_UP_SWORD' = 'APPROACHING_SWORD';

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    const player = engine.getPlayer();
    if (player.hasSword) {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }
    if (this.turnsElapsed >= this.maxTurns) {
      this.completionReason = snapshot.stagnation?.isEarlySwordTrapped ? 'NO_PROGRESS_BLOCKED' : 'NO_PROGRESS_TIMEOUT';
      return 'FAILED';
    }
    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    // 序盤の剣回収前ハマり（物理的詰み）検知
    if (snapshot.stagnation.isEarlySwordTrapped) {
      this.completionReason = 'NO_PROGRESS_BLOCKED';
      this.status = 'FAILED';
      return {
        type: 'GIVE_UP',
        priority: 100,
        reason: '💀 詰み検知: 剣への到達経路が存在しないためギブアップ',
      };
    }

    const player = engine.getPlayer();
    const map = snapshot.map;

    // 足元に剣がある場合は拾う
    if (map.getItem(player.pos) === 'SWORD') {
      this.subMode = 'PICKING_UP_SWORD';
      return {
        type: 'PICKUP_ITEM',
        targetItemType: 'SWORD',
        priority: 100,
        reason: '足元の剣を回収',
      };
    }

    // マップ上の剣を探す (認知層のマップサマリを参照)
    const swordPos = MapSituationEvaluator.get(snapshot, engine).items.nearestSword;
    if (swordPos) {
      this.subMode = 'APPROACHING_SWORD';
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: swordPos,
        targetItemType: 'SWORD',
        priority: 95,
        reason: `剣への最短ナビゲーション (${swordPos.x}, ${swordPos.y})`,
      };
    }

    return {
      type: 'WANDER_SAFELY',
      priority: 10,
      reason: '剣を探索中',
    };
  }
}
