import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { BaseStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { DragonReadinessAssessment, ReadinessEvaluator } from '../evaluators/ReadinessEvaluator.js';
import { MissionSelector } from '../evaluators/MissionSelector.js';

/**
 * PrepareDragonAssaultMission (カテゴリ2: 決戦前リソース備蓄・最終調整作戦)
 *
 * 大・中・小分類ステートマシン：
 * - 中分類 (subMode): DROPPING_JUNK | CASHING_GOLD | COLLECTING_COIN | COLLECTING_POTION | HEALING_AT_HOME | READY_IDLE
 * - 小分類 (lockedTarget): HOME | POTION | COIN
 *
 * ポーションとコインの回収中に1歩単位でターゲットが目移り（ピンポン移動）しないよう、
 * 選定した単一ターゲットを回収完了・無効化までロック維持する。
 */
export class PrepareDragonAssaultMission extends BaseStrategicMission {
  public readonly id = 'PREPARE_DRAGON_ASSAULT';
  public readonly name = '⚔️ 決戦前リソース備蓄・最終調整作戦';
  public readonly maxTurns = 120;
  public override subMode: 'DROPPING_JUNK' | 'CASHING_GOLD' | 'COLLECTING_COIN' | 'COLLECTING_POTION' | 'HEALING_AT_HOME' | 'READY_IDLE' = 'COLLECTING_POTION';

  private hasMadeProgress(snapshot: TacticalSnapshot): boolean {
    const start = this.startTurn ?? snapshot.totalTurns;
    return snapshot.progress.substantiveGainsSince(start).length > 0;
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    const player = engine.getPlayer();
    const madeProgress = this.hasMadeProgress(snapshot);
    const assessment = ReadinessEvaluator.evaluateDragonReadiness(snapshot, engine, this.turnsElapsed);

    if (assessment.isFullyPrepared) {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }

    const situation = MapSituationEvaluator.get(snapshot, engine);
    const hasChestKeySupply =
      MissionSelector.hasReachableKey(snapshot.map, snapshot) &&
      MissionSelector.hasReachableChests(snapshot.map, snapshot);

    // 序盤BREAK解禁のために起動していた場合: EXP>=4000 (BREAK習得) かつ STR未達で宝箱/石が攻略可能になったら本業へ戻る
    if (
      player.strength < snapshot.params.targetStr &&
      snapshot.milestones.canBreak &&
      player.gold === 0 &&
      (hasChestKeySupply || situation.items.nearestPowerStone !== null)
    ) {
      this.completionReason = madeProgress ? 'OBJECTIVE_ACHIEVED' : 'PARTIAL_PROGRESS';
      return 'COMPLETED';
    }

    // マップ上に到達可能ポーション・コインが無く、ゴールドも無く、HPも十分でこれ以上補給手段がない場合
    const noReachablePotion = situation.items.nearestPotion === null;
    const hasEnoughHp = player.hp >= player.maxHp * 0.70 || player.hp >= 30000;

    if (
      player.gold === 0 &&
      noReachablePotion &&
      !assessment.needsCoinSweep &&
      hasEnoughHp &&
      !assessment.needsRelocation &&
      this.turnsElapsed >= (hasChestKeySupply ? 10 : 3)
    ) {
      this.completionReason = 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }

    if (this.turnsElapsed >= this.maxTurns) {
      if (madeProgress) {
        this.completionReason = 'PARTIAL_PROGRESS';
        return 'COMPLETED';
      }
      this.completionReason = 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  /**
   * Step 1: 毎ターン先頭でロック済みターゲットの完了・無効化を検証する
   */
  private verifyLocks(
    snapshot: TacticalSnapshot,
    engine: GameEngine,
    assessment: DragonReadinessAssessment
  ): void {
    const player = engine.getPlayer();
    const map = snapshot.map;
    this.updateLockProgress(player.pos, map);

    if (player.holdItem !== 'NONE' && player.holdItem !== 'POWER_STONE') {
      this.clearTargetLock();
      this.subMode = 'DROPPING_JUNK';
      return;
    }

    if (!this.lockedTarget) return;

    switch (this.lockedTarget.kind) {
      case 'HOME': {
        if (this.subMode === 'CASHING_GOLD' && player.gold === 0) {
          this.clearTargetLock();
        } else if (
          this.subMode === 'HEALING_AT_HOME' &&
          (player.hp >= player.maxHp * 0.70 || player.hp >= 30000 || player.gold > 0)
        ) {
          this.clearTargetLock();
        } else if (this.isLockInvalidated(snapshot, 20)) {
          this.clearTargetLock();
        }
        break;
      }
      case 'POTION': {
        if (
          map.getItem(this.lockedTarget.pos) !== 'POTION' ||
          player.magic >= snapshot.params.maxTargetMagic ||
          this.isLockInvalidated(snapshot, 15)
        ) {
          this.clearTargetLock();
        }
        break;
      }
      case 'COIN': {
        if (
          map.getItem(this.lockedTarget.pos) !== 'COIN' ||
          player.gold >= 8 ||
          !assessment.needsCoinSweep ||
          this.isLockInvalidated(snapshot, 15)
        ) {
          this.clearTargetLock();
        }
        break;
      }
      default:
        this.clearTargetLock();
        break;
    }
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    const player = engine.getPlayer();
    const map = snapshot.map;
    const assessment = ReadinessEvaluator.evaluateDragonReadiness(snapshot, engine, this.turnsElapsed);

    // Step 1: ターゲットロック検証
    this.verifyLocks(snapshot, engine, assessment);

    // 1. 不要アイテム（CROSS, KEY等）の手放し
    if (player.holdItem !== 'NONE' && player.holdItem !== 'POWER_STONE') {
      this.subMode = 'DROPPING_JUNK';
      return {
        type: 'DROP_HOLD_ITEM',
        priority: 95,
        reason: `決戦準備のため不要アイテム手放し [${player.holdItem}]`,
      };
    }

    const items = MapSituationEvaluator.get(snapshot, engine).items;
    const floorItem = map.getItem(player.pos);
    const needMoreExp =
      player.experience < 12000 ||
      !snapshot.milestones.canDiagonal ||
      Boolean(assessment.needsCoinSweep);
    const needMagic = player.magic < snapshot.params.maxTargetMagic;

    // 2. 足元にポーション・コインがある場合: 手ぶらなら即回収
    if (floorItem === 'POTION' && needMagic) {
      this.subMode = 'COLLECTING_POTION';
      return {
        type: 'PICKUP_ITEM',
        targetItemType: 'POTION',
        priority: 94,
        reason: '決戦前MP備蓄: 足元のポーションを回収',
      };
    }
    if (floorItem === 'COIN' && needMoreExp) {
      this.subMode = 'COLLECTING_COIN';
      return {
        type: 'PICKUP_ITEM',
        targetItemType: 'COIN',
        priority: 94,
        reason: '決戦前EXP育成: 足元の金貨を回収',
      };
    }

    // 3. コインまとめ回収 vs 我が家で一括換金の判定 (コインでEXPが増えるモードのみ)
    const coinGrantsExp = snapshot.params.coinGrantsExp !== false;
    const estimatedGainedExp = coinGrantsExp
      ? (player.gold * 300 + Math.floor(player.experience * 0.02 * player.gold))
      : 0;
    const afterExp = player.experience + estimatedGainedExp;
    const reachesMilestone =
      (player.experience < 4000 && afterExp >= 4000) ||
      (player.experience < 12000 && afterExp >= 12000) ||
      (player.experience < snapshot.params.targetDefenseExp && afterExp >= snapshot.params.targetDefenseExp);
    const coinTarget =
      this.lockedTarget?.kind === 'COIN' ? this.lockedTarget.pos : items.nearestCoin;
    const distNearestCoin = coinTarget ? map.getTorusDistance(player.pos, coinTarget).manhattan : Infinity;
    const maxSweepGold = player.experience < 12000 ? 5 : 7;
    const canKeepSweepingCoins =
      Boolean(assessment.needsCoinSweep) &&
      coinTarget !== null &&
      player.gold < maxSweepGold &&
      !reachesMilestone &&
      this.turnsElapsed < 65 &&
      (distNearestCoin <= 10 || (player.experience < 12000 && this.turnsElapsed < 40));

    if (coinGrantsExp && player.gold > 0 && !canKeepSweepingCoins) {
      this.subMode = 'CASHING_GOLD';
      this.lockTarget('HOME', map.realHomePos, snapshot.totalTurns, player.pos, map);
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: map.realHomePos,
        priority: 92,
        reason: `決戦前コイン換金・EXPオーバーヒールへ帰還 [所持:${player.gold}G]`,
      };
    }

    // 4. 緊急MP (MP < 3) 時は最寄りポーション優先（ただし既にロック中のポーションがあれば維持）
    const potionTarget =
      this.lockedTarget?.kind === 'POTION' ? this.lockedTarget.pos : items.nearestPotion;
    const distNearestPotion = potionTarget ? map.getTorusDistance(player.pos, potionTarget).manhattan : Infinity;
    if (player.magic < 3 && potionTarget && (distNearestPotion <= distNearestCoin || !canKeepSweepingCoins)) {
      this.subMode = 'COLLECTING_POTION';
      this.lockTarget('POTION', potionTarget, snapshot.totalTurns, player.pos, map);
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: potionTarget,
        targetItemType: 'POTION',
        priority: 90,
        reason: `決戦前MP備蓄(急務): ポーションへ移動 (${potionTarget.x}, ${potionTarget.y})`,
      };
    }

    // 4-B. ロック中のリソースターゲット（COIN / POTION）が有効なら目移りせず継続する
    if (this.lockedTarget?.kind === 'COIN' && assessment.needsCoinSweep && player.gold < 8) {
      this.subMode = 'COLLECTING_COIN';
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: this.lockedTarget.pos,
        targetItemType: 'COIN',
        priority: 86,
        reason: `決戦前EXP育成: 床コイン回収継続 (${this.lockedTarget.pos.x}, ${this.lockedTarget.pos.y}) [所持:${player.gold}G]`,
      };
    }
    if (this.lockedTarget?.kind === 'POTION' && needMagic) {
      this.subMode = 'COLLECTING_POTION';
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: this.lockedTarget.pos,
        targetItemType: 'POTION',
        priority: 88,
        reason: `決戦前MP備蓄: ポーションへ移動継続 (${this.lockedTarget.pos.x}, ${this.lockedTarget.pos.y})`,
      };
    }

    // 5. EXP不足時の床コイン一括スイープ回収
    if (
      assessment.needsCoinSweep &&
      coinTarget &&
      player.gold < 8 &&
      (player.experience < 12000 || distNearestCoin <= 15)
    ) {
      this.subMode = 'COLLECTING_COIN';
      this.lockTarget('COIN', coinTarget, snapshot.totalTurns, player.pos, map);
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: coinTarget,
        targetItemType: 'COIN',
        priority: 86,
        reason: `決戦前EXP育成: 床コイン回収 (${coinTarget.x}, ${coinTarget.y}) [所持:${player.gold}G]`,
      };
    }

    // 6. 通常MP備蓄
    if (potionTarget) {
      this.subMode = 'COLLECTING_POTION';
      this.lockTarget('POTION', potionTarget, snapshot.totalTurns, player.pos, map);
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: potionTarget,
        targetItemType: 'POTION',
        priority: 88,
        reason: `決戦前MP備蓄: ポーションへ移動 (${potionTarget.x}, ${potionTarget.y})`,
      };
    }

    // 7. 残余ゴールドの換金フォールバック
    if (player.gold > 0) {
      this.subMode = 'CASHING_GOLD';
      this.lockTarget('HOME', map.realHomePos, snapshot.totalTurns, player.pos, map);
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: map.realHomePos,
        priority: 92,
        reason: `決戦前コイン換金・EXPオーバーヒールへ帰還 [所持:${player.gold}G]`,
      };
    }

    // 8. HP不足時 (HP < 70%): 我が家で全回復
    if (player.hp < player.maxHp * 0.70 && player.hp < 30000) {
      this.subMode = 'HEALING_AT_HOME';
      this.lockTarget('HOME', map.realHomePos, snapshot.totalTurns, player.pos, map);
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: map.realHomePos,
        priority: 85,
        reason: '決戦前HP全回復のため我が家へ帰還',
      };
    }

    // 準備完了（または到達可能資源なし）
    this.subMode = 'READY_IDLE';
    this.clearTargetLock();
    return {
      type: 'WANDER_SAFELY',
      priority: 20,
      reason: '決戦突入準備完了',
    };
  }
}
