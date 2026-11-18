import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { IStrategicMission } from '../StrategicMission.js';
import { BootstrapSwordMission } from '../missions/BootstrapSwordMission.js';
import { EarlyBreakUnlockMission } from '../missions/EarlyBreakUnlockMission.js';
import { HarvestPowerStoneMission } from '../missions/HarvestPowerStoneMission.js';
import { ClearTreasureZoneMission } from '../missions/ClearTreasureZoneMission.js';
import { CashInGoldMission } from '../missions/CashInGoldMission.js';
import { SlayDragonMission } from '../missions/SlayDragonMission.js';
import { PrepareDragonAssaultMission } from '../missions/PrepareDragonAssaultMission.js';
import { RelocateHomeMission } from '../missions/RelocateHomeMission.js';
import { DragonReadinessAssessment, ReadinessEvaluator } from './ReadinessEvaluator.js';
import { CrownEscapeMission } from '../missions/CrownEscapeMission.js';
import { ExploreFrontierMission } from '../missions/ExploreFrontierMission.js';
import { StrategicBreakMission } from '../missions/StrategicBreakMission.js';
import type { ForcedMissionOrder, PhaseWaiver } from '../command/CommanderTypes.js';
import { Position } from '../../../models/Types.js';
import { WorldMap } from '../../../models/WorldMap.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { ThreatPlayerStats } from '../../../systems/ThreatEvaluator.js';
import { DEFAULT_MISSION_POLICY_PARAMS, DEFAULT_READINESS_PARAMS } from '../../TacticalContext.js';

/**
 * MissionSelector (大局的ミッション選定モジュール)
 *
 * プレイヤーの成長マイルストーン、所持リソース、空間トポロジー、および脅威状況に基づき、
 * 最適な長期的作戦（StrategicMission）を選定する。
 */
export class MissionSelector {
  public static createForcedMission(order: ForcedMissionOrder): IStrategicMission {
    if (order.kind === 'EXPLORE_FRONTIER') {
      return new ExploreFrontierMission(order.target);
    }
    return new StrategicBreakMission(order.mode, order.mode === 'BREACH' ? order.target : null);
  }

