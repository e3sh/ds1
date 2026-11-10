import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
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

    // 規定ターン超過時はアボートして別ミッションへ
    if (this.turnsElapsed >= this.maxTurns) {
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

    // 2. 足元にパワーストーンがある場合: 周辺に宝箱があるならチェーンを優先し、なければ回収
    const floorItem = map.getItem(player.pos);
    if (floorItem === 'POWER_STONE' && !snapshot.milestones.isStrCapped) {
      const hasNearbyChest = this.hasNearbyChest(player.pos, map, 8);
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

    // 2-B. 足元に POTION または COIN がある場合: 手ぶらなら即拾い（MP/所持金加算）
    if (player.holdItem === 'NONE' && (floorItem === 'POTION' || floorItem === 'COIN')) {
      return {
        type: 'PICKUP_ITEM',
        targetItemType: floorItem,
        priority: 92,
        reason: `足元の ${floorItem === 'POTION' ? '魔法の壺(MP回復)' : '金貨'} を取得`,
      };
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
        const needStr = player.strength < snapshot.params.targetStr && !snapshot.milestones.isStrCapped;
        return {
          type: needStr ? 'UNLOCK_CHEST_8STEP' : 'NAVIGATE_TO_POSITION',
          targetPos: nearestChest,
          priority: 88,
          reason: needStr ? `宝箱の8歩開錠 (${nearestChest.x}, ${nearestChest.y})` : `宝箱の最速開錠(コイン回収) (${nearestChest.x}, ${nearestChest.y})`,
        };
      }

      // ゾーン内の到達可能宝箱が枯渇している場合: 即座に完了/アボートして別ゾーンへ
      this.status = 'COMPLETED';
      return {
        type: 'WANDER_SAFELY',
        priority: 20,
        reason: `ゾーン ${this.zoneId} 内の到達可能宝箱が完了したため別作戦へ移行`,
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
      this.status = 'ABORTED';
    }

    return {
      type: 'WANDER_SAFELY',
      priority: 20,
      reason: '宝箱探索中',
    };
  }

  private countReachableChestsInZone(zone: any, map: WorldMap, snapshot: TacticalSnapshot): number {
    let count = 0;
    const minX = Math.min(zone.bounds.x1, zone.bounds.x2);
    const maxX = Math.max(zone.bounds.x1, zone.bounds.x2);
    const minY = Math.min(zone.bounds.y1, zone.bounds.y2);
    const maxY = Math.max(zone.bounds.y1, zone.bounds.y2);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const p = map.wrapPosition({ x, y });
        if (map.getObject(p) === 'CHEST' && !snapshot.memory.isTargetUnreachable(p, snapshot.totalTurns)) {
          count++;
        }
      }
    }
    return count;
  }

  private countReachableChestsGlobal(map: WorldMap, snapshot: TacticalSnapshot): number {
    let count = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (map.getObject(p) === 'CHEST' && !snapshot.memory.isTargetUnreachable(p, snapshot.totalTurns)) {
          count++;
        }
      }
    }
    return count;
  }

  private findNearestChestGlobal(fromPos: Position, map: WorldMap, snapshot: TacticalSnapshot): Position | null {
    let nearest: Position | null = null;
    let minDist = Infinity;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (map.getObject(p) === 'CHEST' && !snapshot.memory.isTargetUnreachable(p, snapshot.totalTurns)) {
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
    let nearest: Position | null = null;
    let minDist = Infinity;

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

  private findNearestChestInZone(
    fromPos: Position,
    zone: any,
    map: WorldMap,
    snapshot?: TacticalSnapshot
  ): Position | null {
    const minX = Math.min(zone.bounds.x1, zone.bounds.x2);
    const maxX = Math.max(zone.bounds.x1, zone.bounds.x2);
    const minY = Math.min(zone.bounds.y1, zone.bounds.y2);
    const maxY = Math.max(zone.bounds.y1, zone.bounds.y2);

    let nearest: Position | null = null;
    let minDist = Infinity;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const p = map.wrapPosition({ x, y });
        if (map.getObject(p) === 'CHEST') {
          if (snapshot && snapshot.memory.isTargetUnreachable(p, snapshot.totalTurns)) {
            continue;
          }
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

  private hasNearbyChest(pos: Position, map: WorldMap, maxDist: number): boolean {
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
}
