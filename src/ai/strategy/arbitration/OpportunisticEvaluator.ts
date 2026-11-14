import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { ThreatEvaluator } from '../../../systems/ThreatEvaluator.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';

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
    // DS1では手ぶら（holdItem === 'NONE'）でしか床のアイテム（COIN, POTION）を拾えない
    if (!snapshot.milestones.canPickupFloorItem) {
      return null;
    }

    const player = engine.getPlayer();
    const map = snapshot.map;
    const pPos = player.pos;

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

    let bestEnemy: any = null;
    let minEnemyDist = Infinity;

    for (const enemy of snapshot.livingEnemies) {
      if (!enemy.isAlive || enemy.isPermanentlyFrozen) continue;
      if (snapshot.memory.isTargetUnreachable(enemy.pos, snapshot.totalTurns)) continue;

      const dist = map.getTorusDistance(pPos, enemy.pos).manhattan;
      if (dist > 2) continue; // 直角隣接(1)または至近2歩以内(2)

      const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
      const isCompletelySafe = details.defenseThreat === 'NO_DAMAGE' || (
        details.defenseThreat !== 'LETHAL' &&
        !details.hasDrain &&
        details.damageToPlayer < player.hp * 0.05
      );
      if (!isCompletelySafe) continue;

      const isQuickKill = details.attackThreat === 'ONE_SHOT' || details.turnsToKill <= 2;
      if (!isQuickKill) continue;

      if (dist < minEnemyDist) {
        minEnemyDist = dist;
        bestEnemy = enemy;
      }
    }

    if (bestEnemy) {
      const priority = minEnemyDist === 1 ? 80 : 74;
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
