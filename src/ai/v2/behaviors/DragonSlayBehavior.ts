import { Direction, Position } from '../../../models/Types.js';
import { WorldMap } from '../../../models/WorldMap.js';
import { Player } from '../../../models/Player.js';
import { EnemyInstance } from '../../../models/Enemy.js';
import { Dragon } from '../../../models/Dragon.js';
import { MagicSystem } from '../../../systems/MagicSystem.js';
import { ThreatEvaluator } from '../../../systems/ThreatEvaluator.js';
import { BehaviorResult, DynamicBotParameters } from '../BotTypesV2.js';
import { AdaptiveNavigator } from '../AdaptiveNavigator.js';
import { TacticalContext } from '../TacticalContext.js';

/**
 * DragonSlayBehavior
 *
 * ドラゴン要塞進軍、安全ポジション確保、斜めからの首各個撃破を担当。
 */
export class DragonSlayBehavior {
  public static execute(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    nav: AdaptiveNavigator,
    context: TacticalContext,
    params: DynamicBotParameters
  ): BehaviorResult | null {
    const curPos = player.pos;
    const livingHeads = dragon.heads.filter(h => h.isAlive);
    if (livingHeads.length === 0) return null;

    const homePos = map.realHomePos;
    const isLastHead = livingHeads.length === 1;

    // 0. 不要な手持ちアイテム（KEY, RING, CROSS等）があれば即座に手放して身軽にする
    if (player.holdItem !== 'NONE') {
      const floorItem = map.getItem(curPos);
      const floorObj = map.getObject(curPos);
      if (floorItem === 'NONE' && floorObj === 'NONE') {
        return {
          action: { type: 'SPACE' },
          description: `🗑️ 決戦前不要アイテム手放し [${player.holdItem}]`,
        };
      }
    }

    // 1. 直角隣接（マンハッタン距離1）に危険な敵（被ダメ大・即死）がいる場合、FREEZEで即時無力化
    const adjacentEnemies = enemies.filter(
      e => e.isAlive && !e.isPermanentlyFrozen && map.getTorusDistance(curPos, e.pos).manhattan === 1
    );
    const hasDangerousAdjacent = adjacentEnemies.some(e => {
      const threat = ThreatEvaluator.evaluateThreat(player, e);
      return threat === 'LETHAL' || threat === 'DANGER' || e.atk > player.experience;
    });

    if (hasDangerousAdjacent && player.magic > 0 && !player.hasDeath && MagicSystem.canCast(player, 'FREEZE').allowed) {
      return {
        action: { type: 'MAGIC', magic: 'FREEZE' },
        description: '❄️ 首決戦中の隣接危険敵FREEZE無力化',
      };
    }

    // 2. HP危機時 (HP < 35% かつ < 20,000): 首への突撃より前に前線基地（我が家）へ帰還して回復
    const isDamaged = player.hp < player.maxHp * 0.35 && player.hp < 20000;
    if (isDamaged) {
      const dirToHome = nav.findPath(curPos, homePos, map, player, enemies, params, { dragon });
      if (dirToHome) {
        return {
          action: { type: 'MOVE', dir: dirToHome },
          description: '🏠 決戦中HP回復のため我が家へ帰還',
        };
      }
    }

    // 3. 最後の首撃破前の MP 万全化 (MP < 2 なら CROWN_ESCAPE での FLASH/RETURN が使えないため補充)
    if (isLastHead && player.magic < 2) {
      // 3-A. 近傍のポット回収
      const potionCandidates = nav.findNearestItemCandidates(curPos, 'POTION', map, enemies, player, 4);
      for (const potPos of potionCandidates) {
        const dist = map.getTorusDistance(curPos, potPos).manhattan;
        if (dist <= context.scale.nearRadius) {
          const dir = nav.findPath(curPos, potPos, map, player, enemies, params, { dragon });
          if (dir) {
            return {
              action: { type: 'MOVE', dir },
              description: `🧪 最終首決戦前のMP補給 (${potPos.x}, ${potPos.y}) [距離: ${dist}]`,
            };
          }
        }
      }
      // 3-B. 前線基地へ帰還して回復
      const dirToHome = nav.findPath(curPos, homePos, map, player, enemies, params, { dragon });
      if (dirToHome) {
        return {
          action: { type: 'MOVE', dir: dirToHome },
          description: '🏠 最終首撃破前のMP/HP補給のため我が家へ帰還',
        };
      }
    }

    // 4. 首の斜め隣接マスにいる場合: 首攻撃を実行！（HP・MP万全時のみ）
    for (const head of livingHeads) {
      const dx = Math.abs(curPos.x - head.pos.x);
      const dy = Math.abs(curPos.y - head.pos.y);
      const isDiagonal = (dx === 1 || dx === map.width - 1) && (dy === 1 || dy === map.height - 1);
      if (isDiagonal) {
        const dir = this.getDirectionToward(curPos, head.pos, map);
        if (dir) {
          return {
            action: { type: 'MOVE', dir },
            description: `🐉 ドラゴンの首攻撃実行！ (${head.pos.x}, ${head.pos.y})`,
          };
        }
      }
    }

    // 5. 最後の首で隣接に危険敵がいる場合、FREEZEで無力化
    if (isLastHead && player.magic > 0 && !player.hasDeath) {
      const adjEnemies = enemies.filter(e => e.isAlive && !e.isPermanentlyFrozen && map.getTorusDistance(curPos, e.pos).manhattan === 1);
      if (adjEnemies.length > 0 && MagicSystem.canCast(player, 'FREEZE').allowed) {
        return {
          action: { type: 'MAGIC', magic: 'FREEZE' },
          description: '❄️ 最終首撃破前の隣接敵FREEZE無力化',
        };
      }
    }

    // 3. 最も近い首の安全な斜め隣接攻撃マスへ進軍
    const attackSpot = this.findBestAttackSpot(curPos, livingHeads, map, dragon, enemies, nav, params);
    if (attackSpot) {
      const dir = nav.findPath(curPos, attackSpot, map, player, enemies, params, { dragon });
      if (dir) {
        const dist = map.getTorusDistance(curPos, attackSpot).chebyshev;
        return {
          action: { type: 'MOVE', dir },
          description: `🐉 首攻撃ポジションへ進軍 (${attackSpot.x}, ${attackSpot.y}) [距離: ${dist}]`,
        };
      }
    }

    return null;
  }

