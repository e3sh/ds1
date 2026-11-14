import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { IStrategicMission, MissionCompletionReason, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { Direction, Position } from '../../../models/Types.js';
import { WorldMap } from '../../../models/WorldMap.js';
import { MovementSystem } from '../../../systems/MovementSystem.js';

/**
 * RelocateHomeMission (前線基地移転作戦)
 *
 * ドラゴン lair 近傍の安全なアンカー位置へ我が家（HOME）を移転し、
 * 決戦時のリスポーン・補給動線を短縮する。
 */
export class RelocateHomeMission implements IStrategicMission {
  public readonly id = 'RELOCATE_HOME';
  public readonly name: string;
  public readonly maxTurns = 45;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';
  public completionReason?: MissionCompletionReason;
  public subMode: 'DROPPING_JUNK' | 'FETCHING_RING' | 'PUSHING_HOME' = 'FETCHING_RING';
  private initialHomeDist: number | null = null;

  constructor(private readonly anchorPos: Position) {
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
    // 我が家の位置がアンカー座標またはその隣接に更新されたら完了
    const dist = map.getTorusDistance(map.realHomePos, this.anchorPos).manhattan;
    if (dist <= 1) {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }

    // RING所持中にX・Yいずれの軸でも押下不能（立ち位置または押下先が閉塞）な場合は即終了
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

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    this.ensureInitialized(snapshot);
    const player = engine.getPlayer();
    const map = snapshot.map;

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
      const ringPos = MapSituationEvaluator.get(snapshot, engine).items.nearestRing;
      if (ringPos) {
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
      // RINGが見つからない場合は移転不能のためアボート
      this.completionReason = 'TARGET_LOST';
      this.status = 'ABORTED';
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

      return {
        type: 'SEAL_GRAVE_STEP',
        pushBlockPos: homePos,
        pushDestPos: map.wrapPosition(MovementSystem.getNextPosition(homePos, pushDir)),
        targetPos: standPos,
        priority: 85,
        reason: `我が家を押してアンカー(${this.anchorPos.x}, ${this.anchorPos.y})へ移転 [-> ${pushDir}]`,
      };
    }

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
