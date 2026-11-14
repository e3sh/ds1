import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { IStrategicMission, MissionCompletionReason, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { ReadinessEvaluator } from '../evaluators/ReadinessEvaluator.js';
import { MissionSelector } from '../evaluators/MissionSelector.js';

/**
 * PrepareDragonAssaultMission (カテゴリ2: 決戦前リソース備蓄・最終調整作戦)
 *
 * STR達成後、ドラゴン要塞に突撃する前に必要なリソースを計画的に集める：
 * 1. 手持ちコインの一括換金（EXP防御力極大化 ＆ 最大HP超えのオーバーヒール獲得）
 * 2. 決戦・脱出用MPプール（FLASH, RETURN, FREEZE等）のポーション回収・備蓄
 * 3. 不要アイテムの整理
 */
export class PrepareDragonAssaultMission implements IStrategicMission {
  public readonly id = 'PREPARE_DRAGON_ASSAULT';
  public readonly name = '⚔️ 決戦前リソース備蓄・最終調整作戦';
  public readonly maxTurns = 120;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';
  public completionReason?: MissionCompletionReason;
  public subMode: 'DROPPING_JUNK' | 'CASHING_GOLD' | 'COLLECTING_COIN' | 'COLLECTING_POTION' | 'HEALING_AT_HOME' | 'READY_IDLE' = 'COLLECTING_POTION';

  private initialMagic: number | null = null;
  private initialExperience: number | null = null;
  private initialHp: number | null = null;
  private initialGold: number | null = null;

  private ensureInitialized(engine: GameEngine): void {
    const player = engine.getPlayer();
    if (this.initialMagic === null) {
      this.initialMagic = player.magic;
      this.initialExperience = player.experience;
      this.initialHp = player.hp;
      this.initialGold = player.gold;
    }
  }

  private hasMadeProgress(engine: GameEngine): boolean {
    const player = engine.getPlayer();
    return (
      (this.initialMagic !== null && player.magic > this.initialMagic) ||
      (this.initialExperience !== null && player.experience > this.initialExperience) ||
      (this.initialHp !== null && player.hp > this.initialHp) ||
      (this.initialGold !== null && player.gold > this.initialGold) ||
      (this.initialGold !== null && this.initialGold > 0 && player.gold < this.initialGold)
    );
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    this.ensureInitialized(engine);
    const player = engine.getPlayer();
    const madeProgress = this.hasMadeProgress(engine);
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

    // マップ上に到達可能ポーション・コインが無く、ゴールドも無く、HPも十分でこれ以上補給手段がない場合:
    // タイムアウトまで無駄に徘徊せず即終了し、決戦・開削・宝箱補給へ転進させる
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
      if (madeProgress) {
        this.completionReason = 'PARTIAL_PROGRESS';
        return 'COMPLETED';
      }
      this.completionReason = 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }

    // タイムアウト時: ステータス進捗があれば COMPLETED(PARTIAL_PROGRESS)、0進捗なら偽完了にせず ABORTED(NO_PROGRESS_TIMEOUT)
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

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    this.ensureInitialized(engine);
    const player = engine.getPlayer();
    const map = snapshot.map;

    // 1. 不要アイテム（CROSS, KEY等）の手放し（手ぶらでコイン・ポーションを拾えるようにする）
    if (player.holdItem !== 'NONE' && player.holdItem !== 'POWER_STONE') {
      this.subMode = 'DROPPING_JUNK';
      return {
        type: 'DROP_HOLD_ITEM',
        priority: 95,
        reason: `決戦準備のため不要アイテム手放し [${player.holdItem}]`,
      };
    }

    const assessment = ReadinessEvaluator.evaluateDragonReadiness(snapshot, engine, this.turnsElapsed);
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

    // 3. コインまとめ回収 vs 我が家で一括換金の判定
    const estimatedGainedExp = player.gold * 300 + Math.floor(player.experience * 0.02 * player.gold);
    const afterExp = player.experience + estimatedGainedExp;
    const reachesMilestone =
      (player.experience < 4000 && afterExp >= 4000) ||
      (player.experience < 12000 && afterExp >= 12000) ||
      (player.experience < snapshot.params.targetDefenseExp && afterExp >= snapshot.params.targetDefenseExp);
    const nearestCoin = items.nearestCoin;
    const distNearestCoin = nearestCoin ? map.getTorusDistance(player.pos, nearestCoin).manhattan : Infinity;
    const maxSweepGold = player.experience < 12000 ? 5 : 7;
    const canKeepSweepingCoins =
      Boolean(assessment.needsCoinSweep) &&
      nearestCoin !== null &&
      player.gold < maxSweepGold &&
      !reachesMilestone &&
      this.turnsElapsed < 65 &&
      (distNearestCoin <= 10 || (player.experience < 12000 && this.turnsElapsed < 40));

    if (player.gold > 0 && !canKeepSweepingCoins) {
      this.subMode = 'CASHING_GOLD';
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: map.realHomePos,
        priority: 92,
        reason: `決戦前コイン換金・EXPオーバーヒールへ帰還 [所持:${player.gold}G]`,
      };
    }

    // 4. 緊急MP (MP < 3) 時は最寄りポーション優先（BREAK用MP温存・確保）
    const potionPos = items.nearestPotion;
    const distNearestPotion = potionPos ? map.getTorusDistance(player.pos, potionPos).manhattan : Infinity;
    if (player.magic < 3 && potionPos && (distNearestPotion <= distNearestCoin || !canKeepSweepingCoins)) {
      this.subMode = 'COLLECTING_POTION';
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: potionPos,
        targetItemType: 'POTION',
        priority: 90,
        reason: `決戦前MP備蓄(急務): ポーションへ移動 (${potionPos.x}, ${potionPos.y})`,
      };
    }

    // 5. EXP不足時の床コイン一括スイープ回収 (近傍15以内またはEXP<12000なら遠方も対象)
    if (
      assessment.needsCoinSweep &&
      nearestCoin &&
      player.gold < 8 &&
      (player.experience < 12000 || distNearestCoin <= 15)
    ) {
      this.subMode = 'COLLECTING_COIN';
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: nearestCoin,
        targetItemType: 'COIN',
        priority: 86,
        reason: `決戦前EXP育成: 床コイン回収 (${nearestCoin.x}, ${nearestCoin.y}) [所持:${player.gold}G]`,
      };
    }

    // 6. 通常MP備蓄: マップ全域の安全な最寄りポーションを探索して回収 (認知層のマップサマリを参照)
    if (potionPos) {
      this.subMode = 'COLLECTING_POTION';
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: potionPos,
        targetItemType: 'POTION',
        priority: 88,
        reason: `決戦前MP備蓄: ポーションへ移動 (${potionPos.x}, ${potionPos.y})`,
      };
    }

    // 7. 残余ゴールドの換金フォールバック
    if (player.gold > 0) {
      this.subMode = 'CASHING_GOLD';
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
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: map.realHomePos,
        priority: 85,
        reason: '決戦前HP全回復のため我が家へ帰還',
      };
    }

    // 準備完了（または到達可能資源なし）
    this.subMode = 'READY_IDLE';
    return {
      type: 'WANDER_SAFELY',
      priority: 20,
      reason: '決戦突入準備完了',
    };
  }
}
