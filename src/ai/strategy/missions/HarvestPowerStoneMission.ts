import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { BaseStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { Position } from '../../../models/Types.js';
import { MissionSelector } from '../evaluators/MissionSelector.js';

/**
 * HarvestPowerStoneMission (パワーストーン回収＆奉納作戦)
 *
 * 大・中・小分類ステートマシン：
 * - 中分類 (subMode): APPROACHING_STONE | CHAINING_CHEST | DELIVERING_TO_HOME
 * - 小分類 (lockedTarget): POWER_STONE | CHEST | HOME
 */
export class HarvestPowerStoneMission extends BaseStrategicMission {
  public readonly id = 'HARVEST_POWER_STONE';
  public readonly name: string;
  public readonly maxTurns = 120;
  public override subMode: 'APPROACHING_STONE' | 'CHAINING_CHEST' | 'DELIVERING_TO_HOME' = 'APPROACHING_STONE';
  private stonePos: Position;
  private hasPickedUpStone: boolean = false;
  private initialStrength: number | null = null;

  constructor(targetStonePos: Position) {
    super();
    this.stonePos = { ...targetStonePos };
    this.name = `💎 パワーストーン回収＆奉納 (${this.stonePos.x}, ${this.stonePos.y})`;
  }

  public override get currentTarget(): Position | null {
    return this.lockedTarget ? this.lockedTarget.pos : this.stonePos;
  }

  private ensureInitialized(engine: GameEngine, snapshot: TacticalSnapshot): void {
    const player = engine.getPlayer();
    if (this.initialStrength === null) {
      this.initialStrength = player.strength;
    }
    if (player.holdItem === 'POWER_STONE') {
      this.hasPickedUpStone = true;
      this.subMode = 'DELIVERING_TO_HOME';
      this.lockTarget('HOME', snapshot.map.realHomePos, snapshot.totalTurns, player.pos, snapshot.map);
    } else if (!this.lockedTarget) {
      this.lockTarget('POWER_STONE', this.stonePos, snapshot.totalTurns, player.pos, snapshot.map);
    }
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    this.ensureInitialized(engine, snapshot);
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

      if (map.getItem(player.pos) === 'POWER_STONE') {
        this.hasPickedUpStone = false;
        this.stonePos = { ...player.pos };
        this.subMode = 'APPROACHING_STONE';
        this.lockTarget('POWER_STONE', this.stonePos, snapshot.totalTurns, player.pos, map);
        return 'ACTIVE';
      }

      const nearestStone = MapSituationEvaluator.get(snapshot, engine).items.nearestPowerStone;
      if (nearestStone) {
        this.hasPickedUpStone = false;
        this.stonePos = { ...nearestStone };
        this.subMode = 'APPROACHING_STONE';
        this.lockTarget('POWER_STONE', this.stonePos, snapshot.totalTurns, player.pos, map);
        return 'ACTIVE';
      }

      this.completionReason = 'TARGET_LOST';
      return 'FAILED';
    }

    if (this.subMode === 'CHAINING_CHEST') {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }

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
    this.ensureInitialized(engine, snapshot);
    const player = engine.getPlayer();
    const map = snapshot.map;
    this.updateLockProgress(player.pos, map);

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

    // 1. パワーストーン所持中: 我が家へ徒歩帰還
    if (player.holdItem === 'POWER_STONE') {
      this.subMode = 'DELIVERING_TO_HOME';
      this.lockTarget('HOME', bestHome, snapshot.totalTurns, player.pos, map);
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
          this.lockTarget('CHEST', nearestChest, snapshot.totalTurns, player.pos, map);
          return {
            type: 'UNLOCK_CHEST_8STEP',
            targetPos: nearestChest,
            priority: 93,
            reason: `💎 8歩周期チェーン優先: 足元石を後回収とし周辺宝箱へ直行 (${nearestChest.x}, ${nearestChest.y})`,
          };
        }
      }

      this.subMode = 'APPROACHING_STONE';
      this.lockTarget('POWER_STONE', player.pos, snapshot.totalTurns, player.pos, map);
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

    // 3. 石の位置へ移動
    this.subMode = 'APPROACHING_STONE';
    this.lockTarget('POWER_STONE', this.stonePos, snapshot.totalTurns, player.pos, map);
    return {
      type: 'NAVIGATE_TO_POSITION',
      targetPos: this.stonePos,
      targetItemType: 'POWER_STONE',
      priority: 85,
      reason: `パワーストーンへ移動 (${this.stonePos.x}, ${this.stonePos.y})`,
    };
  }
}
