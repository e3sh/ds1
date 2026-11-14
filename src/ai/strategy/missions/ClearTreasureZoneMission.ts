import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { IStrategicMission, MissionStatus } from '../StrategicMission.js';
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
  public readonly maxTurns = 60;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';
  private lastTargetChestPos: Position | null = null;
  private targetChestTurns: number = 0;

  constructor(public readonly zoneId: string) {
    this.name = zoneId === 'GLOBAL_ALL'
      ? '📦 マップ残存宝箱一括開錠作戦'
      : `📦 宝物庫ゾーン攻略 [Zone: ${zoneId}]`;
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    const player = engine.getPlayer();

    // パワーストーンを所持した場合は奉納ミッションへ引き継ぐため完了
    if (player.holdItem === 'POWER_STONE') {
      return 'COMPLETED';
    }

    // ゾーン内の未開封宝箱（または到達可能宝箱）が0個になれば完了
    if (this.zoneId !== 'GLOBAL_ALL') {
      const zone = snapshot.spatial.treasureZones.get(this.zoneId);
      if (zone) {
        if (zone.remainingChests === 0 || this.countReachableChestsInZone(zone, snapshot.map, snapshot) === 0) {
          return 'COMPLETED';
        }
      }
    } else {
      if (this.countReachableChestsGlobal(snapshot.map, snapshot) === 0) {
        return 'COMPLETED';
      }
    }

    // 鍵を持っておらず、かつマップ上に到達可能な鍵が一切ない場合は開錠不能のため早期アボート
    if (player.holdItem !== 'KEY' && !this.findNearestAvailableKey(player.pos, snapshot.map, snapshot)) {
      return 'ABORTED';
    }

    // 規定ターン超過時はアボートして別ミッションへ（ゾーンを120ターンクールダウン）
    if (this.turnsElapsed >= this.maxTurns) {
      if (this.zoneId !== 'GLOBAL_ALL') {
        snapshot.memory.markZoneUnreachable(this.zoneId, 120, snapshot.totalTurns);
      }
      return 'ABORTED';
    }

    // STR達成後の防御EXP育成期: コインが一定数集まり、手ぶら（鍵なし）なら換金のため完了
    const canDamageDragon = player.hasSword && (player.strength >= snapshot.params.targetStr || snapshot.milestones.isStrCapped || snapshot.milestones.hasTargetStr);
    const hasEnoughDefense = player.experience >= Math.max(25000, snapshot.params.targetDefenseExp);
    if (canDamageDragon && !hasEnoughDefense && player.gold >= 4 && player.holdItem !== 'KEY') {
      return 'COMPLETED';
    }

    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
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

    // 2-A. パワーストーン
    if (floorItem === 'POWER_STONE' && needStr) {
      const hasNearbyChest = MapSituationEvaluator.get(snapshot, engine).items.hasChestWithin2To8;
      const canChain = player.holdItem === 'KEY' && hasNearbyChest;
      if (!canChain) {
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

    // 2-B. 魔法の壺 (POTION)
    if (floorItem === 'POTION' && (needMagic || player.magic < 20)) {
      if (player.holdItem === 'KEY') {
        return {
          type: 'SWAP_KEY_FOR_ITEM',
          targetPos: player.pos,
          targetItemType: 'POTION',
          priority: 94,
          reason: '足元の魔法の壺(MP回復)回収のため鍵を一時置きスワップ',
        };
      }
      if (player.holdItem === 'NONE') {
        return {
          type: 'PICKUP_ITEM',
          targetItemType: 'POTION',
          priority: 92,
          reason: '足元の魔法の壺(MP回復)を取得',
        };
      }
    }

    // 2-C. 金貨 (COIN): 防御EXP育成のために最重要回収！
    if (floorItem === 'COIN' && (needExp || player.experience < 40000)) {
      if (player.holdItem === 'KEY') {
        return {
          type: 'SWAP_KEY_FOR_ITEM',
          targetPos: player.pos,
          targetItemType: 'COIN',
          priority: 94,
          reason: '足元の金貨(防御EXP資産)回収のため鍵を一時置きスワップ',
        };
      }
      if (player.holdItem === 'NONE') {
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
      this.status = 'ABORTED';
      return {
        type: 'WANDER_SAFELY',
        priority: 20,
        reason: '到達可能な鍵が存在しないため作戦中断',
      };
    }

    // 4. 鍵を所持している場合: 最寄り未開封宝箱へ移動し、8歩周期開錠
    if (player.holdItem === 'KEY') {
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

      if (nearestChest) {
        if (this.lastTargetChestPos && this.lastTargetChestPos.x === nearestChest.x && this.lastTargetChestPos.y === nearestChest.y) {
          this.targetChestTurns++;
          if (this.targetChestTurns > 15) {
            snapshot.memory.markTargetUnreachable(nearestChest, 120, snapshot.totalTurns);
            this.lastTargetChestPos = null;
            this.targetChestTurns = 0;
            // 次の宝箱へフォールバック
            const nextChest = this.findNearestChestGlobal(player.pos, map, snapshot);
            if (nextChest) {
              nearestChest = nextChest;
            }
          }
        } else {
          this.lastTargetChestPos = { ...nearestChest };
          this.targetChestTurns = 0;
        }

        const needStr = player.strength < snapshot.params.targetStr && !snapshot.milestones.isStrCapped;
        return {
          type: needStr ? 'UNLOCK_CHEST_8STEP' : 'UNLOCK_CHEST_RAPID',
          targetPos: nearestChest,
          priority: 88,
          reason: needStr ? `宝箱の8歩開錠 (${nearestChest.x}, ${nearestChest.y})` : `宝箱の最速開錠(コイン回収) (${nearestChest.x}, ${nearestChest.y})`,
        };
      }

      // ゾーン内の到達可能宝箱が枯渇している場合: 鍵を手放して手ぶら資源回収・換金帰還へ
      this.status = 'COMPLETED';
      return {
        type: 'DROP_HOLD_ITEM',
        priority: 75,
        reason: `ゾーン ${this.zoneId} 内の到達可能宝箱が完了したため鍵を手放し手ぶら回収へ移行`,
      };
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
        snapshot.memory.markZoneUnreachable(this.zoneId, 120, snapshot.totalTurns);
      }
      this.status = 'ABORTED';
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
