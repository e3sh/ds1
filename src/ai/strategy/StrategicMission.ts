import { GameEngine } from '../../core/GameEngine.js';
import { TacticalSnapshot } from '../perception/TacticalSnapshot.js';
import { StrategicDirective } from './StrategicDirective.js';

export type MissionStatus = 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'ABORTED';

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
  /** 現在のステータス */
  status: MissionStatus;

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
