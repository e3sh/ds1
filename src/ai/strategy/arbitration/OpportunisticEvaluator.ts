import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { ThreatEvaluator } from '../../../systems/ThreatEvaluator.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { EarlyBreakUnlockMission } from '../missions/EarlyBreakUnlockMission.js';

/**
 * OpportunisticEvaluator (並行基本行動評価モジュール)
 *
 * 主作戦遂行中の移動動線上にあるアイテム（コイン・ポーション）のついで拾いや、
 * 安全な雑魚敵のワンパン撃破ディレクティブを評価・生成する。
 */
export class OpportunisticEvaluator {
  /**
   * 並行基本行動 1: 動線上のついで拾い評価
   */
  public static evaluatePickup(
    snapshot: TacticalSnapshot,
    engine: GameEngine,
    mainDirective: StrategicDirective
  ): StrategicDirective | null {
    const player = engine.getPlayer();
    const map = snapshot.map;
    const pPos = player.pos;

    // 0. 既に死神憑依中の場合、近傍（距離<=3）の地面の死神は手持ちアイテムに関わらず踏むだけで安全に排除できる
    if (player.hasDeath) {
      const nearestDeath = MapSituationEvaluator.get(snapshot, engine).items.nearestDeath;
      if (nearestDeath) {
        const deathDist = map.getTorusDistance(pPos, nearestDeath).manhattan;
        if (deathDist >= 1 && deathDist <= 3) {
          return {
            type: 'NAVIGATE_TO_POSITION',
            targetPos: nearestDeath,
            priority: 90 - deathDist,
            reason: `💀 死神憑依中のため動線近傍の死神を安全排除 (${nearestDeath.x}, ${nearestDeath.y}) [距離:${deathDist}]`,
          };
        }
      }
    }

    // DS1では手ぶら（holdItem === 'NONE'）でしか床のアイテム（COIN, POTION）を拾えない
    if (!snapshot.milestones.canPickupFloorItem) {
      return null;
    }

    // A. 現在地の足元にあるアイテム（距離 0）
    const floorItem = map.getItem(pPos);
    if (floorItem === 'COIN' || (floorItem === 'POTION' && player.magic < snapshot.params.maxTargetMagic)) {
      if (mainDirective.type === 'PICKUP_ITEM' && mainDirective.targetItemType === floorItem) {
        return null;
      }
      return {
        type: 'PICKUP_ITEM',
        targetItemType: floorItem,
        priority: 92,
        reason: `動線上の足元アイテム [${floorItem === 'POTION' ? '魔法の壺(MP回復)' : '金貨'}] をついで回収`,
      };
    }

    // B. 近傍にあるアイテム（認知層の P 層観測結果を参照し、S 層での空間走査ループを排除）
    const bestCandidate = MapSituationEvaluator.get(snapshot, engine).items.bestOpportunisticItem;
    if (bestCandidate) {
      const integerDist = Math.ceil(bestCandidate.dist);
      const priority = 90 - integerDist;
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: bestCandidate.pos,
        targetItemType: bestCandidate.type,
        priority,
        reason: `動線近傍の [${bestCandidate.type === 'POTION' ? '魔法の壺(MP回復)' : '金貨'}] (${bestCandidate.pos.x}, ${bestCandidate.pos.y}) を能動回収 [距離:${integerDist}]`,
      };
    }

    return null;
  }

  /**
   * 並行基本行動 2: 動線上の安全敵ワンパン評価
   */
  public static evaluateCombat(
    snapshot: TacticalSnapshot,
    engine: GameEngine,
    _mainDirective: StrategicDirective
  ): StrategicDirective | null {
    const player = engine.getPlayer();
    if (!snapshot.milestones.hasSword || player.holdItem === 'CROSS') {
      return null;
    }

    const map = snapshot.map;
    const pPos = player.pos;
    const isClassicExpNeeded =
      snapshot.params.coinGrantsExp === false &&
      player.experience < snapshot.params.targetDefenseExp &&
      player.holdItem !== 'POWER_STONE' &&
      player.holdItem !== 'CROWN' &&
      EarlyBreakUnlockMission.isHpSafeForHunting(player, snapshot);
    const maxOpportunisticDist = isClassicExpNeeded ? 4 : 2;

    let bestEnemy: any = null;
    let minEnemyDist = Infinity;

    for (const enemy of snapshot.livingEnemies) {
      if (!enemy.isAlive || enemy.isPermanentlyFrozen) continue;
      if (snapshot.memory.isTargetUnreachable(enemy.pos, snapshot.totalTurns)) continue;

      const dist = map.getTorusDistance(pPos, enemy.pos).manhattan;
      if (dist > maxOpportunisticDist) continue;

      const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
      const isCompletelySafe = details.defenseThreat === 'NO_DAMAGE' || (
        details.defenseThreat !== 'LETHAL' &&
        !details.hasDrain &&
        details.damageToPlayer < player.hp * 0.05
      );
      const isClassicSafe =
        isClassicExpNeeded &&
        details.defenseThreat !== 'LETHAL' &&
        !details.hasDrain &&
        details.damageToPlayer < player.hp * 0.35;
      if (!isCompletelySafe && !isClassicSafe) continue;

      const isQuickKill = details.attackThreat === 'ONE_SHOT' || details.turnsToKill <= (isClassicExpNeeded ? 3 : 2);
      if (!isQuickKill) continue;

      if (dist < minEnemyDist) {
        minEnemyDist = dist;
        bestEnemy = enemy;
      }
    }

    if (bestEnemy) {
      const priority =
        minEnemyDist === 1
          ? (isClassicExpNeeded ? 88 : 80)
          : (isClassicExpNeeded && minEnemyDist <= 3 ? 86 : 74);
      return {
        type: 'ATTACK_TARGET',
        targetPos: bestEnemy.pos,
        priority,
        reason: `動線上の安全敵を一撃排除 (${bestEnemy.name}) [距離:${minEnemyDist}]`,
      };
    }

    return null;
  }
}
