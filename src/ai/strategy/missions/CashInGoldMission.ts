import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { IStrategicMission, MissionStatus } from '../StrategicMission.js';
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

  constructor(goldAmount: number) {
    this.name = `🪙 コイン一括換金帰還 [所持: ${goldAmount}G]`;
  }

  public evaluateStatus(_snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    const player = engine.getPlayer();

    // 我が家に到達して換金完了 (player.gold === 0)
    if (player.gold === 0) {
      return 'COMPLETED';
    }

    if (this.turnsElapsed >= this.maxTurns) {
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
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
