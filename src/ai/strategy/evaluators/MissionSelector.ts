import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { IStrategicMission } from '../StrategicMission.js';
import { BootstrapSwordMission } from '../missions/BootstrapSwordMission.js';
import { EarlyBreakUnlockMission } from '../missions/EarlyBreakUnlockMission.js';
import { HarvestPowerStoneMission } from '../missions/HarvestPowerStoneMission.js';
import { ClearTreasureZoneMission } from '../missions/ClearTreasureZoneMission.js';
import { CashInGoldMission } from '../missions/CashInGoldMission.js';
import { SealGraveMission } from '../missions/SealGraveMission.js';
import { SlayDragonMission } from '../missions/SlayDragonMission.js';
import { PrepareDragonAssaultMission } from '../missions/PrepareDragonAssaultMission.js';
import { RelocateHomeMission } from '../missions/RelocateHomeMission.js';
import { ReadinessEvaluator } from './ReadinessEvaluator.js';
import { CrownEscapeMission } from '../missions/CrownEscapeMission.js';
import { ExploreWanderMission } from '../missions/ExploreWanderMission.js';
import { Position } from '../../../models/Types.js';
import { WorldMap } from '../../../models/WorldMap.js';
import { ThreatEvaluator } from '../../../systems/ThreatEvaluator.js';

/**
 * MissionSelector (大局的ミッション選定モジュール)
 *
 * プレイヤーの成長マイルストーン、所持リソース、空間トポロジー、および脅威状況に基づき、
 * 最適な長期的作戦（StrategicMission）を選定する。
 */
