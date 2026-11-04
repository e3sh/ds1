import {
  AttackThreat,
  DefenseThreat,
  HoldItemType,
  ThreatEvaluationDetails,
  ThreatLevel,
  ThreatTargetStats,
} from '../models/Types.js';

export interface ThreatPlayerStats {
  effectiveAttack: number;
  experience: number;
  hp: number;
  holdItem: HoldItemType;
  magic: number;
}

export class ThreatEvaluator {
  /**
   * 攻撃視点×防御視点の2軸（3×3マトリクス）に基づく詳細な脅威度を判定する。
   *
   * 攻撃視点 (AttackThreat):
   * - ONE_SHOT   : 一撃撃破 (与ダメ >= 敵HP)
   * - EFFECTIVE  : 有効打あり (2〜6発以内で撃破可能 & 与ダメ > 1)
   * - INEFFECTIVE: 通らない (1ダメまたは7発以上)
   *
   * 防御視点 (DefenseThreat):
   * - NO_DAMAGE   : 貰わない (被ダメ 0 かつ STR/EXP吸収・壺強奪なし)
   * - TAKES_DAMAGE: 貰う (0 < 被ダメ < プレイヤーHP、または能力吸収あり)
   * - LETHAL      : 即死 (被ダメ >= プレイヤーHP)
   */
  public static evaluateThreatDetails(
    player: ThreatPlayerStats,
    enemy: ThreatTargetStats,
    mitigationRatio: number = 1.0
  ): ThreatEvaluationDetails {
    // 十字架（CROSS）所持時: 攻撃不可かつ被ダメ0のため、完全な膠着状態（STALEMATE）
    if (player.holdItem === 'CROSS') {
      return {
        attackThreat: 'INEFFECTIVE',
        defenseThreat: 'NO_DAMAGE',
        isRiskyOneShot: false,
        isLethalOneShot: false,
        turnsToKill: Infinity,
        damageToEnemy: 0,
        damageToPlayer: 0,
        hasDrain: false,
        overallThreat: 'STALEMATE',
      };
    }

    const dmgToEnemy = Math.max(1, player.effectiveAttack - enemy.def);
    const turnsToKill = Math.ceil(enemy.hp / dmgToEnemy);
    const effectiveDefense = Math.floor(player.experience * mitigationRatio);
    const rawDmgToPlayer = Math.max(0, enemy.atk - effectiveDefense);
    const hasDrain =
      (enemy.drainAtk !== undefined && enemy.drainAtk > 0) ||
      (enemy.drainExp !== undefined && enemy.drainExp > 0) ||
      (Boolean(enemy.stealPotion) && player.magic > 0);

    // 攻撃視点
    let attackThreat: AttackThreat = 'INEFFECTIVE';
    if (turnsToKill === 1) {
      attackThreat = 'ONE_SHOT';
    } else if (dmgToEnemy > 1 && turnsToKill <= 6) {
      attackThreat = 'EFFECTIVE';
    }

    // 防御視点
    let defenseThreat: DefenseThreat = 'NO_DAMAGE';
    if (rawDmgToPlayer >= player.hp) {
      defenseThreat = 'LETHAL';
    } else if (rawDmgToPlayer > 0 || hasDrain) {
      defenseThreat = 'TAKES_DAMAGE';
    }

    const isRiskyOneShot = attackThreat === 'ONE_SHOT' && defenseThreat === 'TAKES_DAMAGE';
    const isLethalOneShot = attackThreat === 'ONE_SHOT' && defenseThreat === 'LETHAL';

    // 既存互換の overallThreat
    let overallThreat: ThreatLevel = 'DANGER';
    if (turnsToKill === 1) {
      overallThreat = 'ONE_SHOT';
    } else if (rawDmgToPlayer >= player.hp) {
      overallThreat = 'LETHAL';
    } else {
      const canDealEffectiveDamage = dmgToEnemy > 1 && turnsToKill <= 6;
      const isNoDamage = rawDmgToPlayer === 0 && !hasDrain;

      if (canDealEffectiveDamage && isNoDamage) {
        overallThreat = 'SAFE';
      } else if (
        (!canDealEffectiveDamage && isNoDamage) ||
        (canDealEffectiveDamage && rawDmgToPlayer < player.hp && !hasDrain)
      ) {
        overallThreat = 'STALEMATE';
      } else {
        overallThreat = 'DANGER';
      }
    }

    return {
      attackThreat,
      defenseThreat,
      isRiskyOneShot,
      isLethalOneShot,
      turnsToKill,
      damageToEnemy: dmgToEnemy,
      damageToPlayer: rawDmgToPlayer,
      hasDrain,
      overallThreat,
    };
  }

  /**
   * プレイヤーと対象モンスター（通常敵またはドラゴンの首）のステータスを比較し、
   * 相対5段階の脅威度（ThreatLevel）を判定する（既存互換API）。
   */
  public static evaluateThreat(
    player: ThreatPlayerStats,
    enemy: ThreatTargetStats,
    mitigationRatio: number = 1.0
  ): ThreatLevel {
    return ThreatEvaluator.evaluateThreatDetails(player, enemy, mitigationRatio).overallThreat;
  }
}
