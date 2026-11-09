import { Direction, Position } from '../../../models/Types.js';
import { WorldMap } from '../../../models/WorldMap.js';
import { Player } from '../../../models/Player.js';
import { EnemyInstance } from '../../../models/Enemy.js';
import { Dragon } from '../../../models/Dragon.js';
import { ThreatEvaluator } from '../../../systems/ThreatEvaluator.js';
import { MagicSystem } from '../../../systems/MagicSystem.js';
import { MovementSystem } from '../../../systems/MovementSystem.js';
import { BehaviorResult, DynamicBotParameters } from '../BotTypesV2.js';
import { AdaptiveNavigator } from '../AdaptiveNavigator.js';
import { TacticalContext } from '../TacticalContext.js';
import { CombatBehavior } from './CombatBehavior.js';
import { EightStepController } from '../../EightStepController.js';

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
 */
export class ResourceFarmBehavior {
  private static pivotTurns: number = 0;

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

    // 0. 8歩周期調整中（チェーン実行中）であれば最優先実行
    const esc = bot?.eightStepController;
    if (esc && esc.eightStepTargetChestPos !== null) {
      const eightStepAction = esc.handleEightStepCycle(player, map, enemies, dragon);
      if (eightStepAction) {
        return {
          action: eightStepAction,
          description: `📦 8歩周期調整 [歩数:${player.stepCountSinceStone}/8] -> 宝箱(${esc.eightStepTargetChestPos.x}, ${esc.eightStepTargetChestPos.y})`,
        };
      }
    }

