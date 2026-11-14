import { GameEngine } from '../../core/GameEngine.js';
import { TacticalSnapshot } from '../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../perception/MapSituationEvaluator.js';
import { IStrategicMission, MissionCompletionReason, MissionStatus } from './StrategicMission.js';
import { StrategicDirective } from './StrategicDirective.js';
import { EmergencyEvacuateMission } from './missions/EmergencyEvacuateMission.js';
import { CrownEscapeMission } from './missions/CrownEscapeMission.js';
import { SlayDragonMission } from './missions/SlayDragonMission.js';
import { PrepareDragonAssaultMission } from './missions/PrepareDragonAssaultMission.js';
import { CashInGoldMission } from './missions/CashInGoldMission.js';
import { EarlyBreakUnlockMission } from './missions/EarlyBreakUnlockMission.js';
import { RelocateHomeMission } from './missions/RelocateHomeMission.js';
import { ReadinessEvaluator } from './evaluators/ReadinessEvaluator.js';
import { DirectiveArbiter } from './arbitration/DirectiveArbiter.js';
import { MissionSelector } from './evaluators/MissionSelector.js';
import { TacticalExecutionResult, TacticalExecutionStatus } from '../tactics/TacticalExecutor.js';
import { Position } from '../../models/Types.js';

/**
 * StrategicPlanner (戦略ユニット司令塔)
 *
 * 認知ユニットから提供された世界の客観的事実（TacticalSnapshot）に基づき、
 * 最上位の作戦（StrategicMission）を選定・コミットし、戦略調停器を経て戦術指令（StrategicDirective）を発行する。
 * 各専門ロジックは以下のサブモジュールへ委譲し、本クラスはオーケストレーションに専念する：
 * - 大局ミッション選定: MissionSelector
 * - 指令調停・並行基本行動: DirectiveArbiter
 * - 戦術膠着打開（カテゴリ3）: TacticalStallResolver
 * - 動線ついで拾い・迎撃: OpportunisticEvaluator
 */
export class StrategicPlanner {
  public activeMission: IStrategicMission | null = null;
  public missionHistory: { missionId: string; status: MissionStatus; reason?: MissionCompletionReason; turns: number }[] = [];
  public totalGraveSealTurns: number = 0;
  public graveSealDone: boolean = false;
  public relocateDone: boolean = false;
  public defensePrepTurns: number = 0;
  private missionCooldowns: Map<string, number> = new Map();

  // 要件2: 戦術フィードバック状態管理
  public lastTacticalStatus: TacticalExecutionStatus | null = null;
  private lastBlockedTarget: Position | null = null;
  private consecutiveBlockedTurns: number = 0;

  constructor() {}

