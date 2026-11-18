import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { HomeReachabilitySummary, MapSituationEvaluator, MapSituationSummary } from '../../perception/MapSituationEvaluator.js';
import { BaseStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { Position } from '../../../models/Types.js';
import { Player } from '../../../models/Player.js';
import { MagicSystem } from '../../../systems/MagicSystem.js';
import { ThreatEvaluator } from '../../../systems/ThreatEvaluator.js';

/**
 * CrownEscapeMission (カテゴリ1: 王冠回収＆我が家脱出作戦)
 *
 * 大・中・小分類ステートマシン：
 * - 中分類 (subMode): ACQUIRING_CROWN | CLEARING_RETURN_BLOCK | CLEARING_RETURN_ENEMY | CARRYING_TO_HOME
 * - 小分類 (lockedTarget): CROWN | BLOCK | POTION | HOME
 *
 * 毎ターン先頭で「現在のロック対象・状態遷移の成否」を検証し、
 * ロック済みターゲットへの移動中は不要なアクティブスキャン（複数王冠往復BFS）を一切発火させない。
 */
export class CrownEscapeMission extends BaseStrategicMission {
  public readonly id = 'CROWN_ESCAPE';
  public readonly name = '👑 王冠回収＆我が家脱出作戦';
  public readonly maxTurns = 3000;
  public override subMode: 'ACQUIRING_CROWN' | 'CLEARING_RETURN_BLOCK' | 'CLEARING_RETURN_ENEMY' | 'CARRYING_TO_HOME' = 'ACQUIRING_CROWN';
  public override readonly auditProfile = {
    graceTurns: 64,
    tabooable: false,
    maxEscalation: 'BREACH' as const,
  };

  private initialCrownsDelivered: number | null = null;
  private lastFlashTurn: number = -999;
  private pendingReturnHeal: boolean = false;
  private lastReturnHealTurn: number = -999;
  private lastDrop1CPos: Position | null = null;
  private lastDrop1CTurn: number = -999;

  private ensureInitialized(engine: GameEngine): void {
    if (this.initialCrownsDelivered === null) {
      this.initialCrownsDelivered = engine.getPlayer().crowns;
    }
  }

  private recordFlash(_pos: Position, turn: number): void {
    this.lastFlashTurn = turn;
  }

  /**
   * グローバル8Tクールダウン＆RETURN/BREAK用MP=1リザーブを保護した FLASH 詠唱可否判定
   */
  private canCastFlashSafely(
    snapshot: TacticalSnapshot,
    player: Player,
    _curPos: Position,
    _homeReachability: HomeReachabilitySummary,
    hasAdjacentLethal: boolean,
    hasEvadeRoute: boolean
  ): boolean {
    if (!MagicSystem.canCast(player, 'FLASH').allowed) {
      return false;
    }

    const isDesperate = hasAdjacentLethal && !hasEvadeRoute;

    // 座標を問わず直近8ターン以内に既に FLASH を撃っていれば重ね掛け禁止（退避不能な隣接即死時を除く）
    if (!isDesperate && snapshot.totalTurns - this.lastFlashTurn < 8) {
      return false;
    }

    // RETURN / BREAK 用の MP=1 リザーブを死守（退避不能な隣接即死時のみ MP=1 を許可）
    if (player.magic <= 1 && !isDesperate) {
      return false;
    }

    return true;
  }

  /**
   * 他に即死・致死反撃を受ける隣接敵がいない場合のみ、一撃撃破 (ONE_SHOT) 可能な隣接敵を返す
   */
  private findSafeOneShotAdjacentEnemy(
    surroundings: MapSituationSummary['surroundings'],
    player: Player,
    onlyHighThreat: boolean = true
  ) {
    const candidate = surroundings.adjacentActiveEnemies.find(
      info =>
        info.attackThreat === 'ONE_SHOT' &&
        (!onlyHighThreat || info.defenseThreat === 'LETHAL' || info.damageToPlayer >= player.hp * 0.35)
    );
    if (!candidate) return null;

    const hasOtherLethal = surroundings.adjacentActiveEnemies.some(
      info => info.defenseThreat === 'LETHAL' && info.enemy.id !== candidate.enemy.id
    );
    const hasOtherChebyshev1Danger = surroundings.chebyshev1ActiveDangerousEnemies.some(
      info => info.enemy.id !== candidate.enemy.id
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

  /**
   * Step 1: 毎ターン先頭で現在の小分類ロック対象と中分類 subMode の成否・有効性を検証し、状態遷移を行う。
   */
  private verifyAndTransitionState(
    snapshot: TacticalSnapshot,
    player: Player,
    homePos: Position,
    canCastBreak: boolean,
    surroundings: MapSituationSummary['surroundings']
  ): void {
    const map = snapshot.map;
    const curPos = player.pos;
    this.updateLockProgress(curPos, map);

    if (player.holdItem === 'CROWN') {
      this.subMode = 'CARRYING_TO_HOME';
      this.lockTarget('HOME', homePos, snapshot.totalTurns, curPos, map);
      return;
    }

    if (player.holdItem !== 'NONE') {
      this.clearTargetLock();
      this.subMode = 'ACQUIRING_CROWN';
      return;
    }

    // 手ぶら状態での既存ロック有効性検証
    if (this.lockedTarget) {
      switch (this.lockedTarget.kind) {
        case 'BLOCK': {
          if (
            map.getObject(this.lockedTarget.pos) !== 'BLOCK' ||
            !canCastBreak ||
            this.isLockInvalidated(snapshot, 20)
          ) {
            this.clearTargetLock();
            if (this.subMode === 'CLEARING_RETURN_BLOCK') {
              this.subMode = 'ACQUIRING_CROWN';
            }
          }
          break;
        }
        case 'POTION': {
          if (
            map.getItem(this.lockedTarget.pos) !== 'POTION' ||
            player.magic >= 2 ||
            this.isLockInvalidated(snapshot, 12)
          ) {
            this.clearTargetLock();
          }
          break;
        }
        case 'CROWN': {
          if (
            map.getItem(this.lockedTarget.pos) !== 'CROWN' ||
            this.isLockInvalidated(snapshot, 25)
          ) {
            this.clearTargetLock();
          }
          break;
        }
        case 'HOME':
        default: {
          this.clearTargetLock();
          this.subMode = 'ACQUIRING_CROWN';
          break;
        }
      }
    }

    if (this.subMode === 'CLEARING_RETURN_BLOCK' && this.lockedTarget?.kind !== 'BLOCK') {
      this.subMode = 'ACQUIRING_CROWN';
    }

    if (
      this.subMode === 'CLEARING_RETURN_ENEMY' &&
      surroundings.floorItem !== 'CROWN' &&
      surroundings.chebyshev1ActiveDangerousEnemies.length === 0 &&
      surroundings.nearbyDangerousEnemies.length === 0 &&
      surroundings.approachingLethalChebyshev3.length === 0
    ) {
      this.subMode = 'ACQUIRING_CROWN';
    }
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    this.ensureInitialized(engine);
    const player = engine.getPlayer();
    const map = snapshot.map;
    const curPos = player.pos;
    const situation = MapSituationEvaluator.get(snapshot, engine);
    const { homeReachability, items, surroundings } = situation;
    const homePos = homeReachability.bestHomePos;
    const canCastBreak = MagicSystem.canCast(player, 'BREAK').allowed;

    // Step 1: 状態確認・ロック有効性検査・遷移
    this.verifyAndTransitionState(snapshot, player, homePos, canCastBreak, surroundings);

    if (homeReachability.isAtHome || player.hp >= player.maxHp) {
      this.pendingReturnHeal = false;
    }

    // 0. 不要な手持ち品（KEY, RING, CROSS等）の手放し
    if (player.holdItem !== 'NONE' && player.holdItem !== 'CROWN') {
      this.clearTargetLock();
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

    // 0-D. 王冠ドロップ後のRETURN緊急帰還回復（pendingReturnHeal時のみ発動し、王冠未取得時の不要な帰還を防止）
    const hasCardLethalAdjacent = surroundings.adjacentActiveEnemies.some(info => info.defenseThreat === 'LETHAL');
    if (
      this.pendingReturnHeal &&
      player.holdItem === 'NONE' &&
      !homeReachability.isAtHome &&
      !hasCardLethalAdjacent &&
      MagicSystem.canCast(player, 'RETURN').allowed
    ) {
      this.pendingReturnHeal = false;
      this.lastReturnHealTurn = snapshot.totalTurns;
      this.clearTargetLock();
      this.subMode = 'ACQUIRING_CROWN';
      return {
        type: 'CAST_MAGIC',
        magicToCast: 'RETURN',
        priority: 101,
        reason: `🏠 HP低下 (${player.hp}/${player.maxHp}) のためRETURNで我が家へ緊急帰還回復`,
      };
    }

    // -------------------------------------------------------------
    // 1. CARRYING_TO_HOME (holdItem === 'CROWN') の自衛＆我が家帰還
    // -------------------------------------------------------------
    if (this.subMode === 'CARRYING_TO_HOME' && player.holdItem === 'CROWN') {
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

      // 1-B2. HP低下時の安全一時ドロップ → RETURN帰還回復（RETURN + 帰還後家周辺FREEZE用に MP >= 2 を要求）
      if (
        !homeReachability.isAtHome &&
        surroundings.floorItem === 'NONE' &&
        player.hp < player.maxHp * 0.35 &&
        player.magic >= 2 &&
        !player.hasDeath &&
        player.experience >= 6000 &&
        map.getTorusDistance(curPos, homePos).manhattan > 8 &&
        snapshot.totalTurns - this.lastReturnHealTurn >= 20
      ) {
        this.pendingReturnHeal = true;
        this.lastReturnHealTurn = snapshot.totalTurns;
        this.clearTargetLock();
        this.subMode = 'ACQUIRING_CROWN';
        return {
          type: 'DROP_HOLD_ITEM',
          priority: 99,
          reason: `👑 HP低下 (${player.hp}/${player.maxHp}) のため王冠を一時手放してRETURN回復準備`,
        };
      }

      // 1-C. 8方向隣接の危険敵に対する一時ドロップ＆FREEZE永久凍結準備
      const canCastWhenEmpty = player.magic > 0 && !player.hasDeath;
      const flashOnCooldown1C = snapshot.totalTurns - this.lastFlashTurn < 8;
      const needsBreakReserve1C = !homeReachability.canReachStaticallyWithCrown;
      const canFreezeWhenEmpty1C =
        canCastWhenEmpty &&
        !homeReachability.isNearRealHome &&
        (!needsBreakReserve1C || player.magic >= 2);
      const canFlashWhenEmpty1C =
        canCastWhenEmpty &&
        player.magic >= 2 &&
        !flashOnCooldown1C;
      const drop1COnCooldown =
        this.lastDrop1CPos !== null &&
        this.lastDrop1CPos.x === curPos.x &&
        this.lastDrop1CPos.y === curPos.y &&
        snapshot.totalTurns - this.lastDrop1CTurn < 6;

      if (
        !player.isFlying &&
        !drop1COnCooldown &&
        (canFreezeWhenEmpty1C || canFlashWhenEmpty1C) &&
        (surroundings.chebyshev1ActiveDangerousEnemies.length > 0 ||
          surroundings.approachingLethalEnemies.length > 0)
      ) {
        const targetDanger =
          surroundings.chebyshev1ActiveDangerousEnemies[0]?.enemy ??
          surroundings.approachingLethalEnemies[0];

        if (surroundings.floorItem !== 'NONE') {
          return {
            type: 'EVADE_DANGER',
            priority: 98,
            reason: `🚨 王冠運搬中・足元アイテム(${surroundings.floorItem})回避し空き床で魔法発動準備 (${targetDanger.name})`,
          };
        }

        const totalDangerCount1C =
          surroundings.chebyshev1ActiveDangerousEnemies.length +
          surroundings.approachingLethalEnemies.length;
        const preferFlash1C =
          canFlashWhenEmpty1C &&
          (!canFreezeWhenEmpty1C ||
            surroundings.approachingLethalEnemies.length > 0 ||
            totalDangerCount1C >= 2);

        this.lastDrop1CPos = { ...curPos };
        this.lastDrop1CTurn = snapshot.totalTurns;
        this.clearTargetLock();
        this.subMode = 'CLEARING_RETURN_ENEMY';
        return {
          type: 'DROP_HOLD_ITEM',
          priority: 98,
          reason: `👑 接近危険敵を${preferFlash1C ? 'FLASH足止め' : 'FREEZE永久凍結'}するため王冠一時ドロップ (${targetDanger.name})`,
        };
      }

      // 1-D. 帰還経路が遮断されている場合の一時ドロップ開拓（静的開通かつ非ブロックなら不要な敵込みBFSを省略）
      const needsReturnClearCheck =
        !homeReachability.canReachStaticallyWithCrown ||
        (this.lockedTarget !== null && this.lockedTarget.blockedCount > 0);
      if (surroundings.floorItem === 'NONE' && needsReturnClearCheck && !homeReachability.canReachWithCrown) {
        const canBreakWhenEmpty = !player.hasDeath && player.experience >= 4000 && player.magic >= 1;
        const canUnblockByBreak =
          homeReachability.blockingCause === 'BLOCK' &&
          canBreakWhenEmpty &&
          homeReachability.firstBlockingBlockPos !== null;

        if (canUnblockByBreak && homeReachability.firstBlockingBlockPos) {
          this.lockTarget('BLOCK', homeReachability.firstBlockingBlockPos, snapshot.totalTurns, curPos, map);
          this.subMode = 'CLEARING_RETURN_BLOCK';
          return {
            type: 'DROP_HOLD_ITEM',
            priority: 97,
            reason: `👑 王冠運搬路遮断 (${homeReachability.blockingCause}): 岩開削のため一時ドロップ`,
          };
        }

        const altOpenCrown = MapSituationEvaluator.findAlternativeOpenCrown(snapshot, curPos, engine);
        if (altOpenCrown) {
          this.lockTarget('CROWN', altOpenCrown.pos, snapshot.totalTurns, curPos, map);
          this.subMode = 'ACQUIRING_CROWN';
          return {
            type: 'DROP_HOLD_ITEM',
            priority: 97,
            reason: `👑 王冠運搬路遮断 (${homeReachability.blockingCause}): 別開通王冠へ切替のため一時ドロップ`,
          };
        }
      }

      // 1-E. 最適な我が家へ最速直行
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: homePos,
        priority: 90,
        policy: homeReachability.isNearRealHome ? { disallowFreezeNearHome: true } : undefined,
        reason: `👑 王冠所持: 我が家 (${homePos.x}, ${homePos.y}) へ最速脱出帰還`,
      };
    }

    // -------------------------------------------------------------
    // 2. 手ぶら時 (holdItem === 'NONE') の状態マシン処理
    // -------------------------------------------------------------

    // 2-0. CLEARING_RETURN_BLOCK: ロック済みの岩開削ターゲットがある場合は完遂する（往復ピンポン完全防止）
    if (
      this.subMode === 'CLEARING_RETURN_BLOCK' &&
      this.lockedTarget?.kind === 'BLOCK' &&
      canCastBreak &&
      !snapshot.threats.isLethalDanger &&
      surroundings.nearbyDangerousEnemies.length === 0
    ) {
      return {
        type: 'BREACH_SHORTCUT',
        targetPos: this.lockedTarget.pos,
        priority: 95,
        reason: `🔨 王冠運搬路の開削継続 (${this.lockedTarget.pos.x}, ${this.lockedTarget.pos.y})`,
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

        const needsBreakReserve =
          this.lockedTarget?.kind === 'BLOCK' ||
          !homeReachability.canReachStaticallyWithCrown;
        const freezeAllowed =
          MagicSystem.canCast(player, 'FREEZE').allowed &&
          (!needsBreakReserve || player.magic >= 2 || !hasEvadeRoute);

        if (surroundings.canSafelyFreezeAdjacent && freezeAllowed) {
          return {
            type: 'CAST_MAGIC',
            magicToCast: 'FREEZE',
            priority: 98,
            reason: `❄️ 王冠取得前・隣接危険敵をFREEZE永久凍結 (${surroundings.chebyshev1ActiveDangerousEnemies[0].enemy.name})`,
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
          const dangerTarget = surroundings.chebyshev1ActiveDangerousEnemies[0]?.enemy ?? surroundings.nearbyDangerousEnemies[0]?.enemy;
          this.recordFlash(curPos, snapshot.totalTurns);
          return {
            type: 'CAST_MAGIC',
            magicToCast: 'FLASH',
            priority: 98,
            reason: `⚡ 王冠取得前ギリギリ足止めFLASH (${dangerTarget.name})`,
          };
        }

        const adjOneShot = this.findSafeOneShotAdjacentEnemy(surroundings, player, false);
        if (adjOneShot) {
          return {
            type: 'ATTACK_TARGET',
            targetPos: adjOneShot.enemy.pos,
            priority: 96,
            reason: `⚔️ 王冠取得前露払い (${adjOneShot.enemy.name})`,
          };
        }

        // MP=0で足止め魔法・一撃撃破とも不可な場合: ポーション回収または別王冠へ切り替え、退避時の2マス往復を防止
        if (player.magic === 0) {
          if (items.nearestPotion && map.getTorusDistance(curPos, items.nearestPotion).manhattan <= 20) {
            this.subMode = 'ACQUIRING_CROWN';
            this.lockTarget('POTION', items.nearestPotion, snapshot.totalTurns, curPos, map);
            if (surroundings.chebyshev1ActiveDangerousEnemies.length === 0) {
              return {
                type: 'NAVIGATE_TO_POSITION',
                targetPos: items.nearestPotion,
                targetItemType: 'POTION',
                priority: 95,
                reason: `🧪 MP枯渇のため先にポーション回収へ (${items.nearestPotion.x}, ${items.nearestPotion.y})`,
              };
            }
          } else {
            const altOpenCrown = MapSituationEvaluator.findAlternativeOpenCrown(snapshot, curPos, engine);
            if (altOpenCrown) {
              this.subMode = 'ACQUIRING_CROWN';
              this.lockTarget('CROWN', altOpenCrown.pos, snapshot.totalTurns, curPos, map);
              if (surroundings.chebyshev1ActiveDangerousEnemies.length === 0) {
                return {
                  type: 'NAVIGATE_TO_POSITION',
                  targetPos: altOpenCrown.pos,
                  targetItemType: 'CROWN',
                  priority: 95,
                  reason: `👑 危険敵居座りかつMP=0のため別王冠へ切替 (${altOpenCrown.pos.x}, ${altOpenCrown.pos.y})`,
                };
              }
            }
          }
          if (
            this.lockedTarget?.kind === 'CROWN' &&
            this.lockedTarget.pos.x === curPos.x &&
            this.lockedTarget.pos.y === curPos.y
          ) {
            snapshot.memory.markTargetUnreachable(curPos, 4, snapshot.totalTurns);
            this.clearTargetLock();
          }
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
          this.lockTarget('POTION', items.nearestPotion, snapshot.totalTurns, curPos, map);
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
      if (!homeReachability.canReachWithCrown) {
        // 3-A. 直角隣接または帰還経路上の岩（BLOCK）を優先開削
        if (surroundings.adjacentBlocks.length > 0 && canCastBreak) {
          const adjBlock = surroundings.adjacentBlocks[0].pos;
          this.subMode = 'CLEARING_RETURN_BLOCK';
          this.lockTarget('BLOCK', adjBlock, snapshot.totalTurns, curPos, map);
          return {
            type: 'BREACH_SHORTCUT',
            targetPos: adjBlock,
            priority: 95,
            reason: '🔨 王冠運搬路の事前開削: 直角隣接の岩を破壊',
          };
        }

        if (
          homeReachability.firstBlockingBlockPos &&
          canCastBreak &&
          !snapshot.memory.isTargetUnreachable(homeReachability.firstBlockingBlockPos, snapshot.totalTurns)
        ) {
          const blockPos = homeReachability.firstBlockingBlockPos;
          this.subMode = 'CLEARING_RETURN_BLOCK';
          this.lockTarget('BLOCK', blockPos, snapshot.totalTurns, curPos, map);
          return {
            type: 'BREACH_SHORTCUT',
            targetPos: blockPos,
            priority: 95,
            reason: `🔨 王冠運搬路の事前開削: 経路上の岩 (${blockPos.x}, ${blockPos.y}) を破壊へ移動`,
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

        // 3-C. 危険敵が帰還路を塞いでいる場合（blockingCause === 'DANGEROUS_ENEMY' のみ許可）
        if (homeReachability.blockingCause === 'DANGEROUS_ENEMY' && !player.hasDeath && player.magic > 0) {
          this.subMode = 'CLEARING_RETURN_ENEMY';
          const needsBreakReserve = !homeReachability.canReachStaticallyWithCrown;
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

        // 3-D. 他に安全帰還開通済みの王冠があればそちらへ切り替え（オンデマンド・アクティブスキャン）
        const altOpenCrown = MapSituationEvaluator.findAlternativeOpenCrown(snapshot, curPos, engine);
        if (altOpenCrown) {
          this.subMode = 'ACQUIRING_CROWN';
          this.lockTarget('CROWN', altOpenCrown.pos, snapshot.totalTurns, curPos, map);
          return {
            type: 'NAVIGATE_TO_POSITION',
            targetPos: altOpenCrown.pos,
            targetItemType: 'CROWN',
            priority: 92,
            reason: `👑 帰還路開通済みの別王冠へ切り替え (${altOpenCrown.pos.x}, ${altOpenCrown.pos.y})`,
          };
        }

        // 近傍に危険敵がおらず拠点からも遠い遠方敵閉塞なら、一旦王冠を拾って接近し、接敵してからFLASH突破する
        const distToHome3E = map.getTorusDistance(curPos, homePos).manhattan;
        if (
          homeReachability.blockingCause === 'DANGEROUS_ENEMY' &&
          distToHome3E > 6 &&
          surroundings.nearbyDangerousEnemies.length === 0 &&
          surroundings.approachingLethalChebyshev3.length === 0 &&
          !player.hasDeath &&
          player.magic >= 1
        ) {
          this.subMode = 'CARRYING_TO_HOME';
          this.lockTarget('HOME', homePos, snapshot.totalTurns, curPos, map);
          return {
            type: 'PICKUP_ITEM',
            targetPos: curPos,
            targetItemType: 'CROWN',
            priority: 91,
            reason: '👑 近傍脅威なしのため王冠を拾って接近（敵近接時にFLASH突破）',
          };
        }

        // 3-E. 帰還路未開通時の再拾得禁止ゲート
        this.subMode = homeReachability.blockingCause === 'BLOCK' ? 'CLEARING_RETURN_BLOCK' : 'CLEARING_RETURN_ENEMY';

        if (player.magic < 2 && items.nearestPotion) {
          this.lockTarget('POTION', items.nearestPotion, snapshot.totalTurns, curPos, map);
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

        return {
          type: 'WANDER_SAFELY',
          priority: 85,
          reason: `👑 帰還路未開通 (${homeReachability.blockingCause}) のため再拾得を保留して状況打開`,
        };
      }

      // ④ 帰還ルート完全開通確認済み: 安全に王冠を取得！
      this.subMode = 'CARRYING_TO_HOME';
      this.lockTarget('HOME', homePos, snapshot.totalTurns, curPos, map);
      return {
        type: 'PICKUP_ITEM',
        targetItemType: 'CROWN',
        priority: 93,
        reason: '👑 進軍ルート開通確認完了: 床の王冠を取得',
      };
    }

    // 2-B. 手ぶら移動中の危険敵接近処理（FREEZE永久凍結を最優先、FLASHは退避不能または経路閉塞時のみ）
    const isCrownPathBlocked =
      (this.lockedTarget?.kind === 'CROWN' && this.lockedTarget.blockedCount > 0) ||
      (items.crowns.nearestCrown !== null && !items.crowns.nearestCrown.isStaticallyReachable);
    const hasCardAdjacentDanger = surroundings.adjacentActiveEnemies.some(
      e => e.defenseThreat === 'LETHAL' || e.damageToPlayer >= player.hp * 0.35
    );

    const tryCastFreeze2B = (): StrategicDirective | null => {
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
          reason: `❄️ 脱出路確保: 隣接危険敵をFREEZE永久凍結 (${surroundings.chebyshev1ActiveDangerousEnemies[0].enemy.name})`,
        };
      }
      return null;
    };

    const tryCastFlash2B = (): StrategicDirective | null => {
      const hasCloseLethalChebyshev2 =
        surroundings.approachingLethalEnemies.length > 0 ||
        surroundings.approachingLethalChebyshev3.some(
          e => map.getTorusDistance(curPos, e.pos).chebyshev <= 2
        ) ||
        surroundings.chebyshev1ActiveDangerousEnemies.length >= 2;

      const hasFlashTarget =
        surroundings.approachingLethalChebyshev3.length > 0 ||
        surroundings.approachingLethalEnemies.length > 0 ||
        surroundings.chebyshev1ActiveDangerousEnemies.length >= 2;

      const needsFlashToEscapeOrUnblock =
        surroundings.safeEvadeDir === null ||
        (isCrownPathBlocked && hasCloseLethalChebyshev2);

      if (
        hasFlashTarget &&
        needsFlashToEscapeOrUnblock &&
        this.canCastFlashSafely(
          snapshot,
          player,
          curPos,
          homeReachability,
          hasCardAdjacentDanger,
          surroundings.safeEvadeDir !== null
        )
      ) {
        const flashTargetName =
          surroundings.approachingLethalChebyshev3[0]?.name ??
          surroundings.approachingLethalEnemies[0]?.name ??
          surroundings.chebyshev1ActiveDangerousEnemies[0]?.enemy.name ??
          '危険敵';
        this.recordFlash(curPos, snapshot.totalTurns);
        this.subMode = 'CLEARING_RETURN_ENEMY';
        return {
          type: 'CAST_MAGIC',
          magicToCast: 'FLASH',
          priority: 96,
          reason: `⚡ 即死敵接近足止めFLASH (${flashTargetName})`,
        };
      }
      return null;
    };

    const magicDirective2B = tryCastFreeze2B() ?? tryCastFlash2B();
    if (magicDirective2B) {
      return magicDirective2B;
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

    if (player.magic < 2) {
      const potionTarget =
        this.lockedTarget?.kind === 'POTION' ? this.lockedTarget.pos : items.nearestPotion;
      if (potionTarget) {
        this.subMode = 'ACQUIRING_CROWN';
        this.lockTarget('POTION', potionTarget, snapshot.totalTurns, curPos, map);
        return {
          type: 'NAVIGATE_TO_POSITION',
          targetPos: potionTarget,
          targetItemType: 'POTION',
          priority: 89,
          reason: `🧪 脱出用MP補給 (${potionTarget.x}, ${potionTarget.y})`,
        };
      }
    }

    // 2-C2. MP=0でロック済み王冠の直近に危険敵が居座っている場合は別王冠へ切替
    if (
      player.magic === 0 &&
      this.lockedTarget?.kind === 'CROWN' &&
      map.getTorusDistance(curPos, this.lockedTarget.pos).chebyshev <= 2 &&
      (surroundings.nearbyDangerousEnemies.length > 0 || surroundings.approachingLethalChebyshev3.length > 0)
    ) {
      const lockedCrownPos = this.lockedTarget.pos;
      const altCrown = MapSituationEvaluator.findAlternativeOpenCrown(snapshot, lockedCrownPos, engine);
      if (altCrown) {
        this.subMode = 'ACQUIRING_CROWN';
        this.lockTarget('CROWN', altCrown.pos, snapshot.totalTurns, curPos, map);
        return {
          type: 'NAVIGATE_TO_POSITION',
          targetPos: altCrown.pos,
          targetItemType: 'CROWN',
          priority: 88,
          reason: `👑 危険敵居座りかつMP=0のため別王冠へ切替 (${altCrown.pos.x}, ${altCrown.pos.y})`,
        };
      }
    }

    // 2-D. 床の王冠へ移動:
    // ロック済みターゲットが有効であればアクティブスキャンを行わずそのまま直行し、
    // 未ロック・再計画時のみ MapSituationEvaluator.selectBestCrownTarget を明示呼び出しする
    this.subMode = 'ACQUIRING_CROWN';
    if (this.lockedTarget?.kind === 'CROWN') {
      const dist = map.getTorusDistance(curPos, this.lockedTarget.pos).manhattan;
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: this.lockedTarget.pos,
        targetItemType: 'CROWN',
        priority: 88,
        reason: `👑 床の王冠へ移動 (${this.lockedTarget.pos.x}, ${this.lockedTarget.pos.y}) [距離:${dist}]`,
      };
    }

    if (items.crowns.allFloorCrowns.length > 0) {
      const targetCrown = MapSituationEvaluator.selectBestCrownTarget(snapshot, engine);
      if (targetCrown) {
        this.lockTarget('CROWN', targetCrown.pos, snapshot.totalTurns, curPos, map);
        return {
          type: 'NAVIGATE_TO_POSITION',
          targetPos: targetCrown.pos,
          targetItemType: 'CROWN',
          priority: 88,
          reason: `👑 床の王冠へ移動 (${targetCrown.pos.x}, ${targetCrown.pos.y}) [距離:${targetCrown.dist}]`,
        };
      }
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

    // 2-F. 直角隣接の安全な ONE_SHOT 敵を露払い排除
    const oneShotAdj = this.findSafeOneShotAdjacentEnemy(surroundings, player, false);
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
