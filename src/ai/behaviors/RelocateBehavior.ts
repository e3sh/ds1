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
 * RelocateBehavior
 *
 * ドラゴン要塞外縁への我が家移転戦術（前線基地化）。
 */
export class RelocateBehavior {
  public static execute(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    nav: AdaptiveNavigator,
    context: TacticalContext,
    params: DynamicBotParameters,
    lockedAnchor: Position | null
  ): BehaviorResult | null {
    const curPos = player.pos;
    const homePos = map.realHomePos;

    // 1. アンカー地点の選定
    const anchor = lockedAnchor ?? this.findAnchor(map, dragon, enemies, player, context, params);
    if (!anchor) return null;

    // 2. 移転完了判定（家がアンカーに到達）
    if (homePos.x === anchor.x && homePos.y === anchor.y) {
      if (player.holdItem === 'RING') {
        const isFireLine = dragon && nav.isDragonFireLine(curPos, dragon, map);
        if (!isFireLine && map.getItem(curPos) === 'NONE' && map.getObject(curPos) === 'NONE') {
          return {
            action: { type: 'SPACE' },
            description: '💍 移転完了: RINGを手放す',
          };
        }
      }
      return null; // 移転完了
    }

    // 3. RINGを持っていない場合、RINGを回収に向かう
    if (player.holdItem !== 'RING') {
      const ringPos = this.findNearestItem(curPos, 'RING', map, nav);
      if (ringPos) {
        if (curPos.x === ringPos.x && curPos.y === ringPos.y) {
          return {
            action: { type: 'SPACE' },
            description: '💍 RINGを取得',
          };
        }
        const dir = nav.findPath(curPos, ringPos, map, player, enemies, params, { dragon });
        if (dir) {
          return {
            action: { type: 'MOVE', dir },
            description: `💍 RINGへ移動 (${ringPos.x}, ${ringPos.y})`,
          };
        }
      }
      return null;
    }

    // 4. RING所持時: 家を押すためのプッシュ位置（家の手前）へ移動して家を押す
    const pushPlan = this.planHomePush(homePos, anchor, map, player, enemies, dragon, nav, params);
    if (pushPlan) {
      if (curPos.x === pushPlan.standPos.x && curPos.y === pushPlan.standPos.y) {
        return {
          action: { type: 'MOVE', dir: pushPlan.pushDir },
          description: `🏠 我が家を押して前線基地へ移転 [-> ${pushPlan.pushDir}]`,
        };
      }
      const dir = nav.findPath(curPos, pushPlan.standPos, map, player, enemies, params, { dragon, extraBlocked: [homePos] });
      if (dir) {
        return {
          action: { type: 'MOVE', dir },
          description: `🏠 家押し位置へ移動 (${pushPlan.standPos.x}, ${pushPlan.standPos.y})`,
        };
      }
    }

    // 5. 家が押せない場合: 障害ブロックを BREAK で破壊して開拓
    const breakAction = this.tryBreakObstacle(homePos, anchor, map, player, enemies, dragon, nav, params);
    if (breakAction) return breakAction;

    return null;
  }

