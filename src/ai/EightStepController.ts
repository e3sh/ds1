import { Direction, Position } from '../models/Types.js';
import { WorldMap } from '../models/WorldMap.js';
import { Player } from '../models/Player.js';
import { EnemyInstance } from '../models/Enemy.js';
import { Dragon } from '../models/Dragon.js';
import { ThreatEvaluator } from '../systems/ThreatEvaluator.js';
import { MovementSystem } from '../systems/MovementSystem.js';
import { BotAction } from './BotTypes.js';

export interface EightStepNavigator {
  isDragonFireLine(pos: Position, dragon: Dragon, map: WorldMap): boolean;
  getAdjacentEnemies(pos: Position, enemies: EnemyInstance[], map: WorldMap): { enemy: EnemyInstance; dir: Direction }[];
  clearPositionHistory(): void;
  getAdjacentDirection(from: Position, to: Position, map: WorldMap): Direction | null;
}

export class EightStepController {
  public eightStepTargetChestPos: Position | null = null;
  public eightStepOriginPos: Position | null = null;
  public eightStepPivotPos: Position | null = null;
  public eightStepWaitPos: Position | null = null;
  public eightStepPathToPivot: Position[] = [];

  constructor(private botNav: EightStepNavigator) {}

  public clearEightStepState(): void {
    this.eightStepTargetChestPos = null;
    this.eightStepOriginPos = null;
    this.eightStepPivotPos = null;
    this.eightStepWaitPos = null;
    this.eightStepPathToPivot = [];
  }

  public isSafeFloorForStepCycle(
    pos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon?: Dragon,
    player?: Player
  ): boolean {
    if (map.getBaseTile(pos) === 'WALL_STATIC') return false;
    if (map.getBaseTile(pos) === 'GRAVE') return false;
    if (map.getBaseTile(pos) === 'HOME') return false;
    if (dragon && dragon.getPartAt(pos)) return false;
    if (dragon && this.botNav.isDragonFireLine(pos, dragon, map)) return false;

    const onTileEnemy = enemies.find(e => e.isAlive && e.pos.x === pos.x && e.pos.y === pos.y);
    if (onTileEnemy) return false;

    if (player) {
      const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
      for (const dir of cardDirs) {
        const adj = map.wrapPosition(MovementSystem.getNextPosition(pos, dir));
        const adjEnemy = enemies.find(e => e.isAlive && e.pos.x === adj.x && e.pos.y === adj.y);
        if (adjEnemy) {
          const details = ThreatEvaluator.evaluateThreatDetails(player, adjEnemy);
          if (details.overallThreat !== 'ONE_SHOT' || details.defenseThreat === 'LETHAL' || details.isLethalOneShot) {
            return false;
          }
        }
      }
    }

    return true;
  }

  public findSafePathForStepCycle(
    from: Position,
    to: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    player: Player
  ): Position[] | null {
    if (from.x === to.x && from.y === to.y) return [];

    const queue: { pos: Position; path: Position[] }[] = [
      { pos: from, path: [] },
    ];
    const visited = new Set<string>();
    visited.add(`${from.x},${from.y}`);

    const cardDirs = [
      { dx: 0, dy: -1 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
    ];

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.path.length >= 7) continue;

      for (const d of cardDirs) {
        const nextPos = map.wrapPosition({ x: cur.pos.x + d.dx, y: cur.pos.y + d.dy });
        const key = `${nextPos.x},${nextPos.y}`;
        if (visited.has(key)) continue;

        if (nextPos.x === to.x && nextPos.y === to.y) {
          return [...cur.path, nextPos];
        }

        const nextObj = map.getObject(nextPos);
        if (nextObj !== 'NONE' && nextObj !== 'CHEST') continue;
        if (!this.isSafeFloorForStepCycle(nextPos, map, enemies, dragon, player)) continue;

        visited.add(key);
        queue.push({ pos: nextPos, path: [...cur.path, nextPos] });
      }
    }

