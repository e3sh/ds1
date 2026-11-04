import { Player } from '../models/Player.js';
import { EnemyInstance } from '../models/Enemy.js';
import { Dragon, DragonPart } from '../models/Dragon.js';
import { Direction, Position, ThreatEvaluationDetails, ThreatLevel, ThreatTargetStats, DungeonTuningParams } from '../models/Types.js';
import { WorldMap } from '../models/WorldMap.js';
import { SpawnSystem } from './SpawnSystem.js';
import { ThreatEvaluator, ThreatPlayerStats } from './ThreatEvaluator.js';

export interface CombatResult {
  damageToEnemy: number;
  damageToPlayer: number;
  enemyKilled: boolean;
  attacked: boolean;
  isDragonHead?: boolean;
  dragonPart?: DragonPart;
  targetPos?: Position;
  enemy?: EnemyInstance;
  specialEffects?: string[];
  expGained?: number;
  mitigatedDamage?: number;
}

export class CombatSystem {
  /**
   * 現在交戦中（対峙中）のモンスター
   */
  public static engagedEnemy: EnemyInstance | null = null;

  public static clearEngagedEnemy(): void {
    CombatSystem.engagedEnemy = null;
  }

  /**
   * 敵（またはドラゴンの首）の相対5段階脅威度を判定
   */
  public static evaluateThreat(
    player: ThreatPlayerStats,
    enemy: ThreatTargetStats,
    mitigationRatio: number = 1.0
  ): ThreatLevel {
    return ThreatEvaluator.evaluateThreat(player, enemy, mitigationRatio);
  }

  /**
   * 敵（またはドラゴンの首）の攻防2軸（3×3マトリクス）詳細脅威度を判定
   */
  public static evaluateThreatDetails(
    player: ThreatPlayerStats,
    enemy: ThreatTargetStats,
    mitigationRatio: number = 1.0
  ): ThreatEvaluationDetails {
    return ThreatEvaluator.evaluateThreatDetails(player, enemy, mitigationRatio);
  }
  /**
   * プレイヤーがドラゴンの部位（首）へ体当たり攻撃した場合の戦闘処理
   */
  public static resolvePlayerAttackDragon(
    player: Player,
    dragon: Dragon,
    part: DragonPart,
    attackDir: Direction,
    map: WorldMap,
    mitigationRatio: number = 1.0
  ): CombatResult {
    // 十字架（CROSS）所持時: 攻撃不可
    if (player.holdItem === 'CROSS') {
      return {
        damageToEnemy: 0,
        damageToPlayer: 0,
        enemyKilled: false,
        attacked: false,
        isDragonHead: true,
        dragonPart: part,
        targetPos: { ...part.pos },
      };
    }

    const effectiveAtk = player.effectiveAttack;
    const damageToEnemy = Math.max(1, effectiveAtk - part.def);

    // 斜めからの攻撃なら首は反撃できない（安全地帯）
    const isDiagonal = attackDir.includes('_');
    const damageToPlayer = isDiagonal ? 0 : Math.max(0, part.atk - player.getEffectiveDefense(mitigationRatio));

    // ダメージ適用
    const killed = dragon.damageHead(part, damageToEnemy);
    player.takeDamage(damageToPlayer, {
      cause: 'DRAGON_HEAD',
      damage: damageToPlayer,
      dragonPartType: part.type,
    });

    if (killed) {
      // ドラゴンの首討伐による経験値獲得はなし（0獲得）。
      // ドラゴン討伐の真の報酬は「王冠（CROWN）の出現」と「クリア権利の獲得」であり、
      // 首撃破で防御力（EXP）をカンストさせず、王冠回収（脱出）フェーズの敵ラッシュの脅威度を維持する。

      // 世界変化の適用
      dragon.applyWorldChanges(map);
    }

    return {
      damageToEnemy,
      damageToPlayer,
      enemyKilled: killed,
      attacked: true,
      isDragonHead: true,
      dragonPart: part,
      targetPos: { ...part.pos },
    };
  }

