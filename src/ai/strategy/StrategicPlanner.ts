import { GameEngine } from '../../core/GameEngine.js';
import { TacticalSnapshot } from '../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../perception/MapSituationEvaluator.js';
import { IStrategicMission, MissionCompletionReason, MissionStatus } from './StrategicMission.js';
import { StrategicDirective } from './StrategicDirective.js';
import { EmergencyEvacuateMission } from './missions/EmergencyEvacuateMission.js';
import { CrownEscapeMission } from './missions/CrownEscapeMission.js';
import { DragonReadinessAssessment, ReadinessEvaluator } from './evaluators/ReadinessEvaluator.js';
import { DirectiveArbiter } from './arbitration/DirectiveArbiter.js';
import { MissionSelector } from './evaluators/MissionSelector.js';
import { TacticalExecutionResult, TacticalExecutionStatus } from '../tactics/TacticalExecutor.js';
import { Position } from '../../models/Types.js';
import {
  DEFAULT_HUNTING_PARAMS,
  DEFAULT_MISSION_POLICY_PARAMS,
  DEFAULT_READINESS_PARAMS,
} from '../TacticalContext.js';
import type {
  CommanderOrders,
  MissionHistoryEntry,
  MissionReport,
  PhaseWaiver,
} from './command/CommanderTypes.js';

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
  public missionHistory: MissionHistoryEntry[] = [];
  public totalGraveSealTurns: number = 0;
  public graveSealDone: boolean = false;
  public relocateDone: boolean = false;
  public defensePrepTurns: number = 0;
  private missionCooldowns: Map<string, number> = new Map();
  private activeWaivers: ReadonlySet<PhaseWaiver> = new Set();

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

      // 同一ターゲットへの移動が連続で PATH_BLOCKED となった場合
      const mp = snapshot.params.missionPolicy ?? DEFAULT_MISSION_POLICY_PARAMS;
      const h = snapshot.params.hunting ?? DEFAULT_HUNTING_PARAMS;
      if (this.consecutiveBlockedTurns >= mp.consecutiveBlockedAbortTurns) {
        // エピソード記憶（認知層）にブラックリスト登録
        snapshot.memory.markTargetUnreachable(target, h.huntUnreachableMarkTurns, snapshot.totalTurns);

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
   * 上位指揮官（StrategicCommander）向けの現状レポートを生成する
   */
  public getMissionReport(): MissionReport {
    return {
      activeMissionId: this.activeMission?.id ?? null,
      activeAuditProfile: this.activeMission?.auditProfile ?? null,
      activeTarget: this.activeMission?.currentTarget ?? null,
      activeZoneId: this.activeMission?.zoneId ?? null,
      recentHistory: this.missionHistory.slice(-24),
    };
  }

  /**
   * 上位指揮官からの命令書（CommanderOrders）をプランナー状態へ反映する
   */
  public applyOrders(orders: CommanderOrders, snapshot: TacticalSnapshot): void {
    this.activeWaivers = orders.waivers;

    for (const [id, untilTurn] of orders.tabooMissions.entries()) {
      const existing = this.missionCooldowns.get(id) ?? 0;
      if (untilTurn > existing) {
        this.missionCooldowns.set(id, untilTurn);
      }
    }

    for (const t of orders.tabooTargets) {
      const duration = Math.max(1, t.untilTurn - snapshot.totalTurns);
      snapshot.memory.markTargetUnreachable(t.pos, duration, snapshot.totalTurns);
    }

    for (const z of orders.tabooZones) {
      const duration = Math.max(1, z.untilTurn - snapshot.totalTurns);
      snapshot.memory.markZoneUnreachable(z.zoneId, duration, snapshot.totalTurns);
    }

    const isProtectedMission =
      this.activeMission?.id === 'CROWN_ESCAPE' ||
      this.activeMission?.id === 'EMERGENCY_EVACUATE';

    if (!isProtectedMission && orders.forcedMission) {
      const expectedId =
        orders.forcedMission.kind === 'EXPLORE_FRONTIER' ? 'EXPLORE_FRONTIER' : 'STRATEGIC_BREAK';
      if (!this.activeMission || this.activeMission.id !== expectedId) {
        if (this.activeMission) {
          this.activeMission.status = 'ABORTED';
          this.activeMission.completionReason = 'COMMANDER_OVERRIDE';
          this.activeMission.onAborted?.(snapshot, `上位指揮官命令による強制切替 -> ${expectedId}`);
          this.recordMissionHistory(this.activeMission, 'ABORTED', 'COMMANDER_OVERRIDE', snapshot);
        }
        this.activeMission = MissionSelector.createForcedMission(orders.forcedMission);
        this.activeMission.startTurn = snapshot.totalTurns;
      }
    } else if (
      !isProtectedMission &&
      this.activeMission &&
      orders.tabooMissions.has(this.activeMission.id)
    ) {
      this.activeMission.status = 'ABORTED';
      this.activeMission.completionReason = 'COMMANDER_OVERRIDE';
      this.activeMission.onAborted?.(snapshot, '上位指揮官によるミッション禁止');
      this.recordMissionHistory(this.activeMission, 'ABORTED', 'COMMANDER_OVERRIDE', snapshot);
      this.activeMission = null;
    }
  }

  /**
   * 毎ターンの戦略判断ルーチン
   */
  public planTurn(
    snapshot: TacticalSnapshot,
    engine: GameEngine,
    orders?: CommanderOrders
  ): StrategicDirective {
    if (orders?.giveUp) {
      return {
        type: 'GIVE_UP',
        priority: 100,
        reason: orders.giveUp.reason,
      };
    }
    if (orders) {
      this.applyOrders(orders, snapshot);
    }

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
            this.recordMissionHistory(this.activeMission, 'COMPLETED', 'OBJECTIVE_ACHIEVED', snapshot);
          } else {
            const reason = this.activeMission.completionReason ?? 'INTERRUPTED_BY_EMERGENCY';
            this.activeMission.status = 'ABORTED';
            this.activeMission.completionReason = reason;
            this.activeMission.onAborted?.(snapshot, '全ドラゴン頭撃破による王冠脱出へ強制移行');
            this.recordMissionHistory(this.activeMission, 'ABORTED', reason, snapshot);
          }
        }
        this.activeMission = new CrownEscapeMission();
        this.activeMission.startTurn = snapshot.totalTurns;
      }
    } else if (snapshot.threats.isLethalDanger || snapshot.threats.isPinchHp) {
      // 1-B. 緊急危機介入 (HPピンチまたは即死敵隣接 ※王冠脱出局面以外)
      if (!this.activeMission || this.activeMission.id !== 'EMERGENCY_EVACUATE') {
        if (this.activeMission) {
          this.activeMission.status = 'ABORTED';
          this.activeMission.completionReason = 'INTERRUPTED_BY_EMERGENCY';
          this.activeMission.onAborted?.(snapshot, '緊急退避による割り込み中断');
          this.recordMissionHistory(this.activeMission, 'ABORTED', 'INTERRUPTED_BY_EMERGENCY', snapshot);
        }
        this.activeMission = new EmergencyEvacuateMission();
        this.activeMission.startTurn = snapshot.totalTurns;
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
    const readyForDragon = MissionSelector.isReadyForDragon(snapshot, engine, this.defensePrepTurns, this.activeWaivers);
    const canTransitionToPrep =
      readyForDragon ||
      canDamageDragon ||
      (player.hasSword && allChestsAndStonesExhausted);

    const crownReserveMagic = Math.min(
      snapshot.params.maxTargetMagic,
      (snapshot.params.readiness ?? DEFAULT_READINESS_PARAMS).crownReserveMagic
    );
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
      this.activeMission.id !== 'EXPLORE_FRONTIER' &&
      this.activeMission.id !== 'STRATEGIC_BREAK' &&
      !(this.activeMission.id === 'CLEAR_TREASURE_ZONE' && player.magic < crownReserveMagic && !readyForDragon) &&
      player.holdItem !== 'POWER_STONE' &&
      !(player.holdItem === 'KEY' && MissionSelector.hasNearbyChest(player.pos, snapshot.map, 8, snapshot))
    ) {
      const activeCooldowns = this.getActiveCooldowns(snapshot.totalTurns);
      const assessment = ReadinessEvaluator.evaluateDragonReadiness(snapshot, engine, this.defensePrepTurns, this.activeWaivers);
      const nextMission =
        MissionSelector.selectDragonPrepMission(snapshot, engine, {
          relocateDone: this.relocateDone,
          prepTurns: this.defensePrepTurns,
          cooldownMissions: activeCooldowns,
          prioritizeImmediateSlay: true,
          includeHeldKeyInChestCheck: false,
          precomputedReady: readyForDragon,
          precomputedAssessment: assessment,
          waivers: this.activeWaivers,
        }) ?? this.selectNextMission(snapshot, engine, { readyForDragon, assessment });

      // 同じミッションを再生成してチャタリングを起こす場合やクールダウン中は中断しない
      if (nextMission.id !== this.activeMission.id && !activeCooldowns.has(nextMission.id)) {
        const reason: MissionCompletionReason =
          this.activeMission.completionReason ??
          (this.activeMission.turnsElapsed > 1 ? 'PARTIAL_PROGRESS' : 'INTERRUPTED_BY_EMERGENCY');
        this.activeMission.onAborted?.(snapshot, '戦力準備・決戦移行のため作戦切替');
        this.recordMissionHistory(this.activeMission, 'ABORTED', reason, snapshot);
        this.activeMission = nextMission;
        this.activeMission.startTurn = snapshot.totalTurns;
      }
    }

    // 2. 現行ミッションのコミットメント評価
    if (this.activeMission) {
      if (this.activeMission.startTurn === undefined) {
        this.activeMission.startTurn = snapshot.totalTurns;
      }
      if (this.activeMission.id === 'SEAL_GRAVE') {
        const mp = snapshot.params.missionPolicy ?? DEFAULT_MISSION_POLICY_PARAMS;
        this.totalGraveSealTurns++;
        if (this.totalGraveSealTurns >= mp.graveSealMaxTotalTurns) {
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
        this.recordMissionHistory(this.activeMission, status, reason, snapshot);
        this.activeMission = null;
      }
    }

    // 3. 次期最適ミッションの調停・選定 (Mission Arbiter)
    this.activeMission = this.selectNextMission(snapshot, engine);
    this.activeMission.turnsElapsed = 1;
    this.activeMission.startTurn = snapshot.totalTurns;
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
    snapshot: TacticalSnapshot
  ): void {
    const totalTurns = snapshot.totalTurns;
    const startTurn = mission.startTurn ?? Math.max(0, totalTurns - mission.turnsElapsed);
    const substantiveGains = snapshot.progress
      ? snapshot.progress.substantiveGainsSince(startTurn).length
      : 0;

    this.missionHistory.push({
      missionId: mission.id,
      status,
      reason,
      turns: mission.turnsElapsed,
      startTurn,
      endTurn: totalTurns,
      substantiveGains,
    });

    const mp = snapshot.params.missionPolicy ?? DEFAULT_MISSION_POLICY_PARAMS;
    if (reason === 'NO_PROGRESS_TIMEOUT' || reason === 'NO_PROGRESS_BLOCKED') {
      if (mission.id === 'PREPARE_DRAGON_ASSAULT') {
        this.defensePrepTurns = Math.max(this.defensePrepTurns, 40);
        this.missionCooldowns.set('PREPARE_DRAGON_ASSAULT', totalTurns + mp.cooldownPrepareDragonAssault);
      } else if (mission.id === 'RELOCATE_HOME') {
        this.relocateDone = true;
      } else if (mission.id === 'CLEAR_TREASURE_ZONE') {
        this.missionCooldowns.set('CLEAR_TREASURE_ZONE', totalTurns + mp.cooldownClearTreasureZone);
      } else if (mission.id === 'SLAY_DRAGON') {
        this.missionCooldowns.set('SLAY_DRAGON', totalTurns + mp.cooldownSlayDragon);
      } else if (mission.id === 'EARLY_BREAK_UNLOCK') {
        this.missionCooldowns.set('EARLY_BREAK_UNLOCK', totalTurns + mp.cooldownEarlyBreakNoProgress);
      } else if (mission.id === 'HARVEST_POWER_STONE') {
        this.missionCooldowns.set('HARVEST_POWER_STONE', totalTurns + mp.cooldownHarvestPowerStone);
      } else if (mission.id === 'SEAL_GRAVE') {
        this.missionCooldowns.set('SEAL_GRAVE', totalTurns + mp.cooldownSealGrave);
      }
    } else if (reason === 'PARTIAL_PROGRESS' && mission.id === 'EARLY_BREAK_UNLOCK') {
      this.missionCooldowns.set('EARLY_BREAK_UNLOCK', totalTurns + mp.cooldownEarlyBreakPartial);
    }
  }

  private getActiveCooldowns(totalTurns: number): Set<string> {
    const activeCooldowns = new Set<string>();
    for (const [key, untilTurn] of this.missionCooldowns.entries()) {
      if (untilTurn > totalTurns) {
        activeCooldowns.add(key);
      } else {
        this.missionCooldowns.delete(key);
      }
    }
    return activeCooldowns;
  }

  /**
   * 次期ミッション選定（MissionSelectorへ委譲）
   */
  public selectNextMission(
    snapshot: TacticalSnapshot,
    engine: GameEngine,
    precomputed?: { readyForDragon?: boolean; assessment?: DragonReadinessAssessment }
  ): IStrategicMission {
    const activeCooldowns = this.getActiveCooldowns(snapshot.totalTurns);
    return MissionSelector.selectNextMission(
      snapshot,
      engine,
      this.graveSealDone,
      this.relocateDone,
      this.defensePrepTurns,
      activeCooldowns,
      { ...precomputed, waivers: this.activeWaivers }
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
