import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { IStrategicMission, MissionCompletionReason, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { Position } from '../../../models/Types.js';

/**
 * SealGraveMission (墓パズル封鎖作戦)
 *
 * テーマブロックメタデータ（GravePuzzleHint）に基づき、
 * 墓周囲の隙間または箱型墓の出口チョークポイントをブロックで封鎖する。
 */
export class SealGraveMission implements IStrategicMission {
  public readonly id = 'SEAL_GRAVE';
  public readonly name: string;
  public readonly maxTurns = 60;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';
  public completionReason?: MissionCompletionReason;
  public subMode: 'PUSHING_BLOCK' | 'MOVING_TO_CHOKE' = 'PUSHING_BLOCK';

  constructor(private readonly gravePos: Position) {
    this.name = `🪦 墓パズル封鎖作戦 (${gravePos.x}, ${gravePos.y})`;
  }

  public evaluateStatus(snapshot: TacticalSnapshot, _engine: GameEngine): MissionStatus {
    const puzzle = snapshot.spatial.gravePuzzles.find(
      gp => gp.gravePos.x === this.gravePos.x && gp.gravePos.y === this.gravePos.y
    );

    if (!puzzle || puzzle.isSealed) {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }

    const map = snapshot.map;
    const hasExecutablePush = puzzle.recommendedPushes.some(
      push =>
        map.getObject(push.blockPos) === 'BLOCK' &&
        !snapshot.memory.isTargetUnreachable(push.blockPos, snapshot.totalTurns)
    );
    if (!hasExecutablePush) {
      snapshot.memory.markTargetUnreachable(this.gravePos, 300, snapshot.totalTurns);
      this.completionReason = 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }

    // 墓そのもの、または封鎖ターゲットへの経路が遮断されている場合は早期アボート
    if (snapshot.memory.isTargetUnreachable(this.gravePos, snapshot.totalTurns)) {
      this.completionReason = 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }

    if (this.turnsElapsed >= this.maxTurns) {
      snapshot.memory.markTargetUnreachable(this.gravePos, 300, snapshot.totalTurns);
      this.completionReason = 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  public onAborted(snapshot: TacticalSnapshot): void {
    snapshot.memory.markTargetUnreachable(this.gravePos, 300, snapshot.totalTurns);
  }

  public generateDirective(snapshot: TacticalSnapshot, _engine: GameEngine): StrategicDirective {
    const puzzle = snapshot.spatial.gravePuzzles.find(
      gp => gp.gravePos.x === this.gravePos.x && gp.gravePos.y === this.gravePos.y
    );

    if (!puzzle) {
      return { type: 'WANDER_SAFELY', priority: 10, reason: '墓パズル不明' };
    }

    const map = snapshot.map;

    // 1. 推奨プッシュ手があれば実行
    for (const push of puzzle.recommendedPushes) {
      const currentObj = map.getObject(push.blockPos);
      if (currentObj === 'BLOCK') {
        this.subMode = 'PUSHING_BLOCK';
        return {
          type: 'SEAL_GRAVE_STEP',
          pushBlockPos: push.blockPos,
          pushDestPos: push.destinationPos,
          targetPos: push.blockPos,
          priority: 85,
          reason: `墓封鎖ブロックプッシュ (${push.blockPos.x}, ${push.blockPos.y}) -> (${push.destinationPos.x}, ${push.destinationPos.y})`,
        };
      }
    }

    // 3. 実行可能なプッシュ対象ブロックがない場合は早期アボート
    this.completionReason = 'NO_PROGRESS_BLOCKED';
    this.status = 'ABORTED';
    return {
      type: 'WANDER_SAFELY',
      priority: 10,
      reason: '実行可能な墓封鎖ブロックが存在しないため作戦中断',
    };
  }
}
