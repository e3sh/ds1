import { Direction, Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { Player } from '../../models/Player.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { Dragon } from '../../models/Dragon.js';
import { MagicSystem } from '../../systems/MagicSystem.js';
import { MovementSystem } from '../../systems/MovementSystem.js';
import { BotAction, BotPhase, BotStrategyTuning } from '../BotTypes.js';
import { BotNavigator } from '../BotNavigator.js';

export interface HomeRelocationContext {
  tuning: Required<BotStrategyTuning>;
  setPhase: (phase: BotPhase) => void;
  actDragonSlay: (player: Player, map: WorldMap, dragon: Dragon, enemies: EnemyInstance[]) => BotAction;
  handleMoveOrBreak: (dir: Direction, player: Player, map: WorldMap) => BotAction;
}

export class HomeRelocationTactics {
  public homeRelocationDone: boolean = false;
  public homeRelocationAborted: boolean = false;
  public totalHomeRelocateTurns: number = 0;
  public lockedRelocateAnchor: Position | null = null;
  private stuckRelocateTurns: number = 0;
  private lastRelocateHomePos: Position | null = null;

  constructor(private botNav: BotNavigator) {}

  public reset(): void {
    this.homeRelocationDone = false;
    this.homeRelocationAborted = false;
    this.totalHomeRelocateTurns = 0;
    this.lockedRelocateAnchor = null;
    this.stuckRelocateTurns = 0;
    this.lastRelocateHomePos = null;
  }

  public findHomeRelocateAnchor(
    map: WorldMap,
    dragon: Dragon,
    _enemies: EnemyInstance[],
    player: Player,
    tuning?: Required<BotStrategyTuning>
  ): Position | null {
    const center = map.dragonCenter;
    const minDist = tuning?.homeRelocateTargetDistMin ?? 5;
    const maxDist = tuning?.homeRelocateTargetDistMax ?? 8;

    let bestPos: Position | null = null;
    let bestScore = Infinity;

    const curHome = map.realHomePos;

    for (let dy = -maxDist; dy <= maxDist; dy++) {
      for (let dx = -maxDist; dx <= maxDist; dx++) {
        const chebDist = Math.max(Math.abs(dx), Math.abs(dy));
        if (chebDist < minDist || chebDist > maxDist) continue;

        const pos = map.wrapPosition({ x: center.x + dx, y: center.y + dy });

        const base = map.getBaseTile(pos);
        if (base === 'WALL_STATIC' || base === 'GRAVE' || base === 'WARP') continue;
        if (map.getObject(pos) === 'CHEST') continue;

        if (this.botNav.isDragonFireLine(pos, dragon, map)) continue;

        const cardDirs: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
        let openAdjacentCount = 0;
        for (const dir of cardDirs) {
          const adj = map.wrapPosition(MovementSystem.getNextPosition(pos, dir));
          const adjBase = map.getBaseTile(adj);
          if (adjBase !== 'WALL_STATIC' && adjBase !== 'GRAVE') {
            openAdjacentCount++;
          }
        }
        if (openAdjacentCount < 2) continue;

        let score = Math.abs(chebDist - 6.5) * 6;

        const homeDist = map.getTorusDistance(curHome, pos).manhattan;
        score += homeDist * 1.5;

        const playerDist = map.getTorusDistance(player.pos, pos).manhattan;
        score += playerDist * 0.5;

        const entrances: Position[] = [
          { x: 28, y: 26 }, { x: 36, y: 26 },
          { x: 26, y: 30 }, { x: 38, y: 30 },
          { x: 28, y: 38 }, { x: 36, y: 38 },
        ];
        const minEntranceDist = Math.min(...entrances.map(e => map.getTorusDistance(pos, e).manhattan));
        score += minEntranceDist * 2;

        if (score < bestScore) {
          bestScore = score;
          bestPos = pos;
        }
      }
    }

    return bestPos;
  }

  public breakBlockAt(
    targetBlockPos: Position,
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    extraBlocked?: Position[],
    handleMoveOrBreak?: (dir: Direction, player: Player, map: WorldMap) => BotAction
  ): BotAction | null {
    if (!MagicSystem.canCast(player, 'BREAK').allowed) return null;
    if (map.getObject(targetBlockPos) !== 'BLOCK') return null;

    const curPos = player.pos;
    const cardDirs: { dir: Direction; dx: number; dy: number }[] = [
      { dir: 'UP', dx: 0, dy: -1 },
      { dir: 'DOWN', dx: 0, dy: 1 },
      { dir: 'LEFT', dx: -1, dy: 0 },
      { dir: 'RIGHT', dx: 1, dy: 0 },
    ];

    for (const d of cardDirs) {
      const neighbor = map.wrapPosition({ x: player.pos.x + d.dx, y: player.pos.y + d.dy });
      if (neighbor.x === targetBlockPos.x && neighbor.y === targetBlockPos.y) {
        player.dir = d.dir;
        this.botNav.clearUnreachableTargets();
        return { type: 'MAGIC', magic: 'BREAK' };
      }
    }

    let bestDir: Direction | null = null;
    let minDist = Infinity;

    for (const d of cardDirs) {
      const standPos = map.wrapPosition({ x: targetBlockPos.x + d.dx, y: targetBlockPos.y + d.dy });
      if (extraBlocked && extraBlocked.some(p => p.x === standPos.x && p.y === standPos.y)) continue;
      if (map.getBaseTile(standPos) === 'WALL_STATIC' || map.getBaseTile(standPos) === 'GRAVE') continue;
      if (map.getObject(standPos) === 'BLOCK') continue;

      const dist = map.getTorusDistance(curPos, standPos).manhattan;
      if (dist < minDist) {
        const dir = this.botNav.findPath(curPos, standPos, map, player, enemies, player.canDiagonal, dragon, extraBlocked);
        if (dir) {
          minDist = dist;
          bestDir = dir;
        }
      }
    }

    if (bestDir) {
      if (handleMoveOrBreak) {
        return handleMoveOrBreak(bestDir, player, map);
      }
      return { type: 'MOVE', dir: bestDir };
    }

    return null;
  }

  public actRelocateHome(
    player: Player,
    map: WorldMap,
    dragon: Dragon,
    enemies: EnemyInstance[],
    context: HomeRelocationContext
  ): BotAction {
    this.totalHomeRelocateTurns++;

    if (this.totalHomeRelocateTurns > 80 || this.stuckRelocateTurns >= 25) {
      return this.abortHomeRelocation(player, map, enemies, dragon, context);
    }

    const curPos = player.pos;
    const curHomePos = map.realHomePos;

    const distPlayerToHome = map.getTorusDistance(curPos, curHomePos).chebyshev;
    if (player.holdItem === 'RING' && distPlayerToHome <= 2) {
      if (
        this.lastRelocateHomePos &&
        (this.lastRelocateHomePos.x !== curHomePos.x || this.lastRelocateHomePos.y !== curHomePos.y)
      ) {
        this.stuckRelocateTurns = 0;
      } else {
        this.stuckRelocateTurns++;
      }
    } else {
      this.stuckRelocateTurns = 0;
    }
    this.lastRelocateHomePos = { ...curHomePos };

    const distToDragon = map.getTorusDistance(curHomePos, map.dragonCenter).chebyshev;
    const isAlreadyAtGoal =
      distToDragon >= context.tuning.homeRelocateTargetDistMin &&
      distToDragon <= context.tuning.homeRelocateTargetDistMax &&
      !this.botNav.isDragonFireLine(curHomePos, dragon, map);

    if (
      isAlreadyAtGoal ||
      (this.lockedRelocateAnchor &&
        curHomePos.x === this.lockedRelocateAnchor.x &&
        curHomePos.y === this.lockedRelocateAnchor.y)
    ) {
      return this.finalizeHomeRelocation(player, map, dragon, enemies, context);
    }

    if (!this.lockedRelocateAnchor) {
      this.lockedRelocateAnchor = this.findHomeRelocateAnchor(map, dragon, enemies, player, context.tuning);
    }
    const anchor = this.lockedRelocateAnchor;
    if (!anchor) {
      return this.abortHomeRelocation(player, map, enemies, dragon, context);
    }

    if (player.holdItem !== 'RING') {
      if (player.holdItem !== 'NONE') {
        if (map.getBaseTile(curPos) !== 'HOME' && map.getItem(curPos) === 'NONE') {
          return { type: 'SPACE' };
        }
        const safeDir = this.botNav.findAdjacentSafeEmptyFloor(curPos, map, enemies, dragon, player);
        if (safeDir) return { type: 'MOVE', dir: safeDir };
      }

      const ringCandidates = this.botNav.findNearestItemCandidates(curPos, 'RING', map, enemies, player, 3);
      const ringPos = ringCandidates[0] ?? this.botNav.findNearestItem(curPos, 'RING', map, enemies, player) ?? this.botNav.findAnyItemOnMap('RING', map);
      if (!ringPos) {
        return this.abortHomeRelocation(player, map, enemies, dragon, context);
      }
      if (curPos.x === ringPos.x && curPos.y === ringPos.y) {
        return { type: 'SPACE' };
      }
      const dirToRing = this.botNav.findPath(curPos, ringPos, map, player, enemies, player.canDiagonal, dragon);
      if (dirToRing) return context.handleMoveOrBreak(dirToRing, player, map);
      return this.botNav.wanderSafe(player, map, enemies, dragon);
    }

    const dirs: { dir: Direction; dx: number; dy: number }[] = [
      { dir: 'UP', dx: 0, dy: -1 },
      { dir: 'DOWN', dx: 0, dy: 1 },
      { dir: 'LEFT', dx: -1, dy: 0 },
      { dir: 'RIGHT', dx: 1, dy: 0 },
    ];

    const currentCheb = map.getTorusDistance(curHomePos, anchor).chebyshev;
    const currentManhattan = map.getTorusDistance(curHomePos, anchor).manhattan;

    const candidateDirs: { dir: Direction; priority: number }[] = [];

    for (const d of dirs) {
      const nextHome = map.wrapPosition({ x: curHomePos.x + d.dx, y: curHomePos.y + d.dy });
      const nextCheb = map.getTorusDistance(nextHome, anchor).chebyshev;
      const nextManhattan = map.getTorusDistance(nextHome, anchor).manhattan;

      if (map.getBaseTile(nextHome) === 'WALL_STATIC' || map.getBaseTile(nextHome) === 'GRAVE') continue;

      let score = 0;
      if (nextCheb < currentCheb) score += 60;
      if (nextManhattan < currentManhattan) score += 30;

      candidateDirs.push({ dir: d.dir, priority: score });
    }

    candidateDirs.sort((a, b) => b.priority - a.priority);

    for (const cand of candidateDirs) {
      const pushDir = cand.dir;
      const pushDest = map.wrapPosition(MovementSystem.getNextPosition(curHomePos, pushDir));
      const behindPos = map.wrapPosition(MovementSystem.getBehindPosition(curHomePos, pushDir));

      const isPushValid = map.isPushDestinationValid(pushDest, enemies);

      if (!isPushValid && map.getObject(pushDest) === 'BLOCK' && MagicSystem.canCast(player, 'BREAK').allowed) {
        const breakAction = this.breakBlockAt(pushDest, player, map, enemies, dragon, [curHomePos], context.handleMoveOrBreak);
        if (breakAction) return breakAction;
      }

      // アイテムや通行不可で家を押せない方向は除外
      if (!isPushValid && map.getObject(pushDest) !== 'BLOCK') {
        continue;
      }

      if (curPos.x === behindPos.x && curPos.y === behindPos.y) {
        if (isPushValid) {
          return { type: 'MOVE', dir: pushDir };
        }
      }

      if (map.getBaseTile(behindPos) !== 'WALL_STATIC' && map.getBaseTile(behindPos) !== 'GRAVE') {
        if (map.getObject(behindPos) === 'BLOCK' && MagicSystem.canCast(player, 'BREAK').allowed) {
          const breakBehind = this.breakBlockAt(behindPos, player, map, enemies, dragon, [curHomePos], context.handleMoveOrBreak);
          if (breakBehind) return breakBehind;
        }

        const dirToStand = this.botNav.findPath(curPos, behindPos, map, player, enemies, player.canDiagonal, dragon, [curHomePos]);
        if (dirToStand) {
          return context.handleMoveOrBreak(dirToStand, player, map);
        }
      }
    }

    return this.botNav.wanderSafe(player, map, enemies, dragon);
  }

  public finalizeHomeRelocation(
    player: Player,
    map: WorldMap,
    dragon: Dragon,
    enemies: EnemyInstance[],
    context: HomeRelocationContext
  ): BotAction {
    const curPos = player.pos;
    const curHomePos = map.realHomePos;

    if (player.holdItem === 'RING') {
      if (map.getBaseTile(curPos) === 'HOME') {
        const safeDir = this.botNav.findAdjacentSafeEmptyFloor(curPos, map, enemies, dragon, player);
        if (safeDir) return { type: 'MOVE', dir: safeDir };
      } else {
        if (map.getItem(curPos) === 'NONE') {
          return { type: 'SPACE' };
        }
        const safeDir = this.botNav.findAdjacentSafeEmptyFloor(curPos, map, enemies, dragon, player);
        if (safeDir) return { type: 'MOVE', dir: safeDir };
      }
    }

    if (player.holdItem === 'NONE') {
      if (curPos.x === curHomePos.x && curPos.y === curHomePos.y) {
        this.homeRelocationDone = true;
        context.setPhase('DRAGON_SLAY');
        return { type: 'WAIT' };
      }

      const dirToHome = this.botNav.findPath(curPos, curHomePos, map, player, enemies, player.canDiagonal, dragon);
      if (dirToHome) {
        return context.handleMoveOrBreak(dirToHome, player, map);
      }
    }

    this.homeRelocationDone = true;
    context.setPhase('DRAGON_SLAY');
    return { type: 'WAIT' };
  }

  public abortHomeRelocation(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    context: HomeRelocationContext
  ): BotAction {
    this.homeRelocationAborted = true;
    context.setPhase('DRAGON_SLAY');

    const curPos = player.pos;
    if (player.holdItem === 'RING') {
      if (map.getBaseTile(curPos) !== 'HOME' && map.getItem(curPos) === 'NONE') {
        return { type: 'SPACE' };
      }
      const safeDir = this.botNav.findAdjacentSafeEmptyFloor(curPos, map, enemies, dragon, player);
      if (safeDir) return { type: 'MOVE', dir: safeDir };
    }

    return context.actDragonSlay(player, map, dragon, enemies);
  }
}
