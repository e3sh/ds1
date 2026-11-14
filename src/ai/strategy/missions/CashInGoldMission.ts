import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { IStrategicMission, MissionCompletionReason, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';

/**
 * CashInGoldMission (コイン換金帰還作戦)
 *
 * 手持ちのゴールドを我が家で換金し、重要なEXPマイルストーンや目標防御力に到達する。
 */
export class CashInGoldMission implements IStrategicMission {
  public readonly id = 'CASH_IN_GOLD';
  public readonly name: string;
  public readonly maxTurns = 100;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';
  public completionReason?: MissionCompletionReason;
  public subMode: 'RETURNING_HOME' | 'COMPLETED_CASHIN' = 'RETURNING_HOME';
  private initialGold: number | null = null;
  private initialExperience: number | null = null;

  constructor(goldAmount: number) {
    this.name = `🪙 コイン一括換金帰還 [所持: ${goldAmount}G]`;
  }

  private ensureInitialized(engine: GameEngine): void {
    const player = engine.getPlayer();
    if (this.initialGold === null) {
      this.initialGold = player.gold;
      this.initialExperience = player.experience;
    }
  }

  public evaluateStatus(_snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    this.ensureInitialized(engine);
    const player = engine.getPlayer();

    // 我が家に到達して換金完了 (player.gold === 0 かつ EXP 増加または初期所持あり)
    if (player.gold === 0) {
      const gainedExp = this.initialExperience !== null && player.experience > this.initialExperience;
      const cashedOut = (this.initialGold !== null && this.initialGold > 0) || gainedExp;
      if (cashedOut) {
        this.subMode = 'COMPLETED_CASHIN';
        this.completionReason = 'OBJECTIVE_ACHIEVED';
        return 'COMPLETED';
      }
      this.completionReason = 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }

    if (this.turnsElapsed >= this.maxTurns) {
      const gainedExp = this.initialExperience !== null && player.experience > this.initialExperience;
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    this.ensureInitialized(engine);
    this.subMode = 'RETURNING_HOME';
    const player = engine.getPlayer();
    const map = snapshot.map;
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

    // ポーション（MP）浪費を防ぐため安易なRETURNは行わず、徒歩で我が家へ帰還
    // （道中の岩はBREAK開削で恒久的通路を作りながら前進）
    return {
      type: 'NAVIGATE_TO_POSITION',
      targetPos: bestHome,
      priority: 90,
      reason: `手持ちコイン換金のため我が家(${bestHome.x}, ${bestHome.y})へ帰還 [所持:${player.gold}G]`,
    };
  }
}
