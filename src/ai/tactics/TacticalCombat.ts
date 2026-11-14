import { Player } from '../../models/Player.js';
import { WorldMap } from '../../models/WorldMap.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { Dragon } from '../../models/Dragon.js';
import { AdaptiveNavigator } from '../AdaptiveNavigator.js';
import { BotAction, DynamicBotParameters } from '../BotTypes.js';
import { MagicSystem } from '../../systems/MagicSystem.js';
import { ThreatEvaluator } from '../../systems/ThreatEvaluator.js';
import { MovementSystem } from '../../systems/MovementSystem.js';
import { Direction, Position } from '../../models/Types.js';

const KICK_MAX_RANGE = 5;

/**
 * TacticalCombat (PST行動層: 戦術戦闘・現場膠着打開ヘルパー)
 *
 * 行動層（TacticalExecutor）が現場の移動・安全パイプラインとして使用する
 * 戦闘補助、KICKスナイプ、障害物周回ループ（カルーセル膠着）打開、安全敵強行突破を提供する。
 * Behavior版（CombatBehavior）から独立したPST版専用モジュール。
 */
export class TacticalCombat {
  /**
   * 直線上の岩越し KICK スナイプ反撃（敵即死排除＋通路開削）
   */
  public static tryKickSnipe(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon
  ): { action: BotAction; description: string } | null {
    if (!MagicSystem.canCast(player, 'KICK').allowed) return null;
    if (player.experience < 6000) return null;

    const dirs: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
    const curPos = player.pos;

    for (const dir of dirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(curPos, dir));
      if (map.getObject(nextPos) !== 'BLOCK') continue;

      // 岩の先をスキャン
      for (let step = 1; step <= KICK_MAX_RANGE; step++) {
        const scanPos = map.wrapPosition({
          x: nextPos.x + (dir === 'RIGHT' ? step : dir === 'LEFT' ? -step : 0),
          y: nextPos.y + (dir === 'DOWN' ? step : dir === 'UP' ? -step : 0),
        });

        if (map.getBaseTile(scanPos) === 'WALL_STATIC') break;
        if (dragon && dragon.getPartAt(scanPos)) break;

        const hitEnemy = enemies.find(e => e.isAlive && e.pos.x === scanPos.x && e.pos.y === scanPos.y);
        if (hitEnemy) {
          player.dir = dir;
          return {
            action: { type: 'MAGIC', magic: 'KICK' },
            description: `🎯 KICKスナイプ発動 (${hitEnemy.name})`,
          };
        }

        if (map.getObject(scanPos) !== 'NONE') break;
      }
    }
    return null;
  }

  /**
   * 訪問ヒートマップにより検知された障害物（墓・岩）周回カルーセル無限ループの打開
   */
  public static tryBreakCirclingLoop(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    nav: AdaptiveNavigator,
    params: DynamicBotParameters
  ): { action: BotAction; description: string } | null {
    const circling = nav.detectObstacleCircling(player, map, enemies);
    if (!circling) return null;

    const { enemy, obstacleType, obstaclePos } = circling;
    const curPos = player.pos;

    // A. 障害物が岩（BLOCK）の場合
    if (obstacleType === 'BLOCK') {
      const canSpendForKick = player.experience < 4000 || player.magic > 1;

      // A-1. プレイヤーと敵の間に岩があり、一直線上に敵がいるなら即座に KICK
      if (canSpendForKick && MagicSystem.canCast(player, 'KICK').allowed && player.experience >= 6000) {
        const dirToRock = nav.getAdjacentDirection(curPos, obstaclePos, map);
        if (dirToRock) {
          for (let step = 1; step <= KICK_MAX_RANGE; step++) {
            const scanPos = map.wrapPosition({
              x: obstaclePos.x + (dirToRock === 'RIGHT' ? step : dirToRock === 'LEFT' ? -step : 0),
              y: obstaclePos.y + (dirToRock === 'DOWN' ? step : dirToRock === 'UP' ? -step : 0),
            });
            if (scanPos.x === enemy.pos.x && scanPos.y === enemy.pos.y) {
              player.dir = dirToRock;
              return {
                action: { type: 'MAGIC', magic: 'KICK' },
                description: `🎯 周回打開 KICKスナイプ発動 (${enemy.name})`,
              };
            }
            if (map.getBaseTile(scanPos) === 'WALL_STATIC' || map.getObject(scanPos) !== 'NONE') break;
          }
        }
      }

      // A-2. もし BREAK が解禁済み (EXP >= 4000) で詠唱可能なら、岩自体を壊して障害物を消滅させる
      if (MagicSystem.canCast(player, 'BREAK').allowed && map.getObject(obstaclePos) === 'BLOCK') {
        const dirToRock = nav.getAdjacentDirection(curPos, obstaclePos, map);
        if (dirToRock) {
          player.dir = dirToRock;
          nav.clearUnreachableTargets();
          return {
            action: { type: 'MAGIC', magic: 'BREAK' },
            description: `⛏️ 周回打開 BREAK岩破壊 (${obstaclePos.x}, ${obstaclePos.y})`,
          };
        }
      }
    }

    // B. 障害物が墓（GRAVE）またはその他の場合（またはBLOCKだがKICK/BREAKできない場合）
    // B-1. FREEZE 詠唱（永久氷像化して足止め＆墓封鎖バリケード化）
    const canSpendForFreeze = player.experience < 4000 || player.magic > params.magicReserveThreshold;
    if (canSpendForFreeze && !player.hasDeath && MagicSystem.canCast(player, 'FREEZE').allowed) {
      if (!enemy.isPermanentlyFrozen && enemy.frozenTimer <= 0) {
        return {
          action: { type: 'MAGIC', magic: 'FREEZE' },
          description: `❄️ 周回打開 FREEZE氷像化 (${enemy.name}) [墓/障害物封鎖]`,
        };
      }
    }

    // B-2. FLASH 詠唱（全敵スタン）
    if (canSpendForFreeze && !player.hasDeath && !enemy.isPermanentlyFrozen && enemy.frozenTimer <= 0 && MagicSystem.canCast(player, 'FLASH').allowed) {
      return {
        action: { type: 'MAGIC', magic: 'FLASH' },
        description: `⚡ 周回打開 FLASHスタン (${enemy.name})`,
      };
    }

    // C. 魔法が使えない場合（MP枯渇やリザーブ保護中）
    // 敵を一時ブラックリスト化して周回追尾を中断し、冷涼ゾーンへ離脱
    nav.markTargetUnreachable(enemy.pos, 20);
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    let bestDir: Direction | null = null;
    let minHeat = Infinity;

    for (const d of cardDirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
      if (map.getBaseTile(nextPos) === 'WALL_STATIC' || map.getObject(nextPos) !== 'NONE') continue;
      if (enemies.some(e => e.isAlive && e.pos.x === nextPos.x && e.pos.y === nextPos.y)) continue;
      if (dragon && dragon.getPartAt(nextPos)) continue;

      const heat = nav.getHeat(nextPos);
      if (heat < minHeat) {
        minHeat = heat;
        bestDir = d;
      }
    }

    if (bestDir) {
      return {
        action: { type: 'MOVE', dir: bestDir },
        description: `🏃 周回打開 冷涼ゾーンへ離脱退避`,
      };
    }

    return null;
  }

  /**
   * 停滞（ヒートマップ飽和・往復・未踏停滞）検知時の安全敵撃破突破（Breakthrough Combat）
   * 厳格制約: turnsToKill <= 5 && damageToEnemy > 1 && attackThreat !== 'INEFFECTIVE'
   */
  public static tryBreakthroughCombat(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    nav: AdaptiveNavigator,
    params: DynamicBotParameters
  ): { action: BotAction; description: string } | null {
    if (!player.hasSword) return null;
    if (player.holdItem === 'CROSS') return null;

    // 停滞していない場合は通常行動に任せる
    if (!nav.isStagnated(player, map)) return null;

    const curPos = player.pos;
    const adjacentTargets = this.getAdjacentEnemies(curPos, enemies, map);

    // 1. 直角隣接の安全な敵（被ダメ0 かつ turnsToKill <= 5 && 与ダメ > 1）を直接攻撃
    for (const { enemy, dir } of adjacentTargets) {
      if (dragon && dragon.getPartAt(enemy.pos)) continue;
      const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
      const canBreakthrough =
        details.defenseThreat === 'NO_DAMAGE' &&
        details.turnsToKill <= 5 &&
        details.damageToEnemy > 1 &&
        details.attackThreat !== 'INEFFECTIVE';

      if (canBreakthrough) {
        return {
          action: { type: 'MOVE', dir },
          description: `⚔️ 停滞打破: 安全な敵を攻撃突破 (${enemy.name}) [撃破まで:${details.turnsToKill}T]`,
        };
      }
    }

    // 2. 直角隣接にいない場合でも、近傍（マンハッタン距離4以内）の安全撃破可能敵へアプローチ
    let nearestSafe: EnemyInstance | null = null;
    let minDist = Infinity;
    for (const e of enemies) {
      if (!e.isAlive || e.isPermanentlyFrozen) continue;
      if (dragon && dragon.getPartAt(e.pos)) continue;
      const dist = map.getTorusDistance(curPos, e.pos).manhattan;
      if (dist <= 4 && dist < minDist) {
        const details = ThreatEvaluator.evaluateThreatDetails(player, e);
        const canBreakthrough =
          details.defenseThreat === 'NO_DAMAGE' &&
          details.turnsToKill <= 5 &&
          details.damageToEnemy > 1 &&
          details.attackThreat !== 'INEFFECTIVE';

        if (canBreakthrough) {
          minDist = dist;
          nearestSafe = e;
        }
      }
    }

    if (nearestSafe) {
      const dir = nav.findPath(curPos, nearestSafe.pos, map, player, enemies, params, { dragon });
      if (dir) {
        return {
          action: { type: 'MOVE', dir },
          description: `⚔️ 停滞打破: 障害敵撃破へ接近 (${nearestSafe.name}) [距離:${minDist}]`,
        };
      }
    }

    return null;
  }

  private static getAdjacentEnemies(
    pos: Position,
    enemies: EnemyInstance[],
    map: WorldMap
  ): { enemy: EnemyInstance; dir: Direction }[] {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const results: { enemy: EnemyInstance; dir: Direction }[] = [];

    for (const d of cardDirs) {
      const nextP = map.wrapPosition(MovementSystem.getNextPosition(pos, d));
      const e = enemies.find(en => en.isAlive && en.pos.x === nextP.x && en.pos.y === nextP.y);
      if (e) {
        results.push({ enemy: e, dir: d });
      }
    }
    return results;
  }
}