    return null;
  }

  public findNearbyChestForEightStepCycle(
    curPos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    player: Player
  ): { chestPos: Position; pivotPos: Position; waitPos: Position; pathToPivot: Position[] } | null {
    const curThreats = this.botNav.getAdjacentEnemies(curPos, enemies, map);
    if (curThreats.some(({ enemy }) => {
      const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
      return details.overallThreat !== 'ONE_SHOT' || details.defenseThreat === 'LETHAL' || details.isLethalOneShot;
    })) {
      return null;
    }
    if (this.botNav.isDragonFireLine(curPos, dragon, map)) {
      return null;
    }

    const remSteps = 7 - player.stepCountSinceStone;
    if (remSteps < 1) {
      return null;
    }

    const diagonalOffsets = [
      { dx: 1, dy: 1 },
      { dx: 1, dy: -1 },
      { dx: -1, dy: 1 },
      { dx: -1, dy: -1 },
    ];

    if (remSteps === 7) {
      for (const offset of diagonalOffsets) {
        const chestPos = map.wrapPosition({ x: curPos.x + offset.dx, y: curPos.y + offset.dy });
        if (map.getObject(chestPos) !== 'CHEST') continue;
        if (!this.isSafeFloorForStepCycle(chestPos, map, enemies, dragon, player)) continue;

        const midPosA = map.wrapPosition({ x: curPos.x + offset.dx, y: curPos.y });
        const midPosB = map.wrapPosition({ x: curPos.x, y: curPos.y + offset.dy });
        const midObjA = map.getObject(midPosA);
        const midObjB = map.getObject(midPosB);
        const isPassableMid = (obj: string) => obj === 'NONE' || obj === 'CHEST';

        let selectedPivot: Position | null = null;
        if (midObjA === 'NONE' && this.isSafeFloorForStepCycle(midPosA, map, enemies, dragon, player)) {
          selectedPivot = midPosA;
        } else if (midObjB === 'NONE' && this.isSafeFloorForStepCycle(midPosB, map, enemies, dragon, player)) {
          selectedPivot = midPosB;
        } else if (isPassableMid(midObjA) && this.isSafeFloorForStepCycle(midPosA, map, enemies, dragon, player)) {
          selectedPivot = midPosA;
        } else if (isPassableMid(midObjB) && this.isSafeFloorForStepCycle(midPosB, map, enemies, dragon, player)) {
          selectedPivot = midPosB;
        }

        if (selectedPivot) {
          return {
            chestPos,
            pivotPos: selectedPivot,
            waitPos: { ...curPos },
            pathToPivot: [selectedPivot],
          };
        }
      }
    }

    const candidateChests: { pos: Position; dist: number }[] = [];
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const manhattan = Math.abs(dx) + Math.abs(dy);
        if (manhattan < 2 || manhattan > 6) continue;
        const p = map.wrapPosition({ x: curPos.x + dx, y: curPos.y + dy });
        if (map.getObject(p) === 'CHEST') {
          candidateChests.push({ pos: p, dist: manhattan });
        }
      }
    }

    candidateChests.sort((a, b) => a.dist - b.dist);

    const cardOffsets = [
      { dx: 0, dy: -1 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
    ];

    for (const candidate of candidateChests) {
      const chestPos = candidate.pos;
      if (!this.isSafeFloorForStepCycle(chestPos, map, enemies, dragon, player)) continue;

      for (const preferEmpty of [true, false]) {
        for (const off of cardOffsets) {
          const pivotPos = map.wrapPosition({ x: chestPos.x + off.dx, y: chestPos.y + off.dy });
          const pivotObj = map.getObject(pivotPos);
          if (preferEmpty) {
            if (pivotObj !== 'NONE') continue;
          } else {
            if (pivotObj !== 'CHEST') continue;
          }
          if (!this.isSafeFloorForStepCycle(pivotPos, map, enemies, dragon, player)) continue;

          const path = this.findSafePathForStepCycle(curPos, pivotPos, map, enemies, dragon, player);
          if (!path || path.length === 0) continue;

          const pathLen = path.length;
          if (pathLen <= remSteps && (remSteps - pathLen) % 2 === 0) {
            const waitPos = pathLen === 1 ? { ...curPos } : { ...path[path.length - 2] };
            return {
              chestPos,
              pivotPos,
              waitPos,
              pathToPivot: path,
            };
          }
        }
      }
    }

    return null;
  }

  public findDiagonalChestForEightStepCycle(
    curPos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    player: Player
  ): { chestPos: Position; pivotPos: Position } | null {
    const res = this.findNearbyChestForEightStepCycle(curPos, map, enemies, dragon, player);
    if (!res) return null;
    return { chestPos: res.chestPos, pivotPos: res.pivotPos };
  }

  public handleEightStepCycle(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon
  ): BotAction | null {
    if (!this.eightStepTargetChestPos || !this.eightStepPivotPos || !this.eightStepWaitPos) {
      this.clearEightStepState();
      return null;
    }

    if (player.holdItem !== 'KEY') {
      this.clearEightStepState();
      return null;
    }

    if (map.getObject(this.eightStepTargetChestPos) !== 'CHEST') {
      this.clearEightStepState();
      return null;
    }

    const curPos = player.pos;

    const adjacentThreats = this.botNav.getAdjacentEnemies(curPos, enemies, map);
    if (adjacentThreats.some(({ enemy }) => {
      const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
      return details.overallThreat !== 'ONE_SHOT' || details.defenseThreat === 'LETHAL' || details.isLethalOneShot;
    })) {
      this.clearEightStepState();
      return null;
    }
    if (this.botNav.isDragonFireLine(curPos, dragon, map)) {
      this.clearEightStepState();
      return null;
    }

    const S = player.stepCountSinceStone;

    if (curPos.x === this.eightStepTargetChestPos.x && curPos.y === this.eightStepTargetChestPos.y) {
      if (S >= 8) {
        this.clearEightStepState();
        this.botNav.clearPositionHistory();
        return { type: 'SPACE' };
      }
    }

    if (S > 8) {
      this.clearEightStepState();
      return null;
    }

    if (S === 7) {
      if (curPos.x === this.eightStepPivotPos.x && curPos.y === this.eightStepPivotPos.y) {
        const dir = this.botNav.getAdjacentDirection(curPos, this.eightStepTargetChestPos, map);
        if (dir) return { type: 'MOVE', dir };
      }
      this.clearEightStepState();
      return null;
    }

    if (curPos.x === this.eightStepPivotPos.x && curPos.y === this.eightStepPivotPos.y) {
      const dir = this.botNav.getAdjacentDirection(curPos, this.eightStepWaitPos, map);
      if (dir) return { type: 'MOVE', dir };
    }

    if (curPos.x === this.eightStepWaitPos.x && curPos.y === this.eightStepWaitPos.y) {
      const dir = this.botNav.getAdjacentDirection(curPos, this.eightStepPivotPos, map);
      if (dir) return { type: 'MOVE', dir };
    }

    if (this.eightStepPathToPivot.length > 0) {
      const curIdx = this.eightStepPathToPivot.findIndex(p => p.x === curPos.x && p.y === curPos.y);
      let targetNext: Position | null = null;
      if (curIdx >= 0 && curIdx < this.eightStepPathToPivot.length - 1) {
        targetNext = this.eightStepPathToPivot[curIdx + 1];
      } else if (curIdx === -1) {
        targetNext = this.eightStepPathToPivot[0];
      }
      if (targetNext) {
        const dir = this.botNav.getAdjacentDirection(curPos, targetNext, map);
        if (dir) return { type: 'MOVE', dir };
      }
    }

    const directDir = this.botNav.getAdjacentDirection(curPos, this.eightStepPivotPos, map);
    if (directDir) return { type: 'MOVE', dir: directDir };

    this.clearEightStepState();
    return null;
  }
}
