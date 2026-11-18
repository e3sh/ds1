import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { BaseStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { Position } from '../../../models/Types.js';

/**
 * SealGraveMission (墓パズル封鎖作戦)
 *
 * 大・中・小分類ステートマシン：
 * - 中分類 (subMode): FETCHING_RING | PUSHING_BLOCK | MOVING_TO_CHOKE
 * - 小分類 (lockedTarget): RING | GRAVE_PUSH (pos: blockPos, secondaryPos: destinationPos)
 */
export class SealGraveMission extends BaseStrategicMission {
  public readonly id = 'SEAL_GRAVE';
  public readonly name: string;
  public readonly maxTurns = 60;
  public override subMode: 'FETCHING_RING' | 'PUSHING_BLOCK' | 'MOVING_TO_CHOKE' = 'PUSHING_BLOCK';

  constructor(private readonly gravePos: Position) {
    super();
    this.name = `🪦 墓パズル封鎖作戦 (${gravePos.x}, ${gravePos.y})`;
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    const puzzle = snapshot.spatial.gravePuzzles.find(
      gp => gp.gravePos.x === this.gravePos.x && gp.gravePos.y === this.gravePos.y
    );

    if (!puzzle || puzzle.isSealed) {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }

    const player = engine.getPlayer();
    const map = snapshot.map;
    const hasRingAccess =
      player.holdItem === 'RING' ||
      (player.holdItem === 'NONE' && MapSituationEvaluator.get(snapshot, engine).items.rings.length > 0);
    if (!hasRingAccess) {
      this.completionReason = 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }

    const hasExecutablePush = puzzle.recommendedPushes.some(
      push =>
        map.getObject(push.blockPos) === 'BLOCK' &&
        map.getBaseTile(push.destinationPos) !== 'WALL_STATIC' &&
        map.getObject(push.destinationPos) !== 'BLOCK' &&
        !snapshot.memory.isTargetUnreachable(push.blockPos, snapshot.totalTurns)
    );
    if (!hasExecutablePush) {
      snapshot.memory.markTargetUnreachable(this.gravePos, 300, snapshot.totalTurns);
      this.completionReason = 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }

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

  private verifyLocks(snapshot: TacticalSnapshot, engine: GameEngine): void {
    const player = engine.getPlayer();
    const map = snapshot.map;
    this.updateLockProgress(player.pos, map);

    if (player.holdItem !== 'RING') {
      this.subMode = 'FETCHING_RING';
      if (this.lockedTarget) {
        if (
          this.lockedTarget.kind !== 'RING' ||
          map.getItem(this.lockedTarget.pos) !== 'RING' ||
          this.isLockInvalidated(snapshot, 15)
        ) {
          this.clearTargetLock();
        }
      }
      return;
    }

    this.subMode = 'PUSHING_BLOCK';
    if (this.lockedTarget) {
      if (this.lockedTarget.kind !== 'GRAVE_PUSH' || !this.lockedTarget.secondaryPos) {
        this.clearTargetLock();
        return;
      }
      const bPos = this.lockedTarget.pos;
      const dPos = this.lockedTarget.secondaryPos;
      if (
        map.getObject(bPos) !== 'BLOCK' ||
        map.getBaseTile(dPos) === 'WALL_STATIC' ||
        map.getObject(dPos) === 'BLOCK' ||
        this.isLockInvalidated(snapshot, 15)
      ) {
        this.clearTargetLock();
      }
    }
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    const puzzle = snapshot.spatial.gravePuzzles.find(
      gp => gp.gravePos.x === this.gravePos.x && gp.gravePos.y === this.gravePos.y
    );

    if (!puzzle) {
      return { type: 'WANDER_SAFELY', priority: 10, reason: '墓パズル不明' };
    }

    const player = engine.getPlayer();
    const map = snapshot.map;

    this.verifyLocks(snapshot, engine);

    // 0. FETCHING_RING: ブロック押し出しには RING 所持が必須
    if (player.holdItem !== 'RING') {
      this.subMode = 'FETCHING_RING';
      if (player.holdItem === 'NONE') {
        const ringPos =
          this.lockedTarget?.kind === 'RING'
            ? this.lockedTarget.pos
            : (MapSituationEvaluator.get(snapshot, engine).items.rings[0] ?? null);
        if (ringPos) {
          this.lockTarget('RING', ringPos, snapshot.totalTurns, player.pos, map);
          if (player.pos.x === ringPos.x && player.pos.y === ringPos.y) {
            return {
              type: 'PICKUP_ITEM',
              targetPos: ringPos,
              targetItemType: 'RING',
              priority: 85,
              reason: `墓封鎖のため足元の指輪(RING)を取得 (${ringPos.x}, ${ringPos.y})`,
            };
          }
          return {
            type: 'NAVIGATE_TO_POSITION',
            targetPos: ringPos,
            targetItemType: 'RING',
            priority: 85,
            reason: `墓封鎖のため指輪(RING)へ移動 (${ringPos.x}, ${ringPos.y})`,
          };
        }
      }
      this.completionReason = 'NO_PROGRESS_BLOCKED';
      this.status = 'ABORTED';
      this.clearTargetLock();
      return {
        type: 'WANDER_SAFELY',
        priority: 10,
        reason: '指輪(RING)未所持のため墓封鎖を中断',
      };
    }

    // 1. PUSHING_BLOCK: ロック済みのプッシュがあればそのまま継続、なければ次を選定
    this.subMode = 'PUSHING_BLOCK';
    if (this.lockedTarget?.kind === 'GRAVE_PUSH' && this.lockedTarget.secondaryPos) {
      return {
        type: 'SEAL_GRAVE_STEP',
        pushBlockPos: this.lockedTarget.pos,
        pushDestPos: this.lockedTarget.secondaryPos,
        targetPos: this.lockedTarget.pos,
        priority: 85,
        reason: `墓封鎖ブロックプッシュ継続 (${this.lockedTarget.pos.x}, ${this.lockedTarget.pos.y}) -> (${this.lockedTarget.secondaryPos.x}, ${this.lockedTarget.secondaryPos.y})`,
      };
    }

    for (const push of puzzle.recommendedPushes) {
      const currentObj = map.getObject(push.blockPos);
      const destBase = map.getBaseTile(push.destinationPos);
      const destObj = map.getObject(push.destinationPos);
      if (
        currentObj === 'BLOCK' &&
        destBase !== 'WALL_STATIC' &&
        destObj !== 'BLOCK' &&
        !snapshot.memory.isTargetUnreachable(push.blockPos, snapshot.totalTurns)
      ) {
        this.lockTarget('GRAVE_PUSH', push.blockPos, snapshot.totalTurns, player.pos, map, {
          secondaryPos: push.destinationPos,
        });
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

    this.completionReason = 'NO_PROGRESS_BLOCKED';
    this.status = 'ABORTED';
    this.clearTargetLock();
    return {
      type: 'WANDER_SAFELY',
      priority: 10,
      reason: '実行可能な墓封鎖ブロックが存在しないため作戦中断',
    };
  }
}
