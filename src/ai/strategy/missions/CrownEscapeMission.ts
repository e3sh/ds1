import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { IStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { Position } from '../../../models/Types.js';
import { MagicSystem } from '../../../systems/MagicSystem.js';

/**
 * CrownEscapeMission (カテゴリ1: 王冠回収＆我が家脱出作戦)
 *
 * 全首撃破後に出現した王冠（最大4個）を回収し、我が家へ持ち帰って脱出・ゲームクリアする。
 * 認知層 (MapSituationEvaluator) が提供する拠点到達性・閉塞原因・アイテム到達性サマリーに基づき、
 * 1. 王冠取得前の事前安全確保（危険敵への事前 FREEZE/FLASH 詠唱）
 * 2. 王冠取得前の事前 MP 補給（近傍ポーション回収）
 * 3. 王冠取得前の帰還ルート検証と開削目標ロック（往復ピンポン完全防止）
 * 4. 王冠運搬中の先読み自衛（安全距離一時ドロップ＆魔法迎撃、自殺ドロップ絶対防止）
 * 5. 到達可能な王冠候補の柔軟な切り替えおよび王冠所持ゴースト追跡
 * を実行する。
 */
export class CrownEscapeMission implements IStrategicMission {
  public readonly id = 'CROWN_ESCAPE';
  public readonly name = '👑 王冠回収＆我が家脱出作戦';
  public readonly maxTurns = 1500;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';
  private clearingBlockPos: Position | null = null;

  public evaluateStatus(_snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    if (engine.getState() === 'STAGECLEAR') {
      return 'COMPLETED';
    }

    if (this.turnsElapsed >= this.maxTurns) {
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    const player = engine.getPlayer();
    const map = snapshot.map;
    const curPos = player.pos;
    const situation = MapSituationEvaluator.get(snapshot, engine);
    const { homeReachability, items, surroundings } = situation;
    const homePos = homeReachability.bestHomePos;

    // 開削目標ロックの有効性チェック（破壊済み・BREAK不能・到達不能登録時は解除）
    const canCastBreak = MagicSystem.canCast(player, 'BREAK').allowed;
    if (this.clearingBlockPos) {
      if (
        map.getObject(this.clearingBlockPos) !== 'BLOCK' ||
        !canCastBreak ||
        snapshot.memory.isTargetUnreachable(this.clearingBlockPos, snapshot.totalTurns)
      ) {
        this.clearingBlockPos = null;
      }
    }

    // 0. 不要な手持ち品（KEY, RING, CROSS等）の手放し
    if (player.holdItem !== 'NONE' && player.holdItem !== 'CROWN') {
      this.clearingBlockPos = null;
      return {
        type: 'DROP_HOLD_ITEM',
        priority: 100,
        reason: `👑 王冠回収のため不要アイテム手放し [${player.holdItem}]`,
      };
    }

    // 0-B. 我が家マス上または我が家直前の敵排除（FREEZE封鎖・居座り対策）
    if ((player.holdItem === 'NONE' || homeReachability.isNearRealHome) && surroundings.adjacentHomeEnemies.length > 0) {
      const targetEnemy = surroundings.adjacentHomeEnemies[0].enemy;
      return {
        type: 'ATTACK_TARGET',
        targetPos: targetEnemy.pos,
        priority: 101,
        reason: `⚔️ 我が家マス上の敵を排除突破 (${targetEnemy.name})`,
      };
    }

    // 0-C. 敵湧き場（spawnHomePos）のFREEZE家封鎖戦術
    if (
      homeReachability.isNearSpawnHome &&
      !homeReachability.isNearRealHome &&
      surroundings.enemyNearSpawnHome &&
      MagicSystem.canCast(player, 'FREEZE').allowed
    ) {
      return {
        type: 'CAST_MAGIC',
        magicToCast: 'FREEZE',
        priority: 102,
        reason: `❄️ 敵湧き家封鎖FREEZEバリケード (${surroundings.enemyNearSpawnHome.name})`,
      };
    }

    // -------------------------------------------------------------
    // 1. 王冠所持中 (holdItem === 'CROWN') の自衛＆我が家帰還
    // -------------------------------------------------------------
    if (player.holdItem === 'CROWN') {
      this.clearingBlockPos = null;

      // 1-A. 我が家到着: 自動奉納
      if (homeReachability.isAtHome) {
        return {
          type: 'WANDER_SAFELY',
          priority: 20,
          reason: '👑 我が家にて王冠奉納完了',
        };
      }

      // 1-B. 直角隣接（マンハッタン距離1）に即死敵（LETHAL）がいる場合の対応
      const adjacentLethal = surroundings.adjacentActiveEnemies.filter(
        info => info.defenseThreat === 'LETHAL'
      );

      if (adjacentLethal.length > 0) {
        const oneShotTarget = adjacentLethal.find(info => info.attackThreat === 'ONE_SHOT');
        if (oneShotTarget) {
          return {
            type: 'ATTACK_TARGET',
            targetPos: oneShotTarget.enemy.pos,
            priority: 100,
            reason: `⚔️ 王冠運搬中・隣接即死敵を一撃撃破突破 (${oneShotTarget.enemy.name})`,
          };
        }

        // ワンパン不可: 戦術層側で安全退避または強行突破移動（自殺ドロップ絶対防止）
        return {
          type: 'EVADE_DANGER',
          priority: 99,
          reason: '🚨 王冠運搬中・隣接即死敵から緊急退避（自殺ドロップ防止）',
        };
      }

      // 1-C. 【安全距離での先読み一時ドロップ】
      // 直角隣接には即死敵がいないが近傍に危険敵が接近している場合、一時ドロップして魔法迎撃準備
      const canCastWhenEmpty = player.magic > 0 && !player.hasDeath;
      if (
        canCastWhenEmpty &&
        surroundings.floorItem === 'NONE' &&
        !homeReachability.isNearRealHome &&
        surroundings.approachingLethalEnemies.length > 0
      ) {
        return {
          type: 'DROP_HOLD_ITEM',
          priority: 98,
          reason: `👑 即死敵接近につき安全距離で王冠一時ドロップ＆魔法迎撃準備 (${surroundings.approachingLethalEnemies[0].name})`,
        };
      }

      // 1-D. 帰還経路が完全遮断されている場合の一時ドロップ開拓
      // 手ぶらに戻ることで BREAK / FLASH / FREEZE による道切り開きを可能にする
      if (
        !homeReachability.canReachWithCrown &&
        surroundings.floorItem === 'NONE' &&
        canCastWhenEmpty
      ) {
        return {
          type: 'DROP_HOLD_ITEM',
          priority: 97,
          reason: `👑 王冠運搬路遮断 (${homeReachability.blockingCause}): 道切り開きのため一時ドロップ`,
        };
      }

      // 1-E. 最適な我が家へ最速直行
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: homePos,
        priority: 90,
        policy: { disallowFreezeNearHome: true },
        reason: `👑 王冠所持: 我が家 (${homePos.x}, ${homePos.y}) へ最速脱出帰還`,
      };
    }

    // -------------------------------------------------------------
    // 2. 手ぶら時 (holdItem === 'NONE') の安全確認・事前開通・王冠回収
    // -------------------------------------------------------------

    // 2-0. ロック済みの岩開削ターゲットがある場合は完遂する（往復ピンポン完全防止）
    if (
      this.clearingBlockPos &&
      canCastBreak &&
      !snapshot.threats.isLethalDanger &&
      surroundings.nearbyDangerousEnemies.length === 0
    ) {
      return {
        type: 'BREACH_SHORTCUT',
        targetPos: this.clearingBlockPos,
        priority: 95,
        reason: `🔨 王冠運搬路の開削継続 (${this.clearingBlockPos.x}, ${this.clearingBlockPos.y})`,
      };
    }

    // 2-A. 足元の王冠回収（安全確認＆事前スタン・開通チェック）
    if (surroundings.floorItem === 'CROWN') {
      // ① 周囲2マス以内に未凍結・未スタンの危険敵（被ダメージあり）がいる場合
      if (surroundings.nearbyDangerousEnemies.length > 0) {
        const hasAdjacentDangerous = surroundings.nearbyDangerousEnemies.some(
          e => map.getTorusDistance(curPos, e.pos).chebyshev <= 1
        );

        if ((homeReachability.isNearRealHome || !hasAdjacentDangerous) && MagicSystem.canCast(player, 'FLASH').allowed) {
          return {
            type: 'CAST_MAGIC',
            magicToCast: 'FLASH',
            priority: 98,
            reason: '⚡ 王冠取得前安全確保FLASHスタン（全画面足止め）',
          };
        }

        if (!homeReachability.isNearRealHome && hasAdjacentDangerous && MagicSystem.canCast(player, 'FREEZE').allowed) {
          return {
            type: 'CAST_MAGIC',
            magicToCast: 'FREEZE',
            priority: 98,
            reason: `❄️ 王冠取得前自衛FREEZE (${surroundings.nearbyDangerousEnemies[0].name})`,
          };
        }

        if (MagicSystem.canCast(player, 'FLASH').allowed) {
          return {
            type: 'CAST_MAGIC',
            magicToCast: 'FLASH',
            priority: 97,
            reason: '⚡ 王冠取得前FLASHスタン',
          };
        }

        const adjOneShot = surroundings.adjacentAllEnemies.find(info => info.attackThreat === 'ONE_SHOT');
        if (adjOneShot) {
          return {
            type: 'ATTACK_TARGET',
            targetPos: adjOneShot.enemy.pos,
            priority: 96,
            reason: `⚔️ 王冠取得前露払い (${adjOneShot.enemy.name})`,
          };
        }

        return {
          type: 'EVADE_DANGER',
          priority: 95,
          reason: '🚨 王冠上の即死敵から緊急退避',
        };
      }

      // ② 王冠取得前の事前 MP 補給 (magic < 2 かつ 距離15以内に到達可能ポーション)
      if (player.magic < 2 && items.nearestPotion) {
        const dist = map.getTorusDistance(curPos, items.nearestPotion).manhattan;
        if (dist <= 15) {
          return {
            type: 'NAVIGATE_TO_POSITION',
            targetPos: items.nearestPotion,
            targetItemType: 'POTION',
            priority: 94,
            reason: `🧪 王冠取得前MP補充 (${items.nearestPotion.x}, ${items.nearestPotion.y}) [距離:${dist}]`,
          };
        }
      }

      // ③ フロア内に活動中の危険敵がいるなら拾う直前に全画面 FLASH で無力化
      if (surroundings.hasActiveDangerousEnemyOnFloor && MagicSystem.canCast(player, 'FLASH').allowed) {
        return {
          type: 'CAST_MAGIC',
          magicToCast: 'FLASH',
          priority: 94,
          reason: '⚡ 王冠取得前・安全確保の全フロアFLASHスタン',
        };
      }

      // ④ 我が家までの帰還ルートが王冠所持状態で安全に開通しているか検証
      if (!homeReachability.canReachWithCrown) {
        // 4-A. 敵による遮断が残っている場合: FLASH / FREEZE による無力化
        const hasAnyActiveEnemy = snapshot.livingEnemies.some(
          e => e.isAlive && !e.isPermanentlyFrozen && (e.frozenTimer ?? 0) <= 0
        );
        if (hasAnyActiveEnemy && !player.hasDeath && player.magic > 0) {
          if (homeReachability.isNearRealHome && MagicSystem.canCast(player, 'FLASH').allowed) {
            return {
              type: 'CAST_MAGIC',
              magicToCast: 'FLASH',
              priority: 96,
              reason: '⚡ 前線基地近傍・王冠開通FLASH（進入路封鎖抑止）',
            };
          }
          const hasFreezeTarget = snapshot.livingEnemies.some(
            e =>
              e.isAlive &&
              !e.isPermanentlyFrozen &&
              (e.frozenTimer ?? 0) <= 0 &&
              map.getTorusDistance(curPos, e.pos).chebyshev <= 1
          );
          if (!homeReachability.isNearRealHome && hasFreezeTarget && MagicSystem.canCast(player, 'FREEZE').allowed) {
            return {
              type: 'CAST_MAGIC',
              magicToCast: 'FREEZE',
              priority: 96,
              reason: '❄️ 王冠開通FREEZE',
            };
          }
          if (homeReachability.blockingCause === 'DANGEROUS_ENEMY' && MagicSystem.canCast(player, 'FLASH').allowed) {
            return {
              type: 'CAST_MAGIC',
              magicToCast: 'FLASH',
              priority: 95,
              reason: '⚡ 王冠運搬路上の危険敵排除FLASH',
            };
          }
        }

        // 4-B. 直角隣接に岩があれば即座に BREAK 破壊
        if (surroundings.adjacentBlocks.length > 0 && canCastBreak) {
          return {
            type: 'BREACH_SHORTCUT',
            targetPos: surroundings.adjacentBlocks[0].pos,
            priority: 95,
            reason: '🔨 王冠運搬路の事前開削: 直角隣接の岩を破壊',
          };
        }

        // 4-C. 経路途中の岩（firstBlockingBlockPos）をロックして開削に向かう（ピンポン防止）
        if (
          homeReachability.firstBlockingBlockPos &&
          canCastBreak &&
          !snapshot.memory.isTargetUnreachable(homeReachability.firstBlockingBlockPos, snapshot.totalTurns)
        ) {
          this.clearingBlockPos = { ...homeReachability.firstBlockingBlockPos };
          return {
            type: 'BREACH_SHORTCUT',
            targetPos: this.clearingBlockPos,
            priority: 95,
            reason: `🔨 王冠運搬路の事前開削: 経路上の岩 (${this.clearingBlockPos.x}, ${this.clearingBlockPos.y}) を破壊へ移動`,
          };
        }

        // 4-D. 隣接の安全に倒せる敵がいれば露払い
        const safeAdjEnemy = surroundings.adjacentAllEnemies.find(
          info => info.attackThreat === 'ONE_SHOT' || info.defenseThreat === 'NO_DAMAGE'
        );
        if (safeAdjEnemy) {
          return {
            type: 'ATTACK_TARGET',
            targetPos: safeAdjEnemy.enemy.pos,
            priority: 94,
            reason: `⚔️ 王冠開通露払い (${safeAdjEnemy.enemy.name})`,
          };
        }
      }

      // ⑤ 完全開通確認済み（または一時的手段を尽くした後）: 安全に王冠を取得！
      return {
        type: 'PICKUP_ITEM',
        targetItemType: 'CROWN',
        priority: 93,
        reason: '👑 進軍ルート開通確認完了: 床の王冠を取得',
      };
    }

    // 2-B. 周囲2〜3マスに即死敵（LETHAL）が接近している場合 -> 全画面 FLASH で足止め
    if (surroundings.approachingLethalChebyshev3.length > 0 && MagicSystem.canCast(player, 'FLASH').allowed) {
      return {
        type: 'CAST_MAGIC',
        magicToCast: 'FLASH',
        priority: 96,
        reason: `⚡ 即死敵接近足止めFLASH (${surroundings.approachingLethalChebyshev3[0].name})`,
      };
    }

    // 2-C. 足元のポーション即時回収 ＆ 脱出用MP補給 (magic < 2)
    if (surroundings.floorItem === 'POTION') {
      return {
        type: 'PICKUP_ITEM',
        targetItemType: 'POTION',
        priority: 92,
        reason: '🧪 脱出用ポーションを取得',
      };
    }

    if (player.magic < 2 && items.nearestPotion) {
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: items.nearestPotion,
        targetItemType: 'POTION',
        priority: 89,
        reason: `🧪 脱出用MP補給 (${items.nearestPotion.x}, ${items.nearestPotion.y})`,
      };
    }

    // 2-D. 床の王冠へ移動（到達可能な王冠を優先、なければ最寄り候補）
    const targetCrown = items.crowns.reachableCrown ?? items.crowns.nearestCrown;
    if (targetCrown) {
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: targetCrown.pos,
        targetItemType: 'CROWN',
        priority: 88,
        reason: `👑 床の王冠へ移動 (${targetCrown.pos.x}, ${targetCrown.pos.y}) [距離:${targetCrown.dist}]`,
      };
    }

    // 2-E. 床に王冠がなく、ゴーストが王冠を運んでいる場合の追跡
    if (items.crowns.ghostCarryingCrownPos) {
      const gPos = items.crowns.ghostCarryingCrownPos;
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: gPos,
        priority: 87,
        reason: `👻 王冠所持ゴースト追跡 (${gPos.x}, ${gPos.y})`,
      };
    }

    // 2-F. 直角隣接の ONE_SHOT 敵を露払い排除
    const oneShotAdj = surroundings.adjacentAllEnemies.find(info => info.attackThreat === 'ONE_SHOT');
    if (oneShotAdj) {
      return {
        type: 'ATTACK_TARGET',
        targetPos: oneShotAdj.enemy.pos,
        priority: 85,
        reason: `⚔️ 脱出進路露払い (${oneShotAdj.enemy.name})`,
      };
    }

    // 2-G. フォールバック: 我が家へ移動
    return {
      type: 'NAVIGATE_TO_POSITION',
      targetPos: homePos,
      priority: 50,
      reason: '王冠探索または我が家へ移動',
    };
  }
}
