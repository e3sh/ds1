import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { IStrategicMission, MissionCompletionReason, MissionStatus } from '../StrategicMission.js';
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
  public completionReason?: MissionCompletionReason;
  public subMode: 'APPROACHING_STONE' | 'CHAINING_CHEST' | 'DELIVERING_TO_HOME' = 'APPROACHING_STONE';
  private stonePos: Position;
  private hasPickedUpStone: boolean = false;
  private initialStrength: number | null = null;

  constructor(targetStonePos: Position) {
    this.stonePos = { ...targetStonePos };
    this.name = `💎 パワーストーン回収＆奉納 (${this.stonePos.x}, ${this.stonePos.y})`;
  }

  private ensureInitialized(engine: GameEngine): void {
    const player = engine.getPlayer();
    if (this.initialStrength === null) {
      this.initialStrength = player.strength;
    }
    if (player.holdItem === 'POWER_STONE') {
      this.hasPickedUpStone = true;
      this.subMode = 'DELIVERING_TO_HOME';
    }
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    this.ensureInitialized(engine);
    const player = engine.getPlayer();
    const map = snapshot.map;
    const baseStrength = this.initialStrength ?? player.strength;

    if (player.holdItem === 'POWER_STONE') {
      this.hasPickedUpStone = true;
      this.subMode = 'DELIVERING_TO_HOME';
      if (this.turnsElapsed >= this.maxTurns) {
        this.completionReason = 'NO_PROGRESS_TIMEOUT';
        return 'ABORTED';
      }
      return 'ACTIVE';
    }

    // 我が家に到達して奉納完了（実際に strength が増加した）か検証
    if (this.hasPickedUpStone) {
      const atHome =
        (player.pos.x === map.realHomePos.x && player.pos.y === map.realHomePos.y) ||
        map.getBaseTile(player.pos) === 'HOME';
      if (player.strength > baseStrength || (baseStrength >= 999999 && atHome)) {
        this.completionReason = 'OBJECTIVE_ACHIEVED';
        return 'COMPLETED';
      }

      // 納品によるSTR増加が確認できない（道中ドロップ・ゴースト略奪等）ため偽完了させない
      if (map.getItem(player.pos) === 'POWER_STONE') {
        this.hasPickedUpStone = false;
        this.stonePos = { ...player.pos };
        this.subMode = 'APPROACHING_STONE';
        return 'ACTIVE';
      }

      const nearestStone = MapSituationEvaluator.get(snapshot, engine).items.nearestPowerStone;
      if (nearestStone) {
        this.hasPickedUpStone = false;
        this.stonePos = { ...nearestStone };
        this.subMode = 'APPROACHING_STONE';
        return 'ACTIVE';
      }

      this.completionReason = 'TARGET_LOST';
      return 'FAILED';
    }

    if (this.subMode === 'CHAINING_CHEST') {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }

    // まだ拾っておらず、指定位置の石が消失した（誰かに奪われた等）場合
    if (!this.hasPickedUpStone) {
      if (map.getItem(this.stonePos) !== 'POWER_STONE') {
        this.completionReason = 'TARGET_LOST';
        return 'FAILED';
      }
      if (snapshot.memory.isTargetUnreachable(this.stonePos, snapshot.totalTurns)) {
        this.completionReason = 'NO_PROGRESS_BLOCKED';
        return 'ABORTED';
      }
    }

    // STRカンスト済みで石をまだ拾っていない場合は、これ以上の奉納は無意味なためアボート
    if (!this.hasPickedUpStone && snapshot.milestones.isStrCapped) {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'ABORTED';
    }

    if (this.turnsElapsed >= this.maxTurns) {
      this.completionReason = 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    this.ensureInitialized(engine);
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
      this.subMode = 'DELIVERING_TO_HOME';
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: bestHome,
        priority: 95,
        reason: `パワーストーン奉納のため我が家(${bestHome.x}, ${bestHome.y})へ帰還`,
      };
    }

    // 2. まだ石を拾っていないが足元にある場合:
    if (map.getItem(player.pos) === 'POWER_STONE') {
      const canChain =
        player.holdItem === 'KEY' &&
        player.stepCountSinceStone === 0 &&
        MissionSelector.hasNearbyChest(player.pos, map, 8, snapshot);
      if (canChain) {
        const nearestChest = MapSituationEvaluator.get(snapshot, engine).items.nearestChest;
        if (nearestChest) {
          this.subMode = 'CHAINING_CHEST';
          return {
            type: 'UNLOCK_CHEST_8STEP',
            targetPos: nearestChest,
            priority: 93,
            reason: `💎 8歩周期チェーン優先: 足元石を後回収とし周辺宝箱へ直行 (${nearestChest.x}, ${nearestChest.y})`,
          };
        }
      }

      this.subMode = 'APPROACHING_STONE';
      // 既に何か手持ち品（KEY等）がある場合はスワップまたはドロップ
      if (player.holdItem !== 'NONE') {
        if (player.holdItem === 'KEY') {
          return {
            type: 'SWAP_KEY_FOR_ITEM',
            targetPos: player.pos,
            targetItemType: 'POWER_STONE',
            priority: 92,
            reason: `手持ちの鍵 [${player.holdItem}] を一時退避してパワーストーンを回収`,
          };
        }
        return {
          type: 'DROP_HOLD_ITEM',
          priority: 92,
          reason: `手持ちアイテム [${player.holdItem}] を床に置いてパワーストーンを回収`,
        };
      }
      return {
        type: 'PICKUP_ITEM',
        targetItemType: 'POWER_STONE',
        priority: 92,
        reason: '足元のパワーストーンを回収',
      };
    }

    // 3. 石の位置へ移動 (道中の近傍コイン/ポーションついで拾い priority 87..92 を許容するため priority 85)
    this.subMode = 'APPROACHING_STONE';
    return {
      type: 'NAVIGATE_TO_POSITION',
      targetPos: this.stonePos,
      targetItemType: 'POWER_STONE',
      priority: 85,
      reason: `パワーストーンへ移動 (${this.stonePos.x}, ${this.stonePos.y})`,
    };
  }
}
