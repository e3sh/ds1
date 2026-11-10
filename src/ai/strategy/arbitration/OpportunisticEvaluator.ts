import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { Position } from '../../../models/Types.js';
import { ThreatEvaluator } from '../../../systems/ThreatEvaluator.js';

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

    // B. 近傍（マンハッタン距離 1〜3歩以内）にあるアイテム
    let bestItemPos: Position | null = null;
    let bestItemType: string | null = null;
    let bestDist = Infinity;

    const maxSearchDist = 3;
    for (let dy = -maxSearchDist; dy <= maxSearchDist; dy++) {
      for (let dx = -maxSearchDist; dx <= maxSearchDist; dx++) {
        const manhattan = Math.abs(dx) + Math.abs(dy);
        if (manhattan < 1 || manhattan > maxSearchDist) continue;

        const checkPos = map.wrapPosition({ x: pPos.x + dx, y: pPos.y + dy });
        if (snapshot.memory.isTargetUnreachable(checkPos, snapshot.totalTurns)) continue;

        const item = map.getItem(checkPos);
        if (item !== 'COIN' && item !== 'POTION') continue;
        if (item === 'POTION' && player.magic >= snapshot.params.maxTargetMagic) continue;

        // 安全性チェック: 敵が重なっていないか
        const enemyOnSpot = snapshot.livingEnemies.some(
          e => e.isAlive && e.pos.x === checkPos.x && e.pos.y === checkPos.y
        );
        if (enemyOnSpot) continue;

        // 安全性チェック: 即死級敵の直角隣接でないか
        const isNearLethal = snapshot.threats.adjacentLethalEnemies.length > 0;
        if (isNearLethal) continue;

        // 壁や岩で塞がれていないか
        if (map.getBaseTile(checkPos) === 'WALL_STATIC' || map.getObject(checkPos) === 'BLOCK') continue;

        // POTION を COIN より優先（POTIONならスコアボーナス）
        const score = manhattan - (item === 'POTION' ? 0.5 : 0);
        if (score < bestDist) {
          bestDist = score;
          bestItemPos = checkPos;
          bestItemType = item;
        }
      }
    }

    if (bestItemPos && bestItemType) {
      // 手ぶら歩行時は至近のPOTION/COINを主作戦移動(85)より優先して確実に回収
      // 距離1=88, 距離2=87, 距離3=86
      const integerDist = Math.ceil(bestDist);
      const priority = 89 - integerDist;
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: bestItemPos,
        targetItemType: bestItemType,
        priority,
        reason: `動線近傍の [${bestItemType === 'POTION' ? '魔法の壺(MP回復)' : '金貨'}] (${bestItemPos.x}, ${bestItemPos.y}) を能動回収 [距離:${integerDist}]`,
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
