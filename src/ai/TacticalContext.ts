import { Position, ResolvedDungeonTuningParams } from '../models/Types.js';
import { WorldMap } from '../models/WorldMap.js';
import { Player } from '../models/Player.js';
import { Dragon } from '../models/Dragon.js';
import { EnemyInstance } from '../models/Enemy.js';
import { MapTacticalMetadata } from '../systems/generator/ThemeBlockTypes.js';
import { GeometricMetrics } from '../systems/generator/MapProfiler.js';
import {
  BotPhase,
  BotSkillProfile,
  CommanderConfig,
  DynamicBotParameters,
  HuntingParams,
  MissionPolicyParams,
  ReadinessParams,
  TacticalScale,
  BotStrategyTuning,
} from './BotTypes.js';
import { DEFAULT_COMMANDER_CONFIG } from './strategy/command/CommanderTypes.js';

export const DEFAULT_READINESS_PARAMS: ReadinessParams = {
  crownReserveMagic: 10,
  prepBypassTurnsNoChest: 35,
  prepBypassTurnsWithChest: 65,
  prepDefenseExpCutoffTurns: 30,
  prepPotionSweepCutoffTurns: 35,
  prepPotionSweepExtendedTurns: 45,
  prepTreasureMpFarmCutoffTurns: 55,
  prepRelocationCutoffTurns: 30,
  prepHpRatioNormal: 0.70,
  prepHpMinNormal: 30000,
  readyHpRatioNormal: 0.50,
  readyHpMinNormal: 15000,
  readyHpRatioWaived: 0.35,
  readyHpMinWaived: 8000,
  readyDefenseFallbackPrepTurns: 25,
  readyDefenseFallbackTotalTurns: 600,
  stallDefenseRelaxTotalTurns: 1800,
};

export const DEFAULT_HUNTING_PARAMS: HuntingParams = {
  huntDistNoDiag: 8,
  huntDistDiag: 18,
  huntDistPostStr: 45,
  huntMaxTurnsToKill: 4,
  huntMaxDamageRatio: 0.15,
  huntMissionMaxTurns: 35,
  huntNoExpAbortTurns: 20,
  huntNoGapCloseAbortTurns: 8,
  huntTrackMaxTurns: 12,
  huntUnreachableMarkTurns: 30,
};

export const DEFAULT_MISSION_POLICY_PARAMS: MissionPolicyParams = {
  coinCashInGoldThreshold: 8,
  coinCashInChainGoldThreshold: 12,
  coinCashInPrepGoldThreshold: 3,
  coinCashInLateGoldThreshold: 4,
  graveSealMaxTotalTurns: 60,
  consecutiveBlockedAbortTurns: 2,
  cooldownPrepareDragonAssault: 30,
  cooldownClearTreasureZone: 20,
  cooldownSlayDragon: 15,
  cooldownEarlyBreakNoProgress: 50,
  cooldownEarlyBreakPartial: 30,
  cooldownHarvestPowerStone: 20,
  cooldownSealGrave: 80,
};

