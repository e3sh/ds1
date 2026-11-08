import { Position, ResolvedDungeonTuningParams } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { Player } from '../../models/Player.js';
import { Dragon } from '../../models/Dragon.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { MapTacticalMetadata } from '../../systems/generator/ThemeBlockTypes.js';
import { GeometricMetrics } from '../../systems/generator/MapProfiler.js';
import {
  BotPhaseV2,
  BotSkillProfile,
  DynamicBotParameters,
  TacticalScale,
} from './BotTypesV2.js';

/**
 * TacticalContext (動的戦術コンテキストプロバイダ)
 *
 * マップの幾何解像度、トポロジー、テーマブロック戦術メタデータ、
 * ダンジョンチューニングパラメータ（成長率・敵湧き）、プレイヤーの進行度を総合的に解釈し、
 * 各戦術モジュールが必要とするパラメータを動的に導出・供給する。
 */
export class TacticalContext {
  public readonly scale: TacticalScale;
  public readonly metadata?: MapTacticalMetadata;
  public readonly metrics?: GeometricMetrics;
  public readonly tuning?: ResolvedDungeonTuningParams;
  public readonly profile: BotSkillProfile;

  constructor(
    map: WorldMap,
    options?: {
      metadata?: MapTacticalMetadata;
      metrics?: GeometricMetrics;
      tuning?: ResolvedDungeonTuningParams;
      profile?: BotSkillProfile;
    }
  ) {
    const w = map.width;
    const h = map.height;
    const maxToroidal = Math.floor((w + h) / 2);

    this.scale = {
      width: w,
      height: h,
      maxToroidalDist: maxToroidal,
      immediateRadius: Math.max(2, Math.round(maxToroidal * 0.05)),
      nearRadius: Math.max(4, Math.round(maxToroidal * 0.15)),
      midRadius: Math.max(8, Math.round(maxToroidal * 0.35)),
      farRadius: Math.max(16, Math.round(maxToroidal * 0.70)),
    };

    this.metadata = options?.metadata ?? (map.tacticalMetadata as MapTacticalMetadata | undefined);
    this.metrics = options?.metrics;
    this.tuning = options?.tuning;
    this.profile = options?.profile ?? 'STANDARD';
  }