  public static selectNextMission(
    snapshot: TacticalSnapshot,
    engine: GameEngine,
    _graveSealDone: boolean,
    relocateDone?: boolean,
    prepTurns: number = 0,
    cooldownMissions?: Set<string>,
    precomputed?: { readyForDragon?: boolean; assessment?: DragonReadinessAssessment; waivers?: ReadonlySet<PhaseWaiver> }
  ): IStrategicMission {
    const player = engine.getPlayer();
    const map = snapshot.map;
    const dragon = engine.getDragon();
    const clearZoneOnCooldown = cooldownMissions?.has('CLEAR_TREASURE_ZONE') ?? false;
    const harvestOnCooldown = cooldownMissions?.has('HARVEST_POWER_STONE') ?? false;
    const earlyBreakOnCooldown = cooldownMissions?.has('EARLY_BREAK_UNLOCK') ?? false;
    const prepOnCooldown = cooldownMissions?.has('PREPARE_DRAGON_ASSAULT') ?? false;
    const cashInOnCooldown = cooldownMissions?.has('CASH_IN_GOLD') ?? false;

    // ① ドラゴン全首撃破済み -> 王冠脱出
    if (dragon && (dragon.isAllHeadsDefeated || dragon.heads.every(h => !h.isAlive))) {
      return new CrownEscapeMission();
    }

    // ② 剣未所持 -> 序盤の剣回収
    if (!player.hasSword) {
      return new BootstrapSwordMission();
    }

    // ③ パワーストーン所持中 -> クールダウン/タブー中でない限り最優先奉納（STR倍化＆HP全快＆コイン自動換金）
    if (!harvestOnCooldown && player.holdItem === 'POWER_STONE') {
      return new HarvestPowerStoneMission(player.pos);
    }

    const needStr = player.strength < snapshot.params.targetStr;
    const coinGrantsExp = snapshot.params.coinGrantsExp !== false;
    const isClassicInjuredHunt =
      !coinGrantsExp &&
      player.hp < player.experience &&
      EarlyBreakUnlockMission.isHpSafeForHunting(player, snapshot);

    // 足元にパワーストーンが存在する場合:
    // STR未達時で8歩周期チェーン継続可能（KEY所持かつ近傍宝箱あり＆既存石だけでSTR未到達＆歩数条件一致）なら開錠を継続し、そうでなければ回収奉納へ
    // ※CLASSIC負傷狩り中(HP < EXP かつ EXP < 4000)はHOME全快リセットを防ぐためスキップ
    const floorItem = map.getItem(player.pos);
    if (floorItem === 'POWER_STONE' && needStr && !(isClassicInjuredHunt && player.experience < 4000 && player.strength >= 2510)) {
      if (!MapSituationEvaluator.get(snapshot, engine).items.shouldContinueChestChain) {
        return new HarvestPowerStoneMission(player.pos);
      }
    }

    const canUnlockChests =
      (player.holdItem === 'KEY' || this.hasReachableKey(map, snapshot)) &&
      this.hasReachableChests(map, snapshot);
    const itemsAll = MapSituationEvaluator.get(snapshot, engine).items;

    // ★重要: STR目標達成後は宝箱開錠ループに留めず、直ちに決戦準備評価へ直行！
    const canDamageDragon = player.hasSword && !needStr;

    const mp = snapshot.params.missionPolicy ?? DEFAULT_MISSION_POLICY_PARAMS;

    if (!canDamageDragon) {
      // 序盤BREAK(EXP 4,000)解禁優先: 手ぶら(またはCLASSIC負傷狩り中で石以外)で安全敵がいれば最速でBREAK習得へ
      if (
        player.experience < 4000 &&
        (player.holdItem === 'NONE' || (isClassicInjuredHunt && player.holdItem !== 'POWER_STONE')) &&
        !earlyBreakOnCooldown &&
        EarlyBreakUnlockMission.isHpSafeForHunting(player, snapshot) &&
        this.hasSafeEnemyNearby(player, snapshot)
      ) {
        return new EarlyBreakUnlockMission(4000);
      }

      // ④-A. コイン換金帰還トリガー:
      // コインでEXPが増えるモード時のみ、マイルストーン到達または大量金貨で換金帰還する
      if (coinGrantsExp && player.gold > 0) {
        const estimatedGainedExp = player.gold * 300 + Math.floor(player.experience * 0.02 * player.gold);
        const afterExp = player.experience + estimatedGainedExp;
        const reachesMilestone = (player.experience < 4000 && afterExp >= 4000) || (player.experience < 12000 && afterExp >= 12000);
        const hasLargeGold = player.gold >= mp.coinCashInGoldThreshold;

        if (reachesMilestone || hasLargeGold) {
          // 鍵を持って周辺宝箱を開錠中（チェーン中）でなければ、またはコインが閾値以上溜まっていれば即換金
          const isActivelyChaining =
            player.holdItem === 'KEY' &&
            (itemsAll.shouldContinueChestChain || itemsAll.hasChestWithin2To8);
          if (!cashInOnCooldown && (!isActivelyChaining || player.gold >= mp.coinCashInChainGoldThreshold)) {
            return new CashInGoldMission(player.gold);
          }
        }
      }

      // ④-B. 鍵所持中（holdItem === 'KEY'）: 宝物庫ゾーン・残存宝箱の一括開錠を最優先
      if (!clearZoneOnCooldown && player.holdItem === 'KEY') {
        const nearestZone = snapshot.spatial.getNearestUnclearedTreasureZone(player.pos, map, snapshot.memory, snapshot.totalTurns);
        if (nearestZone) {
          return new ClearTreasureZoneMission(nearestZone.id);
        }
        if (this.hasReachableChests(map, snapshot)) {
          return new ClearTreasureZoneMission('GLOBAL_ALL');
        }
      }

      // ④-C. 手ぶら時（holdItem === 'NONE'）の資源回収:
      // ※CLASSIC負傷狩り中(HP < EXP かつ EXP < 4000)は、HOME全快リセットを防ぐため石回収を控える
      const allowStoneHarvestNow = !(isClassicInjuredHunt && player.experience < 4000 && player.strength >= 2510);
      if (player.holdItem === 'NONE') {
        const nearestStone = this.findNearestPowerStone(player.pos, map, snapshot);
        const distStone = nearestStone ? map.getTorusDistance(player.pos, nearestStone).manhattan : Infinity;

        // STR未達時かつ近傍（stoneSearchDist以内）に石がある場合のみ石回収・奉納を優先
        if (allowStoneHarvestNow && !harvestOnCooldown && needStr && nearestStone && distStone <= snapshot.params.stoneSearchDist) {
          return new HarvestPowerStoneMission(nearestStone);
        }

        // 未開封宝箱・鍵が存在する場合は宝箱攻略を最優先！
        if (!clearZoneOnCooldown && canUnlockChests && !(isClassicInjuredHunt && player.experience < 4000)) {
          const nearestZone = snapshot.spatial.getNearestUnclearedTreasureZone(player.pos, map, snapshot.memory, snapshot.totalTurns);
          if (nearestZone) return new ClearTreasureZoneMission(nearestZone.id);
          return new ClearTreasureZoneMission('GLOBAL_ALL');
        }

        // 到達可能な宝箱が枯渇している場合のみ、残存石の回収へ
        if (allowStoneHarvestNow && !harvestOnCooldown && needStr && nearestStone) {
          return new HarvestPowerStoneMission(nearestStone);
        }
      }

      // ④-D. 到達可能な宝箱・鍵・石が無く、EXP < 4000 (BREAK未習得) の場合はEXP獲得手段へ
      if (player.experience < 4000) {
        if (coinGrantsExp) {
          if (!cashInOnCooldown && player.gold > 0) {
            return new CashInGoldMission(player.gold);
          }
          if (!prepOnCooldown && player.holdItem === 'NONE' && itemsAll.nearestCoin !== null) {
            return new PrepareDragonAssaultMission();
          }
        } else if (!earlyBreakOnCooldown && this.hasSafeEnemyNearby(player, snapshot)) {
          return new EarlyBreakUnlockMission(4000);
        }
      }
    }

    // ④ STR達成済み: 決戦準備評価（EXP育成・MP備蓄・コイン換金・移転）
    // ※要件1: 5条件（攻撃力・斜め移動・BREAK・MP>=3・HP十分）をすべて満たすまで絶対に SlayDragonMission を起動しない
    if (canDamageDragon) {
      const prepMission = this.selectDragonPrepMission(snapshot, engine, {
        relocateDone,
        prepTurns,
        cooldownMissions,
        prioritizeImmediateSlay: false,
        includeHeldKeyInChestCheck: true,
        precomputedReady: precomputed?.readyForDragon,
        precomputedAssessment: precomputed?.assessment,
        waivers: precomputed?.waivers,
      });
      if (prepMission) {
        return prepMission;
      }
    }

    // ④-C. STR達成済みだが防御EXPが不足 -> 安全な敵を狩って防御EXP稼ぎ (ワンパン撃破で大量EXP獲得)
    if (
      snapshot.milestones.hasTargetStr &&
      !snapshot.milestones.hasTargetDefenseExp &&
      player.holdItem !== 'KEY' &&
      !earlyBreakOnCooldown &&
      this.hasSafeEnemyNearby(player, snapshot)
    ) {
      return new EarlyBreakUnlockMission(snapshot.params.targetDefenseExp);
    }

    // ⑤ BREAK未習得 (EXP < 4000) かつ鍵未所持かつ近傍に安全な敵がいる -> 敵を狩って最速解禁
    // （※鍵所持中は宝箱開錠を最優先し、手ぶらの移動中のみEXP稼ぎを行う）
    if (player.experience < 4000 && player.holdItem !== 'KEY' && !earlyBreakOnCooldown && this.hasSafeEnemyNearby(player, snapshot)) {
      return new EarlyBreakUnlockMission();
    }

    // ⑥ コイン換金帰還判定:
    // コインでEXPが増えるモード時のみ、マイルストーン到達または一定枚数で帰還
    if (coinGrantsExp && player.gold > 0) {
      const estimatedGainedExp = player.gold * 300 + Math.floor(player.experience * 0.02 * player.gold);
      const afterExp = player.experience + estimatedGainedExp;
      const hitsMilestone =
        (player.experience < 2000 && afterExp >= 2000) ||
        (player.experience < 4000 && afterExp >= 4000) ||
        (player.experience < 12000 && afterExp >= 12000) ||
        (afterExp >= snapshot.params.targetDefenseExp);

      // STR達成済みでEXP 12,000未満の時は、コインが1枚でもあれば早期決戦移行のため即座に換金
      const needExpForDragon = player.experience < 12000 && snapshot.milestones.hasTargetStr;

      if (!cashInOnCooldown && (hitsMilestone || player.gold >= mp.coinCashInLateGoldThreshold || (needExpForDragon && player.gold >= 1))) {
        return new CashInGoldMission(player.gold);
      }
    }

    // ⑦ 宝物庫ゾーン攻略 (未攻略かつ到達可能なゾーンがあり、鍵を所持しているか回収可能な場合)
    if (!clearZoneOnCooldown && canUnlockChests) {
      const nearestZone = snapshot.spatial.getNearestUnclearedTreasureZone(player.pos, map, snapshot.memory, snapshot.totalTurns);
      if (nearestZone) {
        return new ClearTreasureZoneMission(nearestZone.id);
      }

      // ⑧-B. ゾーン外または全ゾーン攻略後の残存宝箱攻略
      if (this.hasReachableChests(map, snapshot)) {
        return new ClearTreasureZoneMission('GLOBAL_ALL');
      }
    }

    // ⑨ 孤立したパワーストーンの回収（STR目標未達時のみ）
    if (!canDamageDragon) {
      const stonePos = !harvestOnCooldown ? this.findNearestPowerStone(player.pos, map, snapshot) : null;
      if (stonePos) {
        return new HarvestPowerStoneMission(stonePos);
      }
    }

    // ⑩ フォールバック: 未踏フロンティア遠征探索
    return new ExploreFrontierMission();
  }

