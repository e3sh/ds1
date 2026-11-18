import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { BaseStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';

/**
 * BootstrapSwordMission (序盤の剣回収作戦)
 *
 * 大・中・小分類ステートマシン：
 * - 中分類 (subMode): APPROACHING_SWORD | PICKING_UP_SWORD
 * - 小分類 (lockedTarget): SWORD
 */
export class BootstrapSwordMission extends BaseStrategicMission {
  public readonly id = 'BOOTSTRAP_SWORD';
  public readonly name = '⚔️ 序盤の剣回収作戦';
  public readonly maxTurns = 120;
  public override subMode: 'APPROACHING_SWORD' | 'PICKING_UP_SWORD' = 'APPROACHING_SWORD';

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    const player = engine.getPlayer();
    if (player.hasSword) {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }
    if (this.turnsElapsed >= this.maxTurns) {
      const trapped = MapSituationEvaluator.get(snapshot, engine).items.isEarlySwordTrapped;
      this.completionReason = trapped ? 'NO_PROGRESS_BLOCKED' : 'NO_PROGRESS_TIMEOUT';
      return 'FAILED';
    }
    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    const items = MapSituationEvaluator.get(snapshot, engine).items;
    if (items.isEarlySwordTrapped) {
      this.completionReason = 'NO_PROGRESS_BLOCKED';
      this.status = 'FAILED';
      this.clearTargetLock();
      return {
        type: 'GIVE_UP',
        priority: 100,
        reason: '💀 詰み検知: 剣への到達経路が存在しないためギブアップ',
      };
    }

    const player = engine.getPlayer();
    const map = snapshot.map;

    this.updateLockProgress(player.pos, map);
    if (
      this.lockedTarget &&
      (this.lockedTarget.kind !== 'SWORD' ||
        map.getItem(this.lockedTarget.pos) !== 'SWORD' ||
        this.isLockInvalidated(snapshot, 20))
    ) {
      this.clearTargetLock();
    }

    // 足元に剣がある場合は拾う
    if (map.getItem(player.pos) === 'SWORD') {
      this.subMode = 'PICKING_UP_SWORD';
      this.lockTarget('SWORD', player.pos, snapshot.totalTurns, player.pos, map);
      return {
        type: 'PICKUP_ITEM',
        targetItemType: 'SWORD',
        priority: 100,
        reason: '足元の剣を回収',
      };
    }

    const swordPos =
      this.lockedTarget?.kind === 'SWORD' ? this.lockedTarget.pos : items.nearestSword;
    if (swordPos) {
      this.subMode = 'APPROACHING_SWORD';
      this.lockTarget('SWORD', swordPos, snapshot.totalTurns, player.pos, map);
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
