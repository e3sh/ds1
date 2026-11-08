import { Position } from '../../../models/Types.js';
import { WorldMap } from '../../../models/WorldMap.js';
import { Player } from '../../../models/Player.js';
import { EnemyInstance } from '../../../models/Enemy.js';
import { Dragon } from '../../../models/Dragon.js';
import { BehaviorResult, DynamicBotParameters } from '../BotTypesV2.js';
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

    // 1. 足元に剣があるなら拾う
    if (map.getItem(curPos) === 'SWORD' && !player.hasSword) {
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

    // 3. 足元に鍵があるなら拾う（手ぶら時）
    if (map.getItem(curPos) === 'KEY' && player.holdItem === 'NONE') {
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
