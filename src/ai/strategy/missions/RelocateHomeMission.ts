import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { IStrategicMission, MissionStatus } from '../StrategicMission.js';
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
  public readonly maxTurns = 60;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';

  constructor(private readonly anchorPos: Position) {
    this.name = `⛺ 前線基地移転作戦 (${anchorPos.x}, ${anchorPos.y})`;
  }

  public evaluateStatus(snapshot: TacticalSnapshot, _engine: GameEngine): MissionStatus {
    const map = snapshot.map;
    // 我が家の位置がアンカー座標またはその隣接に更新されたら完了
    const dist = map.getTorusDistance(map.realHomePos, this.anchorPos).manhattan;
    if (dist <= 1) {
      return 'COMPLETED';
    }

    if (this.turnsElapsed >= this.maxTurns) {
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    const player = engine.getPlayer();
    const map = snapshot.map;

    // 1. 手持ちがRING以外の場合、手ぶらにする
    if (player.holdItem !== 'NONE' && player.holdItem !== 'RING') {
      return {
        type: 'DROP_HOLD_ITEM',
        priority: 95,
        reason: `RING回収準備のため所持品を置く [${player.holdItem}]`,
      };
    }

    // 2. RINGを持っていない場合、RINGを拾いに行く
    if (player.holdItem !== 'RING') {
      const ringPos = this.findNearestRing(player.pos, map, snapshot);
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
      this.status = 'ABORTED';
      return {
        type: 'WANDER_SAFELY',
        priority: 10,
        reason: 'RING不在のため前線基地移転を中断',
      };
    }

    // 3. RING所持時: 我が家をアンカーに向けて押す
    const homePos = map.realHomePos;
    const pushDir = this.calculatePushDir(homePos, this.anchorPos, map);
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

  private findNearestRing(from: Position, map: WorldMap, snapshot: TacticalSnapshot): Position | null {
    let nearest: Position | null = null;
    let minDist = Infinity;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (map.getItem(p) === 'RING' && !snapshot.memory.isTargetUnreachable(p, snapshot.totalTurns)) {
          const d = map.getTorusDistance(from, p).manhattan;
          if (d < minDist) {
            minDist = d;
            nearest = p;
          }
        }
      }
    }
    return nearest;
  }

  private calculatePushDir(home: Position, anchor: Position, map: WorldMap): Direction | null {
    let dx = anchor.x - home.x;
    let dy = anchor.y - home.y;
    if (Math.abs(dx) > map.width / 2) dx = -Math.sign(dx) * (map.width - Math.abs(dx));
    if (Math.abs(dy) > map.height / 2) dy = -Math.sign(dy) * (map.height - Math.abs(dy));

    if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
      return dx > 0 ? 'RIGHT' : 'LEFT';
    } else if (dy !== 0) {
      return dy > 0 ? 'DOWN' : 'UP';
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
