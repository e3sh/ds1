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
  DynamicBotParameters,
  TacticalScale,
  BotStrategyTuning,
} from './BotTypes.js';

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
    options?: { totalTurns?: number; defensePrepTurns?: number; strategyTuning?: BotStrategyTuning }
  ): DynamicBotParameters {
    const isClassic = this.tuning?.progressionConfig?.ruleMode === 'CLASSIC';
    const mazeIndex = this.metrics?.mazeIndex ?? 0.3;

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
    let targetDefenseExp = this.calculateTargetDefenseExp(isClassic);

    // 強敵がいる場合: 最大ATKに耐えられるよう目標防御EXPを動的引き上げ
    if (maxNearEnemyAtk > targetDefenseExp) {
      targetDefenseExp = Math.max(targetDefenseExp, maxNearEnemyAtk + 2000);
    }

    // 滞留防止フィードバック: 防御準備ターンや総ターンがかさんだ場合は早期切り上げ (TIMEOUT_STALL防止)
    const defensePrepTurns = options?.defensePrepTurns ?? 0;
    const totalTurns = options?.totalTurns ?? 0;
    if (phase === 'RESOURCE_FARM' && (defensePrepTurns > 80 || totalTurns > 1800)) {
      targetDefenseExp = Math.min(targetDefenseExp, Math.max(player.experience, 12000));
    }

    const graveSealEarlyStr = isClassic ? 2500 : 30000;
    const defaultTargetMagic = this.profile === 'NOVICE' ? 8 : 14;
    const maxTargetMagic = options?.strategyTuning?.maxTargetMagic ?? defaultTargetMagic;
    const minDragonMagic = this.profile === 'NOVICE' ? 2 : 3;

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
    const coinSearchDist = needDefenseExp
      ? Math.max(20, this.scale.farRadius)
      : this.scale.immediateRadius;

    // 敵狩り許容距離:
    // BREAK (EXP 4,000) 未習得時のみ最速解禁のために極近傍の安全敵狩りを許可。
    // EXP 4,000 以降はキルランク上昇による強敵湧きを防ぐため無目的な敵狩りを完全禁止 (huntDistance = 0)。
    let huntDistance = 0;
    if (player.hasSword && player.experience < 4000) {
      huntDistance = player.holdItem !== 'KEY' ? this.scale.immediateRadius : 0;
    }

    // 5. ナビゲーション・BFSコスト
    // 迷路度が高い場合は壁破壊（BREAK）をより積極的に幹線道路として活用
    const allowBreakAsRoad = player.experience >= 4000;
    const breakCostMultiplier = mazeIndex > 0.5 ? 1.1 : 1.6;
    const warpAvoidanceCost = this.scale.nearRadius * 2;
    // マップ面積に比例したBFSステップ上限
    const maxBfsSteps = Math.min(6000, Math.max(3000, this.scale.width * this.scale.height * 2));

    // 6. 戦術ポリシー
    const enableHomeRelocation = this.profile !== 'NOVICE';
    const homeRelocateDistMin = Math.max(4, Math.round(this.scale.nearRadius * 0.5));
    const homeRelocateDistMax = Math.max(7, Math.round(this.scale.nearRadius * 0.8));

    // 墓封鎖ポリシーの推奨値判定（マップ幾何メトリクス＆資源数連動）
    let graveSealPolicy: 'AUTO' | 'NONE' | 'NEAR_HOME' | 'ALL' = 'NEAR_HOME';
    if (this.metadata?.recommendedBotTuning?.graveSealPolicy) {
      graveSealPolicy = this.metadata.recommendedBotTuning.graveSealPolicy;
    } else {
      const nearGraves = this.metrics?.nearHomeGraves ?? 1;
      const hasTools = this.resourceCounts.crossCount > 0 || this.resourceCounts.ringCount > 0;
      if (!hasTools || nearGraves === 0) {
        graveSealPolicy = 'NONE';
      } else if (nearGraves > 0) {
        graveSealPolicy = 'NEAR_HOME';
      } else if (this.resourceCounts.crossCount >= 3 && mazeIndex > 0.4) {
        graveSealPolicy = 'ALL';
      }
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
    const minHeadDef = livingHeads.length > 0 ? Math.min(...livingHeads.map(h => h.def)) : 0;
    if (minHeadDef > 0) {
      return minHeadDef + 1000;
    }
    return isClassic ? 11000 : 301000;
  }

  /**
   * ルールモードに応じた目標防御力(EXP)の算出
   */
  public calculateTargetDefenseExp(isClassic?: boolean): number {
    if (isClassic) return 12000;
    return 18000;
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
