import { GameEngine } from '../../../core/GameEngine.js';
import { EnemyInstance } from '../../../models/Enemy.js';
import { Position } from '../../../models/Types.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { DEFAULT_HUNTING_PARAMS } from '../../TacticalContext.js';
import { BaseStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { ThreatEvaluator, ThreatPlayerStats } from '../../../systems/ThreatEvaluator.js';
import { MagicSystem } from '../../../systems/MagicSystem.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';

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
  private closeChaseTurns: number = 0;
  private cachedTurn: number = -1;
  private cachedPosX: number = -1;
  private cachedPosY: number = -1;
  private cachedResult: { enemy: EnemyInstance; distance: number } | null = null;

  constructor(public readonly targetExp: number = 4000) {
    super();
    this.name = targetExp > 4000 ? '⚔️ 決戦前防御EXP稼ぎ作戦' : '⛏️ BREAK解禁EXP稼ぎ作戦';
  }

  /**
   * 連続狩り継続のためのHP安全下限ガード
   */
  public static isHpSafeForHunting(
    player: ThreatPlayerStats,
    snapshot: TacticalSnapshot
  ): boolean {
    if (snapshot.params.coinGrantsExp !== false) return true;
    if (snapshot.threats.isPinchHp) return false;
    const minSafeHp = Math.max(300, Math.floor(player.experience * 0.50));
    return player.hp >= minSafeHp;
  }

  private static isEnemySafeTarget(
    player: ThreatPlayerStats,
    enemy: EnemyInstance,
    snapshot: TacticalSnapshot
  ): boolean {
    const h = snapshot.params.hunting ?? DEFAULT_HUNTING_PARAMS;
    const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
    const isClassic = snapshot.params.coinGrantsExp === false;
    // FLASH等の一時停止中または永久凍結中の敵は反撃・逃走しないため、停止中に倒し切れるなら安全ターゲットとみなす
    if (enemy.frozenTimer > 0 && !enemy.isPermanentlyFrozen) {
      if (details.attackThreat === 'ONE_SHOT' || details.turnsToKill <= Math.min(3, enemy.frozenTimer)) {
        return true;
      }
    }
    if (isClassic && enemy.isPermanentlyFrozen && details.attackThreat === 'ONE_SHOT') {
      return true;
    }
    const isTriggerCandidate =
      isClassic &&
      player.hp >= player.experience &&
      details.turnsToKill <= 3 &&
      details.defenseThreat !== 'LETHAL' &&
      !details.hasDrain &&
      details.damageToPlayer < player.hp * 0.45;
    const classicOneShotRelaxed =
      isClassic &&
      details.attackThreat === 'ONE_SHOT' &&
      details.defenseThreat !== 'LETHAL' &&
      details.damageToPlayer < player.hp * 0.75;
    const isDefenseSafe =
      details.defenseThreat === 'NO_DAMAGE' ||
      classicOneShotRelaxed ||
      isTriggerCandidate ||
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
    player: ThreatPlayerStats & { pos: Position; canDiagonal?: boolean; hasSword?: boolean },
    snapshot: TacticalSnapshot,
    targetExp: number,
    maxDistOverride?: number
  ): { enemy: EnemyInstance; distance: number } | null {
    const map = snapshot.map;
    const h = snapshot.params.hunting ?? DEFAULT_HUNTING_PARAMS;
    const canDiag = snapshot.milestones?.canDiagonal || Boolean(player.canDiagonal);
    const baseMaxDist =
      maxDistOverride ??
      (!canDiag
        ? h.huntDistNoDiag
        : targetExp > 4000
          ? h.huntDistPostStr
          : h.huntDistDiag);
    const maxDist =
      snapshot.params.coinGrantsExp === false
        ? Math.max(baseMaxDist, 64)
        : baseMaxDist;

    const isClassic = snapshot.params.coinGrantsExp === false;
    if (!isClassic) {
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

    const items = MapSituationEvaluator.get(snapshot).items;
    const isInjured = player.hp < player.experience;
    const hasSword = player.hasSword ?? snapshot.milestones?.hasSword ?? true;

    let bestTarget: EnemyInstance | null = null;
    let bestScore = Infinity;
    let bestRealDist = Infinity;

    for (const enemy of snapshot.livingEnemies) {
      if (!enemy.isAlive) continue;
      if (snapshot.memory.isTargetUnreachable(enemy.pos, snapshot.totalTurns)) continue;

      const reachableDist = items.getReachableDist
        ? items.getReachableDist(enemy.pos)
        : map.getTorusDistance(player.pos, enemy.pos).manhattan;
      if (!Number.isFinite(reachableDist) || reachableDist > maxDist) continue;

      const willFlee =
        !isInjured &&
        !enemy.isFrozen &&
        enemy.typeId < 16 &&
        hasSword &&
        player.effectiveAttack > enemy.def;

      if (!EarlyBreakUnlockMission.isEnemySafeTarget(player, enemy, snapshot)) continue;

      const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
      let score = reachableDist;
      if (enemy.frozenTimer > 0 && !enemy.isPermanentlyFrozen && details.attackThreat === 'ONE_SHOT') {
        // FLASH等で一時停止中のワンパン敵は高EXPほど最優先で回収
        score -= 20 + Math.min(20, Math.floor(enemy.expReward / 400));
      } else if (enemy.isFrozen && details.attackThreat === 'ONE_SHOT') {
        score -= 15;
      } else if (!isInjured) {
        // HP >= EXP の初動時: FLEE する下位敵より逃げない敵(typeId>=16)を最優先
        if (!willFlee) {
          score -= 30;
        } else if (reachableDist > 5) {
          score += 6;
        }
      } else if (details.attackThreat === 'ONE_SHOT') {
        // HP < EXP の連続狩り時: ワンパンできる敵を優先して迎撃
        score -= 3;
      }

      if (score < bestScore || (score === bestScore && reachableDist < bestRealDist)) {
        bestScore = score;
        bestRealDist = reachableDist;
        bestTarget = enemy;
      }
    }

    return bestTarget ? { enemy: bestTarget, distance: bestRealDist } : null;
  }

  /**
   * CLASSICモード用: FLASH詠唱(EXP>=8000)で全敵を一時停止させてワンパン撃破できる近傍敵を検索する
   */
  public static findFlashKillCandidate(
    player: ThreatPlayerStats & { pos: Position; canDiagonal?: boolean },
    snapshot: TacticalSnapshot
  ): { enemy: EnemyInstance; distance: number } | null {
    if (snapshot.params.coinGrantsExp !== false) return null;
    const minMagic = player.experience < 12000 ? 2 : 4;
    if (player.experience < 8000 || player.magic < minMagic) return null;
    if (player.holdItem === 'CROSS' || player.holdItem === 'CROWN') return null;

    const items = MapSituationEvaluator.get(snapshot).items;
    const canDiag = snapshot.milestones?.canDiagonal || Boolean(player.canDiagonal);
    const maxFlashHuntDist = canDiag ? 12 : 9;

    // すでにFLASH等で一時停止中の安全敵が射程内にいる場合は重ね掛けを控える
    const hasActiveTempFrozen = snapshot.livingEnemies.some(e => {
      if (!e.isAlive || e.isPermanentlyFrozen || e.frozenTimer <= 1) return false;
      const d = items.getReachableDist
        ? items.getReachableDist(e.pos)
        : snapshot.map.getTorusDistance(player.pos, e.pos).manhattan;
      return Number.isFinite(d) && d <= e.frozenTimer;
    });
    if (hasActiveTempFrozen) return null;

    let best: { enemy: EnemyInstance; distance: number; score: number } | null = null;
    for (const enemy of snapshot.livingEnemies) {
      if (!enemy.isAlive || enemy.isFrozen) continue;
      if (snapshot.memory.isTargetUnreachable(enemy.pos, snapshot.totalTurns)) continue;
      const reachableDist = items.getReachableDist
        ? items.getReachableDist(enemy.pos)
        : snapshot.map.getTorusDistance(player.pos, enemy.pos).manhattan;
      if (!Number.isFinite(reachableDist) || reachableDist > maxFlashHuntDist) continue;

      const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
      const killableInFlash =
        details.attackThreat === 'ONE_SHOT' ||
        (details.turnsToKill <= 2 && reachableDist <= 5);
      if (!killableInFlash) continue;

      // 通常は安全に倒せない敵(LETHAL/hasDrain)または高EXP逃走敵をFLASH対象にする
      const isNormallyUnsafe =
        details.defenseThreat === 'LETHAL' ||
        details.hasDrain ||
        (player.hp >= player.experience && enemy.typeId < 16);
      if (!isNormallyUnsafe && reachableDist <= 4) continue;

      const score = reachableDist - Math.min(20, Math.floor(enemy.expReward / 500));
      if (!best || score < best.score || (score === best.score && reachableDist < best.distance)) {
        best = { enemy, distance: reachableDist, score };
      }
    }
    return best ? { enemy: best.enemy, distance: best.distance } : null;
  }

  /**
   * CLASSICモード用: FREEZE詠唱(EXP>=6000)で隣接(Chebyshev<=1)のワンパン敵を永久凍結して安全に狩れる候補を返す
   */
  public static findFreezeKillCandidate(
    player: ThreatPlayerStats & { pos: Position },
    snapshot: TacticalSnapshot
  ): EnemyInstance | null {
    if (snapshot.params.coinGrantsExp !== false) return null;
    const minMagic = player.experience < 12000 ? 2 : 4;
    if (player.experience < 6000 || player.magic < minMagic) return null;
    if (player.holdItem === 'CROSS' || player.holdItem === 'CROWN') return null;

    let best: EnemyInstance | null = null;
    for (const enemy of snapshot.livingEnemies) {
      if (!enemy.isAlive || enemy.isFrozen) continue;
      const cheb = snapshot.map.getTorusDistance(player.pos, enemy.pos).chebyshev;
      if (cheb > 1) continue;
      const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
      if (details.attackThreat !== 'ONE_SHOT') continue;
      const needsFreeze =
        details.defenseThreat === 'LETHAL' ||
        details.hasDrain ||
        (player.hp >= player.experience && enemy.typeId < 16);
      if (!needsFreeze) continue;
      if (!best || enemy.expReward > best.expReward) {
        best = enemy;
      }
    }
    return best;
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
    const baseMaxDist = !canDiag
      ? h.huntDistNoDiag
      : this.targetExp > 4000
        ? h.huntDistPostStr
        : h.huntDistDiag;
    const maxDist =
      snapshot.params.coinGrantsExp === false
        ? Math.max(baseMaxDist, 64)
        : baseMaxDist;

    let resolved: { enemy: EnemyInstance; distance: number } | null = null;

    // 既に単一敵をロックしている場合は優先的に追跡検証
    if (this.lockedTarget?.kind === 'ENEMY' && this.lockedTarget.entityId) {
      const lockedEnemy = snapshot.livingEnemies.find(
        e => e.id === this.lockedTarget!.entityId
      );
      const allowPermFrozen =
        snapshot.params.coinGrantsExp === false &&
        lockedEnemy !== undefined &&
        lockedEnemy.isPermanentlyFrozen;
      if (
        lockedEnemy &&
        lockedEnemy.isAlive &&
        (!lockedEnemy.isPermanentlyFrozen || allowPermFrozen) &&
        !snapshot.memory.isTargetUnreachable(lockedEnemy.pos, snapshot.totalTurns) &&
        EarlyBreakUnlockMission.isEnemySafeTarget(player, lockedEnemy, snapshot)
      ) {
        const dist = map.getTorusDistance(player.pos, lockedEnemy.pos).manhattan;
        this.trackedEnemyTurns++;
        this.updateLockedEntityPos(lockedEnemy.pos, player.pos, map);

        const isFleeingLocked =
          snapshot.params.coinGrantsExp === false &&
          player.experience >= 4000 &&
          player.hp >= player.experience &&
          !lockedEnemy.isFrozen &&
          lockedEnemy.typeId < 16 &&
          player.effectiveAttack > lockedEnemy.def;

        if (isFleeingLocked && dist <= 4) {
          this.closeChaseTurns++;
        } else if (!isFleeingLocked || dist > 5) {
          this.closeChaseTurns = 0;
        }

        const effectiveTrackLimit =
          snapshot.params.coinGrantsExp === false && (dist <= 4 || this.lockedTarget.stalledTurns <= 2)
            ? Math.max(h.huntTrackMaxTurns, 24)
            : h.huntTrackMaxTurns;
        const exceededTrackLimit = this.trackedEnemyTurns >= effectiveTrackLimit;
        const blockedOut =
          this.lockedTarget.blockedCount >= 2 ||
          (isFleeingLocked && (this.lockedTarget.stalledTurns >= 8 || this.closeChaseTurns >= 12));
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
          this.closeChaseTurns = 0;
        } else {
          resolved = { enemy: lockedEnemy, distance: dist };
        }
      } else {
        this.clearTargetLock();
        this.trackedEnemyTurns = 0;
        this.closeChaseTurns = 0;
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
        this.closeChaseTurns = 0;
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
    if (!EarlyBreakUnlockMission.isHpSafeForHunting(player, snapshot)) {
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }

    const resolved = this.resolveAndVerifyTarget(player, snapshot);
    const lastExpEvent = gains.filter(g => g.kind === 'EXP_UP').pop();
    const lastExpTurn = lastExpEvent ? lastExpEvent.turn : start;
    const turnsSinceExp = snapshot.totalTurns - lastExpTurn;

    const isLockedWillFlee =
      snapshot.params.coinGrantsExp === false &&
      player.experience >= 4000 &&
      resolved !== null &&
      player.hp >= player.experience &&
      !resolved.enemy.isFrozen &&
      resolved.enemy.typeId < 16 &&
      player.effectiveAttack > resolved.enemy.def &&
      resolved.distance > 2;

    const effectiveNoExpAbortTurns =
      snapshot.params.coinGrantsExp === false && resolved && !isLockedWillFlee
        ? Math.max(h.huntNoExpAbortTurns + 10, Math.min(60, resolved.distance + 18))
        : h.huntNoExpAbortTurns;
    if (turnsSinceExp >= effectiveNoExpAbortTurns) {
      if (this.lockedTarget) {
        snapshot.memory.markTargetUnreachable(this.lockedTarget.pos, h.huntUnreachableMarkTurns, snapshot.totalTurns);
      }
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }
    const effectiveGapCloseAbortTurns =
      snapshot.params.coinGrantsExp === false && resolved && !isLockedWillFlee && (resolved.distance <= 5 || player.hp >= player.experience)
        ? Math.max(h.huntNoGapCloseAbortTurns, 16)
        : h.huntNoGapCloseAbortTurns;
    if (this.lockedTarget && this.lockedTarget.stalledTurns >= effectiveGapCloseAbortTurns) {
      snapshot.memory.markTargetUnreachable(this.lockedTarget.pos, h.huntUnreachableMarkTurns, snapshot.totalTurns);
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }
    const isClassicActivelyClosing =
      snapshot.params.coinGrantsExp === false &&
      resolved !== null &&
      !isLockedWillFlee &&
      (!this.lockedTarget || this.lockedTarget.stalledTurns < 6) &&
      turnsSinceExp < effectiveNoExpAbortTurns;
    const isClassicInjuredRush =
      snapshot.params.coinGrantsExp === false &&
      player.hp < player.experience &&
      turnsSinceExp < effectiveNoExpAbortTurns;
    if (!isClassicInjuredRush && !isClassicActivelyClosing && this.turnsElapsed >= h.huntMissionMaxTurns) {
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }

    if (!resolved) {
      if (
        isClassicInjuredRush ||
        EarlyBreakUnlockMission.findFlashKillCandidate(player, snapshot) !== null ||
        EarlyBreakUnlockMission.findFreezeKillCandidate(player, snapshot) !== null
      ) {
        return 'ACTIVE';
      }
      this.completionReason = gainedExp ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }
    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    const player = engine.getPlayer();
    const found = this.resolveAndVerifyTarget(player, snapshot);
    const surroundings = MapSituationEvaluator.get(snapshot, engine).surroundings;

    // CLASSICでMPに余裕があり、隣接(Chebyshev<=1)にFREEZEで永久凍結→ワンパン撃破できる敵がいれば最優先でFREEZE詠唱
    if (
      snapshot.params.coinGrantsExp === false &&
      MagicSystem.canCast(player, 'FREEZE').allowed
    ) {
      const freezeCand = EarlyBreakUnlockMission.findFreezeKillCandidate(player, snapshot);
      if (freezeCand) {
        return {
          type: 'CAST_MAGIC',
          magicToCast: 'FREEZE',
          priority: 94,
          reason: `❄️ FREEZEで隣接強敵/逃走敵を凍結し安全にEXP稼ぎ (${freezeCand.name})`,
        };
      }
    }

    // CLASSICでMPに余裕があり、FLASHで全敵を停止させて安全にワンパン撃破できる敵がいればFLASH詠唱
    if (
      snapshot.params.coinGrantsExp === false &&
      MagicSystem.canCast(player, 'FLASH').allowed
    ) {
      const flashCand = EarlyBreakUnlockMission.findFlashKillCandidate(player, snapshot);
      const shouldCastFlash =
        flashCand !== null &&
        (!found ||
          (!found.enemy.isFrozen &&
            (found.distance > 6 ||
              (flashCand.enemy.expReward >= 1500 && flashCand.enemy.expReward > found.enemy.expReward))));
      if (shouldCastFlash) {
        return {
          type: 'CAST_MAGIC',
          magicToCast: 'FLASH',
          priority: 92,
          reason: `⚡ FLASHで周囲敵を停止し安全にEXP稼ぎ (${flashCand.enemy.name})`,
        };
      }
    }

    // 強敵接近時の回避・迎撃判断（HP < EXP による全域 CHASE 中の強敵接触を防止）
    const isClassicInjured = snapshot.params.coinGrantsExp === false && player.hp < player.experience;
    const hasApproachingLethal =
      isClassicInjured &&
      (surroundings.approachingLethalChebyshev3.length > 0 ||
        surroundings.approachingLethalEnemies.length > 0);
    if (hasApproachingLethal) {
      const isAdjacentSafeOneShot =
        found &&
        found.distance === 1 &&
        ThreatEvaluator.evaluateThreatDetails(player, found.enemy).attackThreat === 'ONE_SHOT';
      if (!isAdjacentSafeOneShot) {
        return {
          type: 'EVADE_DANGER',
          priority: 90,
          reason: '接近する即死級強敵を回避して安全を確保',
        };
      }
    }

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
