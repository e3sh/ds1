import { GameEngine } from '../../../core/GameEngine.js';
import { EnemyInstance } from '../../../models/Enemy.js';
import { Position } from '../../../models/Types.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { DEFAULT_HUNTING_PARAMS } from '../../TacticalContext.js';
import { IStrategicMission, MissionCompletionReason, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { ThreatEvaluator, ThreatPlayerStats } from '../../../systems/ThreatEvaluator.js';

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
  public startTurn?: number;
  public status: MissionStatus = 'ACTIVE';
  public completionReason?: MissionCompletionReason;
  public subMode: 'HUNTING_SAFE_ENEMY' | 'SEARCHING_ENEMY' = 'HUNTING_SAFE_ENEMY';
  private trackedEnemyId: string | null = null;
  private trackedEnemyTurns: number = 0;
  private lastEnemyPos: Position | null = null;
  private lastEnemyDist: number = Infinity;
  private turnsWithoutClosingGap: number = 0;

  constructor(public readonly targetExp: number = 4000) {
    this.name = targetExp > 4000 ? '⚔️ 決戦前防御EXP稼ぎ作戦' : '⛏️ BREAK解禁EXP稼ぎ作戦';
  }

  /**
   * 狩り対象の安全な最寄り敵を検索する共通ヘルパー
   */
  public static findNearestSafeEnemy(
    player: ThreatPlayerStats & { pos: Position; canDiagonal?: boolean },
    snapshot: TacticalSnapshot,
    targetExp: number,
    maxDistOverride?: number
  ): { enemy: EnemyInstance; distance: number } | null {
    const map = snapshot.map;
    const h = snapshot.params.hunting ?? DEFAULT_HUNTING_PARAMS;
    const canDiag = snapshot.milestones?.canDiagonal || Boolean(player.canDiagonal);
    const maxDist =
      maxDistOverride ??
      (!canDiag
        ? h.huntDistNoDiag
        : targetExp > 4000
          ? h.huntDistPostStr
          : h.huntDistDiag);

    let bestTarget: EnemyInstance | null = null;
    let minDistance = Infinity;

    for (const enemy of snapshot.livingEnemies) {
      if (!enemy.isAlive || enemy.isPermanentlyFrozen) continue;
      if (snapshot.memory.isTargetUnreachable(enemy.pos, snapshot.totalTurns)) continue;

      const dist = map.getTorusDistance(player.pos, enemy.pos).manhattan;
      if (dist > maxDist || dist >= minDistance) continue;

      const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
      const isDefenseSafe =
        details.defenseThreat === 'NO_DAMAGE' ||
        (details.defenseThreat !== 'LETHAL' &&
          !details.hasDrain &&
          details.damageToPlayer < player.hp * h.huntMaxDamageRatio);
      if (!isDefenseSafe) continue;

      const isAttackSafe =
        details.attackThreat === 'ONE_SHOT' || details.turnsToKill <= h.huntMaxTurnsToKill;
      if (!isAttackSafe) continue;

      minDistance = dist;
      bestTarget = enemy;
    }

    return bestTarget ? { enemy: bestTarget, distance: minDistance } : null;
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    const player = engine.getPlayer();
    const h = snapshot.params.hunting ?? DEFAULT_HUNTING_PARAMS;
    const start = this.startTurn ?? snapshot.totalTurns;
    const gains = snapshot.progress.substantiveGainsSince(start);
    const gainedExp = gains.some(g => g.kind === 'EXP_UP' || g.kind === 'GOLD_CASHED');

    if (player.experience >= this.targetExp) {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }
    if (!player.hasSword) {
      this.completionReason = 'TARGET_LOST';
      return 'ABORTED';
    }
    const lastExpEvent = gains.filter(g => g.kind === 'EXP_UP').pop();
    const lastExpTurn = lastExpEvent ? lastExpEvent.turn : start;
    const turnsSinceExp = snapshot.totalTurns - lastExpTurn;

    if (turnsSinceExp >= h.huntNoExpAbortTurns) {
      if (this.lastEnemyPos) {
        snapshot.memory.markTargetUnreachable(this.lastEnemyPos, h.huntUnreachableMarkTurns, snapshot.totalTurns);
      }
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }
    if (this.turnsWithoutClosingGap >= h.huntNoGapCloseAbortTurns) {
      if (this.lastEnemyPos) {
        snapshot.memory.markTargetUnreachable(this.lastEnemyPos, h.huntUnreachableMarkTurns, snapshot.totalTurns);
      }
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }
    if (this.turnsElapsed >= h.huntMissionMaxTurns) {
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }

    const found = EarlyBreakUnlockMission.findNearestSafeEnemy(player, snapshot, this.targetExp);
    if (!found) {
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }
    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    const player = engine.getPlayer();
    const h = snapshot.params.hunting ?? DEFAULT_HUNTING_PARAMS;
    const found = EarlyBreakUnlockMission.findNearestSafeEnemy(player, snapshot, this.targetExp);

    if (found) {
      const bestTarget = found.enemy;
      const minDistance = found.distance;
      if (this.trackedEnemyId === bestTarget.id) {
        this.trackedEnemyTurns++;
        if (this.trackedEnemyTurns >= h.huntTrackMaxTurns) {
          // 一定ターン追っても倒せない場合は深追いをやめてブラックリスト化
          snapshot.memory.markTargetUnreachable(bestTarget.pos, h.huntUnreachableMarkTurns, snapshot.totalTurns);
          this.trackedEnemyId = null;
          this.trackedEnemyTurns = 0;
          this.turnsWithoutClosingGap = 0;
        } else if (minDistance < this.lastEnemyDist) {
          this.turnsWithoutClosingGap = 0;
        } else {
          this.turnsWithoutClosingGap++;
        }
      } else {
        this.trackedEnemyId = bestTarget.id;
        this.trackedEnemyTurns = 1;
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