  /**
   * プレイヤーが敵のマスに体当たり進入を試みた場合の戦闘処理
   * @param immediateCounter 敵の反撃を同一手番で即時処理するか（旧互換用デフォルト: true、ターン調停モード: false）
   */
  public static resolvePlayerAttack(
    player: Player,
    enemy: EnemyInstance,
    immediateCounter: boolean = true,
    mitigationRatio: number = 1.0,
    progressionConfig?: DungeonTuningParams['progressionConfig'],
    dragon?: Dragon
  ): CombatResult {
    // 十字架（CROSS）所持時: 被ダメ0（無敵）かつ自身も攻撃不可
    if (player.holdItem === 'CROSS') {
      return {
        damageToEnemy: 0,
        damageToPlayer: 0,
        enemyKilled: false,
        attacked: false,
        enemy,
      };
    }

    // 1. プレイヤー攻撃力算出 (剣がないと10固定)
    const effectiveAtk = player.effectiveAttack;

    // 2. ダメージ計算 (与ダメは最低1保証)
    const damageToEnemy = Math.max(1, effectiveAtk - enemy.def);
    enemy.takeDamage(damageToEnemy);

    let damageToPlayer = 0;
    let specialEffects: string[] = [];

    // 3. 敵生存時の処理
    if (enemy.isAlive) {
      CombatSystem.engagedEnemy = enemy;
      if (immediateCounter) {
        // 旧互換モード: 同一ターンで反撃被ダメと特殊能力を即時処理
        damageToPlayer = Math.max(0, enemy.atk - player.getEffectiveDefense(mitigationRatio));
        player.takeDamage(damageToPlayer, {
          cause: 'MONSTER_COUNTER',
          damage: damageToPlayer,
          enemyName: enemy.name,
          enemyDisplayName: enemy.displayName,
          enemyTypeId: enemy.typeId,
          enemyColor: enemy.color,
        });
        specialEffects = this.applyEnemySpecialEffects(enemy, player);
      }
    } else {
      // 4. 敵撃破時: 経験値加算 & モンスターランク進行
      if (CombatSystem.engagedEnemy?.id === enemy.id) {
        CombatSystem.engagedEnemy = null;
      }
      const heads = dragon?.defeatedHeadsCount ?? 0;
      const expReward = enemy.getExpReward(progressionConfig, heads);
      player.addExperience(expReward);
      player.totalKills++;
      SpawnSystem.recordKill();
      return {
        damageToEnemy,
        damageToPlayer,
        enemyKilled: true,
        attacked: true,
        enemy,
        targetPos: { ...enemy.pos },
        specialEffects,
        expGained: expReward,
      };
    }

    return {
      damageToEnemy,
      damageToPlayer,
      enemyKilled: !enemy.isAlive,
      attacked: true,
      enemy,
      targetPos: { ...enemy.pos },
      specialEffects,
    };
  }

  /**
   * 敵がプレイヤーのマスに進入・攻撃してきた場合の戦闘処理（敵の手番反撃・攻撃）
   */
  public static resolveEnemyAttack(
    enemy: EnemyInstance,
    player: Player,
    mitigationRatio: number = 1.0
  ): CombatResult {
    // 接触した敵を交戦相手として記録
    if (enemy.isAlive) {
      CombatSystem.engagedEnemy = enemy;
    }

    // 十字架所持時は被ダメ0（完全無敵）
    if (player.holdItem === 'CROSS') {
      return {
        damageToEnemy: 0,
        damageToPlayer: 0,
        enemyKilled: false,
        attacked: false,
        enemy,
      };
    }

    const effectiveDef = player.getEffectiveDefense(mitigationRatio);
    const damageToPlayer = Math.max(0, enemy.atk - effectiveDef);
    const mitigatedDamage = Math.min(enemy.atk, effectiveDef);
    player.takeDamage(damageToPlayer, {
      cause: 'MONSTER_ATTACK',
      damage: damageToPlayer,
      enemyName: enemy.name,
      enemyDisplayName: enemy.displayName,
      enemyTypeId: enemy.typeId,
      enemyColor: enemy.color,
    });

    // 特殊効果発動
    const specialEffects = this.applyEnemySpecialEffects(enemy, player);

    return {
      damageToEnemy: 0,
      damageToPlayer,
      enemyKilled: false,
      attacked: true,
      enemy,
      specialEffects,
      mitigatedDamage,
    };
  }

  /**
   * 特殊モンスターの能力発動（攻撃力吸収、経験値吸収、壺強奪）
   */
  public static applyEnemySpecialEffects(enemy: EnemyInstance, player: Player): string[] {
    const effects: string[] = [];

    // dora, knight: 攻撃力を3000吸い取る
    if (enemy.drainAtk > 0) {
      const prevStr = player.strength;
      player.strength = Math.max(0, player.strength - enemy.drainAtk);
      const lost = prevStr - player.strength;
      if (lost > 0) {
        effects.push(`STRを${lost}吸い取られた！`);
      }
    }

    // rich, crownload: 経験値を吸い取る
    if (enemy.drainExp > 0) {
      const prevExp = player.experience;
      player.experience = Math.max(0, player.experience - enemy.drainExp);
      player.maxHp = Math.max(1, player.experience);
      if (player.hp > player.maxHp) {
        player.hp = player.maxHp;
      }
      const lost = prevExp - player.experience;
      if (lost > 0) {
        effects.push(`EXPを${lost}吸い取られた！`);
      }
    }

    // monstir: 魔法の壺を1つ強奪
    if (enemy.stealPotion && player.magic > 0) {
      player.magic = Math.max(0, player.magic - 1);
      effects.push(`魔法の壺（POTION）を1つ奪われた！`);
    }

    return effects;
  }
}
