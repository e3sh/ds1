import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { GameEngine } from '../../../core/GameEngine.js';

export interface DragonReadinessAssessment {
  isFullyPrepared: boolean;
  needsPotionSweep: boolean;
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

    // 準備にターンを費やしすぎた場合 (35ターン超過) で、最低限のMP (>=3) かつ斜め移動・BREAK習得済みなら決戦へフォールスルー
    const isReadyBase = snapshot.milestones.canDiagonal && snapshot.milestones.canBreak && player.magic >= 3;
    const isTimeoutBypass = prepTurns > 35 && isReadyBase;
    if (isTimeoutBypass) {
      return {
        isFullyPrepared: true,
        needsPotionSweep: false,
        needsGoldCashIn: false,
        needsRelocation: false,
        reason: '準備ターン超過のため決戦へ移行',
      };
    }

    // 1. 手持ちコインの換金評価 (EXPによる防御力強化 ＆ 最大HP超えのオーバーヒール)
    const needsGoldCashIn = player.gold > 0;

    // 2. マップ上のポーション残存数とMPプール評価
    // 近傍（距離 <= 15）にある安全なポーションのみをカウントし、遠方ポーションのための全マップ横断を防止
    let nearbyReachablePotionCount = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (map.getItem(p) === 'POTION' && !snapshot.memory.isTargetUnreachable(p, snapshot.totalTurns)) {
          const d = map.getTorusDistance(player.pos, p).manhattan;
          if (d <= 15) {
            nearbyReachablePotionCount++;
          }
        }
      }
    }

    // MP が minDragonMagic (3) 未満の場合は必須。すでに MP >= 3 あれば近傍ポーションのみ集め、遠くのポーション探索はスキップ
    const targetMagic = nearbyReachablePotionCount > 0 ? Math.min(snapshot.params.maxTargetMagic, 6) : snapshot.params.minDragonMagic;
    const needsPotionSweep = player.magic < 3 || (nearbyReachablePotionCount > 0 && player.magic < targetMagic && prepTurns < 25);

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

    const isFullyPrepared = !needsGoldCashIn && !needsPotionSweep && !needsRelocation && hasEnoughHp;

    let reason = '決戦準備完了';
    if (needsGoldCashIn) reason = `手持ちコイン換金が必要 [所持:${player.gold}G]`;
    else if (needsPotionSweep) reason = `決戦用MP備蓄が必要 [MP:${player.magic}/${targetMagic}]`;
    else if (needsRelocation) reason = '前線基地移転が必要';
    else if (!hasEnoughHp) reason = '決戦前HP回復が必要';

    return {
      isFullyPrepared,
      needsPotionSweep,
      needsGoldCashIn,
      needsRelocation,
      reason,
    };
  }

  public static hasMapRing(map: any, snapshot: TacticalSnapshot): boolean {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (map.getItem(p) === 'RING' && !snapshot.memory.isTargetUnreachable(p, snapshot.totalTurns)) {
          return true;
        }
      }
    }
    return false;
  }
}
