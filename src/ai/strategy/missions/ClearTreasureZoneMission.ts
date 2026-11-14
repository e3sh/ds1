import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { IStrategicMission, MissionCompletionReason, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { Position } from '../../../models/Types.js';
import { WorldMap } from '../../../models/WorldMap.js';
import { MagicSystem } from '../../../systems/MagicSystem.js';

/**
 * ClearTreasureZoneMission (宝物庫ゾーン一括攻略作戦)
 *
 * 特定ゾーン内の宝箱を一括開錠し、出現したパワーストーン等の資源を回収する。
 * BREAK習得済みならショートカット開削（breachShortcutPositions）を積極的に活用する。
 */
export class ClearTreasureZoneMission implements IStrategicMission {
  public readonly id = 'CLEAR_TREASURE_ZONE';
  public readonly name: string;
  public readonly maxTurns = 75;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';
  public completionReason?: MissionCompletionReason;
  public subMode: 'BREACHING_ENTRY' | 'COLLECTING_DROP' | 'FETCHING_KEY' | 'OPENING_CHEST' | 'EXHAUSTED' = 'OPENING_CHEST';

  private lastTargetChestPos: Position | null = null;
  private lastTargetChestDist: number = Infinity;
  private targetChestTurns: number = 0;

  private initialActualChests: number | null = null;
  private initialStrength: number | null = null;
  private initialExperience: number | null = null;
  private initialGold: number | null = null;
  private initialMagic: number | null = null;
  private lastProgressChests: number | null = null;
  private lastProgressGold: number = 0;
  private lastProgressStrength: number = 0;
  private turnsWithoutProgress: number = 0;
  private lastTrackedTurn: number = -1;

  constructor(public readonly zoneId: string) {
    this.name = zoneId === 'GLOBAL_ALL'
      ? '📦 マップ残存宝箱一括開錠作戦'
      : `📦 宝物庫ゾーン攻略 [Zone: ${zoneId}]`;
  }

  private getCurrentActualChests(snapshot: TacticalSnapshot, engine: GameEngine): number {
    if (this.zoneId !== 'GLOBAL_ALL') {
      const zone = snapshot.spatial.treasureZones.get(this.zoneId);
      if (zone) {
        return zone.remainingChests;
      }
    }
    return MapSituationEvaluator.get(snapshot, engine).items.totalActualChests;
  }

  private ensureInitialized(snapshot: TacticalSnapshot, engine: GameEngine): void {
    if (this.initialActualChests === null) {
      const player = engine.getPlayer();
      const curChests = this.getCurrentActualChests(snapshot, engine);
      this.initialActualChests = curChests;
      this.initialStrength = player.strength;
      this.initialExperience = player.experience;
      this.initialGold = player.gold;
      this.initialMagic = player.magic;
      this.lastProgressChests = curChests;
      this.lastProgressGold = player.gold;
      this.lastProgressStrength = player.strength;
    }
  }

  private hasMadeProgress(snapshot: TacticalSnapshot, engine: GameEngine): boolean {
    const player = engine.getPlayer();
    const curActual = this.getCurrentActualChests(snapshot, engine);
    return (
      (this.initialActualChests !== null && curActual < this.initialActualChests) ||
      (this.initialStrength !== null && player.strength > this.initialStrength) ||
      (this.initialExperience !== null && player.experience > this.initialExperience) ||
      (this.initialGold !== null && player.gold > this.initialGold) ||
      (this.initialMagic !== null && player.magic > this.initialMagic)
    );
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    this.ensureInitialized(snapshot, engine);
    const player = engine.getPlayer();
    const curActual = this.getCurrentActualChests(snapshot, engine);
    if (snapshot.totalTurns !== this.lastTrackedTurn) {
      this.lastTrackedTurn = snapshot.totalTurns;
      const madeStepProgress =
        (this.lastProgressChests !== null && curActual < this.lastProgressChests) ||
        player.gold > this.lastProgressGold ||
        player.strength > this.lastProgressStrength;
      if (madeStepProgress) {
        this.turnsWithoutProgress = 0;
      } else {
        this.turnsWithoutProgress++;
      }
      this.lastProgressChests = curActual;
      this.lastProgressGold = player.gold;
      this.lastProgressStrength = player.strength;
    }
    const madeProgress = this.hasMadeProgress(snapshot, engine);

    // パワーストーンを所持した場合は奉納ミッションへ引き継ぐため完了
    if (player.holdItem === 'POWER_STONE') {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }

    // ゾーン内の未開封宝箱（または到達可能宝箱）の検証
    // 注意: 実際に宝箱を開けたのではなく、PATH_BLOCKED ブラックリスト入りで到達可能数が0になっただけなら偽完了(COMPLETED)にしない！
    if (this.zoneId !== 'GLOBAL_ALL') {
      const zone = snapshot.spatial.treasureZones.get(this.zoneId);
      if (zone) {
        if (zone.remainingChests === 0) {
          this.completionReason = 'OBJECTIVE_ACHIEVED';
          return 'COMPLETED';
        }
        if (this.countReachableChestsInZone(zone, snapshot.map, snapshot) === 0) {
          snapshot.memory.markZoneUnreachable(this.zoneId, 25, snapshot.totalTurns);
          this.completionReason = madeProgress ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
          return 'ABORTED';
        }
      }
    } else {
      if (this.countReachableChestsGlobal(snapshot.map, snapshot) === 0) {
        const curActualChests = MapSituationEvaluator.get(snapshot, engine).items.totalActualChests;
        if (curActualChests === 0) {
          this.completionReason = 'OBJECTIVE_ACHIEVED';
          return 'COMPLETED';
        }
        this.completionReason = madeProgress ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
        return 'ABORTED';
      }
    }

    // 鍵を持っておらず、かつマップ上に到達可能な鍵が一切ない場合は開錠不能のため早期アボート
    if (player.holdItem !== 'KEY' && !this.findNearestAvailableKey(player.pos, snapshot.map, snapshot)) {
      this.completionReason = madeProgress ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }

    // 規定ターン超過時: 順調に攻略が進んでいる場合は自己BANせず PARTIAL_PROGRESS で完了して次ターン即継続可能にする
    if (this.turnsElapsed >= this.maxTurns) {
      if (madeProgress && this.turnsWithoutProgress < 25) {
        this.completionReason = 'PARTIAL_PROGRESS';
        return 'COMPLETED';
      }
      if (this.zoneId !== 'GLOBAL_ALL') {
        snapshot.memory.markZoneUnreachable(this.zoneId, 30, snapshot.totalTurns);
      }
      this.completionReason = madeProgress ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }

    // 途中換金判定: 手ぶらで金貨を持ち、換金により BREAK(4000)/斜め(12000) マイルストーン達成・7G以上・またはSTR達成後の防御EXP不足解消時は換金へ移行
    const estimatedGainedExp = player.gold * 300 + Math.floor(player.experience * 0.02 * player.gold);
    const afterExp = player.experience + estimatedGainedExp;
    const reachesMilestoneFromGold =
      (player.experience < 4000 && afterExp >= 4000) ||
      (player.experience < 12000 && afterExp >= 12000);
    const canDamageDragon = player.hasSword && (player.strength >= snapshot.params.targetStr || snapshot.milestones.isStrCapped || snapshot.milestones.hasTargetStr);
    const hasEnoughDefense = player.experience >= Math.max(25000, snapshot.params.targetDefenseExp);
    if (
      player.holdItem === 'NONE' &&
      player.gold > 0 &&
      (reachesMilestoneFromGold || player.gold >= 7 || (canDamageDragon && !hasEnoughDefense && player.gold >= 4))
    ) {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }

    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    this.ensureInitialized(snapshot, engine);
    const player = engine.getPlayer();
    const map = snapshot.map;
    const isGlobal = this.zoneId === 'GLOBAL_ALL';
    const zone = !isGlobal ? snapshot.spatial.treasureZones.get(this.zoneId) : undefined;

    // 1. ショートカット開削の検討:
    // BREAK習得済み (EXP >= 4000) かつ詠唱可能 (MP >= 1, 死神なし) で、このゾーンに関連する未開削ショートカットがあり、
    // まだ開通していないなら開削を指示
    const canCastBreach = snapshot.milestones.canBreak && (MagicSystem.canCast(player, 'BREAK').allowed || MagicSystem.canCast(player, 'KICK').allowed);
    if (canCastBreach) {
      const viableShortcuts = snapshot.spatial.getViableBreachShortcuts(player, map);
      for (const sc of viableShortcuts) {
        if (snapshot.memory.isTargetUnreachable(sc.pos, snapshot.totalTurns)) continue;
        const distFromPlayer = map.getTorusDistance(player.pos, sc.pos).manhattan;
        if (distFromPlayer > 20) continue;

        if (zone) {
          const distToZone = this.getDistanceToZoneBounds(sc.pos, zone);
          if (distToZone <= 4) {
            this.subMode = 'BREACHING_ENTRY';
            return {
              type: 'BREACH_SHORTCUT',
              targetPos: sc.pos,
              priority: 85,
              reason: `ゾーン ${this.zoneId} へのショートカット壁・岩を開削 (${sc.pos.x}, ${sc.pos.y})`,
            };
          }
        } else {
          // GLOBAL_ALL の場合は最寄りショートカットを開削
          if (distFromPlayer <= 8) {
            this.subMode = 'BREACHING_ENTRY';
            return {
              type: 'BREACH_SHORTCUT',
              targetPos: sc.pos,
              priority: 85,
              reason: `未開通ショートカットを開削 (${sc.pos.x}, ${sc.pos.y})`,
            };
          }
        }
      }
    }

    // 2. 足元に有益アイテム（POWER_STONE, POTION, COIN）が出現した場合:
    // 鍵所持中なら一時置きスワップ（SWAP_KEY_FOR_ITEM）、手ぶらなら直接拾い（PICKUP_ITEM）
    const floorItem = map.getItem(player.pos);
    const needStr = player.strength < snapshot.params.targetStr;
    const needExp = player.experience < snapshot.params.targetDefenseExp;
    const needMagic = player.magic < snapshot.params.maxTargetMagic;
    const situation = MapSituationEvaluator.get(snapshot, engine);
    const itemsSummary = situation.items;
    const hasPendingRoomChests =
      itemsSummary.nearbyChestCountWithin8 > 0 || itemsSummary.activeZoneRemainingChests > 0;

    // 2-A. パワーストーン
    if (floorItem === 'POWER_STONE' && needStr) {
      if (!itemsSummary.shouldContinueChestChain) {
        this.subMode = 'COLLECTING_DROP';
        if (player.holdItem === 'KEY') {
          return {
            type: 'SWAP_KEY_FOR_ITEM',
            targetPos: player.pos,
            targetItemType: 'POWER_STONE',
            priority: 95,
            reason: '足元のパワーストーン回収のため鍵を一時置きスワップ',
          };
        }
        return {
          type: 'PICKUP_ITEM',
          targetItemType: 'POWER_STONE',
          priority: 95,
          reason: '足元のパワーストーンを回収',
        };
      }
    }

    // 2-A2. 同一宝物庫内（距離 <= 8）に出現しているパワーストーンの回収
    if (needStr) {
      const nearbyStone = itemsSummary.nearestPowerStone;
      if (
        nearbyStone &&
        !itemsSummary.shouldContinueChestChain &&
        map.getTorusDistance(player.pos, nearbyStone).manhattan <= 8 &&
        (player.holdItem === 'NONE' || !itemsSummary.hasChestWithin2To8)
      ) {
        this.subMode = 'COLLECTING_DROP';
        return {
          type: 'NAVIGATE_TO_POSITION',
          targetPos: nearbyStone,
          targetItemType: 'POWER_STONE',
          priority: 93,
          reason: `宝物庫内で出現したパワーストーンを回収 (${nearbyStone.x}, ${nearbyStone.y})`,
        };
      }
    }

    // 2-B. 魔法の壺 (POTION): 部屋内に開けるべき宝箱が残っている間は鍵スワップして手数を消費しない（手ぶら時または全開錠後に回収）
    if (floorItem === 'POTION') {
      if (player.holdItem === 'KEY' && needMagic && !hasPendingRoomChests) {
        this.subMode = 'COLLECTING_DROP';
        return {
          type: 'SWAP_KEY_FOR_ITEM',
          targetPos: player.pos,
          targetItemType: 'POTION',
          priority: 94,
          reason: '足元の魔法の壺(MP回復)回収のため鍵を一時置きスワップ',
        };
      }
      if (player.holdItem === 'NONE' && (needMagic || player.magic < 20)) {
        this.subMode = 'COLLECTING_DROP';
        return {
          type: 'PICKUP_ITEM',
          targetItemType: 'POTION',
          priority: 92,
          reason: '足元の魔法の壺(MP回復)を取得',
        };
      }
    }

    // 2-C. 金貨 (COIN): 部屋内に宝箱が残っている間は鍵スワップを避け、全開錠後に回収する
    if (floorItem === 'COIN') {
      if (player.holdItem === 'KEY' && needExp && !hasPendingRoomChests) {
        this.subMode = 'COLLECTING_DROP';
        return {
          type: 'SWAP_KEY_FOR_ITEM',
          targetPos: player.pos,
          targetItemType: 'COIN',
          priority: 94,
          reason: '足元の金貨(防御EXP資産)回収のため鍵を一時置きスワップ',
        };
      }
      if (player.holdItem === 'NONE' && (needExp || player.experience < 40000)) {
        this.subMode = 'COLLECTING_DROP';
        return {
          type: 'PICKUP_ITEM',
          targetItemType: 'COIN',
          priority: 92,
          reason: '足元の金貨を取得',
        };
      }
    }

    // 3. 鍵を持っていない場合: 鍵を回収
    if (player.holdItem !== 'KEY') {
      this.subMode = 'FETCHING_KEY';
      const keyPos = this.findNearestAvailableKey(player.pos, map, snapshot);
      if (keyPos) {
        if (map.getItem(player.pos) === 'KEY') {
          return {
            type: 'PICKUP_ITEM',
            targetItemType: 'KEY',
            priority: 88,
            reason: '足元の鍵を拾う',
          };
        }
        return {
          type: 'NAVIGATE_TO_POSITION',
          targetPos: keyPos,
          targetItemType: 'KEY',
          priority: 85,
          reason: `宝箱開錠用の鍵へ移動 (${keyPos.x}, ${keyPos.y})`,
        };
      }
      // 到達可能な鍵がマップ上にない場合は即座にアボート
      this.completionReason = this.hasMadeProgress(snapshot, engine) ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      this.status = 'ABORTED';
      this.subMode = 'EXHAUSTED';
      return {
        type: 'WANDER_SAFELY',
        priority: 20,
        reason: '到達可能な鍵が存在しないため作戦中断',
      };
    }

    // 4. 鍵を所持している場合: 最寄り未開封宝箱へ移動し、8歩周期開錠
    if (player.holdItem === 'KEY') {
      this.subMode = 'OPENING_CHEST';
      const nearestGlobal = this.findNearestChestGlobal(player.pos, map, snapshot);
      const nearestInZone = zone ? this.findNearestChestInZone(player.pos, zone, map, snapshot) : null;

      let nearestChest = nearestInZone;
      if (nearestGlobal) {
        if (!nearestInZone) {
          nearestChest = nearestGlobal;
        } else {
          const distGlobal = map.getTorusDistance(player.pos, nearestGlobal).manhattan;
          const distZone = map.getTorusDistance(player.pos, nearestInZone).manhattan;
          nearestChest = distGlobal < distZone ? nearestGlobal : nearestInZone;
        }
      }

      const needMoreStr =
        player.strength < snapshot.params.targetStr &&
        !snapshot.milestones.isStrCapped &&
        itemsSummary.projectedStrFromNearbyStones < snapshot.params.targetStr;

      if (needMoreStr && player.stepCountSinceStone <= 7) {
        const remSteps = 8 - player.stepCountSinceStone;
        const zonePool = zone
          ? itemsSummary.getReachableChestsInZone(zone.bounds)
          : itemsSummary.chests;
        let bestParityChest: Position | null = null;
        let bestParityDist = Infinity;
        for (const cPos of zonePool) {
          const d = map.getTorusDistance(player.pos, cPos).manhattan;
          if (d <= 8 && d <= remSteps && (remSteps - d) % 2 === 0 && d < bestParityDist) {
            bestParityDist = d;
            bestParityChest = cPos;
          }
        }
        if (!bestParityChest && zone) {
          for (const cPos of itemsSummary.chests) {
            const d = map.getTorusDistance(player.pos, cPos).manhattan;
            if (d <= 8 && d <= remSteps && (remSteps - d) % 2 === 0 && d < bestParityDist) {
              bestParityDist = d;
              bestParityChest = cPos;
            }
          }
        }
        if (bestParityChest) {
          nearestChest = bestParityChest;
        }
      }

      if (nearestChest) {
        const chestDist = map.getTorusDistance(player.pos, nearestChest).manhattan;
        if (this.lastTargetChestPos && this.lastTargetChestPos.x === nearestChest.x && this.lastTargetChestPos.y === nearestChest.y) {
          // 接近している間は停滞カウントをリセットし、遠方宝箱への移動中に誤ブラックリスト化されるのを防ぐ
          if (chestDist < this.lastTargetChestDist) {
            this.targetChestTurns = 0;
          } else {
            this.targetChestTurns++;
          }
          this.lastTargetChestDist = chestDist;

          if (this.targetChestTurns > 15) {
            snapshot.memory.markTargetUnreachable(nearestChest, 20, snapshot.totalTurns);
            this.lastTargetChestPos = null;
            this.lastTargetChestDist = Infinity;
            this.targetChestTurns = 0;
            // 次の宝箱へフォールバック
            const nextChest = this.findNearestChestGlobal(player.pos, map, snapshot);
            if (nextChest) {
              nearestChest = nextChest;
            }
          }
        } else {
          this.lastTargetChestPos = { ...nearestChest };
          this.lastTargetChestDist = chestDist;
          this.targetChestTurns = 0;
        }

        return {
          type: needMoreStr ? 'UNLOCK_CHEST_8STEP' : 'UNLOCK_CHEST_RAPID',
          targetPos: nearestChest,
          priority: 88,
          reason: needMoreStr ? `宝箱の8歩開錠 (${nearestChest.x}, ${nearestChest.y})` : `宝箱の最速開錠(コイン回収) (${nearestChest.x}, ${nearestChest.y})`,
        };
      }

      // 到達可能宝箱が枯渇している場合: 実宝箱が0なら達成完了、まだ残っていればブロック遮断によるアボート
      const curActual = MapSituationEvaluator.get(snapshot, engine).items.totalActualChests;
      this.subMode = 'EXHAUSTED';
      if (curActual === 0) {
        this.completionReason = 'OBJECTIVE_ACHIEVED';
        this.status = 'COMPLETED';
        return {
          type: 'DROP_HOLD_ITEM',
          priority: 75,
          reason: `ゾーン ${this.zoneId} 内の到達可能宝箱が完了したため鍵を手放し手ぶら回収へ移行`,
        };
      } else {
        this.completionReason = this.hasMadeProgress(snapshot, engine) ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
        this.status = 'ABORTED';
        return {
          type: 'WANDER_SAFELY',
          priority: 20,
          reason: `ゾーン ${this.zoneId} の残存宝箱が経路遮断のため一時中断`,
        };
      }
    }

    // 5. フォールバック: ゾーン中心へ移動（中心が到達不能ならアボート）
    if (zone) {
      const centerX = Math.floor((zone.bounds.x1 + zone.bounds.x2) / 2);
      const centerY = Math.floor((zone.bounds.y1 + zone.bounds.y2) / 2);
      const centerPos = { x: centerX, y: centerY };

      if (!snapshot.memory.isTargetUnreachable(centerPos, snapshot.totalTurns)) {
        return {
          type: 'NAVIGATE_TO_POSITION',
          targetPos: centerPos,
          priority: 50,
          reason: `ゾーン ${this.zoneId} へ移動`,
        };
      }
      if (this.zoneId !== 'GLOBAL_ALL') {
        snapshot.memory.markZoneUnreachable(this.zoneId, 30, snapshot.totalTurns);
      }
      this.completionReason = this.hasMadeProgress(snapshot, engine) ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      this.status = 'ABORTED';
      this.subMode = 'EXHAUSTED';
    }

    return {
      type: 'WANDER_SAFELY',
      priority: 20,
      reason: '宝箱探索中',
    };
  }

  private countReachableChestsInZone(zone: any, _map: WorldMap, snapshot: TacticalSnapshot): number {
    return MapSituationEvaluator.get(snapshot).items.getReachableChestsInZone(zone.bounds).length;
  }

  private countReachableChestsGlobal(_map: WorldMap, snapshot: TacticalSnapshot): number {
    return MapSituationEvaluator.get(snapshot).items.chests.length;
  }

  private findNearestChestGlobal(fromPos: Position, map: WorldMap, snapshot: TacticalSnapshot): Position | null {
    const items = MapSituationEvaluator.get(snapshot).items;
    if (fromPos.x === snapshot.player.pos.x && fromPos.y === snapshot.player.pos.y) {
      return items.nearestChest;
    }
    let nearest: Position | null = null;
    let minDist = Infinity;
    for (const p of items.chests) {
      const d = map.getTorusDistance(fromPos, p).manhattan;
      if (d < minDist) {
        minDist = d;
        nearest = p;
      }
    }
    return nearest;
  }

  private getDistanceToZoneBounds(pos: Position, zone: any): number {
    const minX = Math.min(zone.bounds.x1, zone.bounds.x2);
    const maxX = Math.max(zone.bounds.x1, zone.bounds.x2);
    const minY = Math.min(zone.bounds.y1, zone.bounds.y2);
    const maxY = Math.max(zone.bounds.y1, zone.bounds.y2);

    let dx = 0;
    if (pos.x < minX) dx = minX - pos.x;
    else if (pos.x > maxX) dx = pos.x - maxX;

    let dy = 0;
    if (pos.y < minY) dy = minY - pos.y;
    else if (pos.y > maxY) dy = pos.y - maxY;

    return dx + dy;
  }

  private findNearestAvailableKey(fromPos: Position, map: WorldMap, snapshot: TacticalSnapshot): Position | null {
    const items = MapSituationEvaluator.get(snapshot).items;
    if (fromPos.x === snapshot.player.pos.x && fromPos.y === snapshot.player.pos.y) {
      return items.nearestKey;
    }
    let nearest: Position | null = null;
    let minDist = Infinity;
    for (const p of items.keys) {
      const d = map.getTorusDistance(fromPos, p).manhattan;
      if (d < minDist) {
        minDist = d;
        nearest = p;
      }
    }
    return nearest;
  }

  private findNearestChestInZone(
    fromPos: Position,
    zone: any,
    map: WorldMap,
    snapshot?: TacticalSnapshot
  ): Position | null {
    if (!snapshot) return null;
    const inZone = MapSituationEvaluator.get(snapshot).items.getReachableChestsInZone(zone.bounds);
    let nearest: Position | null = null;
    let minDist = Infinity;
    for (const p of inZone) {
      const d = map.getTorusDistance(fromPos, p).manhattan;
      if (d < minDist) {
        minDist = d;
        nearest = p;
      }
    }
    return nearest;
  }
}
