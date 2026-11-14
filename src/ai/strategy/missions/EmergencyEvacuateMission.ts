import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { IStrategicMission, MissionCompletionReason, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { MagicSystem } from '../../../systems/MagicSystem.js';

/**
 * EmergencyEvacuateMission (緊急危機退避作戦)
 *
 * 即死級の敵の隣接や致命的HPピンチに際し、最優先で緊急離脱または魔法詠唱を行う。
 */
export class EmergencyEvacuateMission implements IStrategicMission {
  public readonly id = 'EMERGENCY_EVACUATE';
  public readonly name = '🚨 緊急危機退避作戦';
  public readonly maxTurns = 30;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';
  public completionReason?: MissionCompletionReason;
  public subMode: 'CASTING_ESCAPE' | 'EVADING_DANGER' = 'EVADING_DANGER';

  public evaluateStatus(snapshot: TacticalSnapshot, _engine: GameEngine): MissionStatus {
    // 致命的危機が解除されたか判定
    if (!snapshot.threats.isLethalDanger && !snapshot.threats.isPinchHp) {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }

    if (this.turnsElapsed >= this.maxTurns) {
      this.completionReason = 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    const player = engine.getPlayer();
    const map = snapshot.map;
    const allHomes = map.getAllHomePositions();
    const distToNearestHome = Math.min(
      ...allHomes.map(h => map.getTorusDistance(player.pos, h).manhattan)
    );

    // 1. 極限瀕死 (HP <= 15% かつ HP < 1000) または逃げ場のない多重包囲時のみ緊急脱出 (RETURN / JUMP)
    // ※ポーション(MP)浪費を防ぐため、通常のピンチはBREAK/FREEZE/KICKによる打開や徒歩帰還を優先
    const isExtremeHpCrisis = snapshot.threats.isPinchHp && player.hp <= Math.max(1000, player.maxHp * 0.15);
    const isTrappedOrMultiLethal = snapshot.threats.adjacentLethalEnemies.length >= 2 || isExtremeHpCrisis;

    if (isTrappedOrMultiLethal && player.holdItem !== 'CROWN') {
      if (distToNearestHome > 2 && MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying) {
        this.subMode = 'CASTING_ESCAPE';
        return {
          type: 'CAST_MAGIC',
          magicToCast: 'RETURN',
          priority: 100,
          reason: '🚨 絶体絶命の危機のため緊急RETURN全快帰還',
        };
      }
      if (MagicSystem.canCast(player, 'JUMP').allowed) {
        this.subMode = 'CASTING_ESCAPE';
        return {
          type: 'CAST_MAGIC',
          magicToCast: 'JUMP',
          priority: 99,
          reason: '🚨 逃げ場のない即死危機のため緊急JUMP詠唱',
        };
      }
    }

    // 2. 危険マスからの離脱・戦術層自衛（FREEZE/KICK/回避/BREAK徒歩帰還）へ委譲
    this.subMode = 'EVADING_DANGER';
    return {
      type: 'EVADE_DANGER',
      priority: 95,
      reason: '🚨 敵の攻撃射程または直角隣接からの緊急回避',
    };
  }
}
