import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { GameEngine } from '../../../core/GameEngine.js';
import { DEFAULT_READINESS_PARAMS } from '../../TacticalContext.js';
import type { PhaseWaiver } from '../command/CommanderTypes.js';

export interface DragonReadinessAssessment {
  isFullyPrepared: boolean;
  needsPotionSweep: boolean;
  needsCoinSweep?: boolean;
  needsTreasureMpFarm?: boolean;
  needsGoldCashIn: boolean;
  needsRelocation: boolean;
  reason: string;
}

/**
 * ReadinessEvaluator (カテゴリ2: 決戦前準備度・将来リソース評価モジュール)
 *
 * STR目標達成後、即座に無謀な決戦突入を行わず、
 * 決戦・王冠脱出で必要となる MPプール、防御EXP、オーバーヒールHPの準備状況を評価する。
 */
export class ReadinessEvaluator {
  public static evaluateDragonReadiness(
    snapshot: TacticalSnapshot,
    engine: GameEngine,
    prepTurns: number,
    waivers?: ReadonlySet<PhaseWaiver>
  ): DragonReadinessAssessment {
    const player = engine.getPlayer();
    const map = snapshot.map;
    const dragon = engine.getDragon();

    const waiveDefense = waivers?.has('DEFENSE_EXP') ?? false;
    const waiveMagic = waivers?.has('MAGIC_STOCK') ?? false;
    const waiveRelocation = waivers?.has('RELOCATION') ?? false;
    const waiveHpFull = waivers?.has('HP_FULL') ?? false;

    const r = snapshot.params.readiness ?? DEFAULT_READINESS_PARAMS;
    const items = MapSituationEvaluator.get(snapshot).items;
    const nearbyReachablePotionCount = items.nearbyPotionCountWithin15;
    const noReachablePotion = nearbyReachablePotionCount === 0 && items.nearestPotion === null;
    const hasMinimumCombatMagic = player.magic >= 3 || ((noReachablePotion || waiveMagic) && player.magic >= 1);

    // 準備にターンを費やしすぎた場合で最低条件を満たせば決戦へフォールスルー
    const crownReserveMagic = Math.min(snapshot.params.maxTargetMagic, r.crownReserveMagic);
    const hasChestSupplyForMp =
      !waiveMagic &&
      player.magic < crownReserveMagic &&
      items.chests.length > 0 &&
      (player.holdItem === 'KEY' || items.keys.length > 0);
    const maxPrepBypassTurns = hasChestSupplyForMp ? r.prepBypassTurnsWithChest : r.prepBypassTurnsNoChest;
    const isReadyBase = snapshot.milestones.canDiagonal && snapshot.milestones.canBreak && hasMinimumCombatMagic;
    const isTimeoutBypass = prepTurns > maxPrepBypassTurns && isReadyBase;
    if (isTimeoutBypass) {
      return {
        isFullyPrepared: true,
        needsPotionSweep: false,
        needsCoinSweep: false,
        needsTreasureMpFarm: false,
        needsGoldCashIn: false,
        needsRelocation: false,
        reason: '準備ターン超過のため決戦へ移行',
      };
    }

    const coinGrantsExp = snapshot.params.coinGrantsExp !== false;

    // 1. 手持ちコインの換金評価 (コインでEXPが増えるモードのみ必須)
    const needsGoldCashIn = coinGrantsExp ? player.gold > 0 : false;

    // 1-B. 床上コインの一括回収評価 (斜め移動 EXP 12,000 未満、または防御EXP未達時のEXP育成)
    const needExpForDiagonal = player.experience < 12000 || !snapshot.milestones.canDiagonal;
    const needExpForDefense = !waiveDefense && player.experience < snapshot.params.targetDefenseExp && prepTurns < r.prepDefenseExpCutoffTurns;
    const hasReachableCoins = items.nearestCoin !== null;
    const needsCoinSweep = coinGrantsExp && hasReachableCoins && (needExpForDiagonal || needExpForDefense);

    // 2. マップ上のポーション残存数とMPプール評価（王冠フェーズを見据えた備蓄）
    const targetMagic = nearbyReachablePotionCount > 0 ? crownReserveMagic : snapshot.params.minDragonMagic;
    const needsPotionSweep = !waiveMagic && !noReachablePotion && (player.magic < 3 || (player.magic < crownReserveMagic && prepTurns < r.prepPotionSweepCutoffTurns) || (nearbyReachablePotionCount > 0 && player.magic < targetMagic && prepTurns < r.prepPotionSweepExtendedTurns));

    // 2-B. 王冠フェーズの魔法枯渇対策: 床ポーション不足でも未開封宝箱と鍵があれば開錠してMPを確保
    const needsTreasureMpFarm = hasChestSupplyForMp && prepTurns < r.prepTreasureMpFarmCutoffTurns;

    // 3. 前線基地移転評価（距離・準備ターンに関わらず、RINGが存在し未移転なら安全な家を増やすため必ず実施）
    let needsRelocation = false;
    if (!waiveRelocation && snapshot.params.enableHomeRelocation && dragon && dragon.defeatedHeadsCount === 0) {
      const hasRing = player.holdItem === 'RING' || this.hasMapRing(map, snapshot);
      if (hasRing) {
        needsRelocation = true;
      }
    }

    // 4. HP十分性チェック (見切り時は緩和)
    const hasEnoughHp = waiveHpFull
      ? (player.hp >= player.maxHp * r.readyHpRatioWaived || player.hp >= r.readyHpMinWaived)
      : (player.hp >= player.maxHp * r.prepHpRatioNormal || player.hp >= r.prepHpMinNormal);

    const isFullyPrepared = !needsGoldCashIn && !needsPotionSweep && !needsCoinSweep && !needsTreasureMpFarm && !needsRelocation && hasEnoughHp;

    let reason = '決戦準備完了';
    if (needsGoldCashIn) reason = `手持ちコイン換金が必要 [所持:${player.gold}G]`;
    else if (needsCoinSweep) reason = `コイン回収によるEXP育成が必要 [EXP:${player.experience}]`;
    else if (needsPotionSweep) reason = `決戦用MP備蓄が必要 [MP:${player.magic}/${targetMagic}]`;
    else if (needsTreasureMpFarm) reason = `王冠フェーズ用MP備蓄のため宝箱開錠が必要 [MP:${player.magic}/${crownReserveMagic}]`;
    else if (needsRelocation) reason = '前線基地移転が必要';
    else if (!hasEnoughHp) reason = '決戦前HP回復が必要';

    return {
      isFullyPrepared,
      needsPotionSweep,
      needsCoinSweep,
      needsTreasureMpFarm,
      needsGoldCashIn,
      needsRelocation,
      reason,
    };
  }

  public static hasMapRing(_map: any, snapshot: TacticalSnapshot): boolean {
    return MapSituationEvaluator.get(snapshot).items.rings.length > 0;
  }
}