  public static hasReachableChests(_map: WorldMap, snapshot: TacticalSnapshot): boolean {
    return MapSituationEvaluator.get(snapshot).items.chests.length > 0;
  }

  public static hasSafeEnemyNearby(
    player: ThreatPlayerStats & { pos: Position; canDiagonal?: boolean },
    snapshot: TacticalSnapshot,
    maxDistOverride?: number
  ): boolean {
    const targetExp = snapshot.milestones?.hasTargetStr ? snapshot.params.targetDefenseExp : 4000;
    return (
      EarlyBreakUnlockMission.findNearestSafeEnemy(player, snapshot, targetExp, maxDistOverride) !== null ||
      EarlyBreakUnlockMission.findFlashKillCandidate(player, snapshot) !== null ||
      EarlyBreakUnlockMission.findFreezeKillCandidate(player, snapshot) !== null
    );
  }

  public static findNearestPowerStone(fromPos: Position, map: WorldMap, snapshot: TacticalSnapshot): Position | null {
    const items = MapSituationEvaluator.get(snapshot).items;
    if (fromPos.x === snapshot.player.pos.x && fromPos.y === snapshot.player.pos.y) {
      return items.nearestPowerStone;
    }
    let nearest: Position | null = null;
    let minDist = Infinity;
    for (const p of items.powerStones) {
      const d = map.getTorusDistance(fromPos, p).manhattan;
      if (d < minDist) {
        minDist = d;
        nearest = p;
      }
    }
    return nearest;
  }

