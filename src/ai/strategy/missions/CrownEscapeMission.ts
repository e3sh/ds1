import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { HomeReachabilitySummary, MapSituationEvaluator, MapSituationSummary } from '../../perception/MapSituationEvaluator.js';
import { IStrategicMission, MissionCompletionReason, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { Position } from '../../../models/Types.js';
import { Player } from '../../../models/Player.js';
import { MagicSystem } from '../../../systems/MagicSystem.js';
import { ThreatEvaluator } from '../../../systems/ThreatEvaluator.js';

/**
 * CrownEscapeMission (カテゴリ1: 王冠回収＆我が家脱出作戦)
 *
 * 全首撃破後に出現した王冠（最大4個）を回収し、我が家へ持ち帰って脱出・ゲームクリアする。
 * 内部サブモード（ACQUIRING_CROWN / CLEARING_RETURN_BLOCK / CLEARING_RETURN_ENEMY / CARRYING_TO_HOME）を
 * 明示的に管理し、道を開拓するために一時ドロップした王冠を「開通達成前に即再拾得 → 再ドロップ → FLASH空撃ち」
 * する無限ループを構造的に根絶する。
 */
export class CrownEscapeMission implements IStrategicMission {
  public readonly id = 'CROWN_ESCAPE';
  public readonly name = '👑 王冠回収＆我が家脱出作戦';
  public readonly maxTurns = 3000;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';
  public completionReason?: MissionCompletionReason;
  public subMode: 'ACQUIRING_CROWN' | 'CLEARING_RETURN_BLOCK' | 'CLEARING_RETURN_ENEMY' | 'CARRYING_TO_HOME' = 'ACQUIRING_CROWN';

  private initialCrownsDelivered: number | null = null;
  private clearingBlockPos: Position | null = null;
  private droppedCrownForClearing: boolean = false;
  private lastFlashPos: Position | null = null;
  private lastFlashTurn: number = -999;

  private ensureInitialized(engine: GameEngine): void {
    if (this.initialCrownsDelivered === null) {
      this.initialCrownsDelivered = engine.getPlayer().crowns;
    }
  }

  private recordFlash(pos: Position, turn: number): void {
    this.lastFlashPos = { ...pos };
    this.lastFlashTurn = turn;
  }

  /**
   * 同一座標での連打抑制＆BREAK用MP=1リザーブを保護した FLASH 詠唱可否判定
   */
  private canCastFlashSafely(
    snapshot: TacticalSnapshot,
    player: Player,
    curPos: Position,
    homeReachability: HomeReachabilitySummary,
    hasAdjacentLethal: boolean,
    hasEvadeRoute: boolean
  ): boolean {
    if (!MagicSystem.canCast(player, 'FLASH').allowed) {
      return false;
    }

    // 同一座標で直近8ターン以内に既に FLASH を撃っていれば無駄打ち禁止
    if (
      this.lastFlashPos &&
      this.lastFlashPos.x === curPos.x &&
      this.lastFlashPos.y === curPos.y &&
      snapshot.totalTurns - this.lastFlashTurn < 8
    ) {
      return false;
    }

    // 帰還路上に破壊すべき岩がある場合は BREAK 用の MP=1 リザーブを死守
    // （ただし隣接即死敵から退避マスがない緊急事態のみ例外）
    const needsBreakToReturn = Boolean(
      this.clearingBlockPos ||
      homeReachability.firstBlockingBlockPos ||
      homeReachability.blockingCause === 'BLOCK'
    );
    if (needsBreakToReturn && snapshot.milestones.canBreak && player.magic <= 1) {
      if (!(hasAdjacentLethal && !hasEvadeRoute)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 他に即死・致死反撃を受ける隣接敵がいない場合のみ、一撃撃破 (ONE_SHOT) 可能な隣接敵を返す
   */
  private findSafeOneShotAdjacentEnemy(
    surroundings: MapSituationSummary['surroundings'],
    player: Player
  ) {
    const candidate = surroundings.adjacentActiveEnemies.find(
      info =>
        info.attackThreat === 'ONE_SHOT' &&
        (info.defenseThreat === 'LETHAL' || info.damageToPlayer >= player.hp * 0.35)
    );
    if (!candidate) return null;

    const hasOtherLethal = surroundings.adjacentActiveEnemies.some(
      info => info.defenseThreat === 'LETHAL' && info.enemy.id !== candidate.enemy.id
    );
    const hasOtherChebyshev1Danger = surroundings.chebyshev1ActiveDangerousEnemies.some(
      e => e.id !== candidate.enemy.id
    );
    const otherAdjacentDamage = surroundings.adjacentActiveEnemies
      .filter(info => info.enemy.id !== candidate.enemy.id)
      .reduce((sum, info) => sum + info.damageToPlayer, 0);

    if (hasOtherLethal || hasOtherChebyshev1Danger || otherAdjacentDamage >= player.hp) {
      return null;
    }
    return candidate;
  }

  public evaluateStatus(_snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    this.ensureInitialized(engine);
    if (engine.getState() === 'STAGECLEAR') {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }

    if (this.turnsElapsed >= this.maxTurns) {
      const delivered = engine.getPlayer().crowns > (this.initialCrownsDelivered ?? 0);
      this.completionReason = delivered ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    this.ensureInitialized(engine);
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

    // 開通完了時、または最寄り王冠から距離6以上離れた場合は一時ドロップ閉塞解消モードを自動解除
    if (this.droppedCrownForClearing) {
      const distToNearestCrown = items.crowns.nearestCrown
        ? map.getTorusDistance(curPos, items.crowns.nearestCrown.pos).manhattan
        : Infinity;
      if (homeReachability.canReachWithCrown || distToNearestCrown >= 6) {
        this.droppedCrownForClearing = false;
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

    // 0-C. 手ぶら時の一撃粉砕優先（永久凍結像による通路封鎖を抑止）＆敵湧き場封鎖
    const safeOneShotAdjGlobal = this.findSafeOneShotAdjacentEnemy(surroundings, player);
    if (
      player.holdItem === 'NONE' &&
      safeOneShotAdjGlobal &&
      (safeOneShotAdjGlobal.defenseThreat === 'LETHAL' || safeOneShotAdjGlobal.damageToPlayer >= player.hp * 0.35)
    ) {
      return {
        type: 'ATTACK_TARGET',
        targetPos: safeOneShotAdjGlobal.enemy.pos,
        priority: 103,
        reason: `⚔️ 脱出路確保: 隣接脅威敵を一撃粉砕 (${safeOneShotAdjGlobal.enemy.name})`,
      };
    }

    if (
      homeReachability.isNearSpawnHome &&
      !homeReachability.isNearRealHome &&
      surroundings.enemyNearSpawnHome &&
      MagicSystem.canCast(player, 'FREEZE').allowed &&
      player.magic > 1
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
      this.droppedCrownForClearing = false;
      this.subMode = 'CARRYING_TO_HOME';

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
        if (safeOneShotAdjGlobal) {
          return {
            type: 'ATTACK_TARGET',
            targetPos: safeOneShotAdjGlobal.enemy.pos,
            priority: 100,
            reason: `⚔️ 王冠運搬中・隣接即死敵を一撃撃破突破 (${safeOneShotAdjGlobal.enemy.name})`,
          };
        }

        // ワンパン不可: 戦術層側で安全退避または強行突破移動（自殺ドロップ絶対防止）
        return {
          type: 'EVADE_DANGER',
          priority: 99,
          reason: '🚨 王冠運搬中・隣接即死敵から緊急退避（自殺ドロップ防止）',
        };
      }

      // 1-C. 【8方向隣接の危険敵に対する一時ドロップ＆FREEZE永久凍結準備】
      // 遠方や距離2〜3で早々に王冠を落として持続の短い FLASH を乱射するのではなく、
      // 8方向隣接に未凍結の危険敵が接近し、手ぶら化で FREEZE 永久凍結（または拠点近傍FLASH）できる場合のみドロップする
      const canCastWhenEmpty = player.magic > 0 && !player.hasDeath;
      const flashBlockedHere =
        this.lastFlashPos !== null &&
        this.lastFlashPos.x === curPos.x &&
        this.lastFlashPos.y === curPos.y &&
        snapshot.totalTurns - this.lastFlashTurn < 8;
      const needsBreakReserve1C = Boolean(
        this.clearingBlockPos ||
        homeReachability.firstBlockingBlockPos ||
        homeReachability.blockingCause === 'BLOCK'
      );
      const canFreezeWhenEmpty1C =
        canCastWhenEmpty &&
        !homeReachability.isNearRealHome &&
        (!needsBreakReserve1C || player.magic >= 2);
      const canFlashWhenEmpty1C =
        canCastWhenEmpty &&
        !flashBlockedHere &&
        (!needsBreakReserve1C || player.magic >= 2);

      if (
        (canFreezeWhenEmpty1C || canFlashWhenEmpty1C) &&
        surroundings.floorItem === 'NONE' &&
        (surroundings.chebyshev1ActiveDangerousEnemies.length > 0 ||
          surroundings.approachingLethalEnemies.length > 0)
      ) {
        const targetDanger =
          surroundings.chebyshev1ActiveDangerousEnemies[0] ??
          surroundings.approachingLethalEnemies[0];
        this.droppedCrownForClearing = true;
        this.subMode = 'CLEARING_RETURN_ENEMY';
        return {
          type: 'DROP_HOLD_ITEM',
          priority: 98,
          reason: `👑 接近危険敵を${canFreezeWhenEmpty1C ? 'FREEZE永久凍結' : 'FLASH足止め'}するため王冠一時ドロップ (${targetDanger.name})`,
        };
      }

      // 1-D. 帰還経路が完全遮断されている場合の一時ドロップ開拓
      // 実際に手ぶら化によって道を開拓できる場合（BLOCKをBREAK可能、または別の開通王冠へ切替可能）のみドロップし、無意味な拾う⇄落とすループを禁止する
      if (!homeReachability.canReachWithCrown && surroundings.floorItem === 'NONE') {
        const canBreakWhenEmpty = !player.hasDeath && player.experience >= 4000 && player.magic >= 1;
        const canUnblockByBreak =
          homeReachability.blockingCause === 'BLOCK' &&
          canBreakWhenEmpty &&
          homeReachability.firstBlockingBlockPos !== null;
        const hasAlternativeOpenCrown = items.crowns.allFloorCrowns.some(
          c => (c.pos.x !== curPos.x || c.pos.y !== curPos.y) && c.isReachable && c.canReturnHomeWithCrown
        );

        if (canUnblockByBreak || hasAlternativeOpenCrown) {
          this.droppedCrownForClearing = true;
          this.subMode = canUnblockByBreak ? 'CLEARING_RETURN_BLOCK' : 'ACQUIRING_CROWN';
          return {
            type: 'DROP_HOLD_ITEM',
            priority: 97,
            reason: `👑 王冠運搬路遮断 (${homeReachability.blockingCause}): 道切り開きのため一時ドロップ`,
          };
        }
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
      this.subMode = 'CLEARING_RETURN_BLOCK';
      return {
        type: 'BREACH_SHORTCUT',
        targetPos: this.clearingBlockPos,
        priority: 95,
        reason: `🔨 王冠運搬路の開削継続 (${this.clearingBlockPos.x}, ${this.clearingBlockPos.y})`,
      };
    }

    // 2-A. 足元の王冠回収（安全確認＆事前スタン・開通チェック）
    if (surroundings.floorItem === 'CROWN') {
      const adjacentLethalCount = surroundings.adjacentActiveEnemies.filter(
        info => info.defenseThreat === 'LETHAL'
      ).length;
      const hasEvadeRoute = surroundings.safeEvadeDir !== null;

      // ① 周囲（8方向隣接含む）または距離2以内に未凍結・未スタンの危険敵がいる場合
      if (surroundings.chebyshev1ActiveDangerousEnemies.length > 0 || surroundings.nearbyDangerousEnemies.length > 0) {
        this.subMode = 'CLEARING_RETURN_ENEMY';
        if (safeOneShotAdjGlobal) {
          return {
            type: 'ATTACK_TARGET',
            targetPos: safeOneShotAdjGlobal.enemy.pos,
            priority: 99,
            reason: `⚔️ 王冠上の隣接敵を一撃粉砕 (${safeOneShotAdjGlobal.enemy.name})`,
          };
        }

        const needsBreakReserve = Boolean(this.clearingBlockPos || homeReachability.firstBlockingBlockPos || homeReachability.blockingCause === 'BLOCK');
        const freezeAllowed =
          MagicSystem.canCast(player, 'FREEZE').allowed &&
          (!needsBreakReserve || player.magic >= 2 || !hasEvadeRoute);

        // 拠点近傍以外で8方向隣接に危険敵がいる場合は、8Tで切れる FLASH ではなく永続無力化の FREEZE を最優先
        if (surroundings.canSafelyFreezeAdjacent && freezeAllowed) {
          return {
            type: 'CAST_MAGIC',
            magicToCast: 'FREEZE',
            priority: 98,
            reason: `❄️ 王冠取得前・隣接危険敵をFREEZE永久凍結 (${surroundings.chebyshev1ActiveDangerousEnemies[0].name})`,
          };
        }

        const flashAllowed = this.canCastFlashSafely(
          snapshot,
          player,
          curPos,
          homeReachability,
          adjacentLethalCount > 0,
          hasEvadeRoute
        );
        if (flashAllowed) {
          const dangerTarget = surroundings.chebyshev1ActiveDangerousEnemies[0] ?? surroundings.nearbyDangerousEnemies[0];
          this.recordFlash(curPos, snapshot.totalTurns);
          return {
            type: 'CAST_MAGIC',
            magicToCast: 'FLASH',
            priority: 98,
            reason: `⚡ 王冠取得前ギリギリ足止めFLASH (${dangerTarget.name})`,
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
          this.subMode = 'ACQUIRING_CROWN';
          return {
            type: 'NAVIGATE_TO_POSITION',
            targetPos: items.nearestPotion,
            targetItemType: 'POTION',
            priority: 94,
            reason: `🧪 王冠取得前MP補充 (${items.nearestPotion.x}, ${items.nearestPotion.y}) [距離:${dist}]`,
          };
        }
      }

      // ③ 我が家までの帰還ルートが王冠所持状態で安全に開通しているか検証
      // ※開通未達成の間は絶対にそのまま拾わず、対応する開削・敵排除・別ルート確保を完了させる
      if (!homeReachability.canReachWithCrown) {
        // 3-A. 直角隣接または帰還経路上の岩（BLOCK）を優先開削
        if (surroundings.adjacentBlocks.length > 0 && canCastBreak) {
          this.subMode = 'CLEARING_RETURN_BLOCK';
          return {
            type: 'BREACH_SHORTCUT',
            targetPos: surroundings.adjacentBlocks[0].pos,
            priority: 95,
            reason: '🔨 王冠運搬路の事前開削: 直角隣接の岩を破壊',
          };
        }

        if (
          homeReachability.firstBlockingBlockPos &&
          canCastBreak &&
          !snapshot.memory.isTargetUnreachable(homeReachability.firstBlockingBlockPos, snapshot.totalTurns)
        ) {
          this.subMode = 'CLEARING_RETURN_BLOCK';
          this.clearingBlockPos = { ...homeReachability.firstBlockingBlockPos };
          return {
            type: 'BREACH_SHORTCUT',
            targetPos: this.clearingBlockPos,
            priority: 95,
            reason: `🔨 王冠運搬路の事前開削: 経路上の岩 (${this.clearingBlockPos.x}, ${this.clearingBlockPos.y}) を破壊へ移動`,
          };
        }

        // 3-B. 隣接の安全に倒せる敵がいれば露払い
        const safeAdjEnemy =
          safeOneShotAdjGlobal ??
          surroundings.adjacentAllEnemies.find(info => info.defenseThreat === 'NO_DAMAGE');
        if (safeAdjEnemy) {
          this.subMode = 'CLEARING_RETURN_ENEMY';
          return {
            type: 'ATTACK_TARGET',
            targetPos: safeAdjEnemy.enemy.pos,
            priority: 94,
            reason: `⚔️ 王冠開通露払い (${safeAdjEnemy.enemy.name})`,
          };
        }

        // 3-C. 危険敵が帰還路を塞いでいる場合（blockingCause === 'DANGEROUS_ENEMY' のみ許可。BLOCK時は絶対撃たない）
        // ※8方向隣接の危険敵は8T限定の FLASH より永続無力化できる FREEZE を最優先し、FLASH は射程外・拠点近傍のみ使用する
        if (homeReachability.blockingCause === 'DANGEROUS_ENEMY' && !player.hasDeath && player.magic > 0) {
          this.subMode = 'CLEARING_RETURN_ENEMY';
          const needsBreakReserve = Boolean(this.clearingBlockPos || homeReachability.firstBlockingBlockPos);
          const freezeAllowed =
            MagicSystem.canCast(player, 'FREEZE').allowed &&
            (!needsBreakReserve || player.magic >= 2 || !hasEvadeRoute);
          if (surroundings.canSafelyFreezeAdjacent && freezeAllowed) {
            return {
              type: 'CAST_MAGIC',
              magicToCast: 'FREEZE',
              priority: 95,
              reason: '❄️ 王冠開通FREEZE（帰還路上の隣接危険敵を永久凍結）',
            };
          }
          const distToHome3C = map.getTorusDistance(curPos, homePos).manhattan;
          if (
            (surroundings.nearbyDangerousEnemies.length > 0 ||
              surroundings.approachingLethalChebyshev3.length > 0 ||
              distToHome3C <= 6) &&
            this.canCastFlashSafely(
              snapshot,
              player,
              curPos,
              homeReachability,
              adjacentLethalCount > 0,
              hasEvadeRoute
            )
          ) {
            this.recordFlash(curPos, snapshot.totalTurns);
            return {
              type: 'CAST_MAGIC',
              magicToCast: 'FLASH',
              priority: 95,
              reason: '⚡ 王冠運搬路上の危険敵排除FLASH',
            };
          }
        }

        // 3-D. 他に安全帰還開通済みの王冠があればそちらへ切り替え
        const altOpenCrown = items.crowns.allFloorCrowns.find(
          c => (c.pos.x !== curPos.x || c.pos.y !== curPos.y) && c.isReachable && c.canReturnHomeWithCrown
        );
        if (altOpenCrown) {
          this.droppedCrownForClearing = false;
          this.subMode = 'ACQUIRING_CROWN';
          return {
            type: 'NAVIGATE_TO_POSITION',
            targetPos: altOpenCrown.pos,
            targetItemType: 'CROWN',
            priority: 92,
            reason: `👑 帰還路開通済みの別王冠へ切り替え (${altOpenCrown.pos.x}, ${altOpenCrown.pos.y})`,
          };
        }

        // 近傍（Chebyshev <= 3）に危険敵がおらず拠点からも遠い（距離 > 6）遠方敵閉塞なら、一旦王冠を拾って接近し、接敵してからFLASH突破する
        const distToHome3E = map.getTorusDistance(curPos, homePos).manhattan;
        if (
          homeReachability.blockingCause === 'DANGEROUS_ENEMY' &&
          distToHome3E > 6 &&
          surroundings.nearbyDangerousEnemies.length === 0 &&
          surroundings.approachingLethalChebyshev3.length === 0 &&
          !player.hasDeath &&
          player.magic >= 1
        ) {
          this.droppedCrownForClearing = false;
          this.subMode = 'ACQUIRING_CROWN';
          return {
            type: 'PICKUP_ITEM',
            targetPos: curPos,
            targetItemType: 'CROWN',
            priority: 91,
            reason: '👑 近傍脅威なしのため王冠を拾って接近（敵近接時にFLASH突破）',
          };
        }

        // 3-E. 帰還路未開通時の再拾得禁止ゲート:
        // 開通が確認されるまで拾わずに MP補給 / 安全敵撃破 / 手ぶら突破移動を行う
        this.subMode = homeReachability.blockingCause === 'BLOCK' ? 'CLEARING_RETURN_BLOCK' : 'CLEARING_RETURN_ENEMY';

        if (player.magic < 2 && items.nearestPotion) {
          return {
            type: 'NAVIGATE_TO_POSITION',
            targetPos: items.nearestPotion,
            targetItemType: 'POTION',
            priority: 91,
            reason: `🧪 帰還路開拓用MP補給ポーションへ移動 (${items.nearestPotion.x}, ${items.nearestPotion.y})`,
          };
        }

        // 手ぶらなら安全に倒せる敵（帰還路上の敵等）がいれば撃破へ
        let safeHuntEnemy = null;
        let minEnemyDist = Infinity;
        for (const enemy of snapshot.livingEnemies) {
          if (!enemy.isAlive || enemy.isPermanentlyFrozen) continue;
          const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
          const safeToFight =
            details.attackThreat === 'ONE_SHOT' ||
            (details.defenseThreat === 'NO_DAMAGE' && details.turnsToKill <= 6);
          if (!safeToFight) continue;
          const d = map.getTorusDistance(curPos, enemy.pos).manhattan;
          if (d <= 12 && d < minEnemyDist) {
            minEnemyDist = d;
            safeHuntEnemy = enemy;
          }
        }
        if (safeHuntEnemy) {
          return {
            type: 'ATTACK_TARGET',
            targetPos: safeHuntEnemy.pos,
            priority: 90,
            reason: `⚔️ 帰還路確保のため敵排除移動 (${safeHuntEnemy.name})`,
          };
        }

        // これ以上の即時開拓手段がない場合でも「拾う⇄落とす」往復は起こさず、状況打開のため安全徘徊・待機
        return {
          type: 'WANDER_SAFELY',
          priority: 85,
          reason: `👑 帰還路未開通 (${homeReachability.blockingCause}) のため再拾得を保留して状況打開`,
        };
      }

      // ④ 帰還ルート完全開通確認済み: 安全に王冠を取得！
      this.droppedCrownForClearing = false;
      this.subMode = 'CARRYING_TO_HOME';
      return {
        type: 'PICKUP_ITEM',
        targetItemType: 'CROWN',
        priority: 93,
        reason: '👑 進軍ルート開通確認完了: 床の王冠を取得',
      };
    }

    // 2-B. 手ぶら移動中の危険敵接近処理:
    // 周囲8方向隣接（Chebyshev 1）に危険敵がいる場合は永続無力化の FREEZE を最優先（上下左右の致命脅威・退避路なし・王冠閉塞時のみ限定）し、
    // 射程外（距離2〜3）への FLASH はチェビシェフ距離2以内・退避路なし・または王冠への経路閉塞時のみに限定してMP枯渇を防ぐ
    const isCrownPathBlocked =
      items.crowns.reachableCrown === null && items.crowns.nearestCrown !== null;
    const hasCardAdjacentDanger = surroundings.adjacentActiveEnemies.some(
      e => e.defenseThreat === 'LETHAL' || e.damageToPlayer >= player.hp * 0.35
    );
    if (
      surroundings.canSafelyFreezeAdjacent &&
      MagicSystem.canCast(player, 'FREEZE').allowed &&
      (!snapshot.milestones.canBreak || player.magic > 1 || surroundings.safeEvadeDir === null) &&
      (hasCardAdjacentDanger || surroundings.safeEvadeDir === null || isCrownPathBlocked)
    ) {
      this.subMode = 'CLEARING_RETURN_ENEMY';
      return {
        type: 'CAST_MAGIC',
        magicToCast: 'FREEZE',
        priority: 96,
        reason: `❄️ 脱出路確保: 隣接危険敵をFREEZE永久凍結 (${surroundings.chebyshev1ActiveDangerousEnemies[0].name})`,
      };
    }

    const hasCloseLethalChebyshev2 =
      surroundings.approachingLethalEnemies.length > 0 ||
      surroundings.approachingLethalChebyshev3.some(
        e => map.getTorusDistance(curPos, e.pos).chebyshev <= 2
      );

    if (
      surroundings.approachingLethalChebyshev3.length > 0 &&
      (hasCloseLethalChebyshev2 || surroundings.safeEvadeDir === null || isCrownPathBlocked) &&
      this.canCastFlashSafely(snapshot, player, curPos, homeReachability, false, surroundings.safeEvadeDir !== null)
    ) {
      this.recordFlash(curPos, snapshot.totalTurns);
      this.subMode = 'CLEARING_RETURN_ENEMY';
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

    // 2-D. 床の王冠へ移動（到達可能＋帰還開通済みを最優先、次いで到達可能、次いで最寄り候補）
    this.subMode = 'ACQUIRING_CROWN';
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
