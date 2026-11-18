import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { BaseStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { Direction, Position } from '../../../models/Types.js';
import { WorldMap } from '../../../models/WorldMap.js';
import { MovementSystem } from '../../../systems/MovementSystem.js';

/**
 * RelocateHomeMission (前線基地移転作戦)
 *
 * 大・中・小分類ステートマシン：
 * - 中分類 (subMode): DROPPING_JUNK | FETCHING_RING | PUSHING_HOME
 * - 小分類 (lockedTarget): RING | HOME (secondaryPos: realHomePos)
 */
export class RelocateHomeMission extends BaseStrategicMission {
  public readonly id = 'RELOCATE_HOME';
  public readonly name: string;
  public readonly maxTurns = 45;
  public override subMode: 'DROPPING_JUNK' | 'FETCHING_RING' | 'PUSHING_HOME' = 'FETCHING_RING';
  private initialHomeDist: number | null = null;

  constructor(private readonly anchorPos: Position) {
    super();
    this.name = `⛺ 前線基地移転作戦 (${anchorPos.x}, ${anchorPos.y})`;
  }

  private ensureInitialized(snapshot: TacticalSnapshot): void {
    if (this.initialHomeDist === null) {
      this.initialHomeDist = snapshot.map.getTorusDistance(snapshot.map.realHomePos, this.anchorPos).manhattan;
    }
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    this.ensureInitialized(snapshot);
    const map = snapshot.map;
    const dist = map.getTorusDistance(map.realHomePos, this.anchorPos).manhattan;
    if (dist <= 1) {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }

    const movedCloser = this.initialHomeDist !== null && dist < this.initialHomeDist;
    if (
      engine.getPlayer().holdItem === 'RING' &&
      !this.calculatePushDir(map.realHomePos, this.anchorPos, map, snapshot)
    ) {
      this.completionReason = movedCloser ? 'OBJECTIVE_ACHIEVED' : 'NO_PROGRESS_BLOCKED';
      return movedCloser ? 'COMPLETED' : 'ABORTED';
    }

    if (this.turnsElapsed >= this.maxTurns) {
      this.completionReason = movedCloser ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  private verifyLocks(snapshot: TacticalSnapshot, engine: GameEngine): void {
    const player = engine.getPlayer();
    const map = snapshot.map;
    this.updateLockProgress(player.pos, map);

    if (player.holdItem !== 'NONE' && player.holdItem !== 'RING') {
      this.clearTargetLock();
      this.subMode = 'DROPPING_JUNK';
      return;
    }

    if (player.holdItem === 'NONE') {
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

    this.subMode = 'PUSHING_HOME';
    if (this.lockedTarget && this.lockedTarget.kind !== 'HOME') {
      this.clearTargetLock();
    }
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    this.ensureInitialized(snapshot);
    const player = engine.getPlayer();
    const map = snapshot.map;

    this.verifyLocks(snapshot, engine);

    // 1. 手持ちがRING以外の場合、手ぶらにする
    if (player.holdItem !== 'NONE' && player.holdItem !== 'RING') {
      this.subMode = 'DROPPING_JUNK';
      return {
        type: 'DROP_HOLD_ITEM',
        priority: 95,
        reason: `RING回収準備のため所持品を置く [${player.holdItem}]`,
      };
    }

    // 2. RINGを持っていない場合、RINGを拾いに行く
    if (player.holdItem !== 'RING') {
      this.subMode = 'FETCHING_RING';
      const ringPos =
        this.lockedTarget?.kind === 'RING'
          ? this.lockedTarget.pos
          : MapSituationEvaluator.get(snapshot, engine).items.nearestRing;
      if (ringPos) {
        this.lockTarget('RING', ringPos, snapshot.totalTurns, player.pos, map);
        if (player.pos.x === ringPos.x && player.pos.y === ringPos.y) {
          return {
            type: 'PICKUP_ITEM',
            targetItemType: 'RING',
            priority: 90,
            reason: '足元のRINGを取得',
          };
        }
        return {
          type: 'NAVIGATE_TO_POSITION',
          targetPos: ringPos,
          targetItemType: 'RING',
          priority: 88,
          reason: `RINGへ移動 (${ringPos.x}, ${ringPos.y})`,
        };
      }
      this.completionReason = 'TARGET_LOST';
      this.status = 'ABORTED';
      this.clearTargetLock();
      return {
        type: 'WANDER_SAFELY',
        priority: 10,
        reason: 'RING不在のため前線基地移転を中断',
      };
    }

    // 3. RING所持時: 我が家をアンカーに向けて押す
    this.subMode = 'PUSHING_HOME';
    const homePos = map.realHomePos;
    const pushDir = this.calculatePushDir(homePos, this.anchorPos, map, snapshot);
    if (pushDir) {
      const oppDir = this.getOppositeDirection(pushDir);
      const standPos = map.wrapPosition(MovementSystem.getNextPosition(homePos, oppDir));
      this.lockTarget('HOME', standPos, snapshot.totalTurns, player.pos, map, {
        secondaryPos: homePos,
      });

      return {
        type: 'SEAL_GRAVE_STEP',
        pushBlockPos: homePos,
        pushDestPos: map.wrapPosition(MovementSystem.getNextPosition(homePos, pushDir)),
        targetPos: standPos,
        priority: 85,
        reason: `我が家を押してアンカー(${this.anchorPos.x}, ${this.anchorPos.y})へ移転 [-> ${pushDir}]`,
      };
    }

    this.lockTarget('HOME', this.anchorPos, snapshot.totalTurns, player.pos, map);
    return {
      type: 'NAVIGATE_TO_POSITION',
      targetPos: this.anchorPos,
      priority: 80,
      reason: `前線基地移転アンカーへ接近 (${this.anchorPos.x}, ${this.anchorPos.y})`,
    };
  }

  private isStandPosPassable(pos: Position, map: WorldMap, snapshot: TacticalSnapshot): boolean {
    const base = map.getBaseTile(pos);
    const obj = map.getObject(pos);
    if (base === 'WALL_STATIC') return false;
    if (base === 'GRAVE' && obj === 'NONE') return false;
    if (obj === 'BLOCK') return false;
    if (snapshot.memory.isTargetUnreachable(pos, snapshot.totalTurns)) return false;
    return true;
  }

  private calculatePushDir(
    home: Position,
    anchor: Position,
    map: WorldMap,
    snapshot: TacticalSnapshot
  ): Direction | null {
    let dx = anchor.x - home.x;
    let dy = anchor.y - home.y;
    if (Math.abs(dx) > map.width / 2) dx = -Math.sign(dx) * (map.width - Math.abs(dx));
    if (Math.abs(dy) > map.height / 2) dy = -Math.sign(dy) * (map.height - Math.abs(dy));

    const candidates: Direction[] = [];
    const xDir: Direction | null = dx > 0 ? 'RIGHT' : dx < 0 ? 'LEFT' : null;
    const yDir: Direction | null = dy > 0 ? 'DOWN' : dy < 0 ? 'UP' : null;

    if (Math.abs(dx) >= Math.abs(dy)) {
      if (xDir) candidates.push(xDir);
      if (yDir) candidates.push(yDir);
    } else {
      if (yDir) candidates.push(yDir);
      if (xDir) candidates.push(xDir);
    }

    for (const dir of candidates) {
      const pushDest = map.wrapPosition(MovementSystem.getNextPosition(home, dir));
      const oppDir = this.getOppositeDirection(dir);
      const standPos = map.wrapPosition(MovementSystem.getNextPosition(home, oppDir));
      if (map.isPushDestinationValid(pushDest) && this.isStandPosPassable(standPos, map, snapshot)) {
        return dir;
      }
    }
    return null;
  }

  private getOppositeDirection(dir: Direction): Direction {
    switch (dir) {
      case 'UP': return 'DOWN';
      case 'DOWN': return 'UP';
      case 'LEFT': return 'RIGHT';
      case 'RIGHT': return 'LEFT';
      default: return 'UP';
    }
  }
}