export class MissionSelector {
  public static selectNextMission(
    snapshot: TacticalSnapshot,
    engine: GameEngine,
    graveSealDone: boolean,
    relocateDone?: boolean,
    prepTurns: number = 0
  ): IStrategicMission {
    const player = engine.getPlayer();
    const map = snapshot.map;
    const dragon = engine.getDragon();

    // ① ドラゴン全首撃破済み -> 王冠脱出
    if (dragon && (dragon.isAllHeadsDefeated || dragon.heads.every(h => !h.isAlive))) {
      return new CrownEscapeMission();
    }

    // ② 剣未所持 -> 序盤の剣回収
    if (!player.hasSword) {
      return new BootstrapSwordMission();
    }

    const canUnlockChests = this.hasReachableKey(map, snapshot) && this.hasReachableChests(map, snapshot);

    // ★重要: STR目標達成 かつ 防御EXP（DEF）目標達成 かつ 斜め移動解禁済みの場合は、
    // 残存宝箱開錠や石集めを打ち切り、直ちに決戦準備評価へ直行！
    const canDamageDragon = player.hasSword && (player.strength >= snapshot.params.targetStr || snapshot.milestones.isStrCapped || snapshot.milestones.hasTargetStr);
    const hasEnoughDefense = player.experience >= Math.max(25000, snapshot.params.targetDefenseExp);
    const hasDiagonal = snapshot.milestones.canDiagonal;

    if (!canDamageDragon || !hasEnoughDefense || !hasDiagonal) {
      // ②-B. 鍵所持中（holdItem === 'KEY'）: 宝物庫ゾーン・残存宝箱の一括開錠を最優先
      if (player.holdItem === 'KEY') {
        const nearestZone = snapshot.spatial.getNearestUnclearedTreasureZone(player.pos, map, snapshot.memory, snapshot.totalTurns);
        if (nearestZone) {
          return new ClearTreasureZoneMission(nearestZone.id);
        }
        if (this.hasReachableChests(map, snapshot)) {
          return new ClearTreasureZoneMission('GLOBAL_ALL');
        }
      }

      // ②-C. 手ぶら時（holdItem === 'NONE'）の距離・安全優先制御:
      // 目の前や近傍にある資源を優先し、遠くの石や遠くの鍵に惑わされず最寄りの育成行動を選択
      if (player.holdItem === 'NONE') {
        const nearestStone = this.findNearestPowerStone(player.pos, map, snapshot);
        const nearestKey = this.findNearestAvailableKey(player.pos, map, snapshot);
        const nearestZone = snapshot.spatial.getNearestUnclearedTreasureZone(player.pos, map, snapshot.memory, snapshot.totalTurns);

        const distStone = nearestStone ? map.getTorusDistance(player.pos, nearestStone).manhattan : Infinity;
        const distKey = nearestKey ? map.getTorusDistance(player.pos, nearestKey).manhattan : Infinity;
        const distZone = nearestZone ? map.getTorusDistance(player.pos, {
          x: Math.floor((nearestZone.bounds.x1 + nearestZone.bounds.x2) / 2),
          y: Math.floor((nearestZone.bounds.y1 + nearestZone.bounds.y2) / 2),
        }).manhattan : Infinity;

        // 宝箱や鍵が近くにあり（<=8歩）、石が遠い場合は宝箱攻略を優先
        const hasCloseChestOrKey = (distKey <= 8 || distZone <= 10) && canUnlockChests;
        const isStoneCloser = nearestStone && (distStone <= distKey && distStone <= distZone);

        if (isStoneCloser || (!hasCloseChestOrKey && nearestStone)) {
          return new HarvestPowerStoneMission(nearestStone);
        }

        if (hasCloseChestOrKey) {
          if (nearestZone) return new ClearTreasureZoneMission(nearestZone.id);
          return new ClearTreasureZoneMission('GLOBAL_ALL');
        }
      }

      // ③ パワーストーン所持中または足元に存在 -> パワーストーン奉納
      if (player.holdItem === 'POWER_STONE') {
        return new HarvestPowerStoneMission(player.pos);
      }
      const floorItem = map.getItem(player.pos);
      if (floorItem === 'POWER_STONE') {
        const canChain = player.holdItem === 'KEY' && this.hasNearbyChest(player.pos, map, 8);
        if (!canChain) {
          return new HarvestPowerStoneMission(player.pos);
        }
      }
    }

    // ④ STR達成済みまたはカンスト時: 決戦準備評価（MP備蓄・コイン換金・移転）
    // ※要件1: 5条件（攻撃力・斜め移動・BREAK・MP>=3・HP十分）をすべて満たすまで絶対に SlayDragonMission を起動しない
    const needAssaultPrep = canDamageDragon;
    if (needAssaultPrep) {
      const assessment = ReadinessEvaluator.evaluateDragonReadiness(snapshot, engine, prepTurns);
      const readyForDragon = this.isReadyForDragon(snapshot, engine);

      // 1. EXP不足 (< 12,000 または BREAK未習得)
      if (player.experience < 12000 || !snapshot.milestones.canDiagonal || !snapshot.milestones.canBreak) {
        if (player.gold > 0) {
          return new CashInGoldMission(player.gold);
        }
        if (this.hasSafeEnemyNearby(player, snapshot)) {
          return new EarlyBreakUnlockMission(12000);
        }
      }

      // 2. MP不足 (< 3) または ポーション回収が必要
      if (player.magic < 3 || assessment.needsPotionSweep) {
        return new PrepareDragonAssaultMission();
      }

      // 3. コイン換金が必要
      if (assessment.needsGoldCashIn || player.gold > 0) {
        return new CashInGoldMission(player.gold);
      }

      // 4. 前線移転条件合致時
      if (assessment.needsRelocation && !relocateDone && (player.holdItem === 'RING' || ReadinessEvaluator.hasMapRing(map, snapshot))) {
        const anchor = snapshot.spatial.recommendedRelocateAnchors[0] ?? { x: 32, y: 25 };
        return new RelocateHomeMission(anchor);
      }

      // 5. HP十分性チェック
      if (player.hp < player.maxHp * 0.5 && player.hp < 15000) {
        return new PrepareDragonAssaultMission();
      }

      // 6. 全条件を満たした場合のみ決戦起動
      if (readyForDragon && assessment.isFullyPrepared) {
        return new SlayDragonMission();
      }
    }

    // ④-C. STR達成済みだが防御EXPが不足 -> 安全な敵を狩って防御EXP稼ぎ (ワンパン撃破で大量EXP獲得)
    if (
      snapshot.milestones.hasTargetStr &&
      !snapshot.milestones.hasTargetDefenseExp &&
      player.holdItem !== 'KEY' &&
      this.hasSafeEnemyNearby(player, snapshot)
    ) {
      return new EarlyBreakUnlockMission(snapshot.params.targetDefenseExp);
    }

    // ⑤ BREAK未習得 (EXP < 4000) かつ鍵未所持かつ近傍に安全な敵がいる -> 敵を狩って最速解禁
    // （※鍵所持中は宝箱開錠を最優先し、手ぶらの移動中のみEXP稼ぎを行う）
    if (player.experience < 4000 && player.holdItem !== 'KEY' && this.hasSafeEnemyNearby(player, snapshot)) {
      return new EarlyBreakUnlockMission();
    }

    // ⑥ コイン換金帰還判定:
    // 手持ちコインを換金すれば重要マイルストーンに到達できる、またはコインが一定枚数以上
    if (player.gold > 0) {
      const estimatedGainedExp = player.gold * 300 + Math.floor(player.experience * 0.02 * player.gold);
      const afterExp = player.experience + estimatedGainedExp;
      const hitsMilestone =
        (player.experience < 2000 && afterExp >= 2000) ||
        (player.experience < 4000 && afterExp >= 4000) ||
        (player.experience < 12000 && afterExp >= 12000) ||
        (afterExp >= snapshot.params.targetDefenseExp);

      // STR達成済みでEXP 12,000未満の時は、コインが1枚でもあれば早期決戦移行のため即座に換金
      const needExpForDragon = player.experience < 12000 && snapshot.milestones.hasTargetStr;

      if (hitsMilestone || player.gold >= 4 || (needExpForDragon && player.gold >= 1)) {
        return new CashInGoldMission(player.gold);
      }
    }

    // ⑦ 墓封鎖 (序盤ポリシーが有効かつSTRが基準値以上)
    if (
      !graveSealDone &&
      snapshot.params.graveSealPolicy !== 'NONE' &&
      player.strength >= snapshot.params.graveSealEarlyStr &&
      (!dragon || dragon.defeatedHeadsCount === 0)
    ) {
      const unsealedPuzzles = snapshot.spatial.getUnsealedGravePuzzles();
      const highPriority = unsealedPuzzles.find(
        p => p.priority === 'HIGH' && !snapshot.memory.isTargetUnreachable(p.gravePos, snapshot.totalTurns)
      );
      if (highPriority) {
        return new SealGraveMission(highPriority.gravePos);
      }
    }

    // ⑧ 宝物庫ゾーン攻略 (未攻略かつ到達可能なゾーンがあり、鍵を所持しているか回収可能な場合)
    if (canUnlockChests) {
      const nearestZone = snapshot.spatial.getNearestUnclearedTreasureZone(player.pos, map, snapshot.memory, snapshot.totalTurns);
      if (nearestZone) {
        return new ClearTreasureZoneMission(nearestZone.id);
      }

      // ⑧-B. ゾーン外または全ゾーン攻略後の残存宝箱攻略
      if (this.hasReachableChests(map, snapshot)) {
        return new ClearTreasureZoneMission('GLOBAL_ALL');
      }
    }

    // ⑨ 孤立したパワーストーンの回収
    const stonePos = this.findNearestPowerStone(player.pos, map, snapshot);
    if (stonePos) {
      return new HarvestPowerStoneMission(stonePos);
    }

    // ⑩ フォールバック: 安全探索徘徊
    return new ExploreWanderMission();
  }

