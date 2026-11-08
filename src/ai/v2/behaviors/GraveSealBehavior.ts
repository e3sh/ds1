import { Position } from '../../../models/Types.js';
import { WorldMap } from '../../../models/WorldMap.js';
import { Player } from '../../../models/Player.js';
import { EnemyInstance } from '../../../models/Enemy.js';
import { Dragon } from '../../../models/Dragon.js';
import { BehaviorResult, DynamicBotParameters } from '../BotTypesV2.js';
import { AdaptiveNavigator } from '../AdaptiveNavigator.js';
import { TacticalContext } from '../TacticalContext.js';

/**
 * GraveSealBehavior
 *
 * テーマブロックメタデータ（出口チョークポイント・推奨岩押し）を活用した、
 * 最小歩数での墓封鎖戦術。
 */
export class GraveSealBehavior {
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

    // 1. メタデータに基づく出口チョークポイントの封鎖ターゲット取得
    const openTargets = this.getTargetSealSpots(map, enemies, context, params);
    if (openTargets.length === 0) return null;

    // 2. 十字架所持時: 最寄りの封鎖ターゲットへ移動して設置
    if (player.holdItem === 'CROSS') {
      const nearestTarget = this.findNearestPos(curPos, openTargets, map, nav);
      if (nearestTarget) {
        if (curPos.x === nearestTarget.x && curPos.y === nearestTarget.y) {
          return {
            action: { type: 'SPACE' },
            description: `✝️ 十字架で墓封鎖完了 (${curPos.x}, ${curPos.y})`,
          };
        }
        const dir = nav.findPath(curPos, nearestTarget, map, player, enemies, params, { dragon });
        if (dir) {
          return {
            action: { type: 'MOVE', dir },
            description: `✝️ 十字架で封鎖マスへ移動 (${nearestTarget.x}, ${nearestTarget.y})`,
          };
        }
      }
    }

    // 3. 手ぶら時: 床の未使用十字架があれば回収に向かう
    if (player.holdItem === 'NONE') {
      const unusedCross = this.findNearestUnusedCross(curPos, map, openTargets, nav);
      if (unusedCross) {
        const dist = map.getTorusDistance(curPos, unusedCross).manhattan;
        if (dist <= params.keySearchDist) {
          if (curPos.x === unusedCross.x && curPos.y === unusedCross.y) {
            return {
              action: { type: 'SPACE' },
              description: '✝️ 未使用十字架を拾う',
            };
          }
          const dir = nav.findPath(curPos, unusedCross, map, player, enemies, params, { dragon });
          if (dir) {
            return {
              action: { type: 'MOVE', dir },
              description: `✝️ 十字架回収へ移動 (${unusedCross.x}, ${unusedCross.y})`,
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * メタデータ（出口チョークポイント等）およびマップ構造から未封鎖ターゲット座標を導出
   */
  public static getTargetSealSpots(
    map: WorldMap,
    enemies: EnemyInstance[],
    context: TacticalContext,
    params: DynamicBotParameters
  ): Position[] {
    const home = map.realHomePos;
    const targets: Position[] = [];

    // A. メタデータに箱型墓の出口ヒント (gravePuzzleHints) がある場合、最優先で利用
    if (context.metadata?.gravePuzzleHints && context.metadata.gravePuzzleHints.length > 0) {
      for (const hint of context.metadata.gravePuzzleHints) {
        if (params.graveSealPolicy === 'NEAR_HOME' && hint.priority !== 'HIGH') {
          const distToHome = map.getTorusDistance(home, hint.gravePos).manhattan;
          if (distToHome > params.stoneSearchDist * 1.5) continue;
        }

        if (hint.sealTargetPositions && hint.sealTargetPositions.length > 0) {
          for (const exitPos of hint.sealTargetPositions) {
            if (!this.isTileSealed(exitPos, map, enemies)) {
              targets.push(exitPos);
            }
          }
        }
      }
      if (targets.length > 0) return targets;
    }

    // B. メタデータがない場合は墓周囲8マスの未封鎖マスを抽出
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (map.getBaseTile(p) === 'GRAVE') {
          if (params.graveSealPolicy === 'NEAR_HOME') {
            const dist = map.getTorusDistance(home, p).manhattan;
            if (dist > params.stoneSearchDist) continue;
          }
          const openSpots = this.getOpenSpotsAroundGrave(p, map, enemies);
          targets.push(...openSpots);
        }
      }
    }

    return targets;
  }

  public static isTileSealed(pos: Position, map: WorldMap, enemies: EnemyInstance[]): boolean {
    if (map.getBaseTile(pos) === 'WALL_STATIC') return true;
    if (map.getObject(pos) === 'BLOCK') return true;
    if (map.getItem(pos) === 'CROSS') return true;
    const enemy = enemies.find(e => e.isAlive && e.pos.x === pos.x && e.pos.y === pos.y);
    if (enemy && enemy.isPermanentlyFrozen) return true;
    return false;
  }

  private static getOpenSpotsAroundGrave(grave: Position, map: WorldMap, enemies: EnemyInstance[]): Position[] {
    const spots: Position[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const p = map.wrapPosition({ x: grave.x + dx, y: grave.y + dy });
        if (!this.isTileSealed(p, map, enemies)) {
          spots.push(p);
        }
      }
    }
    return spots;
  }

  private static findNearestPos(from: Position, candidates: Position[], map: WorldMap, nav: AdaptiveNavigator): Position | null {
    let nearest: Position | null = null;
    let minDist = Infinity;
    for (const p of candidates) {
      if (nav.isTargetUnreachable(p)) continue;
      const dist = map.getTorusDistance(from, p).manhattan;
      if (dist < minDist) {
        minDist = dist;
        nearest = p;
      }
    }
    return nearest;
  }

  private static findNearestUnusedCross(from: Position, map: WorldMap, sealTargets: Position[], nav: AdaptiveNavigator): Position | null {
    let nearest: Position | null = null;
    let minDist = Infinity;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (nav.isTargetUnreachable(p)) continue;
        if (map.getItem(p) === 'CROSS') {
          // すでに封鎖ターゲット上にある十字架は「使用済み」として除外
          if (sealTargets.some(t => t.x === p.x && t.y === p.y)) continue;
          const dist = map.getTorusDistance(from, p).manhattan;
          if (dist < minDist) {
            minDist = dist;
            nearest = p;
          }
        }
      }
    }
    return nearest;
  }
}