  /**
   * 戦術層からの行動実行結果フィードバックを受け取る
   */
  public recordExecutionResult(
    directive: StrategicDirective,
    result: TacticalExecutionResult,
    snapshot: TacticalSnapshot
  ): void {
    this.lastTacticalStatus = result.status;

    // 現行ミッションへの個別フィードバック通知
    if (this.activeMission?.onTacticalFeedback) {
      this.activeMission.onTacticalFeedback(result, directive, snapshot);
    }

    // 経路遮断（PATH_BLOCKED）の監視とブラックリスト化
    if (result.status === 'PATH_BLOCKED' && directive.targetPos) {
      const target = directive.targetPos;
      const isHomeTarget =
        snapshot.map.getBaseTile(target) === 'HOME' ||
        snapshot.map.getAllHomePositions().some(h => h.x === target.x && h.y === target.y);

      // 王冠脱出ミッション中、および我が家(HOME)ターゲットは絶対放棄・ブラックリスト化しない
      if (this.activeMission?.id === 'CROWN_ESCAPE' || isHomeTarget) {
        this.lastBlockedTarget = null;
        this.consecutiveBlockedTurns = 0;
        return;
      }

      const isSameTarget =
        this.lastBlockedTarget !== null &&
        this.lastBlockedTarget.x === target.x &&
        this.lastBlockedTarget.y === target.y;

      if (isSameTarget) {
        this.consecutiveBlockedTurns++;
      } else {
        this.lastBlockedTarget = { x: target.x, y: target.y };
        this.consecutiveBlockedTurns = 1;
      }

      // 同一ターゲットへの移動が 2〜3 ターン連続で PATH_BLOCKED となった場合
      if (this.consecutiveBlockedTurns >= 2) {
        // エピソード記憶（認知層）にブラックリスト登録
        snapshot.memory.markTargetUnreachable(target, 30, snapshot.totalTurns);

        // 現行ミッションを即座に ABORTED として別作戦・別ターゲットへ強制転進
        if (this.activeMission) {
          this.activeMission.status = 'ABORTED';
          if (!this.activeMission.completionReason) {
            this.activeMission.completionReason = 'NO_PROGRESS_BLOCKED';
          }
          this.activeMission.onAborted?.(
            snapshot,
            `ターゲット(${target.x}, ${target.y})への経路遮断が${this.consecutiveBlockedTurns}回連続したためブラックリスト化`
          );
        }

        this.lastBlockedTarget = null;
        this.consecutiveBlockedTurns = 0;
      }
    } else if (result.status === 'SUCCESS') {
      this.lastBlockedTarget = null;
      this.consecutiveBlockedTurns = 0;
    }
  }

