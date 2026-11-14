import { Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { Player } from '../../models/Player.js';
import { Dragon, DragonPart } from '../../models/Dragon.js';
import { EpisodicMemory } from './EpisodicMemory.js';
import {
  MapTacticalMetadata,
  RecommendedPush,
  DragonLairStyle,
} from '../../systems/generator/ThemeBlockTypes.js';

export interface TreasureZoneState {
  id: string;
  bounds: { x1: number; y1: number; x2: number; y2: number };
  entryPorts: Position[];
  totalChests: number;
  remainingChests: number;
  uncollectedItems: { pos: Position; type: string }[];
  isEightStepOptimal: boolean;
  isCleared: boolean;
  dangerLevel: number;
}

export interface BreachShortcutState {
  pos: Position;
  targetZoneId?: string;
  isBreached: boolean;
  blocksRemaining: number;
}

export interface GravePuzzleState {
  gravePos: Position;
  themeId: string;
  sealMode: 'DIRECT_8WAY' | 'BOX_EXITS';
  sealTargetPositions: Position[];
  recommendedPushes: RecommendedPush[];
  priority: 'HIGH' | 'NORMAL' | 'LOW';
  isSealed: boolean;
}

/**
 * SpatialKnowledge (空間・トポロジー・メタデータ知識)
 *
 * 生成器（ThemeBlockAllocator）が提供する MapTacticalMetadata を統合し、
 * 宝物庫ゾーン、開削ショートカット、墓パズルの状態をリアルタイムに追跡する。
 */
export class SpatialKnowledge {
  public treasureZones: Map<string, TreasureZoneState> = new Map();
  public breachShortcuts: BreachShortcutState[] = [];
  public gravePuzzles: GravePuzzleState[] = [];
  public dragonLairStyle: DragonLairStyle = 'STANDARD_FORTRESS';
  public recommendedRelocateAnchors: Position[] = [];

  constructor(map: WorldMap, metadata?: MapTacticalMetadata) {
    this.initializeFromMapAndMetadata(map, metadata);
  }

  private initializeFromMapAndMetadata(map: WorldMap, metadata?: MapTacticalMetadata): void {
    const meta = metadata ?? (map.tacticalMetadata as MapTacticalMetadata | undefined);

    if (meta) {
      this.dragonLairStyle = meta.dragonLairStyle ?? 'STANDARD_FORTRESS';
      this.recommendedRelocateAnchors = [...(meta.recommendedRelocateAnchors ?? [])];

      // 1. 宝物庫ゾーンの初期化
      if (meta.treasureZoneHints) {
        for (const hint of meta.treasureZoneHints) {
          this.treasureZones.set(hint.id, {
            id: hint.id,
            bounds: { ...hint.bounds },
            entryPorts: hint.entryPorts.map(p => ({ ...p })),
            totalChests: hint.chestCount,
            remainingChests: hint.chestCount,
            uncollectedItems: [],
            isEightStepOptimal: hint.isEightStepOptimal,
            isCleared: false,
            dangerLevel: 0,
          });
        }
      }

      // 2. 開削ショートカットの初期化
      if (meta.breachShortcutPositions) {
        for (const pos of meta.breachShortcutPositions) {
          this.breachShortcuts.push({
            pos: { ...pos },
            isBreached: false,
            blocksRemaining: 1,
          });
        }
      }

      // 3. 墓パズルの初期化
      if (meta.gravePuzzleHints) {
        for (const hint of meta.gravePuzzleHints) {
          this.gravePuzzles.push({
            gravePos: { ...hint.gravePos },
            themeId: hint.themeId,
            sealMode: hint.sealMode,
            sealTargetPositions: hint.sealTargetPositions.map(p => ({ ...p })),
            recommendedPushes: hint.recommendedPushes.map(r => ({
              blockPos: { ...r.blockPos },
              dir: r.dir,
              destinationPos: { ...r.destinationPos },
            })),
            priority: hint.priority,
            isSealed: false,
          });
        }
      }
    }

    // 初回スキャン
    this.update(map);
  }

  /**
   * マップの現在状況（残存宝箱、残存アイテム、開削状況、墓封鎖状況）を走査して更新
   */
  public update(map: WorldMap): void {
    // 1. 各ゾーン内の宝箱・アイテム数の再集計
    for (const zone of this.treasureZones.values()) {
      let remainingChests = 0;
      const uncollected: { pos: Position; type: string }[] = [];

      const { x1, y1, x2, y2 } = zone.bounds;
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const p = map.wrapPosition({ x, y });
          if (map.getObject(p) === 'CHEST') {
            remainingChests++;
          }
          const item = map.getItem(p);
          if (item !== 'NONE') {
            uncollected.push({ pos: p, type: item });
          }
        }
      }

      zone.remainingChests = remainingChests;
      zone.uncollectedItems = uncollected;
      zone.isCleared = remainingChests === 0;
    }

    // 2. 開削ショートカットの開通状況更新
    for (const sc of this.breachShortcuts) {
      const obj = map.getObject(sc.pos);
      const base = map.getBaseTile(sc.pos);
      // 通行可能床になっていれば開通済み
      sc.isBreached = obj !== 'BLOCK' && base !== 'WALL_STATIC';
      sc.blocksRemaining = (obj === 'BLOCK' || base === 'WALL_STATIC') ? 1 : 0;
    }

    // 3. 墓パズルの封鎖状況更新
    for (const gp of this.gravePuzzles) {
      if (gp.sealMode === 'BOX_EXITS') {
        // 出口チョークポイントがすべて埋まっているか
        const allBlocked = gp.sealTargetPositions.every(tp => {
          const obj = map.getObject(tp);
          const base = map.getBaseTile(tp);
          return obj === 'BLOCK' || base === 'WALL_STATIC';
        });
        gp.isSealed = allBlocked;
      } else {
        // DIRECT_8WAY: 墓周囲8マスがすべて埋まっているか
        let openCount = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const p = map.wrapPosition({ x: gp.gravePos.x + dx, y: gp.gravePos.y + dy });
            const obj = map.getObject(p);
            const base = map.getBaseTile(p);
            if (obj !== 'BLOCK' && base !== 'WALL_STATIC') {
              openCount++;
            }
          }
        }
        gp.isSealed = openCount === 0;
      }
    }
  }

  /**
   * 指定座標が含まれる宝物庫ゾーンを取得
   */
  public getZoneAt(pos: Position): TreasureZoneState | null {
    for (const zone of this.treasureZones.values()) {
      const minX = Math.min(zone.bounds.x1, zone.bounds.x2);
      const maxX = Math.max(zone.bounds.x1, zone.bounds.x2);
      const minY = Math.min(zone.bounds.y1, zone.bounds.y2);
      const maxY = Math.max(zone.bounds.y1, zone.bounds.y2);

      if (pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) {
        return zone;
      }
    }
    return null;
  }

  /**
   * 最寄りの未攻略宝物庫ゾーンを取得
   * （到達不能ブラックリストに登録されている宝箱しかないゾーンは除外）
   */
  public getNearestUnclearedTreasureZone(
    fromPos: Position,
    map: WorldMap,
    memory?: EpisodicMemory,
    currentTurn?: number
  ): TreasureZoneState | null {
    let nearest: TreasureZoneState | null = null;
    let minDistance = Infinity;

    for (const zone of this.treasureZones.values()) {
      if (zone.isCleared || zone.remainingChests === 0) continue;
      if (memory && currentTurn !== undefined && memory.isZoneUnreachable(zone.id, currentTurn)) continue;

      // ゾーン内の残存宝箱がすべて到達不能か判定
      if (memory && currentTurn !== undefined) {
        let hasAnyReachableChest = false;
        const minX = Math.min(zone.bounds.x1, zone.bounds.x2);
        const maxX = Math.max(zone.bounds.x1, zone.bounds.x2);
        const minY = Math.min(zone.bounds.y1, zone.bounds.y2);
        const maxY = Math.max(zone.bounds.y1, zone.bounds.y2);

        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const p = map.wrapPosition({ x, y });
            if (map.getObject(p) === 'CHEST' && !memory.isTargetUnreachable(p, currentTurn)) {
              hasAnyReachableChest = true;
              break;
            }
          }
          if (hasAnyReachableChest) break;
        }

        if (!hasAnyReachableChest) {
          continue; // すべての宝箱が現在到達不能なのでスキップ
        }
      }

      // ゾーン中心またはエントリーポートまでの最短距離
      const centerX = Math.floor((zone.bounds.x1 + zone.bounds.x2) / 2);
      const centerY = Math.floor((zone.bounds.y1 + zone.bounds.y2) / 2);
      const dist = map.getTorusDistance(fromPos, { x: centerX, y: centerY }).manhattan;

      if (dist < minDistance) {
        minDistance = dist;
        nearest = zone;
      }
    }

    return nearest;
  }

  /**
   * BREAK習得時に利用可能な未開削ショートカット一覧を取得
   */
  public getViableBreachShortcuts(player: Player, _map?: WorldMap): BreachShortcutState[] {
    if (player.experience < 4000) return [];
    return this.breachShortcuts.filter(sc => !sc.isBreached);
  }

  /**
   * 未封鎖の墓パズル一覧を取得
   */
  public getUnsealedGravePuzzles(): GravePuzzleState[] {
    return this.gravePuzzles.filter(gp => !gp.isSealed);
  }

  /**
   * ドラゴン特定首に対する斜め安全攻撃可能マス (Attack Spot) を算出
   *
   * 条件:
   * 1. 首の斜め4マス (dx=±1, dy=±1)
   * 2. 壁 (WALL_STATIC) でない
   * 3. ドラゴンの体パーツに乗っていない
   * 4. 他のすべての生存首と直角隣接（十字方向1マス）していない（正面ブレス・噛み付きの直撃を完全排除）
   */
  public calculateHeadAttackSpots(head: DragonPart, dragon: Dragon, map: WorldMap): Position[] {
    if (!head.isAlive) return [];
    const spots: Position[] = [];
    const deltas = [
      { dx: -1, dy: -1 },
      { dx: 1, dy: -1 },
      { dx: -1, dy: 1 },
      { dx: 1, dy: 1 },
    ];
    const livingHeads = dragon.heads.filter(h => h.isAlive);

    for (const d of deltas) {
      const spot = map.wrapPosition({ x: head.pos.x + d.dx, y: head.pos.y + d.dy });
      if (map.getBaseTile(spot) === 'WALL_STATIC') continue;
      if (map.getBaseTile(spot) === 'GRAVE' && map.getObject(spot) === 'NONE') continue;
      if (dragon.getPartAt(spot)) continue;

      // 生存首のいずれかと直角隣接していないこと（ブレス直撃防止）
      const isOrthogonal = livingHeads.some(h => map.getTorusDistance(spot, h.pos).manhattan === 1);
      if (isOrthogonal) continue;

      spots.push(spot);
    }
    return spots;
  }

  /**
   * ドラゴンの全生存首について安全攻撃可能マスを一覧算出
   */
  public calculateAllDragonAttackSpots(dragon: Dragon, map: WorldMap): { head: DragonPart; attackSpots: Position[] }[] {
    return dragon.heads
      .filter(h => h.isAlive)
      .map(h => ({
        head: h,
        attackSpots: this.calculateHeadAttackSpots(h, dragon, map),
      }));
  }
}