  /**
   * 現在のフェーズ、プレイヤー状態、ドラゴン状態に応じた動的パラメータを算出
   */
  public resolveParameters(
    _phase: BotPhaseV2,
    player: Player,
    dragon?: Dragon,
    _enemies?: EnemyInstance[]
  ): DynamicBotParameters {
    const isClassic = this.tuning?.progressionConfig?.ruleMode === 'CLASSIC';
    const mazeIndex = this.metrics?.mazeIndex ?? 0.3;

    // 1. 戦闘・ステータス目標の算出
    const targetStr = this.calculateTargetStr(dragon, isClassic);
    const targetDefenseExp = this.calculateTargetDefenseExp(isClassic);
    const graveSealEarlyStr = isClassic ? 2500 : 30000;
    const maxTargetMagic = this.profile === 'NOVICE' ? 4 : 5;
    const minDragonMagic = this.profile === 'NOVICE' ? 2 : 3;

    // 2. リスク・安全許容度
    // 迷路度が高いほど逃げ場が少ないため、緊急HP閾値を引き上げて早めに回復へ向かう
    const emergencyHpRatio = mazeIndex > 0.6 ? 0.50 : 0.40;
    const dangerHpRatio = 0.30;
    const magicReserveThreshold = player.experience >= 4000 ? 1 : 0;

    // 3. 索敵・探索半径（幾何スケール連動）
    const stoneSearchDist = player.strength < targetStr
      ? Math.max(20, this.scale.midRadius)
      : Math.max(8, this.scale.nearRadius);
    const potionSearchDist = player.magic <= 1
      ? this.scale.midRadius
      : this.scale.nearRadius;
    const keySearchDist = player.strength < targetStr
      ? this.scale.farRadius
      : this.scale.midRadius;
    const coinSearchDist = !isClassic && player.experience < 4000
      ? this.scale.midRadius
      : (player.experience < 12000 ? this.scale.nearRadius : this.scale.immediateRadius);

    // 敵狩り許容距離: 序盤の重要魔法・特技解禁期、および終盤防御育成期に拡大
    let huntDistance = 0;
    if (player.hasSword) {
      if (player.strength >= targetStr) {
        huntDistance = this.scale.farRadius; // 決戦前準備期: 防御EXP育成のため広域狩り
      } else if (!isClassic && (player.experience < 4000 || player.experience < 12000)) {
        // 序盤EXPマイルストーン育成: BREAK (4,000) / 斜め移動 (12,000) 早期解禁のため nearRadius まで狩りを拡大
        huntDistance = player.holdItem !== 'KEY' ? this.scale.nearRadius : 0;
      } else if (!isClassic) {
        huntDistance = player.holdItem !== 'KEY' ? this.scale.immediateRadius : 0;
      } else {
        // クラシックモード: STRに応じた段階的拡大
        if (player.strength < 3000) huntDistance = this.scale.immediateRadius;
        else if (player.strength < 6000) huntDistance = Math.round(this.scale.nearRadius * 0.6);
        else huntDistance = this.scale.nearRadius;
      }
    }

    // 4. ナビゲーション・BFSコスト
    // 迷路度が高い場合は壁破壊（BREAK）をより積極的に幹線道路として活用
    const allowBreakAsRoad = player.experience >= 4000;
    const breakCostMultiplier = mazeIndex > 0.5 ? 1.2 : 1.6;
    const warpAvoidanceCost = this.scale.nearRadius * 2;
    // マップ面積に比例したBFSステップ上限
    const maxBfsSteps = Math.min(6000, Math.max(3000, this.scale.width * this.scale.height * 2));

    // 5. 戦術ポリシー
    const enableHomeRelocation = this.profile !== 'NOVICE';
    const homeRelocateDistMin = Math.max(4, Math.round(this.scale.nearRadius * 0.5));
    const homeRelocateDistMax = Math.max(7, Math.round(this.scale.nearRadius * 0.8));

    // 墓封鎖ポリシーの推奨値判定
    let graveSealPolicy: 'AUTO' | 'NONE' | 'NEAR_HOME' | 'ALL' = 'NEAR_HOME';
    if (this.metadata?.recommendedBotTuning?.graveSealPolicy) {
      graveSealPolicy = this.metadata.recommendedBotTuning.graveSealPolicy;
    }

    return {
      targetStr,
      targetDefenseExp,
      graveSealEarlyStr,
      maxTargetMagic,
      minDragonMagic,
      emergencyHpRatio,
      dangerHpRatio,
      magicReserveThreshold,
      huntDistance,
      potionSearchDist,
      keySearchDist,
      stoneSearchDist,
      coinSearchDist,
      allowBreakAsRoad,
      breakCostMultiplier,
      warpAvoidanceCost,
      maxBfsSteps,
      enableHomeRelocation,
      homeRelocateDistMin,
      homeRelocateDistMax,
      graveSealPolicy,
    };
  }

  /**
   * ルールモードやドラゴンの生存首DEFに基づく目標STRの算出
   */
  public calculateTargetStr(dragon?: Dragon, isClassic?: boolean): number {
    const livingHeads = dragon ? dragon.heads.filter(h => h.isAlive) : [];
    const maxHeadDef = livingHeads.length > 0 ? Math.max(...livingHeads.map(h => h.def)) : 0;
    if (maxHeadDef > 0) {
      return maxHeadDef + 1000;
    }
    return isClassic ? 11000 : 350000;
  }

  /**
   * ルールモードに応じた目標防御力(EXP)の算出
   */
  public calculateTargetDefenseExp(isClassic?: boolean): number {
    if (isClassic) return 15000;
    return 40000;
  }

  /**
   * 指定座標が8歩周期に最適な宝箱ゾーン内にあるか判定
   */
  public isInOptimalTreasureZone(pos: Position): boolean {
    if (!this.metadata?.treasureZoneHints) return false;
    return this.metadata.treasureZoneHints.some(
      zone => zone.isEightStepOptimal &&
              pos.x >= zone.bounds.x1 && pos.x <= zone.bounds.x2 &&
              pos.y >= zone.bounds.y1 && pos.y <= zone.bounds.y2
    );
  }
}