  public static hasReachableChests(map: WorldMap, snapshot: TacticalSnapshot): boolean {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (map.getObject(p) === 'CHEST' && !snapshot.memory.isTargetUnreachable(p, snapshot.totalTurns)) {
          return true;
        }
      }
    }
    return false;
  }

  public static hasSafeEnemyNearby(player: any, snapshot: TacticalSnapshot): boolean {
    const map = snapshot.map;
    const maxDist = snapshot.milestones.hasTargetStr ? 30 : 16;
    return snapshot.livingEnemies.some(enemy => {
      if (!enemy.isAlive || enemy.isPermanentlyFrozen) return false;
      if (snapshot.memory.isTargetUnreachable(enemy.pos, snapshot.totalTurns)) return false;
      const dist = map.getTorusDistance(player.pos, enemy.pos).manhattan;
      if (dist > maxDist) return false;
      const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
      const isDefenseSafe = details.defenseThreat === 'NO_DAMAGE' || (
        details.defenseThreat !== 'LETHAL' &&
        !details.hasDrain &&
        details.damageToPlayer < player.hp * 0.15
      );
      if (!isDefenseSafe) return false;
      return details.attackThreat === 'ONE_SHOT' || details.turnsToKill <= 4;
    });
  }

  public static findNearestPowerStone(fromPos: Position, map: WorldMap, snapshot: TacticalSnapshot): Position | null {
    let nearest: Position | null = null;
    let minDist = Infinity;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (map.getItem(p) === 'POWER_STONE' && !snapshot.memory.isTargetUnreachable(p, snapshot.totalTurns)) {
          const d = map.getTorusDistance(fromPos, p).manhattan;
          if (d < minDist) {
            minDist = d;
            nearest = p;
          }
        }
      }
    }
    return nearest;
  }

  public static hasNearbyChest(pos: Position, map: WorldMap, maxDist: number): boolean {
    for (let dy = -maxDist; dy <= maxDist; dy++) {
      for (let dx = -maxDist; dx <= maxDist; dx++) {
        const manhattan = Math.abs(dx) + Math.abs(dy);
        if (manhattan < 2 || manhattan > maxDist) continue;
        const p = map.wrapPosition({ x: pos.x + dx, y: pos.y + dy });
        if (map.getObject(p) === 'CHEST') {
          return true;
        }
      }
    }
    return false;
  }

  public static hasReachableKey(map: WorldMap, snapshot: TacticalSnapshot): boolean {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (map.getItem(p) === 'KEY' && !snapshot.memory.isTargetUnreachable(p, snapshot.totalTurns)) {
          return true;
        }
      }
    }
    return false;
  }

  public static findNearestAvailableKey(fromPos: Position, map: WorldMap, snapshot: TacticalSnapshot): Position | null {
    let minDist = Infinity;
    let nearest: Position | null = null;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (map.getItem(p) === 'KEY' && !snapshot.memory.isTargetUnreachable(p, snapshot.totalTurns)) {
          const d = map.getTorusDistance(fromPos, p).manhattan;
          if (d < minDist) {
            minDist = d;
            nearest = p;
          }
        }
      }
    }
    return nearest;
  }

  public static isReadyForDragon(snapshot: TacticalSnapshot, engine: GameEngine): boolean {
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
    const hasDragonAssaultMagic = player.magic >= 3;
    const hasEnoughHp = player.hp >= player.maxHp * 0.50 || player.hp >= 15000;

    // 防御力（EXP）の適正判定: ドラゴン決戦で即死しないための十分なEXP
    const requiredDefenseExp = snapshot.params.targetDefenseExp ?? 12000;
    const hasEnoughDefense = player.experience >= requiredDefenseExp;

    return canDamageAllHeads && canDiagonal && canBreak && hasDragonAssaultMagic && hasEnoughHp && hasEnoughDefense;
  }
}
