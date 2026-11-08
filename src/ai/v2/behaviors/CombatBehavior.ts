import { Direction, Position } from '../../../models/Types.js';
import { WorldMap } from '../../../models/WorldMap.js';
import { Player } from '../../../models/Player.js';
import { EnemyInstance } from '../../../models/Enemy.js';
import { Dragon } from '../../../models/Dragon.js';
import { ThreatEvaluator } from '../../../systems/ThreatEvaluator.js';
import { MagicSystem } from '../../../systems/MagicSystem.js';
import { MovementSystem } from '../../../systems/MovementSystem.js';
import { KICK_MAX_RANGE } from '../../../config/Constants.js';
import { BehaviorResult, DynamicBotParameters } from '../BotTypesV2.js';
import { AdaptiveNavigator } from '../AdaptiveNavigator.js';
import { TacticalContext } from '../TacticalContext.js';

/**
 * CombatBehavior
 *
 * 安全敵の排除、KICK直線スナイプ、FREEZE/FLASHによる緊急無力化を担当。
 */
export class CombatBehavior {
  public static execute(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    nav: AdaptiveNavigator,
    _context: TacticalContext,
    params: DynamicBotParameters
  ): BehaviorResult | null {
    const curPos = player.pos;

    // 1. 直角隣接の敵を検出
    const adjacentTargets = this.getAdjacentEnemies(curPos, enemies, map);

    // 2. 緊急無力化: 隣接に危険敵がいて、MP温存ラインを満たしている場合
    const hasDangerousAdj = adjacentTargets.some(
      ({ enemy }) => ThreatEvaluator.evaluateThreat(player, enemy) === 'LETHAL' ||
                     ThreatEvaluator.evaluateThreat(player, enemy) === 'DANGER'
    );

    if (hasDangerousAdj && player.magic > params.magicReserveThreshold && !player.hasDeath) {
      if (MagicSystem.canCast(player, 'FREEZE').allowed) {
        const unfrozen = adjacentTargets.find(({ enemy }) => !enemy.isPermanentlyFrozen);
        if (unfrozen) {
          return {
            action: { type: 'MAGIC', magic: 'FREEZE' },
            description: `❄️ FREEZE自衛詠唱 (${unfrozen.enemy.name})`,
          };
        }
      }
      if (MagicSystem.canCast(player, 'FLASH').allowed) {
        return {
          action: { type: 'MAGIC', magic: 'FLASH' },
          description: '⚡ FLASH全敵足止め詠唱',
        };
      }
    }

    // 3. 直線上の KICK スナイプ（即死岩飛ばし）
    const kickAction = this.tryKickSnipe(player, map, enemies, dragon);
    if (kickAction) return kickAction;

    // 4. 直角隣接の ONE_SHOT 敵を攻撃排除
    for (const { enemy, dir } of adjacentTargets) {
      if (dragon && dragon.getPartAt(enemy.pos)) continue;
      const threat = ThreatEvaluator.evaluateThreat(player, enemy);
      if (threat === 'ONE_SHOT') {
        return {
          action: { type: 'MOVE', dir },
          description: `⚔️ 隣接敵撃破 (${enemy.name})`,
        };
      }
    }

    // 5. 能動的敵追尾狩り（params.huntDistance > 0 の場合）
    if (params.huntDistance > 0 && player.hasSword) {
      const targetEnemy = this.findNearestSafeEnemy(curPos, enemies, map, player, params.huntDistance, nav);
      if (targetEnemy) {
        const dir = nav.findPath(curPos, targetEnemy.pos, map, player, enemies, params, { dragon });
        if (dir) {
          const dist = map.getTorusDistance(curPos, targetEnemy.pos).manhattan;
          return {
            action: { type: 'MOVE', dir },
            description: `⚔️ 安全敵追尾 (${targetEnemy.name}) [距離: ${dist}]`,
          };
        }
      }
    }

    return null;
  }

  public static tryKickSnipe(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon
  ): BehaviorResult | null {
    if (!MagicSystem.canCast(player, 'KICK').allowed) return null;
    if (player.experience < 6000) return null;

    const dirs: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
    const curPos = player.pos;

    for (const dir of dirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(curPos, dir));
      if (map.getObject(nextPos) !== 'BLOCK') continue;

      // 岩の先をスキャン
      for (let step = 1; step <= KICK_MAX_RANGE; step++) {
        const scanPos = map.wrapPosition({
          x: nextPos.x + (dir === 'RIGHT' ? step : dir === 'LEFT' ? -step : 0),
          y: nextPos.y + (dir === 'DOWN' ? step : dir === 'UP' ? -step : 0),
        });

        if (map.getBaseTile(scanPos) === 'WALL_STATIC') break;
        if (dragon && dragon.getPartAt(scanPos)) break;

        const hitEnemy = enemies.find(e => e.isAlive && e.pos.x === scanPos.x && e.pos.y === scanPos.y);
        if (hitEnemy) {
          player.dir = dir;
          return {
            action: { type: 'MAGIC', magic: 'KICK' },
            description: `🎯 KICKスナイプ発動 (${hitEnemy.name})`,
          };
        }

        if (map.getObject(scanPos) !== 'NONE') break;
      }
    }
    return null;
  }

  private static getAdjacentEnemies(
    pos: Position,
    enemies: EnemyInstance[],
    map: WorldMap
  ): { enemy: EnemyInstance; dir: Direction }[] {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const results: { enemy: EnemyInstance; dir: Direction }[] = [];

    for (const d of cardDirs) {
      const nextP = map.wrapPosition(MovementSystem.getNextPosition(pos, d));
      const e = enemies.find(enemy => enemy.isAlive && enemy.pos.x === nextP.x && enemy.pos.y === nextP.y);
      if (e) {
        results.push({ enemy: e, dir: d });
      }
    }
    return results;
  }

  public static findNearestSafeEnemy(
    from: Position,
    enemies: EnemyInstance[],
    map: WorldMap,
    player: Player,
    maxDist: number,
    nav: AdaptiveNavigator
  ): EnemyInstance | null {
    let nearest: EnemyInstance | null = null;
    let minDist = Infinity;

    for (const e of enemies) {
      if (!e.isAlive || e.isPermanentlyFrozen) continue;
      if (nav.isTargetUnreachable(e.pos)) continue;

      const threat = ThreatEvaluator.evaluateThreat(player, e);
      if (threat !== 'ONE_SHOT') continue;

      const dist = map.getTorusDistance(from, e.pos).manhattan;
      if (dist <= maxDist && dist < minDist) {
        minDist = dist;
        nearest = e;
      }
    }
    return nearest;
  }
}
