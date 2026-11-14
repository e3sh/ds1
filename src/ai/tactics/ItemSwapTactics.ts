import { Direction, Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { Player } from '../../models/Player.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { Dragon } from '../../models/Dragon.js';
import { BotAction, DynamicBotParameters } from '../BotTypes.js';
import { AdaptiveNavigator } from '../AdaptiveNavigator.js';
import { MovementSystem } from '../../systems/MovementSystem.js';

export interface SwapState {
  itemToPickupPos: Position | null;
  tempDroppedKeyPos: Position | null;
  swapTurns: number;
}

/**
 * ItemSwapTactics (アイテム一時置きスワップのマイクロ戦術)
 *
 * 宝箱を開けた直後などに手持ちの鍵を隣接安全マスに一時置きして
 * 足元の有益アイテム（パワーストーン、ポーション、コイン）を回収し、
 * 再び鍵を回収する一連のマイクロ操作を遂行する。
 */
export class ItemSwapTactics {
  public static execute(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    nav: AdaptiveNavigator,
    params: DynamicBotParameters,
    swapState: SwapState
  ): { action: BotAction; description: string } | null {
    const curPos = player.pos;

    // 1. スワップ中タイムアウト防止 (16ターン以上スタックした場合は状態リセット)
    if (swapState.itemToPickupPos !== null || swapState.tempDroppedKeyPos !== null) {
      swapState.swapTurns++;
      if (swapState.swapTurns > 16) {
        swapState.itemToPickupPos = null;
        swapState.tempDroppedKeyPos = null;
        swapState.swapTurns = 0;
        return null;
      }
    }

    // フェーズ1: 鍵を床に置く (手ぶらになる)
    if (swapState.itemToPickupPos !== null && swapState.tempDroppedKeyPos === null) {
      const isFireLine = dragon && nav.isDragonFireLine(curPos, dragon, map);
      const canDrop = !isFireLine &&
                      map.getItem(curPos) === 'NONE' &&
                      map.getObject(curPos) === 'NONE' &&
                      map.getBaseTile(curPos) !== 'WALL_STATIC' &&
                      map.getBaseTile(curPos) !== 'WARP' &&
                      map.getBaseTile(curPos) !== 'GRAVE' &&
                      map.getBaseTile(curPos) !== 'HOME';

      if (canDrop && player.holdItem === 'KEY') {
        swapState.tempDroppedKeyPos = { ...curPos };
        return {
          action: { type: 'SPACE' },
          description: `🔄 鍵一時置き退避 [足元に鍵を配置]`,
        };
      } else {
        // 退避可能な隣接マスまたは最寄り空き床（距離8以内）へ移動
        const dropDir =
          this.findAdjacentDropTile(curPos, map, enemies, dragon, player, nav) ??
          this.findNearestDropTileStep(curPos, map, enemies, dragon, player, params, nav);
        if (dropDir) {
          return {
            action: { type: 'MOVE', dir: dropDir },
            description: `🔄 鍵退避用安全マスへ移動`,
          };
        }
      }
    }

    // フェーズ2: 手ぶらで目的アイテムマスへ戻る
    if (swapState.itemToPickupPos !== null && swapState.tempDroppedKeyPos !== null && player.holdItem === 'NONE') {
      const atItemPos = curPos.x === swapState.itemToPickupPos.x && curPos.y === swapState.itemToPickupPos.y;
      if (atItemPos) {
        const floorItem = map.getItem(curPos);
        if (floorItem !== 'NONE') {
          swapState.itemToPickupPos = null; // アイテム取得完了
          return {
            action: { type: 'SPACE' },
            description: `🔄 一時置きスワップ: アイテム取得 [${floorItem}]`,
          };
        } else {
          // アイテムが既にない
          swapState.itemToPickupPos = null;
        }
      } else {
        const dir = nav.findPath(curPos, swapState.itemToPickupPos, map, player, enemies, params, { dragon });
        if (dir) {
          return {
            action: { type: 'MOVE', dir },
            description: `🔄 アイテム取得マスへ戻る`,
          };
        }
      }
    }

    // フェーズ3: 退避させた鍵を拾い直す (アイテム所持中またはアイテム消費後)
    if (swapState.tempDroppedKeyPos !== null && player.holdItem === 'NONE') {
      const atKeyPos = curPos.x === swapState.tempDroppedKeyPos.x && curPos.y === swapState.tempDroppedKeyPos.y;
      if (atKeyPos) {
        swapState.tempDroppedKeyPos = null;
        swapState.swapTurns = 0;
        return {
          action: { type: 'SPACE' },
          description: `🔄 一時置きスワップ完了: 退避した鍵を再回収`,
        };
      } else {
        const dir = nav.findPath(curPos, swapState.tempDroppedKeyPos, map, player, enemies, params, { dragon });
        if (dir) {
          return {
            action: { type: 'MOVE', dir },
            description: `🔄 退避した鍵マスへ移動`,
          };
        }
      }
    }

    return null;
  }

  public static isValidDropTile(
    np: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    nav: AdaptiveNavigator
  ): boolean {
    const base = map.getBaseTile(np);
    if (base === 'WALL_STATIC' || base === 'WARP' || base === 'GRAVE' || base === 'HOME') return false;
    if (map.getObject(np) !== 'NONE') return false;
    if (map.getItem(np) !== 'NONE') return false;
    if (dragon && (dragon.getPartAt(np) || nav.isDragonFireLine(np, dragon, map))) return false;
    if (enemies.some(e => e.isAlive && e.pos.x === np.x && e.pos.y === np.y)) return false;
    return true;
  }

  public static findAdjacentDropTile(
    pos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    _player: Player,
    nav: AdaptiveNavigator
  ): Direction | null {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    for (const dir of cardDirs) {
      const np = map.wrapPosition(MovementSystem.getNextPosition(pos, dir));
      if (!this.isValidDropTile(np, map, enemies, dragon, nav)) continue;
      return dir;
    }
    return null;
  }

  /**
   * 隣接4方向に空き床がない場合、マンハッタン距離 1..8 以内の最寄り安全空き床へ至る1歩目を探索
   */
  public static findNearestDropTileStep(
    pos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    player: Player,
    params: DynamicBotParameters,
    nav: AdaptiveNavigator
  ): Direction | null {
    const candidates: { pos: Position; dist: number }[] = [];
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist < 1 || dist > 8) continue;
        const np = map.wrapPosition({ x: pos.x + dx, y: pos.y + dy });
        if (!this.isValidDropTile(np, map, enemies, dragon, nav)) continue;
        candidates.push({ pos: np, dist });
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);

    const maxAttempts = Math.min(candidates.length, 16);
    for (let i = 0; i < maxAttempts; i++) {
      const dir = nav.findPath(pos, candidates[i].pos, map, player, enemies, params, { dragon });
      if (dir) return dir;
    }
    return null;
  }
}