  public static hasNearbyChest(pos: Position, map: WorldMap, maxDist: number, snapshot?: TacticalSnapshot): boolean {
    if (!snapshot) return false;
    const items = MapSituationEvaluator.get(snapshot).items;
    if (pos.x === snapshot.player.pos.x && pos.y === snapshot.player.pos.y && maxDist === 8) {
      return items.hasChestWithin2To8;
    }
    return items.chests.some(c => {
      const d = map.getTorusDistance(pos, c).manhattan;
      return d >= 2 && d <= maxDist;
    });
  }

  public static hasReachableKey(_map: WorldMap, snapshot: TacticalSnapshot): boolean {
    return MapSituationEvaluator.get(snapshot).items.keys.length > 0;
  }

  public static findNearestAvailableKey(fromPos: Position, map: WorldMap, snapshot: TacticalSnapshot): Position | null {
    const items = MapSituationEvaluator.get(snapshot).items;
    if (fromPos.x === snapshot.player.pos.x && fromPos.y === snapshot.player.pos.y) {
      return items.nearestKey;
    }
    let minDist = Infinity;
    let nearest: Position | null = null;
    for (const p of items.keys) {
      const d = map.getTorusDistance(fromPos, p).manhattan;
      if (d < minDist) {
        minDist = d;
        nearest = p;
      }
    }
    return nearest;
  }

