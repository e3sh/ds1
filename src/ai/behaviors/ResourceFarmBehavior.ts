import { Direction, Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { Player } from '../../models/Player.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { Dragon } from '../../models/Dragon.js';
import { ThreatEvaluator } from '../../systems/ThreatEvaluator.js';
import { MagicSystem } from '../../systems/MagicSystem.js';
import { MovementSystem } from '../../systems/MovementSystem.js';
import { BehaviorResult, DynamicBotParameters } from '../BotTypes.js';
import { AdaptiveNavigator } from '../AdaptiveNavigator.js';
import { TacticalContext } from '../TacticalContext.js';
import { CombatBehavior } from './CombatBehavior.js';
import { EightStepController } from '../EightStepController.js';

export interface SwapState {
  itemToPickupPos: Position | null;
  tempDroppedKeyPos: Position | null;
  swapTurns: number;
}

export interface BotTargetLockContext {
  lockedItemPos: Position | null;
  lockedItemType: string | null;
  lockedChestPos: Position | null;
  eightStepController?: EightStepController;
}

/**
 * ResourceFarmBehavior
 *
 * 宝箱開錠、8歩周期同期、パワーストーン回収＆奉納帰還、コイン換金帰還、MP備蓄を管理。
 * パワーストーン集めと帰還の基本サイクルを主軸とし、移動動線上での「ついで拾い（On-the-way Pickup）」を行う。
 */
export class ResourceFarmBehavior {
  private static pivotTurns: number = 0;
  private static lastDroppedKeyPos: Position | null = null;
  private static lockedItemTurns: number = 0;

  public static execute(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    nav: AdaptiveNavigator,
    context: TacticalContext,
    params: DynamicBotParameters,
    swapState: SwapState,
    bot?: BotTargetLockContext
  ): BehaviorResult | null {
    const curPos = player.pos;
    const floorItem = map.getItem(curPos);
    const floorObj = map.getObject(curPos);
    const homePos = map.realHomePos;

    const needStr = player.strength < params.targetStr;
    const needExp = player.experience < params.targetDefenseExp;
    const needMagic = player.magic < params.maxTargetMagic;
    const isUnderTarget = needStr;

    // 0. 8歩周期調整中（チェーン実行中）であれば最優先実行
    const esc = bot?.eightStepController;
    if (esc && esc.eightStepTargetChestPos !== null) {
      const targetChestPos = { ...esc.eightStepTargetChestPos };
      const eightStepAction = esc.handleEightStepCycle(player, map, enemies, dragon);
      if (eightStepAction) {
        return {
          action: eightStepAction,
          description: `📦 8歩周期調整 [歩数:${player.stepCountSinceStone}/8] -> 宝箱(${targetChestPos.x}, ${targetChestPos.y})`,
        };
      }
    }

    // 1. パワーストーン所持中: 我が家へ最速帰還＆奉納（奉納時にHP全快＋所持コイン全額自動換金）
    if (player.holdItem === 'POWER_STONE') {
      bot?.eightStepController?.clearEightStepState();
      swapState.itemToPickupPos = null;
      swapState.tempDroppedKeyPos = null;
      swapState.swapTurns = 0;
      const distToHome = map.getTorusDistance(curPos, homePos).manhattan;
      const canCastReturn = MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying;

      // 徒歩帰還を最優先（allowBreakAsRoadにより岩があればBREAKでコスト0開削）
      const dirToHome = nav.findPath(curPos, homePos, map, player, enemies, params, { dragon });
      if (dirToHome) {
        return {
          action: { type: 'MOVE', dir: dirToHome },
          description: `💎 パワーストーン奉納へ徒歩帰還 [距離: ${distToHome}]`,
        };
      }

      // 徒歩経路が完全に塞がれている場合のみ緊急RETURN
      if (canCastReturn) {
        return {
          action: { type: 'MAGIC', magic: 'RETURN' },
          description: '💎 徒歩ルート遮断のため緊急RETURN奉納',
        };
      }
    }

    // 2. 育成に不要な道具（CROSS, RING、またはSTR達成後の不要なPOWER_STONE）を床に置いて手を空ける (Hands-Free)
    const isUselessStone = player.holdItem === 'POWER_STONE' && !needStr;
    if (isUselessStone || (player.holdItem !== 'NONE' && player.holdItem !== 'KEY' && player.holdItem !== 'POWER_STONE' && player.holdItem !== 'CROWN')) {
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
          description: `📦 不要な所持品を床に置く [${player.holdItem}]`,
        };
      }
      const safeDir = this.findAdjacentDropTile(curPos, map, enemies, dragon, player, nav);
      if (safeDir) {
        return {
          action: { type: 'MOVE', dir: safeDir },
          description: `📦 所持品を置くため安全マスへ移動 [${player.holdItem}]`,
        };
      }
    }

    // 3. 一時置きスワップ状態の処理（最優先: スワップ完了まで他行動の割り込み禁止）
    const swapResult = this.handleItemSwap(player, map, enemies, dragon, nav, params, swapState);
    if (swapResult) return swapResult;

    const isSwapping = swapState.itemToPickupPos !== null || swapState.tempDroppedKeyPos !== null;

    // 3-B. コイン換金帰還トリガー:
    // 序盤: 我が家が至近（距離 <= 3）で手持ちコインを換金すれば重要マイルストーン（EXP 2,000 / 4,000 / 12,000）に即到達できる場合
    // STR達成後の決戦前EXP育成期 (!needStr && needExp):
    // 手持ちコインが一定枚数（4枚以上、または近傍なら3枚以上）、または換金すれば targetDefenseExp に到達する場合に我が家へ徒歩帰還して一括換金
    if (!isSwapping && player.gold > 0 && player.holdItem !== 'POWER_STONE') {
      const estimatedGainedExp = player.gold * 300 + Math.floor(player.experience * 0.02 * player.gold);
      const distToHome = map.getTorusDistance(curPos, homePos).manhattan;
      const afterExp = player.experience + estimatedGainedExp;

      const hitsEarlyMilestone = distToHome <= 3 && (
        (player.experience < 2000 && afterExp >= 2000) ||
        (player.experience < 4000 && afterExp >= 4000) ||
        (player.experience < 12000 && afterExp >= 12000)
      );

      const reachesTargetDefenseExp = !needStr && needExp && afterExp >= params.targetDefenseExp;
      const hasBatchCoinsForDefense = !needStr && needExp && (player.gold >= 4 || (player.gold >= 3 && distToHome <= 12));

      if (hitsEarlyMilestone || reachesTargetDefenseExp || hasBatchCoinsForDefense) {
        const dirToHome = nav.findPath(curPos, homePos, map, player, enemies, params, { dragon });
        if (dirToHome) {
          const desc = hitsEarlyMilestone
            ? `🪙 マイルストーンEXP達成: 至近我が家でコイン換金 [所持:${player.gold}G 距離:${distToHome}]`
            : `🪙 決戦前EXP育成: コイン一括換金へ帰還 [所持:${player.gold}G 距離:${distToHome}]`;
          return {
            action: { type: 'MOVE', dir: dirToHome },
            description: desc,
          };
        }
      }
    }

    // 4. 宝箱マスにいて鍵所持: 8歩周期に同期して宝箱を開ける
    if (floorObj === 'CHEST' && player.holdItem === 'KEY') {
      if (isUnderTarget) {
        const S = player.stepCountSinceStone;
        if (S === 8) {
          this.pivotTurns = 0;
          if (bot) {
            bot.lockedChestPos = null;
          }
          return {
            action: { type: 'SPACE' },
            description: `🔓 8歩周期宝箱開錠 (${curPos.x}, ${curPos.y}) [歩数:8/8 確定]`,
          };
        }

        if (S < 8) {
          if (this.pivotTurns >= 8) {
            this.pivotTurns = 0;
            if (bot) {
              bot.lockedChestPos = null;
            }
            return {
              action: { type: 'SPACE' },
              description: `🔓 8歩周期ピボットタイムアウト即座開錠 (${curPos.x}, ${curPos.y})`,
            };
          }

          const safePivotDir = this.findAdjacentSafePivot(curPos, map, enemies, dragon, player, nav);
          if (safePivotDir) {
            this.pivotTurns++;
            nav.resetPingPong();
            return {
              action: { type: 'MOVE', dir: safePivotDir },
              description: `🚶 8歩周期ピボット移動 [歩数:${S}/8, 試行:${this.pivotTurns}/8]`,
            };
          }
        }
      }

      // フォールバック: 即座に開錠
      this.pivotTurns = 0;
      if (bot) {
        bot.lockedChestPos = null;
      }
      return {
        action: { type: 'SPACE' },
        description: `🔓 宝箱開錠 (${curPos.x}, ${curPos.y})`,
      };
    }

    // 5. 鍵所持中 (KEY)
    if (player.holdItem === 'KEY') {
      // 5-0. 8歩周期パワーストーン・チェーン・ファーミング:
      // STR未達時、足元にパワーストーンが出現した直後 (stepCountSinceStone === 0) であれば、周辺宝箱へのチェーンを起動
      if (floorItem === 'POWER_STONE' && player.stepCountSinceStone === 0 && bot?.eightStepController && needStr) {
        const target = bot.eightStepController.findNearbyChestForEightStepCycle(curPos, map, enemies, dragon, player);
        if (target) {
          bot.eightStepController.eightStepTargetChestPos = target.chestPos;
          bot.eightStepController.eightStepOriginPos = { ...curPos };
          bot.eightStepController.eightStepPivotPos = target.pivotPos;
          bot.eightStepController.eightStepWaitPos = target.waitPos;
          bot.eightStepController.eightStepPathToPivot = target.pathToPivot;
          const firstStep = target.pathToPivot[0] ?? target.pivotPos;
          const dir = nav.getAdjacentDirection(curPos, firstStep, map);
          if (dir) {
            return {
              action: { type: 'MOVE', dir },
              description: `💎 8歩周期チェーン開始！周辺宝箱へ移動 -> (${target.chestPos.x}, ${target.chestPos.y})`,
            };
          }
        }
      }

      // 5-1. 足元に出現した有益アイテムのスワップ回収:
      // 宝箱を開けて足元に POWER_STONE (needStr時)、POTION (needMagic時)、または COIN (needExp かつ needStr時)
      // が出現した場合、swapState を用いて隣接安全マスに鍵を一時置きしてアイテムを回収する。
      // (※!needStr 時は連続開錠優先のため COIN スワップを行わない: Testing 12)
      const shouldSwapFloorItem =
        (floorItem === 'POWER_STONE' && needStr) ||
        (floorItem === 'POTION' && (needMagic || player.magic < 10)) ||
        (floorItem === 'COIN' && needExp && needStr);

      if (shouldSwapFloorItem) {
        const dropDir = this.findAdjacentDropTile(curPos, map, enemies, dragon, player, nav);
        if (dropDir) {
          swapState.itemToPickupPos = { ...curPos };
          swapState.swapTurns = 0;
          return {
            action: { type: 'MOVE', dir: dropDir },
            description: `🔄 鍵一時置き退避移動 [足元:${floorItem}]`,
          };
        }
        // ※周囲が塞がれていて dropDir が null の場合は無理にその場に留まらず、
        // 次の到達可能な宝箱への移動（5-A）へ進ませて WAIT スタックを防止
      }

      // 5-A. ロック中の宝箱への移動継続（ターゲットヒステリシス）
      if (bot?.lockedChestPos) {
        if (map.getObject(bot.lockedChestPos) === 'CHEST') {
          const dir = nav.findPath(curPos, bot.lockedChestPos, map, player, enemies, params, { dragon });
          if (dir) {
            const dist = map.getTorusDistance(curPos, bot.lockedChestPos).manhattan;
            if (dist === 1 && isUnderTarget) {
              const S = player.stepCountSinceStone;
              if (S === 7) {
                return {
                  action: { type: 'MOVE', dir },
                  description: `📦 宝箱へ移動 [8歩達成目前 歩数:7->8]`,
                };
              }
              if (S < 7) {
                const safePivotDir = this.findAdjacentSafePivot(curPos, map, enemies, dragon, player, nav, bot.lockedChestPos);
                if (safePivotDir) {
                  nav.resetPingPong();
                  return {
                    action: { type: 'MOVE', dir: safePivotDir },
                    description: `🚶 8歩周期調整ピボット往復 [歩数:${S}/8]`,
                  };
                }
              }
            }
            return {
              action: { type: 'MOVE', dir },
              description: `📦 ロック中宝箱へ移動 (${bot.lockedChestPos.x}, ${bot.lockedChestPos.y}) [距離: ${dist}]`,
            };
          } else {
            nav.markTargetUnreachable(bot.lockedChestPos, 8);
            bot.lockedChestPos = null;
          }
        } else {
          bot.lockedChestPos = null;
        }
      }

      // 到達可能な最寄りの未開封宝箱候補を走査（距離制限撤廃）
      const chestCandidates = nav.findNearestChestCandidates(
        curPos, map, context, enemies, player, 16, bot?.lockedChestPos
      );

      for (const chestPos of chestCandidates) {
        const dir = nav.findPath(curPos, chestPos, map, player, enemies, params, { dragon });
        if (!dir) {
          nav.markTargetUnreachable(chestPos, 8);
          if (bot?.lockedChestPos && bot.lockedChestPos.x === chestPos.x && bot.lockedChestPos.y === chestPos.y) {
            bot.lockedChestPos = null;
          }
          continue;
        }

        if (bot) {
          bot.lockedChestPos = { ...chestPos };
        }

        const dist = map.getTorusDistance(curPos, chestPos).manhattan;
        if (dist === 1 && isUnderTarget) {
          const S = player.stepCountSinceStone;
          if (S === 7) {
            return {
              action: { type: 'MOVE', dir },
              description: `📦 宝箱へ移動 [8歩達成目前 歩数:7->8]`,
            };
          }
          if (S < 7) {
            const safePivotDir = this.findAdjacentSafePivot(curPos, map, enemies, dragon, player, nav, chestPos);
            if (safePivotDir) {
              nav.resetPingPong();
              return {
                action: { type: 'MOVE', dir: safePivotDir },
                description: `🚶 8歩周期調整ピボット往復 [歩数:${S}/8]`,
              };
            }
          }
        }

        return {
          action: { type: 'MOVE', dir },
          description: `📦 宝箱へ移動 (${chestPos.x}, ${chestPos.y}) [距離: ${dist}]`,
        };
      }

      // 5-B. マップ上に到達可能な未開封宝箱が残っていない場合の鍵手放し処理:
      // 到達可能な宝箱が1つもない場合のみ、安全な床に鍵を置いて手ぶら(NONE)になり、
      // 床の残存資源（STONE/POTION/COIN）の回収やついで拾いへ切り替える。
      const isFireLine = dragon && nav.isDragonFireLine(curPos, dragon, map);
      const canDropHere =
        !isFireLine &&
        floorItem === 'NONE' &&
        floorObj === 'NONE' &&
        map.getBaseTile(curPos) !== 'WALL_STATIC' &&
        map.getBaseTile(curPos) !== 'WARP' &&
        map.getBaseTile(curPos) !== 'GRAVE' &&
        map.getBaseTile(curPos) !== 'HOME';

      if (canDropHere) {
        ResourceFarmBehavior.lastDroppedKeyPos = { ...curPos };
        nav.markTargetUnreachable(curPos, 20);
        return {
          action: { type: 'SPACE' },
          description: '🗝️ 到達可能な宝箱がないため鍵を手放し手ぶら回収へ移行',
        };
      }

      // 足元にアイテムがある等でその場に置けない場合、隣接安全空きマスへ移動して置く
      const dropDir = this.findAdjacentDropTile(curPos, map, enemies, dragon, player, nav);
      if (dropDir) {
        return {
          action: { type: 'MOVE', dir: dropDir },
          description: '🗝️ 鍵を置くため隣接安全マスへ移動',
        };
      }

      // 隣接にも空きマスがない場合（周囲が岩や壁で閉塞）、近傍の安全な空き床タイルへ移動して置く
      const nearestEmptyTile = this.findNearestEmptyDropTile(curPos, map, enemies, dragon, player, nav);
      if (nearestEmptyTile) {
        const dir = nav.findPath(curPos, nearestEmptyTile, map, player, enemies, params, { dragon });
        if (dir) {
          return {
            action: { type: 'MOVE', dir },
            description: `🗝️ 鍵を置く空きマスへ移動 (${nearestEmptyTile.x}, ${nearestEmptyTile.y})`,
          };
        }
      }

      // 空きマスへのパスも見つからない閉塞状態の場合、同じマスでWAIT待機して袋小路ギブアップになるのを防ぐため、
      // 安全に進入可能な隣接マスへ1歩脱出移動する
      const escapeDir = this.findAdjacentEscapeTile(curPos, map, enemies, dragon, player, nav);
      if (escapeDir) {
        return {
          action: { type: 'MOVE', dir: escapeDir },
          description: '🗝️ 鍵手放しのため閉塞地点から脱出移動',
        };
      }
    }

    // 6. 手ぶら時 (player.holdItem === 'NONE'): 優先度順アイテム回収 & ついで拾い (On-the-way Pickup)
    if (player.holdItem === 'NONE') {
      // 直前に置いた鍵から十分に離れたら（5マス以上）lastDroppedKeyPos をクリア
      if (ResourceFarmBehavior.lastDroppedKeyPos) {
        const dFromDropped = map.getTorusDistance(curPos, ResourceFarmBehavior.lastDroppedKeyPos).manhattan;
        if (dFromDropped >= 5) {
          ResourceFarmBehavior.lastDroppedKeyPos = null;
        }
      }

      const reachableChests = nav.findNearestChestCandidates(curPos, map, context, enemies, player, 16).filter(cp => !nav.isTargetUnreachable(cp));
      const hasChestsOnMap = reachableChests.some(cp => nav.findPath(curPos, cp, map, player, enemies, params, { dragon }) !== null);

      // 6-A. 足元の有益アイテムを取得
      // 直前に鍵を手放したマス（同一マス）では即座に拾い直さない（無限ループ防止）
      const isJustDroppedKey = floorItem === 'KEY' && (
        nav.isTargetUnreachable(curPos) ||
        (ResourceFarmBehavior.lastDroppedKeyPos !== null &&
         ResourceFarmBehavior.lastDroppedKeyPos.x === curPos.x &&
         ResourceFarmBehavior.lastDroppedKeyPos.y === curPos.y)
      );

      // 鍵を拾うのは「マップ上に到達可能な未開封宝箱が存在する」かつ「直前に置いた鍵でない」場合のみに限定
      const canPickupKey = floorItem === 'KEY' && !isJustDroppedKey && hasChestsOnMap;

      if ((floorItem === 'POWER_STONE' && needStr) || canPickupKey || floorItem === 'POTION' || floorItem === 'COIN') {
        if (floorItem === 'KEY') {
          ResourceFarmBehavior.lastDroppedKeyPos = null;
        }
        if (bot) {
          bot.lockedItemPos = null;
          bot.lockedItemType = null;
        }
        return {
          action: { type: 'SPACE' },
          description: `📦 足元のアイテム取得 [${floorItem}]`,
        };
      }

      // 足元に KEY があるが拾えない場合、KEY へのロックが残っていれば解除
      if (floorItem === 'KEY' && !canPickupKey && bot?.lockedItemType === 'KEY') {
        bot.lockedItemPos = null;
        bot.lockedItemType = null;
      }

      // 6-A0. ロック中のアイテムへの移動継続（ターゲットヒステリシス）
      if (bot?.lockedItemPos && bot.lockedItemType) {
        ResourceFarmBehavior.lockedItemTurns++;
        // KEY をロック中に宝箱がなくなった、または unreachable の場合はロック解除
        // また 20 ターン以上同一アイテムを追って取れない場合はスタック防止のためロック解除
        if (
          (bot.lockedItemType === 'KEY' && (!hasChestsOnMap || nav.isTargetUnreachable(bot.lockedItemPos))) ||
          ResourceFarmBehavior.lockedItemTurns > 20
        ) {
          if (ResourceFarmBehavior.lockedItemTurns > 20) {
            nav.markTargetUnreachable(bot.lockedItemPos, 15);
          }
          ResourceFarmBehavior.lockedItemTurns = 0;
          bot.lockedItemPos = null;
          bot.lockedItemType = null;
        } else {
          const itemAtPos = map.getItem(bot.lockedItemPos);
          if (itemAtPos === bot.lockedItemType) {
            const dir = nav.findPath(curPos, bot.lockedItemPos, map, player, enemies, params, { dragon });
            if (dir) {
              const dist = map.getTorusDistance(curPos, bot.lockedItemPos).manhattan;
              return {
                action: { type: 'MOVE', dir },
                description: `🎯 ロック中アイテムへ移動 [${bot.lockedItemType}] (${bot.lockedItemPos.x}, ${bot.lockedItemPos.y}) [距離: ${dist}]`,
              };
            } else {
              nav.markTargetUnreachable(bot.lockedItemPos, 8);
              ResourceFarmBehavior.lockedItemTurns = 0;
              bot.lockedItemPos = null;
              bot.lockedItemType = null;
            }
          } else {
            ResourceFarmBehavior.lockedItemTurns = 0;
            bot.lockedItemPos = null;
            bot.lockedItemType = null;
          }
        }
      } else {
        ResourceFarmBehavior.lockedItemTurns = 0;
      }

      // 6-B. 至近・移動動線上の「ついで拾い（On-the-way Pickup）」:
      // 手ぶら歩行時はCOINとPOTIONを踏むだけで枠を消費せず即座にゴールド・MPになる。
      // 周囲至近（距離 <= 3）にある安全な COIN または POTION を、種類を問わず優先的に踏みに行く。
      // ※Testing 17 との整合のため、STR達成後かつ宝箱なしの場合は「一括スイープ回収」の表記を含める。
      const isSweepMode = !needStr && !hasChestsOnMap;
      const coinRadius = (!needStr && needExp) ? params.coinSearchDist : (isSweepMode ? params.coinSearchDist : 3);
      const potionRadius = isSweepMode ? params.potionSearchDist : 3;

      type NearbyPickup = { pos: Position; type: 'POTION' | 'COIN'; dist: number };
      const nearbyPickups: NearbyPickup[] = [];

      // POTION 候補探索
      if (needMagic || isSweepMode || player.magic < 20) {
        const potions = nav.findNearestItemCandidates(curPos, 'POTION', map, enemies, player, 8, bot?.lockedItemPos);
        for (const p of potions) {
          const dist = map.getTorusDistance(curPos, p).manhattan;
          if (dist <= potionRadius && (isSweepMode || dist <= 3)) {
            nearbyPickups.push({ pos: p, type: 'POTION', dist });
          }
        }
      }

      // COIN 候補探索
      if (needExp || isSweepMode || player.experience < 12000) {
        const coins = nav.findNearestItemCandidates(curPos, 'COIN', map, enemies, player, 8, bot?.lockedItemPos);
        for (const c of coins) {
          const dist = map.getTorusDistance(curPos, c).manhattan;
          if (dist <= coinRadius) {
            nearbyPickups.push({ pos: c, type: 'COIN', dist });
          }
        }
      }

      if (nearbyPickups.length > 0) {
        nearbyPickups.sort((a, b) => {
          if (a.dist !== b.dist) return a.dist - b.dist;
          if (a.type === 'POTION' && b.type !== 'POTION') return -1;
          if (b.type === 'POTION' && a.type !== 'POTION') return 1;
          return 0;
        });

        for (const cand of nearbyPickups) {
          const dir = nav.findPath(curPos, cand.pos, map, player, enemies, params, { dragon });
          if (dir) {
            if (bot) {
              bot.lockedItemPos = { ...cand.pos };
              bot.lockedItemType = cand.type;
              ResourceFarmBehavior.lockedItemTurns = 0;
            }
            const icon = cand.type === 'POTION' ? '🧪' : '🪙';
            const label = cand.type === 'POTION' ? 'ポーション' : 'コイン';
            const actionDesc = isSweepMode ? '一括スイープ回収' : 'ついで拾い';
            return {
              action: { type: 'MOVE', dir },
              description: `${icon} ${actionDesc}: ${label} (${cand.pos.x}, ${cand.pos.y}) [距離: ${cand.dist}]`,
            };
          } else {
            nav.markTargetUnreachable(cand.pos, 8);
            if (bot?.lockedItemPos && bot.lockedItemPos.x === cand.pos.x && bot.lockedItemPos.y === cand.pos.y) {
              bot.lockedItemPos = null;
              bot.lockedItemType = null;
            }
          }
        }
      }

      // 6-C. 序盤最優先マイルストーン: BREAK (EXP 4,000) 解禁
      // ダンジョン内の部屋や通路は岩（BLOCK）で塞がれているため、BREAK がないと宝箱や石に到達できない。
      // EXP 4,000 未満の間は、近傍の安全な敵を撃破して最速で BREAK を解禁し、全域開削を可能にする。
      if (player.hasSword && player.experience < 4000) {
        const huntDist = Math.max(6, context?.scale?.nearRadius ?? 6);
        const safeEnemy = CombatBehavior.findNearestSafeEnemy(curPos, enemies, map, player, huntDist, nav);
        if (safeEnemy) {
          const dir = nav.findPath(curPos, safeEnemy.pos, map, player, enemies, params, { dragon });
          if (dir) {
            const dist = map.getTorusDistance(curPos, safeEnemy.pos).manhattan;
            return {
              action: { type: 'MOVE', dir },
              description: `⚔️ BREAK解禁EXP稼ぎ (${safeEnemy.name}) [距離: ${dist}]`,
            };
          }
        }
      }

      // 6-D. 宝箱開錠のための鍵回収:
      // 到達可能な未開封宝箱がある場合は、利用可能な鍵を拾いに行く（距離制限なし）
      if (hasChestsOnMap) {
        const keyCandidates = nav.findNearestItemCandidates(
          curPos, 'KEY', map, enemies, player, 16, bot?.lockedItemPos
        );
        for (const keyPos of keyCandidates) {
          if (nav.isTargetUnreachable(keyPos)) continue;
          if (ResourceFarmBehavior.lastDroppedKeyPos &&
              keyPos.x === ResourceFarmBehavior.lastDroppedKeyPos.x &&
              keyPos.y === ResourceFarmBehavior.lastDroppedKeyPos.y) {
            continue;
          }

          const dir = nav.findPath(curPos, keyPos, map, player, enemies, params, { dragon });
          if (dir) {
            const dist = map.getTorusDistance(curPos, keyPos).manhattan;
            if (bot) {
              bot.lockedItemPos = { ...keyPos };
              bot.lockedItemType = 'KEY';
              ResourceFarmBehavior.lockedItemTurns = 0;
            }
            return {
              action: { type: 'MOVE', dir },
              description: `🗝️ 宝箱開錠用鍵回収 (${keyPos.x}, ${keyPos.y}) [距離: ${dist}]`,
            };
          } else {
            nav.markTargetUnreachable(keyPos, 8);
            if (bot?.lockedItemPos && bot.lockedItemPos.x === keyPos.x && bot.lockedItemPos.y === keyPos.y) {
              bot.lockedItemPos = null;
              bot.lockedItemType = null;
            }
          }
        }
      }

      // 6-E. STR未達時の床落ちパワーストーン回収（宝箱がない場合や近傍の石を回収）
      if (needStr) {
        const stoneCandidates = nav.findNearestItemCandidates(
          curPos, 'POWER_STONE', map, enemies, player, 8, bot?.lockedItemPos
        );
        for (const stonePos of stoneCandidates) {
          const dist = map.getTorusDistance(curPos, stonePos).manhattan;
          if (dist > params.stoneSearchDist) continue;

          const dir = nav.findPath(curPos, stonePos, map, player, enemies, params, { dragon });
          if (dir) {
            if (bot) {
              bot.lockedItemPos = { ...stonePos };
              bot.lockedItemType = 'POWER_STONE';
              ResourceFarmBehavior.lockedItemTurns = 0;
            }
            return {
              action: { type: 'MOVE', dir },
              description: `💎 パワーストーン回収 (${stonePos.x}, ${stonePos.y}) [距離: ${dist}]`,
            };
          } else {
            nav.markTargetUnreachable(stonePos, 8);
            if (bot?.lockedItemPos && bot.lockedItemPos.x === stonePos.x && bot.lockedItemPos.y === stonePos.y) {
              bot.lockedItemPos = null;
              bot.lockedItemType = null;
            }
          }
        }
      }

      // 6-F. 遠方の宝箱・鍵エリアへの手ぶら移動:
      // 近傍に開けられる宝箱がない場合、手ぶらのまま遠方の宝箱エリアへ移動する。
      // 【重要】宝箱そのものへ手ぶらで突撃すると鍵を持たずに宝箱の周りをうろうろするため、
      // 必ず「その宝箱の近くにある鍵（KEY）」を目的地として接近する。
      if (hasChestsOnMap) {
        const allKeys = nav.findNearestItemCandidates(curPos, 'KEY', map, enemies, player, 16, bot?.lockedItemPos);
        let bestKeyPos: Position | null = null;
        let bestDistToKey = Infinity;
        let bestChestDist = Infinity;

        for (const keyPos of allKeys) {
          if (nav.isTargetUnreachable(keyPos)) continue;
          if (ResourceFarmBehavior.lastDroppedKeyPos &&
              keyPos.x === ResourceFarmBehavior.lastDroppedKeyPos.x &&
              keyPos.y === ResourceFarmBehavior.lastDroppedKeyPos.y) {
            continue;
          }

          // この鍵に最も近い未開封宝箱を探す
          let minChestDist = Infinity;
          for (const cp of reachableChests) {
            const d = map.getTorusDistance(keyPos, cp).manhattan;
            if (d < minChestDist) {
              minChestDist = d;
            }
          }

          // 宝箱から遠すぎる鍵（25マス超）は対象外
          if (minChestDist > 25) continue;

          const distFromPlayer = map.getTorusDistance(curPos, keyPos).manhattan;
          if (distFromPlayer < bestDistToKey) {
            bestDistToKey = distFromPlayer;
            bestKeyPos = keyPos;
            bestChestDist = minChestDist;
          }
        }

        if (bestKeyPos) {
          const dir = nav.findPath(curPos, bestKeyPos, map, player, enemies, params, { dragon });
          if (dir) {
            return {
              action: { type: 'MOVE', dir },
              description: `🚶 宝箱エリアの鍵へ手ぶら接近 (${bestKeyPos.x}, ${bestKeyPos.y}) [距離: ${bestDistToKey}, 宝箱距離: ${bestChestDist}]`,
            };
          } else {
            nav.markTargetUnreachable(bestKeyPos, 8);
          }
        }
      }

      // 6-G. マップ上に回収対象アイテムが残っておらず手持ちコインがある場合は我が家へ換金帰還
      // needStr 中はパワーストーン奉納時に自動で全額換金されるため、手ぶら単独換金帰還は行わない
      if (!needStr && player.gold > 0) {
        const dirToHome = nav.findPath(curPos, homePos, map, player, enemies, params, { dragon });
        if (dirToHome) {
          return {
            action: { type: 'MOVE', dir: dirToHome },
            description: `🪙 残存コイン一括換金のため我が家へ帰還 [所持:${player.gold}G]`,
          };
        }
      }
    }

    return null;
  }

  /**
   * 8歩周期調整のための安全な隣接空き床（ピボット）を探索
   */
  private static findAdjacentSafePivot(
    pos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    player: Player,
    nav: AdaptiveNavigator,
    excludePos?: Position
  ): Direction | null {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    for (const d of cardDirs) {
      const p = map.wrapPosition(MovementSystem.getNextPosition(pos, d));
      if (excludePos && p.x === excludePos.x && p.y === excludePos.y) continue;
      if (map.getBaseTile(p) === 'WALL_STATIC') continue;
      if (map.getBaseTile(p) === 'GRAVE') continue;
      if (map.getBaseTile(p) === 'WARP') continue;
      if (map.getObject(p) !== 'NONE') continue;
      if (dragon && (dragon.getPartAt(p) || nav.isDragonFireLine(p, dragon, map))) continue;

      const onEnemy = enemies.find(e => e.isAlive && e.pos.x === p.x && e.pos.y === p.y);
      if (onEnemy) continue;

      const dangerousAdj = enemies.some(e => {
        if (!e.isAlive || e.isPermanentlyFrozen || e.frozenTimer > 0) return false;
        if (map.getTorusDistance(p, e.pos).chebyshev > 1) return false;
        const threat = ThreatEvaluator.evaluateThreat(player, e);
        return threat === 'LETHAL' || threat === 'DANGER';
      });
      if (dangerousAdj) continue;

      return d;
    }
    return null;
  }

  private static handleItemSwap(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    nav: AdaptiveNavigator,
    params: DynamicBotParameters,
    swapState: SwapState
  ): BehaviorResult | null {
    const curPos = player.pos;

    if (swapState.itemToPickupPos !== null || swapState.tempDroppedKeyPos !== null) {
      nav.resetPingPong();
      swapState.swapTurns++;
      if (swapState.swapTurns > 8) {
        swapState.itemToPickupPos = null;
        swapState.tempDroppedKeyPos = null;
        swapState.swapTurns = 0;
        return null;
      }
    }

    if (player.holdItem === 'KEY' && swapState.itemToPickupPos !== null) {
      const isFireLine = dragon && nav.isDragonFireLine(curPos, dragon, map);
      const canDropHere =
        !isFireLine &&
        map.getItem(curPos) === 'NONE' &&
        map.getObject(curPos) === 'NONE' &&
        map.getBaseTile(curPos) !== 'WALL_STATIC' &&
        map.getBaseTile(curPos) !== 'WARP' &&
        map.getBaseTile(curPos) !== 'GRAVE';
      if (canDropHere) {
        swapState.tempDroppedKeyPos = { ...curPos };
        return {
          action: { type: 'SPACE' },
          description: '🔄 鍵を一時置き',
        };
      }
      const dropDir = this.findAdjacentDropTile(curPos, map, enemies, dragon, player, nav);
      if (dropDir) {
        return {
          action: { type: 'MOVE', dir: dropDir },
          description: '🔄 鍵一時置き用安全マスへ移動',
        };
      }
    }

    if (player.holdItem === 'NONE' && swapState.itemToPickupPos !== null) {
      const itemPos = swapState.itemToPickupPos;
      if (curPos.x === itemPos.x && curPos.y === itemPos.y) {
        swapState.itemToPickupPos = null;
        return {
          action: { type: 'SPACE' },
          description: `🔄 退避アイテム取得 [${map.getItem(curPos)}]`,
        };
      }
      const dir = nav.findPath(curPos, itemPos, map, player, enemies, params, { dragon });
      if (dir) {
        return {
          action: { type: 'MOVE', dir },
          description: '🔄 退避アイテムへ戻る',
        };
      } else {
        // アイテムへの経路が敵等で遮断された場合は諦め、一時置きした鍵の再回収へ切り替える
        swapState.itemToPickupPos = null;
      }
    }

    if (player.holdItem === 'NONE' && swapState.tempDroppedKeyPos !== null) {
      const keyPos = swapState.tempDroppedKeyPos;
      if (curPos.x === keyPos.x && curPos.y === keyPos.y) {
        swapState.tempDroppedKeyPos = null;
        return {
          action: { type: 'SPACE' },
          description: '🔄 一時置きした鍵を再回収',
        };
      }
      const dir = nav.findPath(curPos, keyPos, map, player, enemies, params, { dragon });
      if (dir) {
        return {
          action: { type: 'MOVE', dir },
          description: '🔄 一時置きした鍵へ移動',
        };
      }
    }

    return null;
  }

  private static findAdjacentDropTile(
    pos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    player: Player,
    nav: AdaptiveNavigator
  ): Direction | null {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    for (const d of cardDirs) {
      const p = map.wrapPosition(MovementSystem.getNextPosition(pos, d));
      if (map.getBaseTile(p) === 'WALL_STATIC') continue;
      if (map.getBaseTile(p) === 'GRAVE') continue;
      if (map.getBaseTile(p) === 'WARP') continue;
      if (map.getBaseTile(p) === 'HOME') continue;
      if (map.getObject(p) !== 'NONE') continue;
      if (map.getItem(p) !== 'NONE') continue;
      if (dragon && (dragon.getPartAt(p) || nav.isDragonFireLine(p, dragon, map))) continue;

      const onEnemy = enemies.find(e => e.isAlive && e.pos.x === p.x && e.pos.y === p.y);
      if (onEnemy) continue;

      const dangerousAdj = enemies.some(e => {
        if (!e.isAlive || e.isPermanentlyFrozen || e.frozenTimer > 0) return false;
        if (map.getTorusDistance(p, e.pos).chebyshev > 1) return false;
        const threat = ThreatEvaluator.evaluateThreat(player, e);
        return threat === 'LETHAL' || threat === 'DANGER';
      });
      if (dangerousAdj) continue;

      return d;
    }
    return null;
  }

  /**
   * 鍵などを安全に置くための空き床タイルを近傍から探索
   */
  private static findNearestEmptyDropTile(
    curPos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    player: Player,
    nav: AdaptiveNavigator
  ): Position | null {
    let bestPos: Position | null = null;
    let minDist = Infinity;

    for (let r = 1; r <= 16; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const p = map.wrapPosition({ x: curPos.x + dx, y: curPos.y + dy });
          if (map.getBaseTile(p) === 'WALL_STATIC') continue;
          if (map.getBaseTile(p) === 'GRAVE') continue;
          if (map.getBaseTile(p) === 'WARP') continue;
          if (map.getBaseTile(p) === 'HOME') continue;
          if (map.getObject(p) !== 'NONE') continue;
          if (map.getItem(p) !== 'NONE') continue;
          if (dragon && (dragon.getPartAt(p) || nav.isDragonFireLine(p, dragon, map))) continue;

          const onEnemy = enemies.find(e => e.isAlive && e.pos.x === p.x && e.pos.y === p.y);
          if (onEnemy) continue;

          const dangerousAdj = enemies.some(e => {
            if (!e.isAlive || e.isPermanentlyFrozen || e.frozenTimer > 0) return false;
            if (map.getTorusDistance(p, e.pos).chebyshev > 1) return false;
            const threat = ThreatEvaluator.evaluateThreat(player, e);
            return threat === 'LETHAL' || threat === 'DANGER';
          });
          if (dangerousAdj) continue;

          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist < minDist) {
            minDist = dist;
            bestPos = p;
          }
        }
      }
      if (bestPos) break;
    }

    return bestPos;
  }

  /**
   * 閉塞地点から脱出するための安全な隣接マスを探索（アイテムマスも許容）
   */
  private static findAdjacentEscapeTile(
    curPos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    player: Player,
    nav: AdaptiveNavigator
  ): Direction | null {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    for (const d of cardDirs) {
      const p = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
      if (map.getBaseTile(p) === 'WALL_STATIC') continue;
      if (map.getBaseTile(p) === 'GRAVE') continue;
      if (map.getBaseTile(p) === 'WARP') continue;
      if (map.getObject(p) !== 'NONE') continue;
      if (dragon && (dragon.getPartAt(p) || nav.isDragonFireLine(p, dragon, map))) continue;

      const onEnemy = enemies.find(e => e.isAlive && e.pos.x === p.x && e.pos.y === p.y);
      if (onEnemy) continue;

      const dangerousAdj = enemies.some(e => {
        if (!e.isAlive || e.isPermanentlyFrozen || e.frozenTimer > 0) return false;
        if (map.getTorusDistance(p, e.pos).chebyshev > 1) return false;
        const threat = ThreatEvaluator.evaluateThreat(player, e);
        return threat === 'LETHAL' || threat === 'DANGER';
      });
      if (dangerousAdj) continue;

      return d;
    }
    return null;
  }
}
