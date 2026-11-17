import { Player } from '../../models/Player.js';
import { Dragon } from '../../models/Dragon.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { WorldMap } from '../../models/WorldMap.js';
import { Direction, Position } from '../../models/Types.js';
import { DynamicBotParameters } from '../BotTypes.js';
import { ThreatEvaluator } from '../../systems/ThreatEvaluator.js';
import { MovementSystem } from '../../systems/MovementSystem.js';
import { MagicSystem } from '../../systems/MagicSystem.js';

export interface GrowthMilestones {
  hasSword: boolean;
  canBreak: boolean;            // !hasDeath && magic >= 1 && EXP >= 4,000
  canDiagonal: boolean;         // EXP >= 12,000
  hasTargetStr: boolean;        // STR >= targetStr
  hasTargetDefenseExp: boolean; // EXP >= targetDefenseExp
  hasSufficientMagic: boolean;  // MP >= minDragonMagic
  hasMaxMagic: boolean;         // MP >= maxTargetMagic
  canCastMagic: boolean;        // !hasDeath && magic >= 1 (魔法詠唱可能か)
  canPickupFloorItem: boolean;  // holdItem === 'NONE' (床アイテム拾い可能か)
  canOpenChest: boolean;        // holdItem === 'KEY' (宝箱開錠可能か)
  isStrCapped: boolean;         // STR >= 655,350 (カンスト到達)
}

export type ConfinementKind = 'NONE' | 'SEALED_ADJACENT' | 'SMALL_POCKET';
export type EscapeMeans = 'RETURN' | 'JUMP' | 'BREAK' | 'FREEZE' | 'FLASH' | 'BUMP' | 'DROP_CROWN_FOR_BREAK';

export interface ConfinementState {
  kind: ConfinementKind;
  reachableSafeTiles: number;
  escapeMeans: EscapeMeans[];
  /** 敵ではなく静的地形（壁・岩・墓）のみで完全に閉塞しているか */
  isStaticallySealed: boolean;
}

export interface ThreatDistribution {
  isPinchHp: boolean;
  isLethalDanger: boolean;
  maxNearEnemyAtk: number;
  adjacentLethalEnemies: EnemyInstance[];
  isOnDragonFireLine: boolean;
  dangerLevelMap?: number[][];
}

export class SituationalPerception {
  /**
   * 成長マイルストーンの評価
   */
  public static evaluateMilestones(
    player: Player,
    params: DynamicBotParameters,
    _dragon?: Dragon
  ): GrowthMilestones {
    const hasSword = player.hasSword;
    const canBreak = !player.hasDeath && player.magic >= 1 && player.experience >= 4000;
    const canDiagonal = player.experience >= 12000 || player.canDiagonal;
    const hasTargetStr = hasSword && player.strength >= params.targetStr;
    const hasTargetDefenseExp = player.experience >= params.targetDefenseExp;
    const hasSufficientMagic = player.magic >= params.minDragonMagic;
    const hasMaxMagic = player.magic >= params.maxTargetMagic;
    const canCastMagic = !player.hasDeath && player.magic >= 1;
    const canPickupFloorItem = player.holdItem === 'NONE';
    const canOpenChest = player.holdItem === 'KEY';
    const isStrCapped = player.strength >= 655350;

    return {
      hasSword,
      canBreak,
      canDiagonal,
      hasTargetStr,
      hasTargetDefenseExp,
      hasSufficientMagic,
      hasMaxMagic,
      canCastMagic,
      canPickupFloorItem,
      canOpenChest,
      isStrCapped,
    };
  }