export interface MapResourceCounts {
  crossCount: number;
  ringCount: number;
  potionCount: number;
  chestCount: number;
  graveCount: number;
}

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
  public readonly resourceCounts: MapResourceCounts;

  constructor(
    map: WorldMap,
    options?: {
      metadata?: MapTacticalMetadata;
      metrics?: GeometricMetrics;
      tuning?: ResolvedDungeonTuningParams;
      profile?: BotSkillProfile;
      resourceCounts?: MapResourceCounts;
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
    this.resourceCounts = options?.resourceCounts ?? this.countMapResources(map);
  }

  private countMapResources(map: WorldMap): MapResourceCounts {
    let crossCount = 0;
    let ringCount = 0;
    let potionCount = 0;
    let chestCount = 0;
    let graveCount = 0;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        const item = map.getItem(p);
        const obj = map.getObject(p);
        const base = map.getBaseTile(p);

        if (item === 'CROSS') crossCount++;
        else if (item === 'RING') ringCount++;
        else if (item === 'POTION') potionCount++;

        if (obj === 'CHEST') chestCount++;
        if (base === 'GRAVE') graveCount++;
      }
    }

    return { crossCount, ringCount, potionCount, chestCount, graveCount };
  }

  /**
   * 現在のフェーズ、プレイヤー状態、ドラゴン状態、敵配置、経過ターンに応じた動的パラメータを算出
   */
  public resolveParameters(
    phase: BotPhase,
    player: Player,
    dragon?: Dragon,
    enemies?: EnemyInstance[],
    options?: {
      totalTurns?: number;
      strategyTuning?: BotStrategyTuning;
      parameterOverrides?: Partial<DynamicBotParameters>;
      enableGiveUp?: boolean;
    }
  ): DynamicBotParameters {
    const progConfig = this.tuning?.progressionConfig ?? player.activeProgressionConfig;
    const isClassic =
      progConfig?.ruleMode === 'CLASSIC' ||
      (!progConfig?.ruleMode && progConfig?.expCurveMode === 'CLASSIC_LINEAR');
    const coinGrantsExp = progConfig
      ? progConfig.coinScalingMode === 'EXPONENTIAL' ||
        progConfig.ruleMode === 'EXPONENTIAL' ||
        (!progConfig.ruleMode &&
          (progConfig.expCurveMode === 'DAMPED_POWER' || progConfig.expCurveMode === 'PHASE_CAPPED'))
      : true;
    const mazeIndex = this.metrics?.mazeIndex ?? 0.3;
    const opennessScore = this.metrics?.opennessScore ?? 0.3;
    const sectorPartitionScore = this.metrics?.sectorPartitionScore ?? 0.3;
    const nearHomeGraves = this.metrics?.nearHomeGraves ?? 1;

    // 1. 周囲の生存敵の最大攻撃力 (ATK) の計測
    let maxNearEnemyAtk = 0;
    if (enemies && enemies.length > 0) {
      for (const e of enemies) {
        if (!e.isAlive || e.isPermanentlyFrozen) continue;
        const dx = Math.abs(player.pos.x - e.pos.x);
        const dy = Math.abs(player.pos.y - e.pos.y);
        const dist = Math.min(dx, this.scale.width - dx) + Math.min(dy, this.scale.height - dy);
        if (dist <= 12) {
          if (e.atk > maxNearEnemyAtk) {
            maxNearEnemyAtk = e.atk;
          }
        }
      }
    }

    // 2. 戦闘・ステータス目標の算出（敵の最大ATKおよび経過ターンを反映）
    const targetStr = this.calculateTargetStr(dragon, isClassic);
    let targetDefenseExp =
      options?.strategyTuning?.targetDefenseExp ?? this.calculateTargetDefenseExp(isClassic);

    // 強敵がいる場合: 最大ATKに耐えられるよう目標防御EXPを動的引き上げ
    if (maxNearEnemyAtk > targetDefenseExp) {
      targetDefenseExp = Math.max(targetDefenseExp, maxNearEnemyAtk + 2000);
    }

    const graveSealEarlyStr = options?.strategyTuning?.graveSealEarlyStr ?? (isClassic ? 2500 : 30000);
    const defaultTargetMagic = this.profile === 'NOVICE' ? 8 : 14;
    const maxTargetMagic = options?.strategyTuning?.maxTargetMagic ?? defaultTargetMagic;
    const minDragonMagic = this.profile === 'NOVICE' ? 2 : 3;

    // 2-B. サブグループパラメータ（マップ特徴量 × ルールモード × tuning 上書き）
    const readiness = this.resolveReadinessParams(
      mazeIndex,
      opennessScore,
      sectorPartitionScore,
      nearHomeGraves,
      minDragonMagic,
      maxTargetMagic,
      options?.strategyTuning
    );
    const hunting = this.resolveHuntingParams(
      mazeIndex,
      opennessScore,
      coinGrantsExp,
      options?.strategyTuning
    );
    const missionPolicy = this.resolveMissionPolicyParams(
      coinGrantsExp,
      options?.strategyTuning
    );
    const commander = this.resolveCommanderConfig(
      mazeIndex,
      sectorPartitionScore,
      options?.strategyTuning
    );

    // 滞留防止フィードバック: 総ターンがかさんだ場合は早期切り上げ (TIMEOUT_STALL防止)
    // ※ 決戦準備ターン経過による防御緩和は S層 (ReadinessEvaluator / MissionSelector) で実施する
    const totalTurns = options?.totalTurns ?? 0;
    if (phase === 'RESOURCE_FARM' && totalTurns > readiness.stallDefenseRelaxTotalTurns) {
      targetDefenseExp = Math.min(targetDefenseExp, Math.max(player.experience, 12000));
    }

    // 3. リスク・安全許容度
    // 迷路度が高いほど逃げ場が少ないため、緊急HP閾値を引き上げ。さらに強敵が周囲にいれば早めに回復へ
    let emergencyHpRatio = mazeIndex > 0.6 ? 0.50 : 0.40;
    if (maxNearEnemyAtk > player.experience) {
      emergencyHpRatio = Math.min(0.65, emergencyHpRatio + 0.10);
    }
    const dangerHpRatio = 0.30;
    const magicReserveThreshold = player.experience >= 4000 ? 1 : 0;

    // 4. 索敵・探索半径（幾何スケール連動）
    const needStr = player.strength < targetStr;
    const stoneSearchDist = Math.max(12, this.scale.nearRadius);
    // ポット探索半径（青天井備蓄対応）: STR達成後の決戦前は目標MP未達の間広域探索を維持
    const potionSearchDist = !needStr
      ? (player.magic < maxTargetMagic ? Math.max(20, this.scale.farRadius) : this.scale.nearRadius)
      : (player.magic <= 1
      ? Math.max(16, this.scale.midRadius)
      : (player.magic < 5
        ? Math.round(this.scale.nearRadius * 1.2)
        : (player.magic < 10 ? this.scale.nearRadius : this.scale.immediateRadius)));
    const needDefenseExp = player.experience < targetDefenseExp;
    const keySearchDist = (player.strength < targetStr || needDefenseExp)
      ? this.scale.farRadius
      : this.scale.midRadius;
    const coinSearchDist = (coinGrantsExp && needDefenseExp)
      ? Math.max(20, this.scale.farRadius)
      : this.scale.immediateRadius;

    // 敵狩り許容距離:
    // 指数モード時は BREAK (EXP 4,000) 未習得時のみ近傍の安全敵狩りを許可。
    // コインでEXPが増えないモードでは targetDefenseExp 未達の間、敵討伐によるEXP育成を許可する。
    let huntDistance = 0;
    if (player.hasSword && player.holdItem !== 'KEY') {
      if (player.experience < 4000) {
        huntDistance = !coinGrantsExp ? this.scale.midRadius : this.scale.immediateRadius;
      } else if (!coinGrantsExp && player.experience < targetDefenseExp) {
        huntDistance = this.scale.nearRadius;
      }
    }

    // 5. ナビゲーション・BFSコスト
    // 迷路度が高い場合は壁破壊（BREAK）をより積極的に幹線道路として活用
    const allowBreakAsRoad = !player.hasDeath && player.magic >= 1 && player.experience >= 4000;
    const breakCostMultiplier = mazeIndex > 0.5 ? 1.1 : 1.6;
    const warpAvoidanceCost = this.scale.nearRadius * 2;
    // マップ面積に比例したBFSステップ上限
    const maxBfsSteps = Math.min(6000, Math.max(3000, this.scale.width * this.scale.height * 2));

    // 6. 戦術ポリシー
    const enableHomeRelocation = options?.strategyTuning?.enableHomeRelocation ?? (this.profile !== 'NOVICE');
    const homeRelocateDistMin =
      options?.strategyTuning?.homeRelocateTargetDistMin ?? Math.max(4, Math.round(this.scale.nearRadius * 0.5));
    const homeRelocateDistMax =
      options?.strategyTuning?.homeRelocateTargetDistMax ?? Math.max(7, Math.round(this.scale.nearRadius * 0.8));

    // 墓封鎖ポリシーの推奨値判定（strategyTuning 上書き > マップ推奨 > 幾何メトリクス＆資源数連動）
    let graveSealPolicy: 'AUTO' | 'NONE' | 'NEAR_HOME' | 'ALL' = 'NEAR_HOME';
    const overridePolicy = options?.strategyTuning?.graveSealPolicy;
    const recommendedPolicy = this.metadata?.recommendedBotTuning?.graveSealPolicy;
    if (overridePolicy && overridePolicy !== 'AUTO') {
      graveSealPolicy = overridePolicy;
    } else if (recommendedPolicy && recommendedPolicy !== 'AUTO') {
      graveSealPolicy = recommendedPolicy;
    } else {
      const hasTools = this.resourceCounts.crossCount > 0 || this.resourceCounts.ringCount > 0;
      if (!hasTools) {
        graveSealPolicy = 'NONE';
      } else if (this.resourceCounts.crossCount >= 3 && mazeIndex > 0.4) {
        graveSealPolicy = 'ALL';
      } else if (nearHomeGraves > 0) {
        graveSealPolicy = 'NEAR_HOME';
      } else {
        graveSealPolicy = 'NONE';
      }
    }

    const resolved: DynamicBotParameters = {
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
      enableGiveUp: options?.enableGiveUp ?? true,
      coinGrantsExp,
      readiness,
      hunting,
      missionPolicy,
      commander,
    };

    if (options?.parameterOverrides) {
      const ov = options.parameterOverrides;
      return {
        ...resolved,
        ...ov,
        readiness: ov.readiness ? { ...resolved.readiness!, ...ov.readiness } : resolved.readiness,
        hunting: ov.hunting ? { ...resolved.hunting!, ...ov.hunting } : resolved.hunting,
        missionPolicy: ov.missionPolicy ? { ...resolved.missionPolicy!, ...ov.missionPolicy } : resolved.missionPolicy,
        commander: ov.commander
          ? {
              ...resolved.commander!,
              ...ov.commander,
              probationTurns: {
                ...resolved.commander!.probationTurns,
                ...ov.commander.probationTurns,
              },
            }
          : resolved.commander,
      };
    }

    return resolved;
  }

  private resolveReadinessParams(
    mazeIndex: number,
    opennessScore: number,
    sectorPartitionScore: number,
    nearHomeGraves: number,
    minDragonMagic: number,
    maxTargetMagic: number,
    tuning?: BotStrategyTuning
  ): ReadinessParams {
    const baseMagic = minDragonMagic + 2;
    const mazeBonus = Math.round(mazeIndex * 3);
    const graveBonus = nearHomeGraves >= 2 || this.resourceCounts.graveCount >= 8 ? 1 : 0;
    const totalSupply = this.resourceCounts.potionCount + this.resourceCounts.chestCount;
    const supplyAdj = totalSupply >= 10 ? 1 : totalSupply <= 4 ? -1 : 0;
    const openAdj = opennessScore > 0.55 ? -1 : 0;
    const dynamicCrownMagic = Math.max(
      minDragonMagic,
      Math.min(maxTargetMagic, baseMagic + mazeBonus + graveBonus + supplyAdj + openAdj)
    );

    const topoFactor = 1 + 0.35 * mazeIndex + 0.15 * sectorPartitionScore;
    const base: ReadinessParams = {
      ...DEFAULT_READINESS_PARAMS,
      crownReserveMagic: Math.min(maxTargetMagic, tuning?.crownReserveMagic ?? dynamicCrownMagic),
      prepBypassTurnsNoChest: Math.round(32 * topoFactor),
      prepBypassTurnsWithChest: Math.round(58 * topoFactor),
      prepDefenseExpCutoffTurns: Math.round(28 * topoFactor),
      prepPotionSweepCutoffTurns: Math.round(32 * topoFactor),
      prepPotionSweepExtendedTurns: Math.round(42 * topoFactor),
      prepTreasureMpFarmCutoffTurns: Math.round(50 * topoFactor),
      prepRelocationCutoffTurns: Math.round(28 * topoFactor),
    };

    if (!tuning?.readiness) return base;
    const merged = { ...base, ...tuning.readiness };
    merged.crownReserveMagic = Math.min(maxTargetMagic, merged.crownReserveMagic);
    return merged;
  }

  private resolveHuntingParams(
    mazeIndex: number,
    opennessScore: number,
    coinGrantsExp: boolean,
    tuning?: BotStrategyTuning
  ): HuntingParams {
    const isClassicHunt = !coinGrantsExp;
    const mazeTurnAdj = mazeIndex > 0.5 ? 4 : opennessScore > 0.5 ? -3 : 0;
    const base: HuntingParams = {
      ...DEFAULT_HUNTING_PARAMS,
      huntDistNoDiag: isClassicHunt
        ? Math.max(16, Math.round(this.scale.midRadius))
        : Math.max(6, Math.round(this.scale.nearRadius * 0.8)),
      huntDistDiag: isClassicHunt
        ? Math.max(24, Math.round(this.scale.farRadius * 0.8))
        : Math.max(14, Math.round(this.scale.midRadius * 0.8)),
      huntDistPostStr: isClassicHunt
        ? Math.max(24, Math.round(this.scale.farRadius * 0.8))
        : this.scale.farRadius,
      huntMaxTurnsToKill: isClassicHunt ? 8 : 4,
      huntMaxDamageRatio: isClassicHunt ? 0.25 : 0.15,
      huntMissionMaxTurns: Math.round(35 * (1 + 0.2 * mazeIndex)),
      huntNoExpAbortTurns: Math.max(10, 20 + mazeTurnAdj),
      huntNoGapCloseAbortTurns: Math.max(5, 8 + (mazeIndex > 0.5 ? 2 : opennessScore > 0.5 ? -1 : 0)),
      huntTrackMaxTurns: Math.max(8, 12 + (mazeIndex > 0.5 ? 3 : opennessScore > 0.5 ? -2 : 0)),
    };
    return tuning?.hunting ? { ...base, ...tuning.hunting } : base;
  }

  private resolveMissionPolicyParams(
    coinGrantsExp: boolean,
    tuning?: BotStrategyTuning
  ): MissionPolicyParams {
    const base: MissionPolicyParams = {
      ...DEFAULT_MISSION_POLICY_PARAMS,
      cooldownEarlyBreakNoProgress: !coinGrantsExp ? 15 : 50,
    };
    return tuning?.missionPolicy ? { ...base, ...tuning.missionPolicy } : base;
  }

  private resolveCommanderConfig(
    mazeIndex: number,
    sectorPartitionScore: number,
    tuning?: BotStrategyTuning
  ): CommanderConfig {
    const cmdScale = 1 + 0.25 * mazeIndex + 0.10 * sectorPartitionScore;
    const scaledProbation = { ...DEFAULT_COMMANDER_CONFIG.probationTurns };
    for (const key of Object.keys(scaledProbation) as Array<keyof typeof scaledProbation>) {
      if (scaledProbation[key] > 0) {
        scaledProbation[key] = Math.round(scaledProbation[key] * cmdScale);
      }
    }
    const base: CommanderConfig = {
      ...DEFAULT_COMMANDER_CONFIG,
      defaultGraceTurns: Math.round(DEFAULT_COMMANDER_CONFIG.defaultGraceTurns * cmdScale),
      loopNewTileTurns: Math.round(DEFAULT_COMMANDER_CONFIG.loopNewTileTurns * cmdScale),
      probationTurns: scaledProbation,
    };
    if (!tuning?.commander) return base;
    return {
      ...base,
      ...tuning.commander,
      probationTurns: {
        ...base.probationTurns,
        ...tuning.commander.probationTurns,
      },
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
    return isClassic ? 11000 : 401000;
  }

  /**
   * ルールモードに応じた目標防御力(EXP)の算出
   */
  public calculateTargetDefenseExp(isClassic?: boolean): number {
    if (isClassic) return 15000;
    return 35000;
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