  private static findBestAttackSpot(
    curPos: Position,
    livingHeads: { pos: Position }[],
    map: WorldMap,
    dragon: Dragon,
    _enemies: EnemyInstance[],
    _nav: AdaptiveNavigator,
    _params: DynamicBotParameters
  ): Position | null {
    let bestSpot: Position | null = null;
    let minDist = Infinity;

    const deltas = [
      { dx: -1, dy: -1 },
      { dx: 1, dy: -1 },
      { dx: -1, dy: 1 },
      { dx: 1, dy: 1 },
    ];

    for (const head of livingHeads) {
      for (const d of deltas) {
        const spot = map.wrapPosition({ x: head.pos.x + d.dx, y: head.pos.y + d.dy });
        if (map.getBaseTile(spot) === 'WALL_STATIC') continue;
        if (dragon.getPartAt(spot)) continue;

        // いずれかの首と直角隣接（縦横1マス）していないこと（ブレス直撃防止）
        const isOrthogonal = livingHeads.some(h => map.getTorusDistance(spot, h.pos).manhattan === 1);
        if (isOrthogonal) continue;

        const dist = map.getTorusDistance(curPos, spot).chebyshev;
        if (dist < minDist) {
          minDist = dist;
          bestSpot = spot;
        }
      }
    }

    return bestSpot;
  }

  private static getDirectionToward(from: Position, to: Position, map: WorldMap): Direction | null {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    if (dx > map.width / 2) dx -= map.width;
    if (dx < -map.width / 2) dx += map.width;
    if (dy > map.height / 2) dy -= map.height;
    if (dy < -map.height / 2) dy += map.height;

    if (dx === -1 && dy === -1) return 'UP_LEFT';
    if (dx === 1 && dy === -1) return 'UP_RIGHT';
    if (dx === -1 && dy === 1) return 'DOWN_LEFT';
    if (dx === 1 && dy === 1) return 'DOWN_RIGHT';
    if (dx === 0 && dy === -1) return 'UP';
    if (dx === 0 && dy === 1) return 'DOWN';
    if (dx === -1 && dy === 0) return 'LEFT';
    if (dx === 1 && dy === 0) return 'RIGHT';
    return null;
  }
}
