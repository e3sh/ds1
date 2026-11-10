import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { IStrategicMission, MissionStatus } from '../StrategicMission.js';
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

  constructor(private readonly gravePos: Position) {
    this.name = `🪦 墓パズル封鎖作戦 (${gravePos.x}, ${gravePos.y})`;
  }

  public evaluateStatus(snapshot: TacticalSnapshot, _engine: GameEngine): MissionStatus {
    const puzzle = snapshot.spatial.gravePuzzles.find(
      gp => gp.gravePos.x === this.gravePos.x && gp.gravePos.y === this.gravePos.y
    );

    if (!puzzle || puzzle.isSealed) {
      return 'COMPLETED';
    }

    // 墓そのもの、または封鎖ターゲットへの経路が遮断されている場合は早期アボート
    if (snapshot.memory.isTargetUnreachable(this.gravePos, snapshot.totalTurns)) {
      return 'ABORTED';
    }

    if (this.turnsElapsed >= this.maxTurns) {
      snapshot.memory.markTargetUnreachable(this.gravePos, 300, snapshot.totalTurns);
      return 'ABORTED';
    }

    return 'ACTIVE';
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

    // 2. 封鎖ターゲットマス（開口部）への移動
    for (const targetPos of puzzle.sealTargetPositions) {
      const obj = map.getObject(targetPos);
      const base = map.getBaseTile(targetPos);
      if (obj !== 'BLOCK' && base !== 'WALL_STATIC') {
        return {
          type: 'NAVIGATE_TO_POSITION',
          targetPos,
          priority: 80,
          reason: `墓封鎖チョークポイントへ移動 (${targetPos.x}, ${targetPos.y})`,
        };
      }
    }

    return {
      type: 'WANDER_SAFELY',
      priority: 10,
      reason: '墓封鎖ターゲットを探索中',
    };
  }
}
