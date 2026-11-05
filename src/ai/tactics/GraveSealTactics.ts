import { Direction, Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { Player } from '../../models/Player.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { Dragon } from '../../models/Dragon.js';
import { MagicSystem } from '../../systems/MagicSystem.js';
import { ThreatEvaluator } from '../../systems/ThreatEvaluator.js';
import { BotAction, BotPhase, BotSkillProfile, BotStrategyTuning, GraveSealPolicy, MapAssessment } from '../BotTypes.js';
import { BotNavigator } from '../BotNavigator.js';

export interface GraveSealContext {
  tuning: Required<BotStrategyTuning>;
  profile: BotSkillProfile;
  turnsInPhase: number;
  mapAssessment: MapAssessment | null;
  setPhase: (phase: BotPhase) => void;
  actPowerRush: (player: Player, map: WorldMap, enemies: EnemyInstance[], dragon: Dragon) => BotAction;
  handleMoveOrBreak: (dir: Direction, player: Player, map: WorldMap) => BotAction;
}

export class GraveSealTactics {
  public totalGraveSealTurns: number = 0;
  public graveSealAborted: boolean = false;

  constructor(private botNav: BotNavigator) {}

  public resetTurns(): void {
    this.totalGraveSealTurns = 0;
    this.graveSealAborted = false;
  }

  public hasAvailableSealTools(
    map: WorldMap,
    player: Player,
    enemies: EnemyInstance[],
    dragon?: Dragon,
    context?: { tuning: Required<BotStrategyTuning>; mapAssessment: MapAssessment | null }
  ): boolean {
    if (this.graveSealAborted || this.totalGraveSealTurns >= 60) return false;
    if (player.holdItem === 'CROSS') return true;
    const unusedCross = this.findNearestUnusedCross(player.pos, map, enemies, player);
    if (unusedCross) return true;

    const hasRingOrCanGet = player.holdItem === 'RING' || this.botNav.findAnyItemOnMap('RING', map) !== null;
    if (hasRingOrCanGet) {
      const openGraves = this.getTargetOpenGraves(map, enemies, undefined, context?.tuning, context?.mapAssessment);
      if (dragon && this.findBlockPushForGraves(player, map, enemies, dragon, openGraves)) {
        return true;
      }
    }
    return false;
  }

  public getTargetOpenGraves(
    map: WorldMap,
    enemies: EnemyInstance[],
    policy?: GraveSealPolicy,
    tuning?: Required<BotStrategyTuning>,
    mapAssessment?: MapAssessment | null
  ): { grave: Position; openSpots: Position[] }[] {
    const all = this.getAllOpenGraves(map, enemies);
    const effectivePolicy = policy ?? (
      tuning?.graveSealPolicy === 'AUTO'
        ? (mapAssessment?.recommendedPolicy ?? 'NEAR_HOME')
        : (tuning?.graveSealPolicy ?? 'NEAR_HOME')
    );

    if (effectivePolicy === 'NONE') return [];
    if (effectivePolicy === 'ALL') return all;
    if (effectivePolicy === 'NEAR_HOME') {
      const home = map.realHomePos;
      const radius = tuning?.nearHomeRadius ?? 12;
      return all.filter(({ grave }) => map.getTorusDistance(home, grave).manhattan <= radius);
    }
    return all;
  }

  public isCrossSealingAnyGrave(pos: Position, map: WorldMap): boolean {
    return this.botNav.isCrossSealingAnyGrave(pos, map);
  }

  public findNearestAnyCross(from: Position, map: WorldMap): Position | null {
    let nearest: Position | null = null;
    let minDist = Infinity;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (this.botNav.isTargetUnreachable(p)) continue;
        if (map.getItem(p) === 'CROSS') {
          const dist = map.getTorusDistance(from, p).manhattan;
          if (dist < minDist) {
            minDist = dist;
            nearest = p;
          }
        }
      }
    }
    return nearest;
  }

  public findNearestUnusedCross(
    from: Position,
    map: WorldMap,
    enemies?: EnemyInstance[],
    player?: Player
  ): Position | null {
    let nearest: Position | null = null;
    let minDist = Infinity;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (this.botNav.isTargetUnreachable(p)) continue;
        if (map.getItem(p) === 'CROSS') {
          if (this.isCrossSealingAnyGrave(p, map)) continue;

          if (enemies && player) {
            const enemy = enemies.find(e => e.isAlive && e.pos.x === x && e.pos.y === y);
            if (enemy) {
              const threat = ThreatEvaluator.evaluateThreat(player, enemy);
              if (threat !== 'ONE_SHOT' && threat !== 'SAFE') continue;
            }
          }
          const dist = map.getTorusDistance(from, p).manhattan;
          if (dist < minDist) {
            minDist = dist;
            nearest = p;
          }
        }
      }
    }
    return nearest;
  }

  public isTileSealingGrave(pos: Position, map: WorldMap, enemies: EnemyInstance[]): boolean {
    const p = map.wrapPosition(pos);
    const base = map.getBaseTile(p);
    if (base === 'WALL_STATIC' || base === 'HOME') return true;
    const obj = map.getObject(p);
    if (obj === 'BLOCK' || obj === 'CHEST') return true;
    if (map.getItem(p) === 'CROSS') return true;
    if (enemies.some(e => e.isAlive && e.isPermanentlyFrozen && e.pos.x === p.x && e.pos.y === p.y)) return true;
    return false;
  }

  public getOpenGraveSpots(grave: Position, map: WorldMap, enemies: EnemyInstance[]): Position[] {
    const hint = map.tacticalMetadata?.gravePuzzleHints?.find(
      h => h.gravePos.x === grave.x && h.gravePos.y === grave.y
    );

    if (hint) {
      if (hint.sealMode === 'BOX_EXITS') {
        const openExits: Position[] = [];
        for (const target of hint.sealTargetPositions) {
          if (!this.isTileSealingGrave(target, map, enemies)) {
            openExits.push(map.wrapPosition(target));
          }
        }
        return openExits;
      } else if (hint.sealMode === 'DIRECT_8WAY' && hint.sealTargetPositions.length > 0) {
        const openSpots: Position[] = [];
        for (const target of hint.sealTargetPositions) {
          if (!this.isTileSealingGrave(target, map, enemies)) {
            openSpots.push(map.wrapPosition(target));
          }
        }
        return openSpots;
      }
    }

    const openSpots: Position[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nb = map.wrapPosition({ x: grave.x + dx, y: grave.y + dy });
        if (!this.isTileSealingGrave(nb, map, enemies)) {
          openSpots.push(nb);
        }
      }
    }
    return openSpots;
  }

  public getAllOpenGraves(map: WorldMap, enemies: EnemyInstance[]): { grave: Position; openSpots: Position[] }[] {
    const results: { grave: Position; openSpots: Position[] }[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (map.getBaseTile(p) === 'GRAVE') {
          const openSpots = this.getOpenGraveSpots(p, map, enemies);
          if (openSpots.length > 0) {
            results.push({ grave: p, openSpots });
          }
        }
      }
    }
    return results;
  }

  public findBlockPushForGraves(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    openGraves: { grave: Position; openSpots: Position[] }[],
    handleMoveOrBreak?: (dir: Direction, player: Player, map: WorldMap) => BotAction
  ): BotAction | null {
    const curPos = player.pos;

    // 1. tacticalMetadata の recommendedPushes を優先チェック
    if (map.tacticalMetadata?.gravePuzzleHints) {
      const openGraveSet = new Set(openGraves.map(g => `${g.grave.x},${g.grave.y}`));
      for (const hint of map.tacticalMetadata.gravePuzzleHints) {
        if (!openGraveSet.has(`${hint.gravePos.x},${hint.gravePos.y}`)) continue;
        if (!hint.recommendedPushes || hint.recommendedPushes.length === 0) continue;

        for (const push of hint.recommendedPushes) {
          const blockPos = map.wrapPosition(push.blockPos);
          const destPos = map.wrapPosition(push.destinationPos);

          // ブロックがまだ blockPos にあるか？
          if (map.getObject(blockPos) !== 'BLOCK') continue;
          // 行き先がプッシュ先として有効か？
          if (!map.isPushDestinationValid(destPos, enemies)) continue;

          // pushFromPos の計算
          const d = this.getDirectionOffset(push.dir);
          const pushFromPos = map.wrapPosition({ x: blockPos.x - d.dx, y: blockPos.y - d.dy });

          if (map.getBaseTile(pushFromPos) === 'WALL_STATIC') continue;
          if (map.getBaseTile(pushFromPos) === 'GRAVE') continue;
          if (map.getObject(pushFromPos) !== 'NONE') continue;

          if (curPos.x === pushFromPos.x && curPos.y === pushFromPos.y) {
            return { type: 'MOVE', dir: push.dir };
          }

          const dirToStand = this.botNav.findPath(curPos, pushFromPos, map, player, enemies, player.canDiagonal, dragon);
          if (dirToStand) {
            if (handleMoveOrBreak) {
              return handleMoveOrBreak(dirToStand, player, map);
            }
            return { type: 'MOVE', dir: dirToStand };
          }
        }
      }
    }

    const cardDirs: { dir: Direction; dx: number; dy: number }[] = [
      { dir: 'UP', dx: 0, dy: -1 },
      { dir: 'DOWN', dx: 0, dy: 1 },
      { dir: 'LEFT', dx: -1, dy: 0 },
      { dir: 'RIGHT', dx: 1, dy: 0 },
    ];

    for (const { openSpots } of openGraves) {
      for (const spot of openSpots) {
        if (!map.isPushDestinationValid(spot, enemies)) continue;

        for (const d of cardDirs) {
          const blockPos = map.wrapPosition({ x: spot.x - d.dx, y: spot.y - d.dy });
          if (map.getObject(blockPos) !== 'BLOCK') continue;

          const pushFromPos = map.wrapPosition({ x: blockPos.x - d.dx, y: blockPos.y - d.dy });

          if (map.getBaseTile(pushFromPos) === 'WALL_STATIC') continue;
          if (map.getBaseTile(pushFromPos) === 'GRAVE') continue;
          if (map.getObject(pushFromPos) !== 'NONE') continue;

          if (curPos.x === pushFromPos.x && curPos.y === pushFromPos.y) {
            return { type: 'MOVE', dir: d.dir };
          }

          const dirToStand = this.botNav.findPath(curPos, pushFromPos, map, player, enemies, player.canDiagonal, dragon);
          if (dirToStand) {
            if (handleMoveOrBreak) {
              return handleMoveOrBreak(dirToStand, player, map);
            }
            return { type: 'MOVE', dir: dirToStand };
          }
        }
      }
    }

    return null;
  }

  public actGraveSeal(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    context: GraveSealContext
  ): BotAction {
    this.totalGraveSealTurns++;
    const curPos = player.pos;

    if (context.turnsInPhase >= 40 || this.totalGraveSealTurns >= 60) {
      return this.abortGraveSeal(player, map, enemies, dragon, context);
    }

    if (MagicSystem.canCast(player, 'FREEZE').allowed) {
      const adjacentLivingEnemies = enemies.filter(
        e => e.isAlive && !e.isPermanentlyFrozen && map.getTorusDistance(curPos, e.pos).chebyshev <= 1
      );
      if (adjacentLivingEnemies.length > 0) {
        return { type: 'MAGIC', magic: 'FREEZE' };
      }
    }

    if (player.holdItem !== 'NONE' && player.holdItem !== 'CROSS' && player.holdItem !== 'RING') {
      const isCurSafe = this.botNav.isSafeEmptyFloor(curPos, map, enemies, dragon, player);
      if (isCurSafe && map.getItem(curPos) === 'NONE') {
        return { type: 'SPACE' };
      }
      const safeDir = this.botNav.findAdjacentSafeEmptyFloor(curPos, map, enemies, dragon, player);
      if (safeDir) return { type: 'MOVE', dir: safeDir };
    }

    if (player.holdItem === 'CROSS') {
      const openGraves = this.getTargetOpenGraves(map, enemies, undefined, context.tuning, context.mapAssessment);
      if (openGraves.length === 0) {
        return this.abortGraveSeal(player, map, enemies, dragon, context);
      }

      let bestSpot: Position | null = null;
      let minDist = Infinity;
      for (const { openSpots } of openGraves) {
        for (const spot of openSpots) {
          const dist = map.getTorusDistance(curPos, spot).manhattan;
          if (dist < minDist) {
            minDist = dist;
            bestSpot = spot;
          }
        }
      }

      if (bestSpot) {
        if (curPos.x === bestSpot.x && curPos.y === bestSpot.y) {
          return { type: 'SPACE' };
        }
        const dir = this.botNav.findPath(curPos, bestSpot, map, player, enemies, player.canDiagonal, dragon);
        if (dir) return context.handleMoveOrBreak(dir, player, map);
      }

      return this.abortGraveSeal(player, map, enemies, dragon, context);
    }

    if (player.holdItem === 'RING') {
      const openGraves = this.getTargetOpenGraves(map, enemies, undefined, context.tuning, context.mapAssessment);
      const nearbyOpenGraves = openGraves.filter(
        ({ grave }) => map.getTorusDistance(curPos, grave).manhattan <= 15
      );

      if (nearbyOpenGraves.length > 0) {
        const pushAction = this.findBlockPushForGraves(player, map, enemies, dragon, nearbyOpenGraves, context.handleMoveOrBreak);
        if (pushAction) {
          return pushAction;
        }
      }

      return this.abortGraveSeal(player, map, enemies, dragon, context);
    }

    if (player.holdItem === 'NONE') {
      const openGraves = this.getTargetOpenGraves(map, enemies, undefined, context.tuning, context.mapAssessment);
      if (openGraves.length > 0) {
        const crossPos = this.findNearestUnusedCross(curPos, map, enemies, player);
        if (crossPos) {
          if (curPos.x === crossPos.x && curPos.y === crossPos.y) {
            return { type: 'SPACE' };
          }
          const dir = this.botNav.findPath(curPos, crossPos, map, player, enemies, player.canDiagonal, dragon);
          if (dir) return context.handleMoveOrBreak(dir, player, map);
        }

        if (dragon && this.findBlockPushForGraves(player, map, enemies, dragon, openGraves)) {
          const ringCandidates = this.botNav.findNearestItemCandidates(curPos, 'RING', map, enemies, player, 3);
          const bestRing = ringCandidates[0] ?? this.botNav.findAnyItemOnMap('RING', map);
          if (bestRing) {
            if (curPos.x === bestRing.x && curPos.y === bestRing.y) {
              return { type: 'SPACE' };
            }
            const dir = this.botNav.findPath(curPos, bestRing, map, player, enemies, player.canDiagonal, dragon);
            if (dir) return context.handleMoveOrBreak(dir, player, map);
          }
        }
      }
    }

    return this.abortGraveSeal(player, map, enemies, dragon, context);
  }

  public abortGraveSeal(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    context: GraveSealContext
  ): BotAction {
    this.graveSealAborted = true;
    context.setPhase('POWER_RUSH');

    const curPos = player.pos;
    if (player.holdItem === 'RING' || player.holdItem === 'CROSS') {
      if (this.botNav.isSafeEmptyFloor(curPos, map, enemies, dragon, player)) {
        return { type: 'SPACE' };
      }
      const safeDir = this.botNav.findAdjacentSafeEmptyFloor(curPos, map, enemies, dragon, player);
      if (safeDir) return { type: 'MOVE', dir: safeDir };
    }

    return context.actPowerRush(player, map, enemies, dragon);
  }

  private getDirectionOffset(dir: Direction): { dx: number; dy: number } {
    switch (dir) {
      case 'UP': return { dx: 0, dy: -1 };
      case 'DOWN': return { dx: 0, dy: 1 };
      case 'LEFT': return { dx: -1, dy: 0 };
      case 'RIGHT': return { dx: 1, dy: 0 };
      default: return { dx: 0, dy: 0 };
    }
  }
}
