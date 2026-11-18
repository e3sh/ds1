import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { BaseStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { Position } from '../../../models/Types.js';
import { WorldMap } from '../../../models/WorldMap.js';
import { MagicSystem } from '../../../systems/MagicSystem.js';

/**
 * ClearTreasureZoneMission (宝物庫ゾーン一括攻略作戦)
 *
 * 大・中・小分類ステートマシン：
 * - 中分類 (subMode): BREACHING_ENTRY | COLLECTING_DROP | FETCHING_KEY | OPENING_CHEST | EXHAUSTED
 * - 小分類 (lockedTarget): BLOCK | POWER_STONE | DEATH | KEY | CHEST
 *
 * 確定した単一ターゲット（ショートカット岩・鍵・宝箱・ドロップ石）をロックし、
 * 達成・消失・遮断まで維持することで1歩ごとの目移り・ピンポン移動を根絶する。
 */
export class ClearTreasureZoneMission extends BaseStrategicMission {
  public readonly id = 'CLEAR_TREASURE_ZONE';
  public readonly name: string;
  public readonly maxTurns = 75;
  public override subMode: 'BREACHING_ENTRY' | 'COLLECTING_DROP' | 'FETCHING_KEY' | 'OPENING_CHEST' | 'EXHAUSTED' = 'OPENING_CHEST';

  public override readonly auditProfile = {
    graceTurns: 40,
    tabooable: true,
    maxEscalation: 'TERMINAL' as const,
  };

  constructor(public override readonly zoneId: string) {
    super();
    this.name = zoneId === 'GLOBAL_ALL'
      ? '📦 マップ残存宝箱一括開錠作戦'
      : `📦 宝物庫ゾーン攻略 [Zone: ${zoneId}]`;
  }

  private hasMadeProgress(snapshot: TacticalSnapshot): boolean {
    const start = this.startTurn ?? snapshot.totalTurns;
    return snapshot.progress.substantiveGainsSince(start).length > 0;
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    const player = engine.getPlayer();
    const madeProgress = this.hasMadeProgress(snapshot);
    const lastGainTurn = snapshot.progress.lastSubstantiveGain?.turn ?? (this.startTurn ?? snapshot.totalTurns);
    const turnsWithoutProgress = Math.max(0, snapshot.totalTurns - Math.max(this.startTurn ?? 0, lastGainTurn));

    // パワーストーンを所持した場合は奉納ミッションへ引き継ぐため完了
    if (player.holdItem === 'POWER_STONE') {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }

    // ゾーン内の未開封宝箱（または到達可能宝箱）の検証
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
      if (madeProgress && turnsWithoutProgress < 25) {
        this.completionReason = 'PARTIAL_PROGRESS';
        return 'COMPLETED';
      }
      if (this.zoneId !== 'GLOBAL_ALL') {
        snapshot.memory.markZoneUnreachable(this.zoneId, 30, snapshot.totalTurns);
      }
      this.completionReason = madeProgress ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }

    // 途中換金判定: コインでEXPが増えるモード時のみ、BREAK/斜め/防御EXP解消のために帰還
    const coinGrantsExp = snapshot.params.coinGrantsExp !== false;
    const estimatedGainedExp = coinGrantsExp
      ? (player.gold * 300 + Math.floor(player.experience * 0.02 * player.gold))
      : 0;
    const afterExp = player.experience + estimatedGainedExp;
    const reachesMilestoneFromGold =
      (player.experience < 4000 && afterExp >= 4000) ||
      (player.experience < 12000 && afterExp >= 12000);
    const canDamageDragon = player.hasSword && (player.strength >= snapshot.params.targetStr || snapshot.milestones.isStrCapped || snapshot.milestones.hasTargetStr);
    const hasEnoughDefense = player.experience >= Math.max(25000, snapshot.params.targetDefenseExp);
    if (
      coinGrantsExp &&
      player.holdItem === 'NONE' &&
      player.gold > 0 &&
      (reachesMilestoneFromGold || player.gold >= 7 || (canDamageDragon && !hasEnoughDefense && player.gold >= 4))
    ) {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }

    return 'ACTIVE';
  }

  /**
   * Step 1: 毎ターン先頭で現在のロック対象の成否・有効性を検証する
   */
  private verifyAndTransitionLocks(
    snapshot: TacticalSnapshot,
    playerPos: Position,
    holdItem: string,
    hasDeath: boolean,
    canCastBreach: boolean
  ): void {
    const map = snapshot.map;
    this.updateLockProgress(playerPos, map);
    if (!this.lockedTarget) return;

    switch (this.lockedTarget.kind) {
      case 'BLOCK': {
        if (
          !canCastBreach ||
          map.getObject(this.lockedTarget.pos) !== 'BLOCK' ||
          this.isLockInvalidated(snapshot, 15)
        ) {
          this.clearTargetLock();
        }
        break;
      }
      case 'POWER_STONE': {
        if (
          holdItem === 'POWER_STONE' ||
          map.getItem(this.lockedTarget.pos) !== 'POWER_STONE' ||
          map.getTorusDistance(playerPos, this.lockedTarget.pos).manhattan > 10 ||
          this.isLockInvalidated(snapshot, 12)
        ) {
          this.clearTargetLock();
        }
        break;
      }
      case 'DEATH': {
        if (
          !hasDeath ||
          map.getItem(this.lockedTarget.pos) !== 'DEATH' ||
          this.isLockInvalidated(snapshot, 10)
        ) {
          this.clearTargetLock();
        }
        break;
      }
      case 'KEY': {
        if (
          holdItem === 'KEY' ||
          map.getItem(this.lockedTarget.pos) !== 'KEY' ||
          this.isLockInvalidated(snapshot, 15)
        ) {
          this.clearTargetLock();
        }
        break;
      }
      case 'CHEST': {
        if (holdItem !== 'KEY' || map.getObject(this.lockedTarget.pos) !== 'CHEST') {
          this.clearTargetLock();
        } else if (this.isLockInvalidated(snapshot, 15)) {
          snapshot.memory.markTargetUnreachable(this.lockedTarget.pos, 20, snapshot.totalTurns);
          this.clearTargetLock();
        }
        break;
      }
      default:
        this.clearTargetLock();
        break;
    }
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    const player = engine.getPlayer();
    const map = snapshot.map;
    const isGlobal = this.zoneId === 'GLOBAL_ALL';
    const zone = !isGlobal ? snapshot.spatial.treasureZones.get(this.zoneId) : undefined;
    const canCastBreach =
      snapshot.milestones.canBreak &&
      (MagicSystem.canCast(player, 'BREAK').allowed || MagicSystem.canCast(player, 'KICK').allowed);

    // Step 1: ターゲットロックの有効性検証
    this.verifyAndTransitionLocks(snapshot, player.pos, player.holdItem, player.hasDeath, canCastBreach);

    // 1. ショートカット開削の検討（ロック中の岩があればそのまま継続）
    if (canCastBreach) {
      if (this.lockedTarget?.kind === 'BLOCK') {
        this.subMode = 'BREACHING_ENTRY';
        return {
          type: 'BREACH_SHORTCUT',
          targetPos: this.lockedTarget.pos,
          priority: 85,
          reason: `ショートカット壁・岩を開削継続 (${this.lockedTarget.pos.x}, ${this.lockedTarget.pos.y})`,
        };
      }

      const viableShortcuts = snapshot.spatial.getViableBreachShortcuts(player, map);
      for (const sc of viableShortcuts) {
        if (snapshot.memory.isTargetUnreachable(sc.pos, snapshot.totalTurns)) continue;
        const distFromPlayer = map.getTorusDistance(player.pos, sc.pos).manhattan;
        if (distFromPlayer > 20) continue;

        if (zone) {
          const distToZone = this.getDistanceToZoneBounds(sc.pos, zone);
          if (distToZone <= 4) {
            this.subMode = 'BREACHING_ENTRY';
            this.lockTarget('BLOCK', sc.pos, snapshot.totalTurns, player.pos, map);
            return {
              type: 'BREACH_SHORTCUT',
              targetPos: sc.pos,
              priority: 85,
              reason: `ゾーン ${this.zoneId} へのショートカット壁・岩を開削 (${sc.pos.x}, ${sc.pos.y})`,
            };
          }
        } else if (distFromPlayer <= 8) {
          this.subMode = 'BREACHING_ENTRY';
          this.lockTarget('BLOCK', sc.pos, snapshot.totalTurns, player.pos, map);
          return {
            type: 'BREACH_SHORTCUT',
            targetPos: sc.pos,
            priority: 85,
            reason: `未開通ショートカットを開削 (${sc.pos.x}, ${sc.pos.y})`,
          };
        }
      }
    }

    // 2. 足元・近傍の有益アイテム回収
    const floorItem = map.getItem(player.pos);
    const needStr = player.strength < snapshot.params.targetStr;
    const needExp = player.experience < snapshot.params.targetDefenseExp;
    const needMagic = player.magic < snapshot.params.maxTargetMagic;
    const situation = MapSituationEvaluator.get(snapshot, engine);
    const itemsSummary = situation.items;
    const hasPendingRoomChests =
      itemsSummary.nearbyChestCountWithin8 > 0 || itemsSummary.activeZoneRemainingChests > 0;

    // 2-A. 足元パワーストーン
    if (floorItem === 'POWER_STONE' && needStr) {
      if (!itemsSummary.shouldContinueChestChain) {
        this.subMode = 'COLLECTING_DROP';
        this.lockTarget('POWER_STONE', player.pos, snapshot.totalTurns, player.pos, map);
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

    // 2-A2. 同一宝物庫内（距離 <= 8）のパワーストーン回収（ロック維持対応）
    if (needStr && !itemsSummary.shouldContinueChestChain) {
      let stoneTarget: Position | null = null;
      if (this.lockedTarget?.kind === 'POWER_STONE') {
        stoneTarget = this.lockedTarget.pos;
      } else if (
        itemsSummary.nearestPowerStone &&
        map.getTorusDistance(player.pos, itemsSummary.nearestPowerStone).manhattan <= 8 &&
        (player.holdItem === 'NONE' || !itemsSummary.hasChestWithin2To8)
      ) {
        const candidate = itemsSummary.nearestPowerStone;
        const inCurrentZone = zone ? this.getDistanceToZoneBounds(candidate, zone) === 0 : false;
        const withinPath10 = itemsSummary.getNoBreakDist(candidate) <= 10;
        if (inCurrentZone || withinPath10) {
          stoneTarget = candidate;
        }
      }
      if (stoneTarget) {
        this.subMode = 'COLLECTING_DROP';
        this.lockTarget('POWER_STONE', stoneTarget, snapshot.totalTurns, player.pos, map);
        return {
          type: 'NAVIGATE_TO_POSITION',
          targetPos: stoneTarget,
          targetItemType: 'POWER_STONE',
          priority: 93,
          reason: `宝物庫内で出現したパワーストーンを回収 (${stoneTarget.x}, ${stoneTarget.y})`,
        };
      }
    }

    // 2-B. 足元の魔法の壺 (POTION)
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

    // 2-C. 足元の金貨 (COIN)
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

    // 2-D. 死神憑依中の地面死神先行排除
    if (player.hasDeath && !itemsSummary.shouldContinueChestChain) {
      const deathTarget =
        this.lockedTarget?.kind === 'DEATH'
          ? this.lockedTarget.pos
          : (itemsSummary.nearestDeath &&
             map.getTorusDistance(player.pos, itemsSummary.nearestDeath).manhattan >= 1 &&
             map.getTorusDistance(player.pos, itemsSummary.nearestDeath).manhattan <= 8
              ? itemsSummary.nearestDeath
              : null);
      if (deathTarget) {
        this.subMode = 'COLLECTING_DROP';
        this.lockTarget('DEATH', deathTarget, snapshot.totalTurns, player.pos, map);
        return {
          type: 'NAVIGATE_TO_POSITION',
          targetPos: deathTarget,
          priority: 91,
          reason: `💀 死神憑依中のため近傍の地面の死神を先行排除 (${deathTarget.x}, ${deathTarget.y})`,
        };
      }
    }

    // 3. FETCHING_KEY: 鍵を持っていない場合（ロック済み鍵を維持して移動）
    if (player.holdItem !== 'KEY') {
      this.subMode = 'FETCHING_KEY';
      if (floorItem === 'KEY') {
        this.lockTarget('KEY', player.pos, snapshot.totalTurns, player.pos, map);
        return {
          type: 'PICKUP_ITEM',
          targetItemType: 'KEY',
          priority: 88,
          reason: '足元の鍵を拾う',
        };
      }

      const keyPos =
        this.lockedTarget?.kind === 'KEY'
          ? this.lockedTarget.pos
          : this.findNearestAvailableKey(player.pos, map, snapshot);
      if (keyPos) {
        this.lockTarget('KEY', keyPos, snapshot.totalTurns, player.pos, map);
        return {
          type: 'NAVIGATE_TO_POSITION',
          targetPos: keyPos,
          targetItemType: 'KEY',
          priority: 85,
          reason: `宝箱開錠用の鍵へ移動 (${keyPos.x}, ${keyPos.y})`,
        };
      }

      this.completionReason = this.hasMadeProgress(snapshot) ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      this.status = 'ABORTED';
      this.subMode = 'EXHAUSTED';
      this.clearTargetLock();
      return {
        type: 'WANDER_SAFELY',
        priority: 20,
        reason: '到達可能な鍵が存在しないため作戦中断',
      };
    }

    // 4. OPENING_CHEST: 鍵所持中 -> 8歩周期チェインまたはロック済み宝箱への移動・開錠
    if (player.holdItem === 'KEY') {
      this.subMode = 'OPENING_CHEST';

      const needMoreStr =
        player.strength < snapshot.params.targetStr &&
        !snapshot.milestones.isStrCapped &&
        itemsSummary.projectedStrFromNearbyStones < snapshot.params.targetStr;

      let bestParityChest: Position | null = null;
      if (needMoreStr && player.stepCountSinceStone <= 7) {
        const remSteps = 8 - player.stepCountSinceStone;
        const zonePool = zone
          ? itemsSummary.getReachableChestsInZone(zone.bounds)
          : itemsSummary.chests;
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
      }

      let targetChest: Position | null = null;
      if (bestParityChest) {
        targetChest = bestParityChest;
      } else if (this.lockedTarget?.kind === 'CHEST') {
        targetChest = this.lockedTarget.pos;
      } else {
        const nearestGlobal = this.findNearestChestGlobal(player.pos, map, snapshot);
        const nearestInZone = zone ? this.findNearestChestInZone(player.pos, zone, map, snapshot) : null;
        if (nearestGlobal && nearestInZone) {
          const distGlobal = map.getTorusDistance(player.pos, nearestGlobal).manhattan;
          const distZone = map.getTorusDistance(player.pos, nearestInZone).manhattan;
          targetChest = distGlobal < distZone ? nearestGlobal : nearestInZone;
        } else {
          targetChest = nearestInZone ?? nearestGlobal;
        }
      }

      const isAtChestStep8 =
        player.stepCountSinceStone === 8 && map.getObject(player.pos) === 'CHEST';
      const useEightStep = needMoreStr && (bestParityChest !== null || isAtChestStep8);

      if (targetChest) {
        this.lockTarget('CHEST', targetChest, snapshot.totalTurns, player.pos, map);
        return {
          type: useEightStep ? 'UNLOCK_CHEST_8STEP' : 'UNLOCK_CHEST_RAPID',
          targetPos: targetChest,
          priority: 88,
          reason: useEightStep
            ? `宝箱の8歩開錠 (${targetChest.x}, ${targetChest.y})`
            : `宝箱の最速開錠 (${targetChest.x}, ${targetChest.y})`,
        };
      }

      // 到達可能宝箱が枯渇している場合
      const curActual = itemsSummary.totalActualChests;
      this.subMode = 'EXHAUSTED';
      this.clearTargetLock();
      if (curActual === 0) {
        this.completionReason = 'OBJECTIVE_ACHIEVED';
        this.status = 'COMPLETED';
        return {
          type: 'DROP_HOLD_ITEM',
          priority: 75,
          reason: `ゾーン ${this.zoneId} 内の到達可能宝箱が完了したため鍵を手放し手ぶら回収へ移行`,
        };
      } else {
        this.completionReason = this.hasMadeProgress(snapshot) ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
        this.status = 'ABORTED';
        return {
          type: 'WANDER_SAFELY',
          priority: 20,
          reason: `ゾーン ${this.zoneId} の残存宝箱が経路遮断のため一時中断`,
        };
      }
    }

    // 5. フォールバック: ゾーン中心へ移動
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
      this.completionReason = this.hasMadeProgress(snapshot) ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
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
