import { GameEngine } from '../../../core/GameEngine.js';
import { Position } from '../../../models/Types.js';
import { MagicSystem } from '../../../systems/MagicSystem.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { StrategicDirective } from '../StrategicDirective.js';
import {
  IStrategicMission,
  MissionAuditProfile,
  MissionCompletionReason,
  MissionStatus,
} from '../StrategicMission.js';

/**
 * StrategicBreakMission (上位指揮官命令: 局面の強制打開作戦)
 *
 * L4 (BREACH: 指定岩のBREAK開通) または L5 (RELOCATE: RETURN / JUMP 転移) を実行する。
 * 戦術層へ直接命令せず、通常の StrategicDirective として DirectiveArbiter を通過させる。
 */
export class StrategicBreakMission implements IStrategicMission {
  public readonly id = 'STRATEGIC_BREAK';
  public readonly name: string;
  public readonly maxTurns = 12;
  public turnsElapsed = 0;
  public startTurn?: number;
  public status: MissionStatus = 'ACTIVE';
  public completionReason?: MissionCompletionReason;
  public subMode: 'BREACH' | 'RETURN' | 'JUMP';

  public readonly auditProfile: MissionAuditProfile = {
    graceTurns: 16,
    tabooable: false,
    maxEscalation: 'TERMINAL',
  };

  private initialPos: Position | null = null;

  constructor(
    public readonly mode: 'BREACH' | 'RETURN' | 'JUMP',
    public readonly target: Position | null = null
  ) {
    this.subMode = mode;
    this.name =
      mode === 'BREACH'
        ? '⛏️ 閉塞岩強制開通作戦'
        : `🌀 ${mode} 転移局面打開作戦`;
  }

  public get currentTarget(): Position | null {
    return this.target;
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    const player = engine.getPlayer();
    if (!this.initialPos) {
      this.initialPos = { ...player.pos };
    }

    if (this.mode === 'BREACH') {
      if (!this.target || snapshot.map.getObject(this.target) !== 'BLOCK') {
        this.completionReason = 'OBJECTIVE_ACHIEVED';
        return 'COMPLETED';
      }
      if (!snapshot.milestones.canBreak) {
        this.completionReason = 'NO_PROGRESS_BLOCKED';
        return 'ABORTED';
      }
    } else {
      const movedByMagic =
        this.turnsElapsed >= 1 &&
        (player.pos.x !== this.initialPos.x || player.pos.y !== this.initialPos.y);
      if (movedByMagic) {
        this.completionReason = 'OBJECTIVE_ACHIEVED';
        return 'COMPLETED';
      }
      const check = MagicSystem.canCast(player, this.mode);
      if (!check.allowed || (this.mode === 'RETURN' && player.isFlying)) {
        this.completionReason = 'NO_PROGRESS_BLOCKED';
        return 'ABORTED';
      }
    }

    if (this.turnsElapsed >= this.maxTurns) {
      this.completionReason = 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  public generateDirective(_snapshot: TacticalSnapshot, _engine: GameEngine): StrategicDirective {
    if (this.mode === 'BREACH' && this.target) {
      return {
        type: 'BREACH_SHORTCUT',
        targetPos: this.target,
        priority: 85,
        reason: `⛏️ 上位指揮官命令: (${this.target.x}, ${this.target.y}) の岩をBREAK開通`,
      };
    }

    return {
      type: 'CAST_MAGIC',
      magicToCast: this.mode === 'RETURN' ? 'RETURN' : 'JUMP',
      priority: 90,
      reason: `🌀 上位指揮官命令: ${this.mode} 詠唱で別エリアへ転移`,
    };
  }
}
