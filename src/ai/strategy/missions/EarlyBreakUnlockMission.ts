import { GameEngine } from '../../../core/GameEngine.js';
import { EnemyInstance } from '../../../models/Enemy.js';
import { Position } from '../../../models/Types.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { DEFAULT_HUNTING_PARAMS } from '../../TacticalContext.js';
import { BaseStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { ThreatEvaluator, ThreatPlayerStats } from '../../../systems/ThreatEvaluator.js';

/**
 * EarlyBreakUnlockMission (BREAK解禁EXP稼ぎ作戦)
 *
 * 大・中・小分類ステートマシン：
 * - 中分類 (subMode): HUNTING_SAFE_ENEMY | SEARCHING_ENEMY
 * - 小分類 (lockedTarget): ENEMY (entityId による単一敵ロック＆追跡)
 *
 * 同一ターン内での evaluateStatus と generateDirective の二重検索を排除し、
 * ロック中の安全敵を追跡中に別敵へ目移りしないようヒステリシス制御する。
 */
export class EarlyBreakUnlockMission extends BaseStrategicMission {
  public readonly id = 'EARLY_BREAK_UNLOCK';
  public readonly name: string;
  public readonly maxTurns = 35;
  public override subMode: 'HUNTING_SAFE_ENEMY' | 'SEARCHING_ENEMY' = 'HUNTING_SAFE_ENEMY';

  private trackedEnemyTurns: number = 0;
  private cachedTurn: number = -1;
  private cachedPosX: number = -1;
  private cachedPosY: number = -1;
  private cachedResult: { enemy: EnemyInstance; distance: number } | null = null;

  constructor(public readonly targetExp: number = 4000) {
    super();
    this.name = targetExp > 4000 ? '⚔️ 決戦前防御EXP稼ぎ作戦' : '⛏️ BREAK解禁EXP稼ぎ作戦';
  }

  private static isEnemySafeTarget(
    player: ThreatPlayerStats,
    enemy: EnemyInstance,
    snapshot: TacticalSnapshot
  ): boolean {
    const h = snapshot.params.hunting ?? DEFAULT_HUNTING_PARAMS;
    const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
    const isDefenseSafe =
      details.defenseThreat === 'NO_DAMAGE' ||
      (details.defenseThreat !== 'LETHAL' &&
        !details.hasDrain &&
        details.damageToPlayer < player.hp * h.huntMaxDamageRatio);
    if (!isDefenseSafe) return false;
    return details.attackThreat === 'ONE_SHOT' || details.turnsToKill <= h.huntMaxTurnsToKill;
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

      if (!EarlyBreakUnlockMission.isEnemySafeTarget(player, enemy, snapshot)) continue;

      minDistance = dist;
      bestTarget = enemy;
    }

    return bestTarget ? { enemy: bestTarget, distance: minDistance } : null;
  }

  /**
   * Step 1: 同一ターンキャッシュを活用しつつ、ロック敵の追跡・有効性確認・新規選定を一元実行する
   */
  private resolveAndVerifyTarget(
    player: ThreatPlayerStats & { pos: Position; canDiagonal?: boolean },
    snapshot: TacticalSnapshot
  ): { enemy: EnemyInstance; distance: number } | null {
    if (
      this.cachedTurn === snapshot.totalTurns &&
      this.cachedPosX === player.pos.x &&
      this.cachedPosY === player.pos.y
    ) {
      return this.cachedResult;
    }

    const map = snapshot.map;
    const h = snapshot.params.hunting ?? DEFAULT_HUNTING_PARAMS;
    const canDiag = snapshot.milestones?.canDiagonal || Boolean(player.canDiagonal);
    const maxDist = !canDiag
      ? h.huntDistNoDiag
      : this.targetExp > 4000
        ? h.huntDistPostStr
        : h.huntDistDiag;

    let resolved: { enemy: EnemyInstance; distance: number } | null = null;

    // 既に単一敵をロックしている場合は優先的に追跡検証
    if (this.lockedTarget?.kind === 'ENEMY' && this.lockedTarget.entityId) {
      const lockedEnemy = snapshot.livingEnemies.find(
        e => e.id === this.lockedTarget!.entityId
      );
      if (
        lockedEnemy &&
        lockedEnemy.isAlive &&
        !lockedEnemy.isPermanentlyFrozen &&
        !snapshot.memory.isTargetUnreachable(lockedEnemy.pos, snapshot.totalTurns) &&
        EarlyBreakUnlockMission.isEnemySafeTarget(player, lockedEnemy, snapshot)
      ) {
        const dist = map.getTorusDistance(player.pos, lockedEnemy.pos).manhattan;
        this.trackedEnemyTurns++;
        this.updateLockedEntityPos(lockedEnemy.pos, player.pos, map);

        const exceededTrackLimit = this.trackedEnemyTurns >= h.huntTrackMaxTurns;
        const blockedOut = this.lockedTarget.blockedCount >= 2;
        const outOfRange = dist > maxDist + 3;

        if (exceededTrackLimit || blockedOut || outOfRange) {
          if (exceededTrackLimit || blockedOut) {
            snapshot.memory.markTargetUnreachable(
              lockedEnemy.pos,
              h.huntUnreachableMarkTurns,
              snapshot.totalTurns
            );
          }
          this.clearTargetLock();
          this.trackedEnemyTurns = 0;
        } else {
          resolved = { enemy: lockedEnemy, distance: dist };
        }
      } else {
        this.clearTargetLock();
        this.trackedEnemyTurns = 0;
      }
    }

    // 未ロックまたは解除時は最寄り安全敵を探索してロック
    if (!resolved) {
      const found = EarlyBreakUnlockMission.findNearestSafeEnemy(player, snapshot, this.targetExp);
      if (found) {
        this.lockTarget('ENEMY', found.enemy.pos, snapshot.totalTurns, player.pos, map, {
          entityId: found.enemy.id,
        });
        this.trackedEnemyTurns = 1;
        resolved = found;
      }
    }

    this.subMode = resolved ? 'HUNTING_SAFE_ENEMY' : 'SEARCHING_ENEMY';
    this.cachedTurn = snapshot.totalTurns;
    this.cachedPosX = player.pos.x;
    this.cachedPosY = player.pos.y;
    this.cachedResult = resolved;
    return resolved;
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

    const resolved = this.resolveAndVerifyTarget(player, snapshot);
    const lastExpEvent = gains.filter(g => g.kind === 'EXP_UP').pop();
    const lastExpTurn = lastExpEvent ? lastExpEvent.turn : start;
    const turnsSinceExp = snapshot.totalTurns - lastExpTurn;

    if (turnsSinceExp >= h.huntNoExpAbortTurns) {
      if (this.lockedTarget) {
        snapshot.memory.markTargetUnreachable(this.lockedTarget.pos, h.huntUnreachableMarkTurns, snapshot.totalTurns);
      }
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }
    if (this.lockedTarget && this.lockedTarget.stalledTurns >= h.huntNoGapCloseAbortTurns) {
      snapshot.memory.markTargetUnreachable(this.lockedTarget.pos, h.huntUnreachableMarkTurns, snapshot.totalTurns);
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }
    if (this.turnsElapsed >= h.huntMissionMaxTurns) {
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }

    if (!resolved) {
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }
    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    const player = engine.getPlayer();
    const found = this.resolveAndVerifyTarget(player, snapshot);

    if (found) {
      this.subMode = 'HUNTING_SAFE_ENEMY';
      return {
        type: 'ATTACK_TARGET',
        targetPos: found.enemy.pos,
        priority: 85,
        reason: `BREAK解禁のための安全敵迎撃 (${found.enemy.name})`,
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
