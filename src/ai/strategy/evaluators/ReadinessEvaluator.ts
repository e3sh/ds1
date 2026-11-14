import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { GameEngine } from '../../../core/GameEngine.js';

export interface DragonReadinessAssessment {
  isFullyPrepared: boolean;
  needsPotionSweep: boolean;
  needsCoinSweep?: boolean;
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
    prepTurns: number
  ): DragonReadinessAssessment {
    const player = engine.getPlayer();
    const map = snapshot.map;
    const dragon = engine.getDragon();

    const items = MapSituationEvaluator.get(snapshot).items;
    const nearbyReachablePotionCount = items.nearbyPotionCountWithin15;
    const noReachablePotion = nearbyReachablePotionCount === 0 && items.nearestPotion === null;
    const hasMinimumCombatMagic = player.magic >= 3 || (noReachablePotion && player.magic >= 1);

    // 準備にターンを費やしすぎた場合 (35ターン超過) で、最低限のMP (原則>=3、ポーション枯渇時は>=1) かつ斜め移動・BREAK習得済みなら決戦へフォールスルー
    const isReadyBase = snapshot.milestones.canDiagonal && snapshot.milestones.canBreak && hasMinimumCombatMagic;
    const isTimeoutBypass = prepTurns > 35 && isReadyBase;
    if (isTimeoutBypass) {
      return {
        isFullyPrepared: true,
        needsPotionSweep: false,
        needsCoinSweep: false,
        needsGoldCashIn: false,
        needsRelocation: false,
        reason: '準備ターン超過のため決戦へ移行',
      };
    }

    // 1. 手持ちコインの換金評価 (EXPによる防御力強化 ＆ 最大HP超えのオーバーヒール)
    const needsGoldCashIn = player.gold > 0;

    // 1-B. 床上コインの一括回収評価 (斜め移動 EXP 12,000 未満、または防御EXP未達時のEXP育成)
    const needExpForDiagonal = player.experience < 12000 || !snapshot.milestones.canDiagonal;
    const needExpForDefense = player.experience < snapshot.params.targetDefenseExp && prepTurns < 30;
    const hasReachableCoins = items.nearestCoin !== null;
    const progConfig = player.activeProgressionConfig;
    const isExponentialCoinMode =
      progConfig?.coinScalingMode === 'EXPONENTIAL' ||
      progConfig?.ruleMode === 'EXPONENTIAL' ||
      (!progConfig?.ruleMode &&
        (progConfig?.expCurveMode === 'DAMPED_POWER' ||
          progConfig?.expCurveMode === 'PHASE_CAPPED' ||
          !progConfig));
    const needsCoinSweep = isExponentialCoinMode && hasReachableCoins && (needExpForDiagonal || needExpForDefense);

    // 2. マップ上のポーション残存数とMPプール評価
    // 近傍（距離 <= 15）にある安全なポーションのみをカウントし、遠方ポーションのための全マップ横断を防止
    // MP が minDragonMagic (3) 未満の場合は原則必要だが、到達可能ポーションが全て枯渇している場合は無限準備ループを避ける
    const targetMagic = nearbyReachablePotionCount > 0 ? Math.min(snapshot.params.maxTargetMagic, 6) : snapshot.params.minDragonMagic;
    const needsPotionSweep = !noReachablePotion && (player.magic < 3 || (nearbyReachablePotionCount > 0 && player.magic < targetMagic && prepTurns < 25));

    // 3. 前線基地移転評価
    let needsRelocation = false;
    if (snapshot.params.enableHomeRelocation && dragon && dragon.defeatedHeadsCount === 0) {
      const distHomeToDragon = map.getTorusDistance(map.realHomePos, dragon.centerPos).chebyshev;
      const hasRing = player.holdItem === 'RING' || this.hasMapRing(map, snapshot);
      if (distHomeToDragon >= snapshot.params.homeRelocateDistMin && hasRing && prepTurns < 30) {
        needsRelocation = true;
      }
    }

    // 4. HP十分性チェック (最大HPの70%以上または30,000以上)
    const hasEnoughHp = player.hp >= player.maxHp * 0.70 || player.hp >= 30000;

    const isFullyPrepared = !needsGoldCashIn && !needsPotionSweep && !needsCoinSweep && !needsRelocation && hasEnoughHp;

    let reason = '決戦準備完了';
    if (needsGoldCashIn) reason = `手持ちコイン換金が必要 [所持:${player.gold}G]`;
    else if (needsCoinSweep) reason = `コイン回収によるEXP育成が必要 [EXP:${player.experience}]`;
    else if (needsPotionSweep) reason = `決戦用MP備蓄が必要 [MP:${player.magic}/${targetMagic}]`;
    else if (needsRelocation) reason = '前線基地移転が必要';
    else if (!hasEnoughHp) reason = '決戦前HP回復が必要';

    return {
      isFullyPrepared,
      needsPotionSweep,
      needsCoinSweep,
      needsGoldCashIn,
      needsRelocation,
      reason,
    };
  }

  public static hasMapRing(_map: any, snapshot: TacticalSnapshot): boolean {
    return MapSituationEvaluator.get(snapshot).items.rings.length > 0;
  }
}
