import { GameEngine } from '../../../core/GameEngine.js';
import { Position } from '../../../models/Types.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { IStrategicMission, MissionCompletionReason, MissionStatus } from '../StrategicMission.js';
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
  public readonly maxTurns = 35;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';
  public completionReason?: MissionCompletionReason;
  public subMode: 'HUNTING_SAFE_ENEMY' | 'SEARCHING_ENEMY' = 'HUNTING_SAFE_ENEMY';
  private initialExperience: number | null = null;
  private initialGold: number | null = null;
  private trackedEnemyId: string | null = null;
  private lastEnemyPos: Position | null = null;
  private lastEnemyDist: number = Infinity;
  private turnsWithoutClosingGap: number = 0;

  constructor(public readonly targetExp: number = 4000) {
    this.name = targetExp > 4000 ? '⚔️ 決戦前防御EXP稼ぎ作戦' : '⛏️ BREAK解禁EXP稼ぎ作戦';
  }

  private ensureInitialized(engine: GameEngine): void {
    if (this.initialExperience === null) {
      this.initialExperience = engine.getPlayer().experience;
      this.initialGold = engine.getPlayer().gold;
    }
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    this.ensureInitialized(engine);
    const player = engine.getPlayer();
    const gainedExp = this.initialExperience !== null && player.experience > this.initialExperience;

    if (player.experience >= this.targetExp) {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }
    if (!player.hasSword) {
      this.completionReason = 'TARGET_LOST';
      return 'ABORTED';
    }
    if (
      this.turnsElapsed >= 10 &&
      player.experience <= (this.initialExperience ?? player.experience) &&
      player.gold <= (this.initialGold ?? player.gold)
    ) {
      if (this.lastEnemyPos) {
        snapshot.memory.markTargetUnreachable(this.lastEnemyPos, 30, snapshot.totalTurns);
      }
      this.completionReason = 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }
    if (this.turnsWithoutClosingGap >= 8) {
      if (this.lastEnemyPos) {
        snapshot.memory.markTargetUnreachable(this.lastEnemyPos, 30, snapshot.totalTurns);
      }
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }
    if (this.turnsElapsed >= this.maxTurns) {
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }
    // 近傍に狩れる到達可能な安全敵（被ダメージ0または一撃撃破）がいるか
    const map = snapshot.map;
    const canDiag = snapshot.milestones.canDiagonal || player.canDiagonal;
    const maxDist = !canDiag ? 8 : (this.targetExp > 4000 ? 45 : 18);
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
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }
    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    this.ensureInitialized(engine);
    const player = engine.getPlayer();
    const map = snapshot.map;

    let bestTarget = null;
    let minDistance = Infinity;

    const canDiag = snapshot.milestones.canDiagonal || player.canDiagonal;
    const maxDist = !canDiag ? 8 : (this.targetExp > 4000 ? 45 : 18);
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
      if (this.trackedEnemyId === bestTarget.id) {
        if (minDistance < this.lastEnemyDist) {
          this.turnsWithoutClosingGap = 0;
        } else {
          this.turnsWithoutClosingGap++;
        }
      } else {
        this.trackedEnemyId = bestTarget.id;
        this.turnsWithoutClosingGap = 0;
      }
      this.lastEnemyDist = minDistance;
      this.lastEnemyPos = { ...bestTarget.pos };

      this.subMode = 'HUNTING_SAFE_ENEMY';
      return {
        type: 'ATTACK_TARGET',
        targetPos: bestTarget.pos,
        priority: 85,
        reason: `BREAK解禁のための安全敵迎撃 (${bestTarget.name})`,
      };
    }

    this.subMode = 'SEARCHING_ENEMY';
    return {
      type: 'WANDER_SAFELY',
      priority: 10,
      reason: '狩れる敵を索敵中',
    };
  }
}