  /**
   * 毎ターンの戦略判断ルーチン
   */
  public planTurn(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    const dragon = engine.getDragon();
    const isAllHeadsDefeated = Boolean(
      dragon && (dragon.isAllHeadsDefeated || dragon.heads.every(h => !h.isAlive))
    );

    // 1. ドラゴン討伐完了 -> 即座に王冠脱出ミッションへ切り替え＆絶対維持
    // (HPピンチや即死敵隣接を理由に EmergencyEvacuateMission へ毎ターン上書きして状態リセットされるのを防ぐ)
    if (isAllHeadsDefeated) {
      if (!this.activeMission || this.activeMission.id !== 'CROWN_ESCAPE') {
        if (this.activeMission) {
          if (this.activeMission.id === 'SLAY_DRAGON') {
            this.activeMission.status = 'COMPLETED';
            this.activeMission.completionReason = 'OBJECTIVE_ACHIEVED';
            this.activeMission.onCompleted?.(snapshot);
            this.recordMissionHistory(this.activeMission, 'COMPLETED', 'OBJECTIVE_ACHIEVED', snapshot.totalTurns);
          } else {
            const reason = this.activeMission.completionReason ?? 'INTERRUPTED_BY_EMERGENCY';
            this.activeMission.status = 'ABORTED';
            this.activeMission.completionReason = reason;
            this.activeMission.onAborted?.(snapshot, '全ドラゴン頭撃破による王冠脱出へ強制移行');
            this.recordMissionHistory(this.activeMission, 'ABORTED', reason, snapshot.totalTurns);
          }
        }
        this.activeMission = new CrownEscapeMission();
      }
    } else if (snapshot.threats.isLethalDanger || snapshot.threats.isPinchHp) {
      // 1-B. 緊急危機介入 (HPピンチまたは即死敵隣接 ※王冠脱出局面以外)
      if (!this.activeMission || this.activeMission.id !== 'EMERGENCY_EVACUATE') {
        if (this.activeMission) {
          this.activeMission.status = 'ABORTED';
          this.activeMission.completionReason = 'INTERRUPTED_BY_EMERGENCY';
          this.activeMission.onAborted?.(snapshot, '緊急退避による割り込み中断');
          this.recordMissionHistory(this.activeMission, 'ABORTED', 'INTERRUPTED_BY_EMERGENCY', snapshot.totalTurns);
        }
        this.activeMission = new EmergencyEvacuateMission();
      }
    }

    // 1-C. 決戦・準備移行割り込み: 育成・探索系ミッション中に適正戦力に到達または宝箱・石枯渇なら準備または決戦へ移行
    const player = engine.getPlayer();
    const items = MapSituationEvaluator.get(snapshot, engine).items;
    const canUnlockChestsCurrent =
      (player.holdItem === 'KEY' || MissionSelector.hasReachableKey(snapshot.map, snapshot)) &&
      MissionSelector.hasReachableChests(snapshot.map, snapshot);
    const allChestsAndStonesExhausted =
      !canUnlockChestsCurrent &&
      items.powerStones.length === 0 &&
      player.holdItem !== 'POWER_STONE';
    const canDamageDragon = player.hasSword && player.strength >= snapshot.params.targetStr;
    const hasDiagonal = player.experience >= 12000 || player.canDiagonal || snapshot.milestones.canDiagonal;
    if (canDamageDragon && hasDiagonal) {
      this.defensePrepTurns++;
    }
    const canTransitionToPrep =
      MissionSelector.isReadyForDragon(snapshot, engine, this.defensePrepTurns) ||
      canDamageDragon ||
      (player.hasSword && allChestsAndStonesExhausted);

    if (
      canTransitionToPrep &&
      this.activeMission &&
      this.activeMission.id !== 'SLAY_DRAGON' &&
      this.activeMission.id !== 'PREPARE_DRAGON_ASSAULT' &&
      this.activeMission.id !== 'RELOCATE_HOME' &&
      this.activeMission.id !== 'CROWN_ESCAPE' &&
      this.activeMission.id !== 'EMERGENCY_EVACUATE' &&
      this.activeMission.id !== 'CASH_IN_GOLD' &&
      this.activeMission.id !== 'EARLY_BREAK_UNLOCK' &&
      player.holdItem !== 'POWER_STONE' &&
      !(player.holdItem === 'KEY' && MissionSelector.hasNearbyChest(player.pos, snapshot.map, 8, snapshot))
    ) {
      // 要件1: 5条件（攻撃力・斜め移動・BREAK・MP・HP十分）を満たし、準備が完了またはタイムアウトしたら SlayDragonMission を起動
      const assessment = ReadinessEvaluator.evaluateDragonReadiness(snapshot, engine, this.defensePrepTurns);
      const readyForDragon = MissionSelector.isReadyForDragon(snapshot, engine, this.defensePrepTurns);
      const noReachablePotion = items.nearbyPotionCountWithin15 === 0 && items.nearestPotion === null;
      const prepCooldownUntil = this.missionCooldowns.get('PREPARE_DRAGON_ASSAULT') ?? 0;
      const slayCooldownUntil = this.missionCooldowns.get('SLAY_DRAGON') ?? 0;
      const prepOnCooldown = prepCooldownUntil > snapshot.totalTurns;
      const slayOnCooldown = slayCooldownUntil > snapshot.totalTurns;

      let nextMission: IStrategicMission;
      if (readyForDragon && (assessment.isFullyPrepared || prepOnCooldown) && !slayOnCooldown) {
        nextMission = new SlayDragonMission();
      } else {
        // 事前準備優先起動
        if (player.experience < 12000 || !snapshot.milestones.canDiagonal || !snapshot.milestones.canBreak) {
          const estimatedGainedExp = player.gold * 300 + Math.floor(player.experience * 0.02 * player.gold);
          const hitsBreak = player.experience < 4000 && player.experience + estimatedGainedExp >= 4000;
          const earlyBreakCooldownUntil = this.missionCooldowns.get('EARLY_BREAK_UNLOCK') ?? 0;
          const earlyBreakOnCooldown = earlyBreakCooldownUntil > snapshot.totalTurns;
          const clearZoneCooldownUntil = this.missionCooldowns.get('CLEAR_TREASURE_ZONE') ?? 0;
          const clearZoneOnCooldown = clearZoneCooldownUntil > snapshot.totalTurns;
          const canUnlockChests =
            MissionSelector.hasReachableKey(snapshot.map, snapshot) &&
            MissionSelector.hasReachableChests(snapshot.map, snapshot);

          if (player.gold > 0 && (player.experience + estimatedGainedExp >= 12000 || hitsBreak || player.gold >= 3)) {
            nextMission = new CashInGoldMission(player.gold);
          } else if (!prepOnCooldown && items.nearestCoin !== null) {
            nextMission = new PrepareDragonAssaultMission();
          } else if (player.gold > 0) {
            nextMission = new CashInGoldMission(player.gold);
          } else if (!clearZoneOnCooldown && canUnlockChests) {
            nextMission = this.selectNextMission(snapshot, engine);
          } else if (!earlyBreakOnCooldown && MissionSelector.hasSafeEnemyNearby(player, snapshot)) {
            nextMission = new EarlyBreakUnlockMission(12000);
          } else {
            nextMission = this.selectNextMission(snapshot, engine);
          }
        } else if (
          !prepOnCooldown &&
          ((!noReachablePotion && player.magic < 3) || assessment.needsPotionSweep || assessment.needsCoinSweep)
        ) {
          nextMission = new PrepareDragonAssaultMission();
        } else if (assessment.needsGoldCashIn || player.gold > 0) {
          nextMission = new CashInGoldMission(player.gold);
        } else if (assessment.needsRelocation && !this.relocateDone && (player.holdItem === 'RING' || ReadinessEvaluator.hasMapRing(snapshot.map, snapshot))) {
          const anchor = snapshot.spatial.recommendedRelocateAnchors[0] ?? { x: 32, y: 25 };
          nextMission = new RelocateHomeMission(anchor);
        } else if (!prepOnCooldown && player.hp < player.maxHp * 0.5 && player.hp < 15000) {
          nextMission = new PrepareDragonAssaultMission();
        } else if (!slayOnCooldown && readyForDragon) {
          nextMission = new SlayDragonMission();
        } else {
          nextMission = this.selectNextMission(snapshot, engine);
        }
      }

      // 同じミッションを再生成してチャタリングを起こす場合は中断しない
      if (nextMission.id !== this.activeMission.id) {
        const reason: MissionCompletionReason =
          this.activeMission.completionReason ??
          (this.activeMission.turnsElapsed > 1 ? 'PARTIAL_PROGRESS' : 'INTERRUPTED_BY_EMERGENCY');
        this.activeMission.onAborted?.(snapshot, '戦力準備・決戦移行のため作戦切替');
        this.recordMissionHistory(this.activeMission, 'ABORTED', reason, snapshot.totalTurns);
        this.activeMission = nextMission;
      }
    }

    // 2. 現行ミッションのコミットメント評価
    if (this.activeMission) {
      if (this.activeMission.id === 'SEAL_GRAVE') {
        this.totalGraveSealTurns++;
        if (this.totalGraveSealTurns >= 60) {
          this.graveSealDone = true;
          this.activeMission.status = 'ABORTED';
          this.activeMission.completionReason = 'NO_PROGRESS_TIMEOUT';
        }
      }

      // フィードバック等で既に中断/完了されている場合は evaluateStatus をバイパス
      const status = this.activeMission.status !== 'ACTIVE'
        ? this.activeMission.status
        : this.activeMission.evaluateStatus(snapshot, engine);

      if (status === 'ACTIVE') {
        this.activeMission.turnsElapsed++;
        const rawDirective = this.activeMission.generateDirective(snapshot, engine);
        return this.arbitrateDirectives(rawDirective, snapshot, engine);
      } else {
        if (this.activeMission.id === 'RELOCATE_HOME') {
          this.relocateDone = true;
        }

        // ミッション終了（完了 / 失敗 / 中断）
        if (status === 'COMPLETED') {
          this.activeMission.onCompleted?.(snapshot);
        } else {
          this.activeMission.onAborted?.(snapshot, `Status: ${status}`);
        }
        const reason: MissionCompletionReason =
          this.activeMission.completionReason ??
          (status === 'COMPLETED' ? 'OBJECTIVE_ACHIEVED' : 'NO_PROGRESS_TIMEOUT');
        this.recordMissionHistory(this.activeMission, status, reason, snapshot.totalTurns);
        this.activeMission = null;
      }
    }

    // 3. 次期最適ミッションの調停・選定 (Mission Arbiter)
    this.activeMission = this.selectNextMission(snapshot, engine);
    this.activeMission.turnsElapsed = 1;
    const rawDirective = this.activeMission.generateDirective(snapshot, engine);
    return this.arbitrateDirectives(rawDirective, snapshot, engine);
  }