  /**
   * 物理的完全拘束（四方閉塞・極小安全ポケット）および脱出手段の一元評価
   */
  public static evaluateConfinement(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[]
  ): ConfinementState {
    const curPos = player.pos;
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const effectiveDef = Math.floor(player.experience * 1.0);
    const canBreak = MagicSystem.canCast(player, 'BREAK').allowed;

    const isAdjacentPassable = (adjPos: Position): boolean => {
      const base = map.getBaseTile(adjPos);
      const obj = map.getObject(adjPos);
      if (base === 'WALL_STATIC') return false;
      if (base === 'GRAVE' && obj === 'NONE') return false;
      if (obj === 'BLOCK' && !canBreak) return false;

      const enemy = enemies.find(e => e.isAlive && e.pos.x === adjPos.x && e.pos.y === adjPos.y);
      if (enemy) {
        const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
        if (details.defenseThreat !== 'NO_DAMAGE' || details.turnsToKill > 8) return false;
      }

      const isLethalTrap = enemies.some(e => {
        if (!e.isAlive || e.isPermanentlyFrozen || (e.frozenTimer ?? 0) > 0) return false;
        if (map.getTorusDistance(adjPos, e.pos).manhattan !== 1) return false;
        return Math.max(0, e.atk - effectiveDef) >= player.hp;
      });
      return !isLethalTrap;
    };

    const isSealedAdjacent = cardDirs.every(d => {
      const adjPos = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
      return !isAdjacentPassable(adjPos);
    });

    let kind: ConfinementKind = 'NONE';
    let reachableSafeTiles = 0;

    if (isSealedAdjacent) {
      kind = 'SEALED_ADJACENT';
      reachableSafeTiles = 1;
    } else {
      // 安全床BFS（最大10マスまで探索し、3マス以下の小閉域か判定）
      const visited = new Set<string>();
      const queue: Position[] = [curPos];
      visited.add(`${curPos.x},${curPos.y}`);

      while (queue.length > 0 && reachableSafeTiles < 10) {
        const curr = queue.shift()!;
        reachableSafeTiles++;

        for (const d of cardDirs) {
          const nextPos = map.wrapPosition(MovementSystem.getNextPosition(curr, d));
          const key = `${nextPos.x},${nextPos.y}`;
          if (visited.has(key)) continue;
          if (!isAdjacentPassable(nextPos)) continue;
          visited.add(key);
          queue.push(nextPos);
        }
      }

      if (reachableSafeTiles <= 3) {
        kind = 'SMALL_POCKET';
      }
    }

    if (kind === 'NONE') {
      return { kind: 'NONE', reachableSafeTiles, escapeMeans: [], isStaticallySealed: false };
    }

    // 静的地形（壁・墓・BREAK不可岩）のみで四方が塞がれているか（敵の一時的な包囲と区別）
    const isStaticallySealed =
      kind === 'SEALED_ADJACENT' &&
      cardDirs.every(d => {
        const adjPos = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
        const base = map.getBaseTile(adjPos);
        const obj = map.getObject(adjPos);
        if (base === 'WALL_STATIC') return true;
        if (base === 'GRAVE' && obj === 'NONE') return true;
        if (obj === 'BLOCK' && !canBreak) return true;
        return false;
      });

    // 脱出手段の列挙
    const escapeMeans: EscapeMeans[] = [];
    if (MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying) {
      escapeMeans.push('RETURN');
    }
    if (MagicSystem.canCast(player, 'JUMP').allowed) {
      escapeMeans.push('JUMP');
    }
    if (canBreak) {
      const hasAdjBlock = cardDirs.some(d => {
        const adjPos = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
        return map.getObject(adjPos) === 'BLOCK';
      });
      if (hasAdjBlock) {
        escapeMeans.push('BREAK');
      }
    }

    const hasAdjActiveEnemy = cardDirs.some(d => {
      const adjPos = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
      return enemies.some(
        e => e.isAlive && !e.isPermanentlyFrozen && (e.frozenTimer ?? 0) <= 0 && e.pos.x === adjPos.x && e.pos.y === adjPos.y
      );
    });
    const canSpendMagicForControl = !player.hasDeath && (player.experience < 4000 ? player.magic > 0 : player.magic > 1);
    if (hasAdjActiveEnemy && canSpendMagicForControl) {
      const allHomes = map.getAllHomePositions();
      const isNearHome = allHomes.some(h => map.getTorusDistance(curPos, h).chebyshev <= 2);
      if (!isNearHome && MagicSystem.canCast(player, 'FREEZE').allowed) {
        escapeMeans.push('FREEZE');
      }
      if (MagicSystem.canCast(player, 'FLASH').allowed) {
        escapeMeans.push('FLASH');
      }
    }

    // 強行突破（短手数で撃破可能な隣接敵）
    for (const d of cardDirs) {
      const adjPos = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
      const enemy = enemies.find(e => e.isAlive && e.pos.x === adjPos.x && e.pos.y === adjPos.y);
      if (!enemy) continue;
      const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
      const canBump =
        details.attackThreat === 'ONE_SHOT' ||
        (details.turnsToKill <= 5 &&
          details.damageToEnemy > 1 &&
          details.attackThreat !== 'INEFFECTIVE' &&
          details.damageToPlayer < player.hp);
      if (canBump) {
        escapeMeans.push('BUMP');
        break;
      }
    }

    // 王冠所持中なら、足元に王冠を一時ドロップして手ぶらになり BREAK/魔法 を詠唱できる可能性がある
    if (
      player.holdItem === 'CROWN' &&
      map.getItem(curPos) === 'NONE' &&
      !player.hasDeath &&
      player.experience >= 4000 &&
      player.magic >= 1
    ) {
      escapeMeans.push('DROP_CROWN_FOR_BREAK');
    }

    return { kind, reachableSafeTiles, escapeMeans, isStaticallySealed };
  }

  /**
   * 脅威・危険度の評価
   */
  public static evaluateThreats(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    params: DynamicBotParameters
  ): ThreatDistribution {
    const isPinchHp = player.hp < player.maxHp * params.emergencyHpRatio;

    let maxNearEnemyAtk = 0;
    const adjacentLethalEnemies: EnemyInstance[] = [];

    const pPos = player.pos;

    for (const enemy of enemies) {
      if (!enemy.isAlive || enemy.isPermanentlyFrozen) continue;

      const dist = map.getTorusDistance(pPos, enemy.pos);

      if (dist.manhattan <= 12) {
        if (enemy.atk > maxNearEnemyAtk) {
          maxNearEnemyAtk = enemy.atk;
        }
      }

      if (dist.manhattan === 1 && !enemy.isPermanentlyFrozen && (enemy.frozenTimer ?? 0) <= 0) {
        const threat = ThreatEvaluator.evaluateThreatDetails(player, enemy);
        if (threat.defenseThreat === 'LETHAL') {
          adjacentLethalEnemies.push(enemy);
        }
      }
    }

    let isOnDragonFireLine = false;
    if (dragon && dragon.heads.some(h => h.isAlive)) {
      for (const h of dragon.heads) {
        if (!h.isAlive) continue;
        if (pPos.x === h.pos.x || pPos.y === h.pos.y) {
          isOnDragonFireLine = true;
          break;
        }
      }
    }

    const isLethalDanger = adjacentLethalEnemies.length > 0;

    return {
      isPinchHp,
      isLethalDanger,
      maxNearEnemyAtk,
      adjacentLethalEnemies,
      isOnDragonFireLine,
    };
  }
}
