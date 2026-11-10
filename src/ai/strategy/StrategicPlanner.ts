import { GameEngine } from '../../core/GameEngine.js';
import { TacticalSnapshot } from '../perception/TacticalSnapshot.js';
import { IStrategicMission, MissionStatus } from './StrategicMission.js';
import { StrategicDirective } from './StrategicDirective.js';
import { EmergencyEvacuateMission } from './missions/EmergencyEvacuateMission.js';
import { CrownEscapeMission } from './missions/CrownEscapeMission.js';
import { SlayDragonMission } from './missions/SlayDragonMission.js';
import { PrepareDragonAssaultMission } from './missions/PrepareDragonAssaultMission.js';
import { CashInGoldMission } from './missions/CashInGoldMission.js';
import { EarlyBreakUnlockMission } from './missions/EarlyBreakUnlockMission.js';
import { RelocateHomeMission } from './missions/RelocateHomeMission.js';
import { ReadinessEvaluator } from './evaluators/ReadinessEvaluator.js';
import { AdaptiveNavigator } from '../AdaptiveNavigator.js';
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
  public missionHistory: { missionId: string; status: MissionStatus; turns: number }[] = [];
  public totalGraveSealTurns: number = 0;
  public graveSealDone: boolean = false;
  public relocateDone: boolean = false;
  public defensePrepTurns: number = 0;

  // 要件2: 戦術フィードバック状態管理
  public lastTacticalStatus: TacticalExecutionStatus | null = null;
  private lastBlockedTarget: Position | null = null;
  private consecutiveBlockedTurns: number = 0;

  constructor(private nav?: AdaptiveNavigator) {}

  public setNavigator(nav: AdaptiveNavigator): void {
    this.nav = nav;
  }

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
        // エピソード記憶 & ナビゲータにブラックリスト登録
        snapshot.memory.markTargetUnreachable(target, 30, snapshot.totalTurns);
        if (this.nav) {
          this.nav.markTargetUnreachable(target, 30);
        }

        // 現行ミッションを即座に ABORTED として別作戦・別ターゲットへ強制転進
        if (this.activeMission) {
          this.activeMission.status = 'ABORTED';
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
    // 1. 緊急危機介入 (HPピンチまたは即死敵隣接)
    if (snapshot.threats.isLethalDanger || snapshot.threats.isPinchHp) {
      if (!this.activeMission || this.activeMission.id !== 'EMERGENCY_EVACUATE') {
        if (this.activeMission) {
          this.activeMission.onAborted?.(snapshot, '緊急退避による割り込み中断');
        }
        this.activeMission = new EmergencyEvacuateMission();
      }
    }

    // 1-B. ドラゴン討伐完了 -> 即座に王冠脱出ミッションへ切り替え
    const dragon = engine.getDragon();
    if (dragon && (dragon.isAllHeadsDefeated || dragon.heads.every(h => !h.isAlive))) {
      if (!this.activeMission || this.activeMission.id !== 'CROWN_ESCAPE') {
        if (this.activeMission) {
          this.activeMission.onCompleted?.(snapshot);
        }
        this.activeMission = new CrownEscapeMission();
      }
    }

    // 1-C. 決戦・準備移行割り込み: 育成・探索系ミッション中に適正戦力に到達したら準備または決戦へ移行
    const player = engine.getPlayer();
    const canTransitionToPrep = MissionSelector.isReadyForDragon(snapshot, engine) || snapshot.milestones.isStrCapped || snapshot.milestones.hasTargetStr;

    if (canTransitionToPrep) {
      this.defensePrepTurns++;
    }

    if (
      canTransitionToPrep &&
      this.activeMission &&
      this.activeMission.id !== 'SLAY_DRAGON' &&
      this.activeMission.id !== 'PREPARE_DRAGON_ASSAULT' &&
      this.activeMission.id !== 'RELOCATE_HOME' &&
      this.activeMission.id !== 'CROWN_ESCAPE' &&
      this.activeMission.id !== 'EMERGENCY_EVACUATE' &&
      player.holdItem !== 'POWER_STONE'
    ) {
      this.activeMission.onCompleted?.(snapshot);
      this.missionHistory.push({
        missionId: this.activeMission.id,
        status: 'COMPLETED',
        turns: this.activeMission.turnsElapsed,
      });

      // 要件1: 5条件（攻撃力・斜め移動・BREAK・MP>=3・HP十分）を満たし、準備が完了またはタイムアウトしたら SlayDragonMission を起動
      const assessment = ReadinessEvaluator.evaluateDragonReadiness(snapshot, engine, this.defensePrepTurns);
      const readyForDragon = MissionSelector.isReadyForDragon(snapshot, engine);

      if (readyForDragon && assessment.isFullyPrepared) {
        this.activeMission = new SlayDragonMission();
      } else {
        // 事前準備優先起動
        if (player.experience < 12000 || !snapshot.milestones.canDiagonal || !snapshot.milestones.canBreak) {
          if (player.gold > 0) {
            this.activeMission = new CashInGoldMission(player.gold);
          } else if (MissionSelector.hasSafeEnemyNearby(player, snapshot)) {
            this.activeMission = new EarlyBreakUnlockMission(12000);
          } else {
            this.activeMission = this.selectNextMission(snapshot, engine);
          }
        } else if (player.magic < 3 || assessment.needsPotionSweep) {
          this.activeMission = new PrepareDragonAssaultMission();
        } else if (assessment.needsGoldCashIn || player.gold > 0) {
          this.activeMission = new CashInGoldMission(player.gold);
        } else if (assessment.needsRelocation && !this.relocateDone) {
          const anchor = snapshot.spatial.recommendedRelocateAnchors[0] ?? { x: 32, y: 25 };
          this.activeMission = new RelocateHomeMission(anchor);
        } else if (player.hp < player.maxHp * 0.5 && player.hp < 15000) {
          this.activeMission = new PrepareDragonAssaultMission();
        } else if (readyForDragon) {
          this.activeMission = new SlayDragonMission();
        } else {
          this.activeMission = this.selectNextMission(snapshot, engine);
        }
      }
    }

    // 2. 現行ミッションのコミットメント評価
    if (this.activeMission) {
      if (this.activeMission.id === 'SEAL_GRAVE') {
        this.totalGraveSealTurns++;
        if (this.totalGraveSealTurns >= 60) {
          this.graveSealDone = true;
          this.activeMission.status = 'ABORTED';
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
        this.missionHistory.push({
          missionId: this.activeMission.id,
          status,
          turns: this.activeMission.turnsElapsed,
        });
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
   * 次期ミッション選定（MissionSelectorへ委譲）
   */
  public selectNextMission(snapshot: TacticalSnapshot, engine: GameEngine): IStrategicMission {
    return MissionSelector.selectNextMission(snapshot, engine, this.graveSealDone, this.relocateDone, this.defensePrepTurns);
  }

  /**
   * 指令調停（DirectiveArbiterへ委譲）
   */
  public arbitrateDirectives(
    rawDirective: StrategicDirective,
    snapshot: TacticalSnapshot,
    engine: GameEngine
  ): StrategicDirective {
    return DirectiveArbiter.arbitrate(rawDirective, snapshot, engine, this.activeMission, this.nav);
  }
}