  public static findAnchor(
    map: WorldMap,
    dragon: Dragon,
    _enemies: EnemyInstance[],
    _player: Player,
    context: TacticalContext,
    params: DynamicBotParameters
  ): Position | null {
    // A. メタデータに推奨アンカーがある場合
    if (context.metadata?.recommendedRelocateAnchors && context.metadata.recommendedRelocateAnchors.length > 0) {
      for (const a of context.metadata.recommendedRelocateAnchors) {
        if (map.getBaseTile(a) !== 'WALL_STATIC' && map.getObject(a) === 'NONE') {
          return a;
        }
      }
    }

    // B. ドラゴン要塞から指定距離範囲の空床をスキャン
    const center = map.dragonCenter ?? { x: 32, y: 32 };
    for (let r = params.homeRelocateDistMin; r <= params.homeRelocateDistMax; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const p = map.wrapPosition({ x: center.x + dx, y: center.y + dy });
          if (map.getBaseTile(p) !== 'WALL_STATIC' && map.getObject(p) === 'NONE' && map.getItem(p) === 'NONE') {
            if (!dragon.getPartAt(p)) {
              return p;
            }
          }
        }
      }
    }
    return null;
  }

  private static planHomePush(
    home: Position,
    anchor: Position,
    map: WorldMap,
    _player: Player,
    enemies: EnemyInstance[],
    dragon: Dragon,
    _nav: AdaptiveNavigator,
    _params: DynamicBotParameters
  ): { standPos: Position; pushDir: Direction } | null {
    const cardDirs: { dir: Direction; dx: number; dy: number }[] = [
      { dir: 'UP', dx: 0, dy: -1 },
      { dir: 'DOWN', dx: 0, dy: 1 },
      { dir: 'LEFT', dx: -1, dy: 0 },
      { dir: 'RIGHT', dx: 1, dy: 0 },
    ];

    let bestPlan: { standPos: Position; pushDir: Direction } | null = null;
    let minRemainingDist = Infinity;

    for (const { dir, dx, dy } of cardDirs) {
      const standPos = map.wrapPosition({ x: home.x - dx, y: home.y - dy });
      const destPos = map.wrapPosition({ x: home.x + dx, y: home.y + dy });

      if (map.getBaseTile(standPos) === 'WALL_STATIC' || map.getObject(standPos) !== 'NONE') continue;
      if (!map.isPushDestinationValid(destPos, enemies)) continue;
      if (dragon.getPartAt(destPos)) continue;

      const remainingDist = map.getTorusDistance(destPos, anchor).manhattan;
      if (remainingDist < minRemainingDist) {
        minRemainingDist = remainingDist;
        bestPlan = { standPos, pushDir: dir };
      }
    }

    return bestPlan;
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

  /**
   * 家を押す進路または立ち位置を塞いでいる BLOCK を BREAK で破壊
   */
  private static tryBreakObstacle(
    home: Position,
    _anchor: Position,
    map: WorldMap,
    player: Player,
    enemies: EnemyInstance[],
    dragon: Dragon,
    nav: AdaptiveNavigator,
    params: DynamicBotParameters
  ): BehaviorResult | null {
    if (!MagicSystem.canCast(player, 'BREAK').allowed) return null;

    const cardDirs: { dir: Direction; dx: number; dy: number }[] = [
      { dir: 'UP', dx: 0, dy: -1 },
      { dir: 'DOWN', dx: 0, dy: 1 },
      { dir: 'LEFT', dx: -1, dy: 0 },
      { dir: 'RIGHT', dx: 1, dy: 0 },
    ];

    // 家からアンカーへ近づく方向の候補を評価
    for (const { dx, dy } of cardDirs) {
      const destPos = map.wrapPosition({ x: home.x + dx, y: home.y + dy });
      const standPos = map.wrapPosition({ x: home.x - dx, y: home.y - dy });

      // 進行先 destPos が BLOCK で塞がれている場合
      if (map.getObject(destPos) === 'BLOCK') {
        const breakDest = this.breakBlockAt(destPos, player, map, enemies, dragon, nav, params, [home]);
        if (breakDest) return breakDest;
      }

      // 立ち位置 standPos が BLOCK で塞がれている場合
      if (map.getObject(standPos) === 'BLOCK') {
        const breakStand = this.breakBlockAt(standPos, player, map, enemies, dragon, nav, params, [home]);
        if (breakStand) return breakStand;
      }
    }

    return null;
  }

  private static breakBlockAt(
    targetBlockPos: Position,
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    nav: AdaptiveNavigator,
    params: DynamicBotParameters,
    extraBlocked?: Position[]
  ): BehaviorResult | null {
    const curPos = player.pos;
    const cardDirs: { dir: Direction; dx: number; dy: number }[] = [
      { dir: 'UP', dx: 0, dy: -1 },
      { dir: 'DOWN', dx: 0, dy: 1 },
      { dir: 'LEFT', dx: -1, dy: 0 },
      { dir: 'RIGHT', dx: 1, dy: 0 },
    ];

    // 隣接していれば即座に BREAK 詠唱
    for (const d of cardDirs) {
      const neighbor = map.wrapPosition({ x: player.pos.x + d.dx, y: player.pos.y + d.dy });
      if (neighbor.x === targetBlockPos.x && neighbor.y === targetBlockPos.y) {
        player.dir = d.dir;
        return {
          action: { type: 'MAGIC', magic: 'BREAK' },
          description: `🔨 移転ルート開拓のため岩を破壊 (${targetBlockPos.x}, ${targetBlockPos.y})`,
        };
      }
    }

    // 隣接マスへ移動
    for (const d of cardDirs) {
      const standPos = map.wrapPosition({ x: targetBlockPos.x + d.dx, y: targetBlockPos.y + d.dy });
      if (extraBlocked && extraBlocked.some(p => p.x === standPos.x && p.y === standPos.y)) continue;
      if (map.getBaseTile(standPos) === 'WALL_STATIC' || map.getObject(standPos) !== 'NONE') continue;

      const dir = nav.findPath(curPos, standPos, map, player, enemies, params, { dragon, extraBlocked });
      if (dir) {
        return {
          action: { type: 'MOVE', dir },
          description: `🚶 岩破壊位置へ移動 (${standPos.x}, ${standPos.y})`,
        };
      }
    }

    return null;
  }
}
