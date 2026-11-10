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

export interface StagnationState {
  currentHeat: number;
  neighborhoodHeat: number;
  turnsSinceNewTile: number;
  isStagnated: boolean;
  isPhysicallyTrapped: boolean;
  isEarlySwordTrapped: boolean;
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
   * ヒートマップおよび移動履歴に基づく停滞・拘束状況の認知評価
   */
  public static evaluateStagnation(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    nav: any,
    dragon?: Dragon,
    params?: DynamicBotParameters
  ): StagnationState {
    const curPos = player.pos;
    const currentHeat = nav.getHeat ? nav.getHeat(curPos) : 0;
    const neighborhoodHeat = nav.getNeighborhoodHeat ? nav.getNeighborhoodHeat(curPos, map, 2) : 0;
    const turnsSinceNewTile = nav.turnsSinceNewTile ?? 0;
    const isStagnated = nav.isStagnated ? nav.isStagnated(player, map) : (neighborhoodHeat >= 45 || turnsSinceNewTile >= 15);

    // 物理的完全拘束（四方が壁・岩で真に塞がれ、歩いて行ける安全床が3マス以下）の厳密検査
    let isPhysicallyTrapped = false;
    if (turnsSinceNewTile >= 18 && neighborhoodHeat >= 50) {
      const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
      const effectiveDef = Math.floor(player.experience * 1.0);
      const visited = new Set<string>();
      const queue: Position[] = [curPos];
      visited.add(`${curPos.x},${curPos.y}`);

      let walkableCount = 0;
      while (queue.length > 0 && walkableCount < 10) {
        const curr = queue.shift()!;
        walkableCount++;

        for (const d of cardDirs) {
          const nextPos = map.wrapPosition(MovementSystem.getNextPosition(curr, d));
          const key = `${nextPos.x},${nextPos.y}`;
          if (visited.has(key)) continue;

          const base = map.getBaseTile(nextPos);
          const obj = map.getObject(nextPos);
          if (base === 'WALL_STATIC') continue;
          if (base === 'GRAVE' && obj === 'NONE') continue;
          if (obj === 'BLOCK' && !MagicSystem.canCast(player, 'BREAK').allowed) continue;

          // 倒せない敵がいるマスは進入不能
          const enemy = enemies.find(e => e.isAlive && e.pos.x === nextPos.x && e.pos.y === nextPos.y);
          if (enemy) {
            const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
            if (details.defenseThreat !== 'NO_DAMAGE' || details.turnsToKill > 8) continue;
          }

          // 即死敵の直角隣接（進入即死トラップ）は進入不能
          const isLethalDeathTrap = enemies.some(e => {
            if (!e.isAlive || e.isPermanentlyFrozen || (e.frozenTimer ?? 0) > 0) return false;
            if (map.getTorusDistance(nextPos, e.pos).manhattan !== 1) return false;
            return Math.max(0, e.atk - effectiveDef) >= player.hp;
          });
          if (isLethalDeathTrap) continue;

          visited.add(key);
          queue.push(nextPos);
        }
      }

      // 歩いて行ける安全床が高々3マス以下の閉域空間に閉じ込められている場合のみ完全拘束
      isPhysicallyTrapped = walkableCount <= 3;
    }

    // 序盤の剣回収前ハマり（物理的詰み）検知
    const isEarlySwordTrapped = !player.hasSword && nav.detectEarlySwordTrap
      ? Boolean(nav.detectEarlySwordTrap(player, map, enemies, params ?? { targetStr: 0, targetDefenseExp: 0 } as any, dragon))
      : false;

    return {
      currentHeat,
      neighborhoodHeat,
      turnsSinceNewTile,
      isStagnated,
      isPhysicallyTrapped,
      isEarlySwordTrapped,
    };
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

    // 直角隣接および近傍の敵を走査
    for (const enemy of enemies) {
      if (!enemy.isAlive || enemy.isPermanentlyFrozen) continue;

      const dist = map.getTorusDistance(pPos, enemy.pos);

      // 近傍敵 (距離 <= 12) の最大ATK
      if (dist.manhattan <= 12) {
        if (enemy.atk > maxNearEnemyAtk) {
          maxNearEnemyAtk = enemy.atk;
        }
      }

      // マンハッタン距離1（直角隣接）の即死級敵 (LETHAL)
      if (dist.manhattan === 1 && !enemy.isPermanentlyFrozen && (enemy.frozenTimer ?? 0) <= 0) {
        const threat = ThreatEvaluator.evaluateThreatDetails(player, enemy);
        if (threat.defenseThreat === 'LETHAL') {
          adjacentLethalEnemies.push(enemy);
        }
      }
    }

    // ドラゴンブレス射線上か判定
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
