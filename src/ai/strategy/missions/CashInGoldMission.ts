import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { BaseStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';

/**
 * CashInGoldMission (コイン換金帰還作戦)
 *
 * 大・中・小分類ステートマシン：
 * - 中分類 (subMode): RETURNING_HOME | COMPLETED_CASHIN
 * - 小分類 (lockedTarget): HOME
 */
export class CashInGoldMission extends BaseStrategicMission {
  public readonly id = 'CASH_IN_GOLD';
  public readonly name: string;
  public readonly maxTurns = 100;
  public override subMode: 'RETURNING_HOME' | 'COMPLETED_CASHIN' = 'RETURNING_HOME';

  constructor(private readonly initialGoldAmount: number) {
    super();
    this.name = `🪙 コイン一括換金帰還 [所持: ${initialGoldAmount}G]`;
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    const player = engine.getPlayer();
    const start = this.startTurn ?? snapshot.totalTurns;
    const gains = snapshot.progress.substantiveGainsSince(start);
    const gainedExp = gains.some(g => g.kind === 'EXP_UP' || g.kind === 'GOLD_CASHED');

    if (player.gold === 0) {
      if (this.initialGoldAmount > 0 || gainedExp) {
        this.subMode = 'COMPLETED_CASHIN';
        this.completionReason = 'OBJECTIVE_ACHIEVED';
        return 'COMPLETED';
      }
      this.completionReason = 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }

    if (this.turnsElapsed >= this.maxTurns) {
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    this.subMode = 'RETURNING_HOME';
    const player = engine.getPlayer();
    const map = snapshot.map;
    this.updateLockProgress(player.pos, map);

    const allHomes = map.getAllHomePositions();
    let bestHome = map.realHomePos;
    let minDist = Infinity;
    for (const h of allHomes) {
      const d = map.getTorusDistance(player.pos, h).manhattan;
      if (d < minDist) {
        minDist = d;
        bestHome = h;
      }
    }

    this.lockTarget('HOME', bestHome, snapshot.totalTurns, player.pos, map);

    return {
      type: 'NAVIGATE_TO_POSITION',
      targetPos: bestHome,
      priority: 90,
      reason: `手持ちコイン換金のため我が家(${bestHome.x}, ${bestHome.y})へ帰還 [所持:${player.gold}G]`,
    };
  }
}
