import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { IStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { ThreatEvaluator } from '../../../systems/ThreatEvaluator.js';

/**
 * EarlyBreakUnlockMission (BREAK解禁EXP稼ぎ作戦)
 *
 * 剣回収後、EXP 4,000 に到達して BREAK (ブロック破壊) を解禁するまで、
 * 近傍の安全な低ATK敵を狩る。
 */
export class EarlyBreakUnlockMission implements IStrategicMission {
  public readonly id = 'EARLY_BREAK_UNLOCK';
  public readonly name: string;
  public readonly maxTurns = 80;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';

  constructor(public readonly targetExp: number = 4000) {
    this.name = targetExp > 4000 ? '⚔️ 決戦前防御EXP稼ぎ作戦' : '⛏️ BREAK解禁EXP稼ぎ作戦';
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    const player = engine.getPlayer();
    if (player.experience >= this.targetExp) {
      return 'COMPLETED';
    }
    if (!player.hasSword || this.turnsElapsed >= this.maxTurns) {
      return 'ABORTED';
    }
    // 近傍に狩れる到達可能な安全敵（被ダメージ0または一撃撃破）がいるか
    const map = snapshot.map;
    const maxDist = this.targetExp > 4000 ? 30 : 16;
    const hasTarget = snapshot.livingEnemies.some(enemy => {
      if (!enemy.isAlive || enemy.isPermanentlyFrozen) return false;
      if (snapshot.memory.isTargetUnreachable(enemy.pos, snapshot.totalTurns)) return false;
      const dist = map.getTorusDistance(player.pos, enemy.pos).manhattan;
      if (dist > maxDist) return false;

      const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
      // 防御視点: 被ダメージ0、または即死・大ダメージ・能力吸収が絶対にない安全な敵
      const isDefenseSafe = details.defenseThreat === 'NO_DAMAGE' || (
        details.defenseThreat !== 'LETHAL' &&
        !details.hasDrain &&
        details.damageToPlayer < player.hp * 0.15
      );
      if (!isDefenseSafe) return false;

      // 攻撃視点: 一撃撃破可能、または4発以内で撃破可能
      return details.attackThreat === 'ONE_SHOT' || details.turnsToKill <= 4;
    });
    if (!hasTarget) {
      return 'ABORTED';
    }
    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    const player = engine.getPlayer();
    const map = snapshot.map;

    let bestTarget = null;
    let minDistance = Infinity;

    const maxDist = this.targetExp > 4000 ? 30 : 16;
    for (const enemy of snapshot.livingEnemies) {
      if (!enemy.isAlive || enemy.isPermanentlyFrozen) continue;
      if (snapshot.memory.isTargetUnreachable(enemy.pos, snapshot.totalTurns)) continue;

      const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
      const isDefenseSafe = details.defenseThreat === 'NO_DAMAGE' || (
        details.defenseThreat !== 'LETHAL' &&
        !details.hasDrain &&
        details.damageToPlayer < player.hp * 0.15
      );
      if (!isDefenseSafe) continue;
      const isSafe = details.attackThreat === 'ONE_SHOT' || details.turnsToKill <= 4;
      if (!isSafe) continue;

      const dist = map.getTorusDistance(player.pos, enemy.pos).manhattan;
      if (dist < minDistance && dist <= maxDist) {
        minDistance = dist;
        bestTarget = enemy;
      }
    }

    if (bestTarget) {
      return {
        type: 'ATTACK_TARGET',
        targetPos: bestTarget.pos,
        priority: 85,
        reason: `BREAK解禁のための安全敵迎撃 (${bestTarget.name})`,
      };
    }

    return {
      type: 'WANDER_SAFELY',
      priority: 10,
      reason: '狩れる敵を索敵中',
    };
  }
}