  public static isReadyForDragon(
    snapshot: TacticalSnapshot,
    engine: GameEngine,
    prepTurns: number = 0,
    waivers?: ReadonlySet<PhaseWaiver>
  ): boolean {
    const player = engine.getPlayer();
    const dragon = engine.getDragon();
    const hasSword = player.hasSword;
    const livingHeads = dragon ? dragon.heads.filter(h => h.isAlive) : [];
    const maxHeadDef = livingHeads.length > 0 ? Math.max(...livingHeads.map(h => h.def)) : 400000;
    const canDamageAllHeads = hasSword && (
      snapshot.milestones.hasTargetStr ||
      snapshot.milestones.isStrCapped ||
      player.strength >= snapshot.params.targetStr ||
      player.strength > maxHeadDef
    );
    const canDiagonal = player.experience >= 12000 || player.canDiagonal || snapshot.milestones.canDiagonal;
    const canBreak = !player.hasDeath && player.magic >= 1 && player.experience >= 4000;
    const items = MapSituationEvaluator.get(snapshot).items;
    const noReachablePotion = items.nearbyPotionCountWithin15 === 0 && items.nearestPotion === null;
    const waiveMagic = waivers?.has('MAGIC_STOCK') ?? false;
    const waiveDefense = waivers?.has('DEFENSE_EXP') ?? false;
    const waiveHpFull = waivers?.has('HP_FULL') ?? false;

    const r = snapshot.params.readiness ?? DEFAULT_READINESS_PARAMS;
    const hasDragonAssaultMagic = player.magic >= 3 || ((noReachablePotion || waiveMagic) && player.magic >= 1);
    const hasEnoughHp = waiveHpFull
      ? (player.hp >= player.maxHp * r.readyHpRatioWaived || player.hp >= r.readyHpMinWaived)
      : (player.hp >= player.maxHp * r.readyHpRatioNormal || player.hp >= r.readyHpMinNormal);

    // 防御力（EXP）の適正判定: ドラゴン決戦で即死しないための十分なEXP
    const requiredDefenseExp = snapshot.params.targetDefenseExp ?? 12000;
    const hasEnoughDefense =
      waiveDefense ||
      player.experience >= requiredDefenseExp ||
      (canDiagonal && (
        prepTurns >= r.readyDefenseFallbackPrepTurns ||
        snapshot.totalTurns >= r.readyDefenseFallbackTotalTurns ||
        (noReachablePotion && player.gold === 0)
      ));

    return canDamageAllHeads && canDiagonal && canBreak && hasDragonAssaultMagic && hasEnoughHp && hasEnoughDefense;
  }