  /**
   * 終了ミッションの履歴・完了理由記録および無進展ミッションへのクールダウン設定
   */
  private recordMissionHistory(
    mission: IStrategicMission,
    status: MissionStatus,
    reason: MissionCompletionReason | undefined,
    totalTurns: number
  ): void {
    this.missionHistory.push({
      missionId: mission.id,
      status,
      reason,
      turns: mission.turnsElapsed,
    });

    if (reason === 'NO_PROGRESS_TIMEOUT' || reason === 'NO_PROGRESS_BLOCKED') {
      if (mission.id === 'PREPARE_DRAGON_ASSAULT') {
        this.defensePrepTurns = Math.max(this.defensePrepTurns, 40);
        this.missionCooldowns.set('PREPARE_DRAGON_ASSAULT', totalTurns + 30);
      } else if (mission.id === 'RELOCATE_HOME') {
        this.relocateDone = true;
      } else if (mission.id === 'CLEAR_TREASURE_ZONE') {
        this.missionCooldowns.set('CLEAR_TREASURE_ZONE', totalTurns + 20);
      } else if (mission.id === 'SLAY_DRAGON') {
        this.missionCooldowns.set('SLAY_DRAGON', totalTurns + 15);
      } else if (mission.id === 'EARLY_BREAK_UNLOCK') {
        this.missionCooldowns.set('EARLY_BREAK_UNLOCK', totalTurns + 50);
      } else if (mission.id === 'HARVEST_POWER_STONE') {
        this.missionCooldowns.set('HARVEST_POWER_STONE', totalTurns + 20);
      } else if (mission.id === 'SEAL_GRAVE') {
        this.missionCooldowns.set('SEAL_GRAVE', totalTurns + 80);
      }
    } else if (reason === 'PARTIAL_PROGRESS' && mission.id === 'EARLY_BREAK_UNLOCK') {
      this.missionCooldowns.set('EARLY_BREAK_UNLOCK', totalTurns + 30);
    }
  }

  /**
   * 次期ミッション選定（MissionSelectorへ委譲）
   */
  public selectNextMission(snapshot: TacticalSnapshot, engine: GameEngine): IStrategicMission {
    const activeCooldowns = new Set<string>();
    for (const [key, untilTurn] of this.missionCooldowns.entries()) {
      if (untilTurn > snapshot.totalTurns) {
        activeCooldowns.add(key);
      } else {
        this.missionCooldowns.delete(key);
      }
    }
    return MissionSelector.selectNextMission(
      snapshot,
      engine,
      this.graveSealDone,
      this.relocateDone,
      this.defensePrepTurns,
      activeCooldowns
    );
  }

  /**
   * 指令調停（DirectiveArbiterへ委譲）
   */
  public arbitrateDirectives(
    rawDirective: StrategicDirective,
    snapshot: TacticalSnapshot,
    engine: GameEngine
  ): StrategicDirective {
    return DirectiveArbiter.arbitrate(rawDirective, snapshot, engine, this.activeMission);
  }
}
