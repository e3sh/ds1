import { ResolvedDungeonTuningParams, TargetEnemyInfo } from '../../models/Types.js';
import { Player } from '../../models/Player.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { DragonPart } from '../../models/Dragon.js';
import { ThreatEvaluator } from '../../systems/ThreatEvaluator.js';

export class TargetTrackingController {
  private targetEnemyInfo: TargetEnemyInfo | null = null;
  private targetEnemyInstance: EnemyInstance | null = null;

  public getTargetEnemyInfo(): TargetEnemyInfo | null {
    return this.targetEnemyInfo;
  }

  public getTargetEnemyInstance(): EnemyInstance | null {
    return this.targetEnemyInstance;
  }

  public setTargetInfo(info: TargetEnemyInfo | null): void {
    this.targetEnemyInfo = info;
  }

  public setTargetEnemyInstance(instance: EnemyInstance | null): void {
    this.targetEnemyInstance = instance;
  }

  public setTargetEnemy(
    enemy: EnemyInstance | null,
    player: Player,
    tuningParams: ResolvedDungeonTuningParams
  ): void {
    this.targetEnemyInstance = enemy;
    this.targetEnemyInfo = enemy ? this.createTargetEnemyInfo(enemy, player, tuningParams) : null;
  }

  public clear(): void {
    this.targetEnemyInfo = null;
    this.targetEnemyInstance = null;
  }

  /**
   * 敵インスタンスから対峙モンスター情報を作成
   */
  public createTargetEnemyInfo(
    enemy: EnemyInstance,
    player: Player,
    tuningParams: ResolvedDungeonTuningParams
  ): TargetEnemyInfo {
    const threatDetails = ThreatEvaluator.evaluateThreatDetails(
      player,
      enemy,
      tuningParams.progressionConfig.expDefenseMitigationRatio
    );

    return {
      name: enemy.name,
      displayName: enemy.displayName,
      typeId: enemy.typeId,
      symbol: enemy.symbol,
      color: enemy.color,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      atk: enemy.atk,
      def: enemy.def,
      frozenTimer: enemy.frozenTimer,
      isPermanentlyFrozen: enemy.isPermanentlyFrozen,
      drainAtk: enemy.drainAtk,
      drainExp: enemy.drainExp,
      stealPotion: enemy.stealPotion,
      isDragon: false,
      threatLevel: threatDetails.overallThreat,
      threatDetails,
    };
  }

  /**
   * ドラゴン部位から対峙モンスター情報を作成
   */
  public createTargetDragonInfo(
    part: DragonPart,
    player: Player,
    tuningParams: ResolvedDungeonTuningParams
  ): TargetEnemyInfo {
    let headName = 'DRAGON HEAD';
    if (part.type === 'LEFT_HEAD') headName = 'LEFT HEAD (左首)';
    else if (part.type === 'CENTER_HEAD') headName = 'CENTER HEAD (中央首)';
    else if (part.type === 'RIGHT_HEAD') headName = 'RIGHT HEAD (右首)';

    const threatDetails = ThreatEvaluator.evaluateThreatDetails(
      player,
      part,
      tuningParams.progressionConfig.expDefenseMitigationRatio
    );

    return {
      name: part.type,
      displayName: `3-HEADED DRAGON: ${headName}`,
      symbol: 'D',
      color: '#ff3344',
      hp: part.hp,
      maxHp: part.maxHp,
      atk: part.atk,
      def: part.def,
      isDragon: true,
      threatLevel: threatDetails.overallThreat,
      threatDetails,
    };
  }

  /**
   * ターゲット敵の追跡と距離チェック（死亡または離脱でクリア）
   */
  public updateTargetTracking(player: Player, tuningParams: ResolvedDungeonTuningParams): void {
    if (this.targetEnemyInstance) {
      if (!this.targetEnemyInstance.isAlive || this.targetEnemyInstance.hp <= 0) {
        this.targetEnemyInfo = null;
        this.targetEnemyInstance = null;
      } else {
        const dist =
          Math.abs(this.targetEnemyInstance.pos.x - player.pos.x) +
          Math.abs(this.targetEnemyInstance.pos.y - player.pos.y);
        if (dist > 3) {
          // 距離が離れたらターゲット解除
          this.targetEnemyInfo = null;
          this.targetEnemyInstance = null;
        } else {
          // リアルタイムにHP・ステータスを同期
          this.targetEnemyInfo = this.createTargetEnemyInfo(this.targetEnemyInstance, player, tuningParams);
        }
      }
    }
  }
}