  /**
   * 決戦準備・決戦移行ミッションの統合選定ロジック
   * （通常選定 ④ と 緊急割り込み 1-C の双方から利用し、重複評価を排除する）
   */
  public static selectDragonPrepMission(
    snapshot: TacticalSnapshot,
    engine: GameEngine,
    options: {
      relocateDone?: boolean;
      prepTurns?: number;
      cooldownMissions?: Set<string>;
      prioritizeImmediateSlay?: boolean;
      includeHeldKeyInChestCheck?: boolean;
      precomputedReady?: boolean;
      precomputedAssessment?: DragonReadinessAssessment;
      waivers?: ReadonlySet<PhaseWaiver>;
    } = {}
  ): IStrategicMission | null {
    const player = engine.getPlayer();
    const map = snapshot.map;
    const prepTurns = options.prepTurns ?? 0;
    const cooldownMissions = options.cooldownMissions;
    const clearZoneOnCooldown = cooldownMissions?.has('CLEAR_TREASURE_ZONE') ?? false;
    const earlyBreakOnCooldown = cooldownMissions?.has('EARLY_BREAK_UNLOCK') ?? false;
    const prepOnCooldown = cooldownMissions?.has('PREPARE_DRAGON_ASSAULT') ?? false;
    const slayOnCooldown = cooldownMissions?.has('SLAY_DRAGON') ?? false;
    const cashInOnCooldown = cooldownMissions?.has('CASH_IN_GOLD') ?? false;

    const itemsAll = MapSituationEvaluator.get(snapshot, engine).items;
    const assessment = options.precomputedAssessment ?? ReadinessEvaluator.evaluateDragonReadiness(snapshot, engine, prepTurns, options.waivers);
    const readyForDragon = options.precomputedReady ?? this.isReadyForDragon(snapshot, engine, prepTurns, options.waivers);

    if (options.prioritizeImmediateSlay && readyForDragon && (assessment.isFullyPrepared || prepOnCooldown) && !slayOnCooldown) {
      return new SlayDragonMission();
    }

    const r = snapshot.params.readiness ?? DEFAULT_READINESS_PARAMS;
    const mp = snapshot.params.missionPolicy ?? DEFAULT_MISSION_POLICY_PARAMS;
    const coinGrantsExp = snapshot.params.coinGrantsExp !== false;

    // 1. EXP不足 (< 12,000 または BREAK/斜め未習得)
    if (player.experience < 12000 || !snapshot.milestones.canDiagonal || !snapshot.milestones.canBreak) {
      if (coinGrantsExp) {
        const estimatedGainedExp = player.gold * 300 + Math.floor(player.experience * 0.02 * player.gold);
        const hitsBreak = player.experience < 4000 && player.experience + estimatedGainedExp >= 4000;
        if (
          !cashInOnCooldown &&
          player.gold > 0 &&
          (player.experience + estimatedGainedExp >= 12000 || hitsBreak || player.gold >= mp.coinCashInPrepGoldThreshold)
        ) {
          return new CashInGoldMission(player.gold);
        }
        // 逃走敵追跡より確実な床コイン回収・一括換金を最優先
        if (!prepOnCooldown && itemsAll.nearestCoin !== null) {
          return new PrepareDragonAssaultMission();
        }
        if (!cashInOnCooldown && player.gold > 0) {
          return new CashInGoldMission(player.gold);
        }
      }
      const skipChestForClassicHunt = !coinGrantsExp && player.hp < player.experience && player.experience < 12000;
      const hasKey = options.includeHeldKeyInChestCheck ? (player.holdItem === 'KEY' || this.hasReachableKey(map, snapshot)) : this.hasReachableKey(map, snapshot);
      const canUnlockChests = hasKey && this.hasReachableChests(map, snapshot);
      const holdingKeyWithChests = player.holdItem === 'KEY' && canUnlockChests && !clearZoneOnCooldown && !skipChestForClassicHunt;

      if (!coinGrantsExp) {
        // 非指数・コインEXPなしモード: 鍵保持＋開けられる宝箱がある場合は近場の狩り(<=5)またはFLASH/FREEZE候補のみ優先し、遠距離狩りとのCHURNを防ぐ
        const huntDistCap = holdingKeyWithChests ? 5 : undefined;
        const hasImmediateMagicKill =
          EarlyBreakUnlockMission.findFreezeKillCandidate(player, snapshot) !== null ||
          EarlyBreakUnlockMission.findFlashKillCandidate(player, snapshot) !== null;
        const hasHuntTarget =
          hasImmediateMagicKill ||
          EarlyBreakUnlockMission.findNearestSafeEnemy(
            player,
            snapshot,
            Math.max(12000, snapshot.params.targetDefenseExp),
            huntDistCap
          ) !== null;
        if (
          !earlyBreakOnCooldown &&
          EarlyBreakUnlockMission.isHpSafeForHunting(player, snapshot) &&
          hasHuntTarget
        ) {
          return new EarlyBreakUnlockMission(Math.max(12000, snapshot.params.targetDefenseExp));
        }
      }

      if (!clearZoneOnCooldown && canUnlockChests && !skipChestForClassicHunt) {
        if (options.prioritizeImmediateSlay) {
          return null;
        }
        const nearestZone = snapshot.spatial.getNearestUnclearedTreasureZone(player.pos, map, snapshot.memory, snapshot.totalTurns);
        if (nearestZone) return new ClearTreasureZoneMission(nearestZone.id);
        return new ClearTreasureZoneMission('GLOBAL_ALL');
      }
      if (
        !earlyBreakOnCooldown &&
        EarlyBreakUnlockMission.isHpSafeForHunting(player, snapshot) &&
        this.hasSafeEnemyNearby(player, snapshot)
      ) {
        return new EarlyBreakUnlockMission(Math.max(12000, snapshot.params.targetDefenseExp));
      }
      if (options.prioritizeImmediateSlay) {
        return null;
      }
    }

    // 1-C. 前線移転条件合致時（安全な家を増やすため距離に関わらずMP備蓄等より先に実施）
    if (assessment.needsRelocation && !options.relocateDone && (player.holdItem === 'RING' || ReadinessEvaluator.hasMapRing(map, snapshot))) {
      const anchor = RelocateHomeMission.selectBestAnchor(snapshot, engine);
      if (anchor) {
        return new RelocateHomeMission(anchor);
      }
    }

    // 2. MP不足 (< 3) または ポーション/コイン回収が必要（枯渇またはクールダウン時はスキップ）
    const noReachablePotion = itemsAll.nearbyPotionCountWithin15 === 0 && itemsAll.nearestPotion === null;
    if (
      !prepOnCooldown &&
      ((!noReachablePotion && player.magic < 3) || assessment.needsPotionSweep || assessment.needsCoinSweep)
    ) {
      return new PrepareDragonAssaultMission();
    }

    // 2-B. 王冠フェーズ用の余剰MP備蓄のため、残存宝箱を開錠する
    if (!clearZoneOnCooldown && assessment.needsTreasureMpFarm && !options.prioritizeImmediateSlay) {
      const nearestZone = snapshot.spatial.getNearestUnclearedTreasureZone(player.pos, map, snapshot.memory, snapshot.totalTurns);
      if (nearestZone) return new ClearTreasureZoneMission(nearestZone.id);
      if (this.hasReachableChests(map, snapshot)) {
        return new ClearTreasureZoneMission('GLOBAL_ALL');
      }
    }

    // 3. コイン換金が必要
    if (!cashInOnCooldown && (assessment.needsGoldCashIn || (coinGrantsExp && player.gold > 0))) {
      return new CashInGoldMission(player.gold);
    }

    // 5. HP十分性チェック
    if (!prepOnCooldown && player.hp < player.maxHp * r.readyHpRatioNormal && player.hp < r.readyHpMinNormal) {
      return new PrepareDragonAssaultMission();
    }

    // 6. 全条件を満たした場合のみ決戦起動
    if (!slayOnCooldown && readyForDragon && (options.prioritizeImmediateSlay || assessment.isFullyPrepared || prepOnCooldown)) {
      return new SlayDragonMission();
    }

    return null;
  }
}
