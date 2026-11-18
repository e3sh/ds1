import { GameEngine } from '../../core/GameEngine.js';
import { Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { TacticalSnapshot } from '../perception/TacticalSnapshot.js';
import { StrategicDirective } from './StrategicDirective.js';
import type { EscalationLevel } from './command/CommanderTypes.js';

export type MissionStatus = 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'ABORTED';

/**
 * ミッション終了時の詳細理由（実質的な目的達成・部分前進・停滞・喪失・緊急中断・上位指揮官介入を区別）
 */
export type MissionCompletionReason =
  | 'OBJECTIVE_ACHIEVED'
  | 'PARTIAL_PROGRESS'
  | 'NO_PROGRESS_TIMEOUT'
  | 'NO_PROGRESS_BLOCKED'
  | 'TARGET_LOST'
  | 'INTERRUPTED_BY_EMERGENCY'
  | 'COMMANDER_OVERRIDE';

export interface MissionAuditProfile {
  /** 実質的な戦果がないまま許容するターン数 */
  graceTurns: number;
  /** Commander が禁止（Taboo）にできるか（CROWN_ESCAPE 等は false） */
  tabooable: boolean;
  /** 使ってよい打開段階の上限 */
  maxEscalation: EscalationLevel;
}

/** 小分類（確定単一ターゲットロック）の対象種別 */
export type LockedTargetKind =
  | 'CROWN'
  | 'BLOCK'
  | 'POTION'
  | 'COIN'
  | 'KEY'
  | 'CHEST'
  | 'SWORD'
  | 'POWER_STONE'
  | 'RING'
  | 'DEATH'
  | 'HOME'
  | 'DRAGON_HEAD'
  | 'DRAGON_SPOT'
  | 'ENEMY'
  | 'GRAVE_PUSH'
  | 'FRONTIER';

/** 小分類: 確定した単一ターゲットとその進捗・遮断カウンタ */
export interface MissionTargetLock {
  kind: LockedTargetKind;
  pos: Position;
  entityId?: string;
  secondaryPos?: Position;
  lockedAtTurn: number;
  bestDist: number;
  stalledTurns: number;
  blockedCount: number;
}

/**
 * 中長期的な作戦の基底インターフェース。
 * StrategicPlanner により選定され、完了・失敗・緊急割り込みまでコミット（維持）される。
 */
export interface IStrategicMission {
  /** ミッションの一意識別子 */
  readonly id: string;
  /** 人間可読な作戦名 */
  readonly name: string;
  /** 最大許容ターン数（タイムアウト防止） */
  readonly maxTurns: number;
  /** 開始からの経過ターン数 */
  turnsElapsed: number;
  /** ミッション開始時の総ターン数（台帳からの進捗判定用） */
  startTurn?: number;
  /** 現在のステータス */
  status: MissionStatus;
  /** ミッション終了時の詳細理由（目的達成度・中断理由） */
  completionReason?: MissionCompletionReason;
  /** ミッション内部サブモード（中分類状態遷移追跡・検証用） */
  subMode?: string;
  /** 監査プロファイル（未指定時はデフォルト値が適用される） */
  readonly auditProfile?: MissionAuditProfile;
  /** 現在の主ターゲット座標（L1 RETARGET 時の禁止対象） */
  readonly currentTarget?: Position | null;
  /** 現在の対象ゾーンID（L1 RETARGET 時の禁止対象） */
  readonly zoneId?: string;

  /**
   * ミッションの継続可否および完了判定。毎ターン呼び出される。
   */
  evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus;

  /**
   * 戦術ユニットへ下す今ターンの指令を生成する。
   */
  generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective;

  /** ミッション完了時の後処理フック */
  onCompleted?(snapshot: TacticalSnapshot): void;

  /** ミッション中断時の後処理フック */
  onAborted?(snapshot: TacticalSnapshot, reason: string): void;

  /** 戦術層からの行動結果フィードバック（行動失敗・経路遮断等）の受信フック */
  onTacticalFeedback?(
    result: { action: any; description: string; status: 'SUCCESS' | 'PATH_BLOCKED' | 'STALLED' },
    directive: StrategicDirective,
    snapshot: TacticalSnapshot
  ): void;
}

/**
 * 大・中・小分類ステートマシン用共通基底クラス。
 * 中分類（subMode）と小分類（lockedTarget: 単一ターゲットロック・進捗確認・連続遮断検知）を統一管理する。
 */
export abstract class BaseStrategicMission implements IStrategicMission {
  public abstract readonly id: string;
  public abstract readonly name: string;
  public abstract readonly maxTurns: number;
  public turnsElapsed: number = 0;
  public startTurn?: number;
  public status: MissionStatus = 'ACTIVE';
  public completionReason?: MissionCompletionReason;
  public subMode?: string;
  public readonly auditProfile?: MissionAuditProfile;
  public readonly zoneId?: string;

  protected lockedTarget: MissionTargetLock | null = null;

  public get currentTarget(): Position | null {
    if (!this.lockedTarget) return null;
    if (this.lockedTarget.kind === 'HOME' || this.id === 'CROWN_ESCAPE') return null;
    return this.lockedTarget.pos;
  }

  /**
   * 単一ターゲットをロックする。同一ターゲットが既にロック中であれば進捗・遮断カウンタを維持する。
   */
  protected lockTarget(
    kind: LockedTargetKind,
    pos: Position,
    turn: number,
    curPos: Position,
    map: WorldMap,
    opts?: { entityId?: string; secondaryPos?: Position }
  ): MissionTargetLock {
    const entityId = opts?.entityId;
    const secondaryPos = opts?.secondaryPos ? { ...opts.secondaryPos } : undefined;

    if (
      this.lockedTarget &&
      this.lockedTarget.kind === kind &&
      this.lockedTarget.pos.x === pos.x &&
      this.lockedTarget.pos.y === pos.y &&
      this.lockedTarget.entityId === entityId
    ) {
      if (secondaryPos) {
        this.lockedTarget.secondaryPos = secondaryPos;
      }
      return this.lockedTarget;
    }

    const dist = map.getTorusDistance(curPos, pos).manhattan;
    this.lockedTarget = {
      kind,
      pos: { ...pos },
      entityId,
      secondaryPos,
      lockedAtTurn: turn,
      bestDist: dist,
      stalledTurns: 0,
      blockedCount: 0,
    };
    return this.lockedTarget;
  }

  /**
   * 動的エンティティ（追跡中の敵・移動後座標等）の現在座標を更新しつつロック進捗を管理する。
   */
  protected updateLockedEntityPos(newPos: Position, curPos: Position, map: WorldMap): void {
    if (!this.lockedTarget) return;
    this.lockedTarget.pos = { ...newPos };
    const dist = map.getTorusDistance(curPos, newPos).manhattan;
    if (dist < this.lockedTarget.bestDist) {
      this.lockedTarget.bestDist = dist;
      this.lockedTarget.stalledTurns = 0;
    } else {
      this.lockedTarget.stalledTurns++;
    }
  }

  protected clearTargetLock(): void {
    this.lockedTarget = null;
  }

  /**
   * 毎ターン先頭で現在ロック中ターゲットへの接近進捗を更新する。
   */
  protected updateLockProgress(curPos: Position, map: WorldMap): void {
    if (!this.lockedTarget) return;
    const dist = map.getTorusDistance(curPos, this.lockedTarget.pos).manhattan;
    if (dist < this.lockedTarget.bestDist) {
      this.lockedTarget.bestDist = dist;
      this.lockedTarget.stalledTurns = 0;
    } else {
      this.lockedTarget.stalledTurns++;
    }
  }

  /**
   * ロック中ターゲットが遮断・停滞・ブラックリスト登録により無効化されたか判定する。
   */
  protected isLockInvalidated(snapshot: TacticalSnapshot, maxStallTurns: number = 15): boolean {
    if (!this.lockedTarget) return true;
    if (this.lockedTarget.blockedCount >= 2) return true;
    if (this.lockedTarget.stalledTurns > maxStallTurns) return true;
    if (snapshot.memory.isTargetUnreachable(this.lockedTarget.pos, snapshot.totalTurns)) return true;
    return false;
  }

  public onTacticalFeedback(
    result: { action: any; description: string; status: 'SUCCESS' | 'PATH_BLOCKED' | 'STALLED' },
    directive: StrategicDirective,
    _snapshot: TacticalSnapshot
  ): void {
    if (!this.lockedTarget) return;
    const matchesPrimary =
      directive.targetPos !== undefined &&
      directive.targetPos.x === this.lockedTarget.pos.x &&
      directive.targetPos.y === this.lockedTarget.pos.y;
    const matchesSecondary =
      (directive.pushBlockPos !== undefined &&
        directive.pushBlockPos.x === this.lockedTarget.pos.x &&
        directive.pushBlockPos.y === this.lockedTarget.pos.y) ||
      (this.lockedTarget.secondaryPos !== undefined &&
        directive.targetPos !== undefined &&
        directive.targetPos.x === this.lockedTarget.secondaryPos.x &&
        directive.targetPos.y === this.lockedTarget.secondaryPos.y);

    if (!matchesPrimary && !matchesSecondary) return;

    if (result.status === 'PATH_BLOCKED') {
      this.lockedTarget.blockedCount++;
    } else if (result.status === 'SUCCESS') {
      this.lockedTarget.blockedCount = 0;
    }
  }

  public abstract evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus;
  public abstract generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective;
}
