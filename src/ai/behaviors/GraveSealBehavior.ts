import { Direction, Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { Player } from '../../models/Player.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { Dragon } from '../../models/Dragon.js';
import { MagicSystem } from '../../systems/MagicSystem.js';
import { BehaviorResult, DynamicBotParameters } from '../BotTypes.js';
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

    // 0. 墓付近にいる敵を FREEZE で永久氷像バリケード化
    if (MagicSystem.canCast(player, 'FREEZE').allowed && player.magic > params.magicReserveThreshold && !player.hasDeath) {
      const nearGraves = openTargets.some(t => map.getTorusDistance(curPos, t).manhattan <= 2);
      if (nearGraves) {
        const unfrozenAdjacent = enemies.find(
          e => e.isAlive && !e.isPermanentlyFrozen && map.getTorusDistance(curPos, e.pos).chebyshev <= 1
        );
        if (unfrozenAdjacent) {
          return {
            action: { type: 'MAGIC', magic: 'FREEZE' },
            description: `❄️ 墓付近の敵をFREEZE永久凍結バリケード化 (${unfrozenAdjacent.name})`,
          };
        }
      }
    }

    // 1-B. CROSS, RING 以外のアイテム（KEY等）を所持している場合の手ぶら化（Hands-Free）判定
    if (player.holdItem !== 'CROSS' && player.holdItem !== 'RING' && player.holdItem !== 'NONE') {
      const unusedCross = this.findNearestUnusedCross(curPos, map, context, nav);
      const hasCrossCandidate = unusedCross !== null && map.getTorusDistance(curPos, unusedCross).manhattan <= params.keySearchDist;

      let hasRingCandidate = false;
      const ringPos = this.findNearestItem(curPos, 'RING', map, nav);
      if (ringPos && map.getTorusDistance(curPos, ringPos).manhattan <= context.scale.nearRadius) {
        hasRingCandidate = this.hasPushableBlock(openTargets, map, enemies, context);
      }

      if (hasCrossCandidate || hasRingCandidate) {
        const isFireLine = dragon && nav.isDragonFireLine(curPos, dragon, map);
        const canDropHere = !isFireLine &&
                            map.getItem(curPos) === 'NONE' &&
                            map.getObject(curPos) === 'NONE' &&
                            map.getBaseTile(curPos) !== 'WALL_STATIC' &&
                            map.getBaseTile(curPos) !== 'WARP' &&
                            map.getBaseTile(curPos) !== 'GRAVE' &&
                            map.getBaseTile(curPos) !== 'HOME';
        if (canDropHere) {
          return {
            action: { type: 'SPACE' },
            description: `✝️ 墓封鎖準備: 所持品を床に置く [${player.holdItem}]`,
          };
        }
        const safeDir = nav.findAdjacentDropTile(curPos, map, enemies, dragon, player);
        if (safeDir) {
          return {
            action: { type: 'MOVE', dir: safeDir },
            description: `✝️ 墓封鎖準備: 所持品を置くため安全マスへ移動 [${player.holdItem}]`,
          };
        }
      }

      // 利用可能な封鎖手段がない場合は封鎖不可のため null を返す
      return null;
    }

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

    // 3. RING所持時: 岩押しで墓を封鎖
    if (player.holdItem === 'RING') {
      const pushAction = this.planBlockPush(curPos, openTargets, map, enemies, player, dragon, nav, context, params);
      if (pushAction) return pushAction;

      // 押せる岩がない場合、安全な床にRINGを手放す
      const isFireLine = dragon && nav.isDragonFireLine(curPos, dragon, map);
      if (!isFireLine && map.getItem(curPos) === 'NONE' && map.getObject(curPos) === 'NONE') {
        return {
          action: { type: 'SPACE' },
          description: '💍 押せる岩がないためRINGを手放す',
        };
      }
    }

    // 4. 手ぶら時: 未使用十字架またはRINGの回収に向かう
    if (player.holdItem === 'NONE') {
      // 4-A. 未使用十字架の回収
      const unusedCross = this.findNearestUnusedCross(curPos, map, context, nav);
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

      // 4-B. 十字架が近くにない場合、RINGで岩押し封鎖が可能かチェック
      const ringPos = this.findNearestItem(curPos, 'RING', map, nav);
      if (ringPos) {
        const dist = map.getTorusDistance(curPos, ringPos).manhattan;
        if (dist <= context.scale.nearRadius) {
          if (curPos.x === ringPos.x && curPos.y === ringPos.y) {
            return {
              action: { type: 'SPACE' },
              description: '💍 岩押し封鎖のためRINGを取得',
            };
          }
          const dir = nav.findPath(curPos, ringPos, map, player, enemies, params, { dragon });
          if (dir) {
            return {
              action: { type: 'MOVE', dir },
              description: `💍 RING回収へ移動 (${ringPos.x}, ${ringPos.y})`,
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

  /**
   * 十字架がすでにいずれかの墓を封鎖している（使用済み）か判定
   * 墓周囲8マス、またはテーマブロックヒントの封鎖ターゲット座標上にある場合は封鎖中とみなす
   */
  public static isCrossSealing(pos: Position, map: WorldMap, context?: TacticalContext): boolean {
    // A. 墓の周囲8マスに隣接しているか
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const testGrave = map.wrapPosition({ x: pos.x + dx, y: pos.y + dy });
        if (map.getBaseTile(testGrave) === 'GRAVE') {
          return true;
        }
      }
    }

    // B. テーマブロックメタデータの gravePuzzleHints に含まれる sealTargetPositions 上にあるか
    if (context?.metadata?.gravePuzzleHints) {
      for (const hint of context.metadata.gravePuzzleHints) {
        if (hint.sealTargetPositions?.some(t => t.x === pos.x && t.y === pos.y)) {
          return true;
        }
      }
    }

    return false;
  }

  private static findNearestUnusedCross(
    from: Position,
    map: WorldMap,
    context: TacticalContext,
    nav: AdaptiveNavigator
  ): Position | null {
    let nearest: Position | null = null;
    let minDist = Infinity;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (nav.isTargetUnreachable(p)) continue;
        if (map.getItem(p) === 'CROSS') {
          // すでに墓封鎖に使用されている十字架は絶対に拾わない
          if (this.isCrossSealing(p, map, context)) continue;
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

  private static planBlockPush(
    curPos: Position,
    openTargets: Position[],
    map: WorldMap,
    enemies: EnemyInstance[],
    player: Player,
    dragon: Dragon,
    nav: AdaptiveNavigator,
    context: TacticalContext,
    params: DynamicBotParameters
  ): BehaviorResult | null {
    // 1. recommendedPushes の評価
    if (context.metadata?.gravePuzzleHints) {
      for (const hint of context.metadata.gravePuzzleHints) {
        if (!hint.recommendedPushes || hint.recommendedPushes.length === 0) continue;
        for (const push of hint.recommendedPushes) {
          const blockPos = map.wrapPosition(push.blockPos);
          const destPos = map.wrapPosition(push.destinationPos);
          if (map.getObject(blockPos) !== 'BLOCK') continue;
          if (!map.isPushDestinationValid(destPos, enemies)) continue;

          const offsets: Record<string, { dx: number; dy: number }> = {
            UP: { dx: 0, dy: -1 },
            DOWN: { dx: 0, dy: 1 },
            LEFT: { dx: -1, dy: 0 },
            RIGHT: { dx: 1, dy: 0 },
          };
          const d = offsets[push.dir];
          if (!d) continue;
          const standPos = map.wrapPosition({ x: blockPos.x - d.dx, y: blockPos.y - d.dy });
          if (map.getBaseTile(standPos) === 'WALL_STATIC' || map.getObject(standPos) !== 'NONE') continue;

          if (curPos.x === standPos.x && curPos.y === standPos.y) {
            return {
              action: { type: 'MOVE', dir: push.dir },
              description: `🧱 推奨岩押しで墓出口封鎖 [-> ${push.dir}]`,
            };
          }
          const dir = nav.findPath(curPos, standPos, map, player, enemies, params, { dragon, extraBlocked: [blockPos] });
          if (dir) {
            return {
              action: { type: 'MOVE', dir },
              description: `🚶 推奨岩押し位置へ移動 (${standPos.x}, ${standPos.y})`,
            };
          }
        }
      }
    }

    // 2. 一般オープンターゲットへの岩押し
    const cardDirs: { dir: Direction; dx: number; dy: number }[] = [
      { dir: 'UP', dx: 0, dy: -1 },
      { dir: 'DOWN', dx: 0, dy: 1 },
      { dir: 'LEFT', dx: -1, dy: 0 },
      { dir: 'RIGHT', dx: 1, dy: 0 },
    ];
    for (const spot of openTargets) {
      if (!map.isPushDestinationValid(spot, enemies)) continue;
      for (const d of cardDirs) {
        const blockPos = map.wrapPosition({ x: spot.x - d.dx, y: spot.y - d.dy });
        if (map.getObject(blockPos) !== 'BLOCK') continue;
        const standPos = map.wrapPosition({ x: blockPos.x - d.dx, y: blockPos.y - d.dy });
        if (map.getBaseTile(standPos) === 'WALL_STATIC' || map.getObject(standPos) !== 'NONE') continue;

        if (curPos.x === standPos.x && curPos.y === standPos.y) {
          return {
            action: { type: 'MOVE', dir: d.dir },
            description: `🧱 岩押しで墓封鎖 [-> ${d.dir}]`,
          };
        }
        const dir = nav.findPath(curPos, standPos, map, player, enemies, params, { dragon, extraBlocked: [blockPos] });
        if (dir) {
          return {
            action: { type: 'MOVE', dir },
            description: `🚶 岩押し封鎖位置へ移動 (${standPos.x}, ${standPos.y})`,
          };
        }
      }
    }
    return null;
  }

  private static findNearestItem(from: Position, type: string, map: WorldMap, nav: AdaptiveNavigator): Position | null {
    let nearest: Position | null = null;
    let minDist = Infinity;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (nav.isTargetUnreachable(p)) continue;
        if (map.getItem(p) === type) {
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

  public static hasPushableBlock(
    openTargets: Position[],
    map: WorldMap,
    enemies: EnemyInstance[],
    context: TacticalContext
  ): boolean {
    // 1. recommendedPushes の評価
    if (context.metadata?.gravePuzzleHints) {
      for (const hint of context.metadata.gravePuzzleHints) {
        if (!hint.recommendedPushes || hint.recommendedPushes.length === 0) continue;
        for (const push of hint.recommendedPushes) {
          const blockPos = map.wrapPosition(push.blockPos);
          const destPos = map.wrapPosition(push.destinationPos);
          if (map.getObject(blockPos) === 'BLOCK' && map.isPushDestinationValid(destPos, enemies)) {
            return true;
          }
        }
      }
    }

    // 2. openTargets に隣接する岩
    const cardDirs: { dx: number; dy: number }[] = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
    ];
    for (const spot of openTargets) {
      if (!map.isPushDestinationValid(spot, enemies)) continue;
      for (const d of cardDirs) {
        const blockPos = map.wrapPosition({ x: spot.x - d.dx, y: spot.y - d.dy });
        if (map.getObject(blockPos) === 'BLOCK') {
          return true;
        }
      }
    }
    return false;
  }
}
