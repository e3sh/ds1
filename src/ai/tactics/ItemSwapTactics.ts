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

    // 1. スワップ中タイムアウト防止 (10ターン以上スタックした場合は状態リセット)
    if (swapState.itemToPickupPos !== null || swapState.tempDroppedKeyPos !== null) {
      swapState.swapTurns++;
      if (swapState.swapTurns > 10) {
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
                      map.getBaseTile(curPos) !== 'GRAVE';

      if (canDrop && player.holdItem === 'KEY') {
        swapState.tempDroppedKeyPos = { ...curPos };
        return {
          action: { type: 'SPACE' },
          description: `🔄 鍵一時置き退避 [足元に鍵を配置]`,
        };
      } else {
        // 退避可能な隣接マスへ移動
        const dropDir = this.findAdjacentDropTile(curPos, map, enemies, dragon, player, nav);
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
      if (map.getBaseTile(np) === 'WALL_STATIC') continue;
      if (map.getObject(np) !== 'NONE') continue;
      if (map.getItem(np) !== 'NONE') continue;
      if (map.getBaseTile(np) === 'WARP' || map.getBaseTile(np) === 'GRAVE' || map.getBaseTile(np) === 'HOME') continue;
      if (dragon && nav.isDragonFireLine(np, dragon, map)) continue;

      const hasEnemy = enemies.some(e => e.isAlive && e.pos.x === np.x && e.pos.y === np.y);
      if (hasEnemy) continue;

      return dir;
    }
    return null;
  }
}
