import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { IStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { Position } from '../../../models/Types.js';
import { MissionSelector } from '../evaluators/MissionSelector.js';

/**
 * HarvestPowerStoneMission (パワーストーン回収＆奉納作戦)
 *
 * 出現したパワーストーンを回収し、我が家へ帰還して奉納するまでをコミット。
 */
export class HarvestPowerStoneMission implements IStrategicMission {
  public readonly id = 'HARVEST_POWER_STONE';
  public readonly name: string;
  public readonly maxTurns = 120;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';
  private stonePos: Position;
  private hasPickedUpStone: boolean = false;

  constructor(targetStonePos: Position) {
    this.stonePos = { ...targetStonePos };
    this.name = `💎 パワーストーン回収＆奉納 (${this.stonePos.x}, ${this.stonePos.y})`;
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    const player = engine.getPlayer();
    const map = snapshot.map;

    // 我が家に到達して奉納完了したか
    if (this.hasPickedUpStone && player.holdItem !== 'POWER_STONE') {
      const atHome = player.pos.x === map.realHomePos.x && player.pos.y === map.realHomePos.y;
      if (atHome || player.strength > 0) {
        return 'COMPLETED';
      }
    }

    if (player.holdItem === 'POWER_STONE') {
      this.hasPickedUpStone = true;
    }

    // まだ拾っておらず、指定位置の石が消失した（誰かに奪われた等）場合
    if (!this.hasPickedUpStone) {
      if (map.getItem(this.stonePos) !== 'POWER_STONE') {
        return 'FAILED';
      }
    }

    // STRカンスト済みで石をまだ拾っていない場合は、これ以上の奉納は無意味なためアボート
    if (!this.hasPickedUpStone && snapshot.milestones.isStrCapped) {
      return 'ABORTED';
    }

    if (this.turnsElapsed >= this.maxTurns) {
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    const player = engine.getPlayer();
    const map = snapshot.map;
    const allHomes = map.getAllHomePositions();
    let bestHome = map.realHomePos;
    let minDist = Infinity;
    for (const h of allHomes) {
      const d = map.getTorusDistance(player.pos, h).manhattan;
      if (d < minDist) {
        minDist = d;
        bestHome = h;
      }
    }

    // 1. パワーストーン所持中: 我が家へ徒歩帰還（BREAKで岩を開削しながら前進し、ポットを温存）
    if (player.holdItem === 'POWER_STONE') {
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: bestHome,
        priority: 95,
        reason: `パワーストーン奉納のため我が家(${bestHome.x}, ${bestHome.y})へ帰還`,
      };
    }

    // 2. まだ石を拾っていないが足元にある場合:
    if (map.getItem(player.pos) === 'POWER_STONE') {
      const canChain = player.holdItem === 'KEY' && MissionSelector.hasNearbyChest(player.pos, map, 8, snapshot);
      if (canChain) {
        const nearestChest = this.findNearestNearbyChest(player.pos, map, 8);
        if (nearestChest) {
          return {
            type: 'UNLOCK_CHEST_8STEP',
            targetPos: nearestChest,
            priority: 93,
            reason: `💎 8歩周期チェーン優先: 足元石を後回収とし周辺宝箱へ直行 (${nearestChest.x}, ${nearestChest.y})`,
          };
        }
      }

      // 既に何か手持ち品（KEY等）がある場合はスワップまたはドロップ
      if (player.holdItem !== 'NONE') {
        return {
          type: 'SWAP_KEY_FOR_ITEM',
          targetPos: player.pos,
          targetItemType: 'POWER_STONE',
          priority: 92,
          reason: `手持ちアイテム [${player.holdItem}] を一時退避してパワーストーンを回収`,
        };
      }
      return {
        type: 'PICKUP_ITEM',
        targetItemType: 'POWER_STONE',
        priority: 92,
        reason: '足元のパワーストーンを回収',
      };
    }

    // 3. 石の位置へ移動
    return {
      type: 'NAVIGATE_TO_POSITION',
      targetPos: this.stonePos,
      targetItemType: 'POWER_STONE',
      priority: 88,
      reason: `パワーストーンへ移動 (${this.stonePos.x}, ${this.stonePos.y})`,
    };
  }

  private findNearestNearbyChest(from: Position, map: any, maxDist: number): Position | null {
    let bestDist = Infinity;
    let bestPos: Position | null = null;
    for (let dy = -maxDist; dy <= maxDist; dy++) {
      for (let dx = -maxDist; dx <= maxDist; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > maxDist) continue;
        const p = map.wrapPosition({ x: from.x + dx, y: from.y + dy });
        if (map.getObject(p) === 'CHEST') {
          const d = map.getTorusDistance(from, p).manhattan;
          if (d < bestDist) {
            bestDist = d;
            bestPos = p;
          }
        }
      }
    }
    return bestPos;
  }
}
