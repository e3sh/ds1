import { Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { Player } from '../../models/Player.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { Dragon } from '../../models/Dragon.js';
import { BehaviorResult, DynamicBotParameters } from '../BotTypes.js';
import { AdaptiveNavigator } from '../AdaptiveNavigator.js';
import { TacticalContext } from '../TacticalContext.js';

export interface BotTargetLockContext {
  lockedItemPos: Position | null;
  lockedItemType: string | null;
}

/**
 * BootstrapBehavior
 *
 * ゲーム開始時の初期装備（剣・鍵）を安全かつ迅速に確保する。
 */
export class BootstrapBehavior {
  public static execute(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    nav: AdaptiveNavigator,
    _context: TacticalContext,
    params: DynamicBotParameters,
    bot?: BotTargetLockContext
  ): BehaviorResult | null {
    const curPos = player.pos;

    // 0. 剣未所持時に何か持っている場合、剣を拾うために安全な空き床に置いて手ぶら (NONE) に戻る
    if (!player.hasSword && player.holdItem !== 'NONE') {
      const isFireLine = dragon && nav.isDragonFireLine(curPos, dragon, map);
      const canDropHere = !isFireLine &&
                          map.getItem(curPos) === 'NONE' &&
                          map.getObject(curPos) === 'NONE' &&
                          map.getBaseTile(curPos) !== 'WALL_STATIC' &&
                          map.getBaseTile(curPos) !== 'WARP' &&
                          map.getBaseTile(curPos) !== 'GRAVE';
      if (canDropHere) {
        return {
          action: { type: 'SPACE' },
          description: `📦 剣取得のため所持品を床に置く [${player.holdItem}]`,
        };
      }
      // 隣接安全マス探索
      const cardDirs = ['UP', 'RIGHT', 'DOWN', 'LEFT'] as const;
      for (const d of cardDirs) {
        const p = map.wrapPosition({
          x: curPos.x + (d === 'RIGHT' ? 1 : d === 'LEFT' ? -1 : 0),
          y: curPos.y + (d === 'DOWN' ? 1 : d === 'UP' ? -1 : 0),
        });
        if (map.getItem(p) === 'NONE' && map.getObject(p) === 'NONE' && map.getBaseTile(p) !== 'WALL_STATIC') {
          return {
            action: { type: 'MOVE', dir: d },
            description: `📦 所持品を置くため安全マスへ移動 [${player.holdItem}]`,
          };
        }
      }
    }

    // 1. 足元に剣があるなら拾う (手ぶら必須)
    if (map.getItem(curPos) === 'SWORD' && !player.hasSword && player.holdItem === 'NONE') {
      if (bot) {
        bot.lockedItemPos = null;
        bot.lockedItemType = null;
      }
      return {
        action: { type: 'SPACE' },
        description: '🗡️ 足元の剣を取得',
      };
    }

    // 2. 剣が未所持の場合、マップ上の剣候補を評価
    if (!player.hasSword) {
      // 2-A. ロック中の剣への移動継続
      if (bot?.lockedItemPos && bot.lockedItemType === 'SWORD') {
        if (map.getItem(bot.lockedItemPos) === 'SWORD') {
          const dir = nav.findPath(curPos, bot.lockedItemPos, map, player, enemies, params, { dragon });
          if (dir) {
            const dist = map.getTorusDistance(curPos, bot.lockedItemPos).manhattan;
            return {
              action: { type: 'MOVE', dir },
              description: `🗡️ 剣へ移動 (${bot.lockedItemPos.x}, ${bot.lockedItemPos.y}) [距離: ${dist}]`,
            };
          } else {
            nav.markTargetUnreachable(bot.lockedItemPos, 8);
            bot.lockedItemPos = null;
            bot.lockedItemType = null;
          }
        } else {
          bot.lockedItemPos = null;
          bot.lockedItemType = null;
        }
      }

      const swordCandidates = nav.findNearestItemCandidates(
        curPos, 'SWORD', map, enemies, player, 8, bot?.lockedItemPos
      );

      for (const swordPos of swordCandidates) {
        const dir = nav.findPath(curPos, swordPos, map, player, enemies, params, { dragon });
        if (dir) {
          if (bot) {
            bot.lockedItemPos = { ...swordPos };
            bot.lockedItemType = 'SWORD';
          }
          const dist = map.getTorusDistance(curPos, swordPos).manhattan;
          return {
            action: { type: 'MOVE', dir },
            description: `🗡️ 剣へ移動 (${swordPos.x}, ${swordPos.y}) [距離: ${dist}]`,
          };
        } else {
          // 到達不能候補をブラックリストに登録
          nav.markTargetUnreachable(swordPos, 8);
          if (bot?.lockedItemPos && bot.lockedItemPos.x === swordPos.x && bot.lockedItemPos.y === swordPos.y) {
            bot.lockedItemPos = null;
            bot.lockedItemType = null;
          }
        }
      }
    }

    // 3. 足元に鍵があるなら拾う（手ぶら時 かつ 剣所持時のみ）
    if (map.getItem(curPos) === 'KEY' && player.holdItem === 'NONE' && player.hasSword) {
      if (bot) {
        bot.lockedItemPos = null;
        bot.lockedItemType = null;
      }
      return {
        action: { type: 'SPACE' },
        description: '🗝️ 足元の鍵を取得',
      };
    }

    // 4. 剣所持・手ぶらの場合、鍵候補を評価
    if (player.hasSword && player.holdItem === 'NONE') {
      // 4-A. ロック中の鍵への移動継続
      if (bot?.lockedItemPos && bot.lockedItemType === 'KEY') {
        if (map.getItem(bot.lockedItemPos) === 'KEY') {
          const dir = nav.findPath(curPos, bot.lockedItemPos, map, player, enemies, params, { dragon });
          if (dir) {
            const dist = map.getTorusDistance(curPos, bot.lockedItemPos).manhattan;
            return {
              action: { type: 'MOVE', dir },
              description: `🗝️ 鍵へ移動 (${bot.lockedItemPos.x}, ${bot.lockedItemPos.y}) [距離: ${dist}]`,
            };
          } else {
            nav.markTargetUnreachable(bot.lockedItemPos, 8);
            bot.lockedItemPos = null;
            bot.lockedItemType = null;
          }
        } else {
          bot.lockedItemPos = null;
          bot.lockedItemType = null;
        }
      }

      const keyCandidates = nav.findNearestItemCandidates(
        curPos, 'KEY', map, enemies, player, 8, bot?.lockedItemPos
      );

      for (const keyPos of keyCandidates) {
        const dist = map.getTorusDistance(curPos, keyPos).manhattan;
        if (dist > params.keySearchDist) continue;

        const dir = nav.findPath(curPos, keyPos, map, player, enemies, params, { dragon });
        if (dir) {
          if (bot) {
            bot.lockedItemPos = { ...keyPos };
            bot.lockedItemType = 'KEY';
          }
          return {
            action: { type: 'MOVE', dir },
            description: `🗝️ 鍵へ移動 (${keyPos.x}, ${keyPos.y}) [距離: ${dist}]`,
          };
        } else {
          // 到達不能候補をブラックリストに登録
          nav.markTargetUnreachable(keyPos, 8);
          if (bot?.lockedItemPos && bot.lockedItemPos.x === keyPos.x && bot.lockedItemPos.y === keyPos.y) {
            bot.lockedItemPos = null;
            bot.lockedItemType = null;
          }
        }
      }
    }

    return null;
  }
}