    // 1. パワーストーン所持中: 我が家へ最速帰還＆奉納（平時は徒歩＋BREAK開削、RETURNは緊急・孤立時のみ）
    if (player.holdItem === 'POWER_STONE') {
      bot?.eightStepController?.clearEightStepState();
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

    // 2. 育成に不要な道具（CROSS, RING等）を所持している場合、安全な空き床に置いて手を空ける (Hands-Free)
    if (player.holdItem !== 'NONE' && player.holdItem !== 'KEY' && player.holdItem !== 'POWER_STONE' && player.holdItem !== 'CROWN') {
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

    // スワップ処理中（鍵を置き去りにしてアイテム取得中・戻り中）はコイン換金等で中断しない
    const isSwapping = swapState.itemToPickupPos !== null || swapState.tempDroppedKeyPos !== null;

    // 3. コイン換金: 基本はパワーストーン奉納やHP回復での帰宅時に一括納品
    // 例外: 我が家が至近（<= 3マス）かつ手持ちコインで即座に重要マイルストーン (2000, 4000, 12000) に到達できる場合のみ徒歩で立ち寄る
    if (!isSwapping && player.gold > 0 && player.holdItem !== 'POWER_STONE') {
      const estimatedGainedExp = player.gold * 300 + Math.floor(player.experience * 0.02 * player.gold);
      const nextMilestone = player.experience < 2000
        ? 2000
        : (player.experience < 4000 ? 4000 : (player.experience < 12000 ? 12000 : Infinity));
      const distToHome = map.getTorusDistance(curPos, homePos).manhattan;

      const reachedMilestone = nextMilestone !== Infinity && (player.experience + estimatedGainedExp) >= nextMilestone;
      const isJustInFrontOfHome = distToHome <= 3 && reachedMilestone;

      if (isJustInFrontOfHome) {
        const dirToHome = nav.findPath(curPos, homePos, map, player, enemies, params, { dragon });
        if (dirToHome) {
          return {
            action: { type: 'MOVE', dir: dirToHome },
            description: `🪙 至近マイルストーン達成のため立ち寄り換金 [所持:${player.gold}G 距離:${distToHome}]`,
          };
        }
      }
    }

    const needStr = player.strength < params.targetStr;
    const needMagic = player.magic < params.maxTargetMagic;
    const isUnderTarget = needStr || needMagic;

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
          // ピボット安全弁: 敵の接近や往復でピボットが長引いた場合はタイムアウトして即座に開錠
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

          // S < 8 の場合: 安全な隣接空きマス（ピボット）があれば往復して歩数を稼ぐ
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

    // 5. 鍵所持中
    if (player.holdItem === 'KEY') {
      // 5-0. 8歩周期パワーストーン・チェーン・ファーミング:
      // STR未達時、足元にパワーストーンが出現した直後 (stepCountSinceStone === 0) であれば、
      // 足元の石回収（スワップ）をあえて保留し、周辺の未開封宝箱への8歩周期チェーンを起動！
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

      // 5-1. 足元に石やポーションがあれば一時置き退避を開始（青天井備蓄: ポットはMP上限に関わらず回収）
      const isValuable = floorItem === 'POWER_STONE' || floorItem === 'POTION';

      if (isValuable) {
        swapState.itemToPickupPos = { ...curPos };
        swapState.swapTurns = 0;
        const dropDir = this.findAdjacentDropTile(curPos, map, enemies, dragon, player, nav);
        if (dropDir) {
          return {
            action: { type: 'MOVE', dir: dropDir },
            description: `🔄 鍵一時置き退避移動 [足元:${floorItem}]`,
          };
        }
      }

      // 5-A. ロック中の宝箱への移動継続（ターゲットヒステリシス）
      if (bot?.lockedChestPos) {
        if (map.getObject(bot.lockedChestPos) === 'CHEST') {
          const dir = nav.findPath(curPos, bot.lockedChestPos, map, player, enemies, params, { dragon });
          if (dir) {
            const dist = map.getTorusDistance(curPos, bot.lockedChestPos).manhattan;
            // 8歩周期調整
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

      // 宝箱候補を距離順に走査（8歩周期考慮）
      const chestCandidates = nav.findNearestChestCandidates(
        curPos, map, context, enemies, player, 8, bot?.lockedChestPos
      );

      for (const chestPos of chestCandidates) {
        const dist = map.getTorusDistance(curPos, chestPos).manhattan;
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

        // 8歩周期調整: 宝箱の隣接マス（距離1）にいて S < 7 の場合
        if (dist === 1 && isUnderTarget) {
          const S = player.stepCountSinceStone;
          if (S === 7) {
            // 次の1歩で宝箱に乗ればちょうど S=8 に到達！
            return {
              action: { type: 'MOVE', dir },
              description: `📦 宝箱へ移動 [8歩達成目前 歩数:7->8]`,
            };
          }
          if (S < 7) {
            // 安全なピボットマスがあれば往復して歩数を稼ぐ
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
    }

    // 6. 手ぶら時: 優先度順アイテム回収
    if (player.holdItem === 'NONE') {
      // 6-A. 足元の有益アイテムを取得
      if (floorItem === 'POWER_STONE' || floorItem === 'KEY' || floorItem === 'POTION' || floorItem === 'COIN') {
        if (bot) {
          bot.lockedItemPos = null;
          bot.lockedItemType = null;
        }
        return {
          action: { type: 'SPACE' },
          description: `📦 足元のアイテム取得 [${floorItem}]`,
        };
      }

      // 6-A0. ロック中のアイテムへの移動継続（ターゲットヒステリシス）
      if (bot?.lockedItemPos && bot.lockedItemType) {
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
            bot.lockedItemPos = null;
            bot.lockedItemType = null;
          }
        } else {
          bot.lockedItemPos = null;
          bot.lockedItemType = null;
        }
      }

      // 6-B. MP枯渇時 (MP <= 1) のポーション緊急回収
      if (player.magic <= 1) {
        const potionCandidates = nav.findNearestItemCandidates(
          curPos, 'POTION', map, enemies, player, 8, bot?.lockedItemPos
        );
        for (const potionPos of potionCandidates) {
          const dist = map.getTorusDistance(curPos, potionPos).manhattan;
          if (dist > params.potionSearchDist) continue;

          const dir = nav.findPath(curPos, potionPos, map, player, enemies, params, { dragon });
          if (dir) {
            if (bot) {
              bot.lockedItemPos = { ...potionPos };
              bot.lockedItemType = 'POTION';
            }
            return {
              action: { type: 'MOVE', dir },
              description: `🧪 ポーション緊急回収 (${potionPos.x}, ${potionPos.y}) [距離: ${dist}]`,
            };
          } else {
            nav.markTargetUnreachable(potionPos, 8);
            if (bot?.lockedItemPos && bot.lockedItemPos.x === potionPos.x && bot.lockedItemPos.y === potionPos.y) {
              bot.lockedItemPos = null;
              bot.lockedItemType = null;
            }
          }
        }
      }

      // 6-C. STR未達時のパワーストーン回収
      if (player.strength < params.targetStr) {
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

      // 6-C2. 序盤EXP稼ぎ: BREAK (4,000) / 斜め移動 (12,000) 未解禁時は近隣の安全な敵を狩る
      if (!bot?.lockedItemPos && (player.experience < 4000 || player.experience < 12000) && params.huntDistance > 0) {
        const safeEnemy = CombatBehavior.findNearestSafeEnemy(curPos, enemies, map, player, params.huntDistance, nav);
        if (safeEnemy) {
          const dir = nav.findPath(curPos, safeEnemy.pos, map, player, enemies, params, { dragon });
          if (dir) {
            const dist = map.getTorusDistance(curPos, safeEnemy.pos).manhattan;
            return {
              action: { type: 'MOVE', dir },
              description: `⚔️ 序盤EXP稼ぎ敵撃破 (${safeEnemy.name}) [距離: ${dist}]`,
            };
          }
        }
      }

      // 6-D. 序盤のコイン回収 (EXP < 12,000 の場合、魔法解禁のため優先)
      if (player.experience < 12000) {
        const coinCandidates = nav.findNearestItemCandidates(
          curPos, 'COIN', map, enemies, player, 8, bot?.lockedItemPos
        );
        for (const coinPos of coinCandidates) {
          const dist = map.getTorusDistance(curPos, coinPos).manhattan;
          if (dist > params.coinSearchDist) continue;

          const dir = nav.findPath(curPos, coinPos, map, player, enemies, params, { dragon });
          if (dir) {
            if (bot) {
              bot.lockedItemPos = { ...coinPos };
              bot.lockedItemType = 'COIN';
            }
            return {
              action: { type: 'MOVE', dir },
              description: `🪙 コイン回収 (${coinPos.x}, ${coinPos.y}) [距離: ${dist}]`,
            };
          } else {
            nav.markTargetUnreachable(coinPos, 8);
            if (bot?.lockedItemPos && bot.lockedItemPos.x === coinPos.x && bot.lockedItemPos.y === coinPos.y) {
              bot.lockedItemPos = null;
              bot.lockedItemType = null;
            }
          }
        }
      }

      // 6-E. 鍵回収（距離に関わらずマップ全体の鍵を優先探索）
      const keyCandidates = nav.findNearestItemCandidates(
        curPos, 'KEY', map, enemies, player, 8, bot?.lockedItemPos
      );
      for (const keyPos of keyCandidates) {
        const dist = map.getTorusDistance(curPos, keyPos).manhattan;

        const dir = nav.findPath(curPos, keyPos, map, player, enemies, params, { dragon });
        if (dir) {
          if (bot) {
            bot.lockedItemPos = { ...keyPos };
            bot.lockedItemType = 'KEY';
          }
          return {
            action: { type: 'MOVE', dir },
            description: `🗝️ 鍵回収 (${keyPos.x}, ${keyPos.y}) [距離: ${dist}]`,
          };
        } else {
          nav.markTargetUnreachable(keyPos, 8);
          if (bot?.lockedItemPos && bot.lockedItemPos.x === keyPos.x && bot.lockedItemPos.y === keyPos.y) {
            bot.lockedItemPos = null;
            bot.lockedItemType = null;
          }
        }
      }

      // 6-F. ポーション回収（青天井備蓄: potionSearchDistの範囲にあるポットを上限なく回収）
      if (params.potionSearchDist > 0) {
        const potionCandidates = nav.findNearestItemCandidates(
          curPos, 'POTION', map, enemies, player, 8, bot?.lockedItemPos
        );
        for (const potionPos of potionCandidates) {
          const dist = map.getTorusDistance(curPos, potionPos).manhattan;
          if (dist > params.potionSearchDist) continue;

          const dir = nav.findPath(curPos, potionPos, map, player, enemies, params, { dragon });
          if (dir) {
            if (bot) {
              bot.lockedItemPos = { ...potionPos };
              bot.lockedItemType = 'POTION';
            }
            return {
              action: { type: 'MOVE', dir },
              description: `🧪 ポーション回収 (${potionPos.x}, ${potionPos.y}) [距離: ${dist}]`,
            };
          } else {
            nav.markTargetUnreachable(potionPos, 8);
            if (bot?.lockedItemPos && bot.lockedItemPos.x === potionPos.x && bot.lockedItemPos.y === potionPos.y) {
              bot.lockedItemPos = null;
              bot.lockedItemType = null;
            }
          }
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

      // 敵が直接乗っていないか確認
      const onEnemy = enemies.find(e => e.isAlive && e.pos.x === p.x && e.pos.y === p.y);
      if (onEnemy) continue;

      // 移動先に隣接する危険敵のチェック
      const dangerousAdj = enemies.some(e => {
        if (!e.isAlive || e.isPermanentlyFrozen) return false;
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

    // スワップ滞留防止タイムアウト (8ターン)
    if (swapState.itemToPickupPos !== null || swapState.tempDroppedKeyPos !== null) {
      swapState.swapTurns++;
      if (swapState.swapTurns >= 8) {
        swapState.itemToPickupPos = null;
        swapState.tempDroppedKeyPos = null;
        swapState.swapTurns = 0;
        return null;
      }
    }

    // A. 鍵を床に置く
    if (swapState.itemToPickupPos !== null && player.holdItem === 'KEY') {
      const isFireLine = dragon && nav.isDragonFireLine(curPos, dragon, map);
      const canDropHere = !isFireLine &&
                          map.getItem(curPos) === 'NONE' && map.getObject(curPos) === 'NONE' &&
                          map.getBaseTile(curPos) !== 'WALL_STATIC' && map.getBaseTile(curPos) !== 'WARP' &&
                          map.getBaseTile(curPos) !== 'GRAVE';
      if (canDropHere) {
        swapState.tempDroppedKeyPos = { ...curPos };
        return {
          action: { type: 'SPACE' },
          description: '🔄 鍵を一時置き',
        };
      }
      const dir = this.findAdjacentDropTile(curPos, map, enemies, dragon, player, nav);
      if (dir) return { action: { type: 'MOVE', dir }, description: '🔄 鍵置き場所を探して移動' };
    }

    // B. 退避アイテムを回収
    if (player.holdItem === 'NONE' && swapState.itemToPickupPos !== null) {
      if (curPos.x === swapState.itemToPickupPos.x && curPos.y === swapState.itemToPickupPos.y) {
        swapState.itemToPickupPos = null;
        return { action: { type: 'SPACE' }, description: '🔄 退避アイテム取得' };
      }

      const dir = nav.findPath(curPos, swapState.itemToPickupPos, map, player, enemies, params, { dragon });
      if (dir) return { action: { type: 'MOVE', dir }, description: '🔄 退避アイテムへ戻る' };

      // 経路が即死敵等で塞がれている場合: FREEZE自衛または安全待機
      const nearbyThreat = enemies.find(e => e.isAlive && !e.isPermanentlyFrozen && map.getTorusDistance(curPos, e.pos).manhattan <= 2);
      if (nearbyThreat && player.magic > 0 && MagicSystem.canCast(player, 'FREEZE').allowed) {
        return { action: { type: 'MAGIC', magic: 'FREEZE' }, description: `❄️ 退避アイテム近傍の敵をFREEZE (${nearbyThreat.name})` };
      }
      const evadeDir = nav.findEvadeDirection(curPos, map, enemies, player, dragon);
      if (evadeDir) return { action: { type: 'MOVE', dir: evadeDir }, description: '🚨 退避アイテム安全待機回避' };
    }

    // C. 一時置きした鍵を再回収
    if (player.holdItem === 'NONE' && swapState.itemToPickupPos === null && swapState.tempDroppedKeyPos !== null) {
      if (curPos.x === swapState.tempDroppedKeyPos.x && curPos.y === swapState.tempDroppedKeyPos.y) {
        swapState.tempDroppedKeyPos = null;
        return { action: { type: 'SPACE' }, description: '🔄 一時置き鍵を再回収' };
      }

      const dir = nav.findPath(curPos, swapState.tempDroppedKeyPos, map, player, enemies, params, { dragon });
      if (dir) return { action: { type: 'MOVE', dir }, description: '🔄 一時置き鍵へ戻る' };

      // 経路が即死敵等で塞がれている場合: FREEZE自衛または安全待機
      const nearbyThreat = enemies.find(e => e.isAlive && !e.isPermanentlyFrozen && map.getTorusDistance(curPos, e.pos).manhattan <= 2);
      if (nearbyThreat && player.magic > 0 && MagicSystem.canCast(player, 'FREEZE').allowed) {
        return { action: { type: 'MAGIC', magic: 'FREEZE' }, description: `❄️ 一時置き鍵近傍の敵をFREEZE (${nearbyThreat.name})` };
      }
      const evadeDir = nav.findEvadeDirection(curPos, map, enemies, player, dragon);
      if (evadeDir) return { action: { type: 'MOVE', dir: evadeDir }, description: '🚨 一時置き鍵安全待機回避' };
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
      if (
        map.getBaseTile(p) !== 'WALL_STATIC' &&
        map.getBaseTile(p) !== 'GRAVE' &&
        map.getBaseTile(p) !== 'WARP' &&
        map.getObject(p) === 'NONE' &&
        map.getItem(p) === 'NONE'
      ) {
        if (dragon && (dragon.getPartAt(p) || nav.isDragonFireLine(p, dragon, map))) {
          continue; // 火線上には絶対に置かない
        }
        const hasEnemy = enemies.some(e => e.isAlive && e.pos.x === p.x && e.pos.y === p.y);
        if (hasEnemy) continue;
        const hasAdjDanger = enemies.some(e => {
          if (!e.isAlive || e.isPermanentlyFrozen) return false;
          if (map.getTorusDistance(p, e.pos).chebyshev > 1) return false;
          const threat = ThreatEvaluator.evaluateThreat(player, e);
          return threat === 'LETHAL' || threat === 'DANGER';
        });
        if (hasAdjDanger) continue;
        return d;
      }
    }
    return null;
  }
}
