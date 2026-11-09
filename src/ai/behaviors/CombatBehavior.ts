import { Direction, Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { Player } from '../../models/Player.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { Dragon } from '../../models/Dragon.js';
import { ThreatEvaluator } from '../../systems/ThreatEvaluator.js';
import { MagicSystem } from '../../systems/MagicSystem.js';
import { MovementSystem } from '../../systems/MovementSystem.js';
import { KICK_MAX_RANGE } from '../../config/Constants.js';
import { BehaviorResult, DynamicBotParameters } from '../BotTypes.js';
import { AdaptiveNavigator } from '../AdaptiveNavigator.js';
import { TacticalContext } from '../TacticalContext.js';

/**
 * CombatBehavior
 *
 * 安全敵の排除、KICK直線スナイプ、FREEZE/FLASHによる緊急無力化を担当。
 */
export class CombatBehavior {
  public static execute(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    nav: AdaptiveNavigator,
    _context: TacticalContext,
    params: DynamicBotParameters
  ): BehaviorResult | null {
    const curPos = player.pos;

    // 1. 直角隣接の敵を検出
    const adjacentTargets = this.getAdjacentEnemies(curPos, enemies, map);

    // 1-B. 訪問ヒートマップによる障害物周回ループ（カルーセル膠着）の検知と打開
    const circlingAction = this.tryBreakCirclingLoop(player, map, enemies, dragon, nav, params);
    if (circlingAction) return circlingAction;

    // 2. 緊急無力化: 隣接に未凍結・未スタンの危険敵がいて、MP温存ラインを満たしている場合
    const hasDangerousAdj = adjacentTargets.some(
      ({ enemy }) =>
        !enemy.isPermanentlyFrozen &&
        enemy.frozenTimer <= 0 &&
        (ThreatEvaluator.evaluateThreat(player, enemy) === 'LETHAL' ||
          ThreatEvaluator.evaluateThreat(player, enemy) === 'DANGER')
    );

    if (hasDangerousAdj && player.magic > params.magicReserveThreshold && !player.hasDeath) {
      if (MagicSystem.canCast(player, 'FREEZE').allowed) {
        const unfrozen = adjacentTargets.find(
          ({ enemy }) => !enemy.isPermanentlyFrozen && enemy.frozenTimer <= 0
        );
        if (unfrozen) {
          return {
            action: { type: 'MAGIC', magic: 'FREEZE' },
            description: `❄️ FREEZE自衛詠唱 (${unfrozen.enemy.name})`,
          };
        }
      }
      const hasAnyActive = enemies.some(e => e.isAlive && !e.isPermanentlyFrozen && e.frozenTimer <= 0);
      if (hasAnyActive && MagicSystem.canCast(player, 'FLASH').allowed) {
        return {
          action: { type: 'MAGIC', magic: 'FLASH' },
          description: '⚡ FLASH全敵足止め詠唱',
        };
      }
    }

    // 3. 直線上の KICK スナイプ（即死岩飛ばし: BREAK習得後のMP=1時は命中時MP消費を避けるため抑制）
    const canSpendForKick = player.experience < 4000 || player.magic > 1;
    if (canSpendForKick) {
      const kickAction = this.tryKickSnipe(player, map, enemies, dragon);
      if (kickAction) return kickAction;

      // 3-B. 能動的 KICK 狙撃ポジショニング（周囲1〜3マスの岩背後へ移動して狙撃）
      const snipeAction = this.tryKickSnipePositioning(player, map, enemies, dragon, nav, params);
      if (snipeAction) return snipeAction;
    }

    // 4. 直角隣接の ONE_SHOT 敵を攻撃排除
    for (const { enemy, dir } of adjacentTargets) {
      if (dragon && dragon.getPartAt(enemy.pos)) continue;
      const threat = ThreatEvaluator.evaluateThreat(player, enemy);
      if (threat === 'ONE_SHOT') {
        return {
          action: { type: 'MOVE', dir },
          description: `⚔️ 隣接敵撃破 (${enemy.name})`,
        };
      }
    }

    // 5. 能動的敵追尾狩り（params.huntDistance > 0 の場合）
    if (params.huntDistance > 0 && player.hasSword) {
      const targetEnemy = this.findNearestSafeEnemy(curPos, enemies, map, player, params.huntDistance, nav);
      if (targetEnemy) {
        const dir = nav.findPath(curPos, targetEnemy.pos, map, player, enemies, params, { dragon });
        if (dir) {
          const dist = map.getTorusDistance(curPos, targetEnemy.pos).manhattan;
          return {
            action: { type: 'MOVE', dir },
            description: `⚔️ 安全敵追尾 (${targetEnemy.name}) [距離: ${dist}]`,
          };
        }
      }
    }

    return null;
  }

  public static tryKickSnipe(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon
  ): BehaviorResult | null {
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

  private static getAdjacentEnemies(
    pos: Position,
    enemies: EnemyInstance[],
    map: WorldMap
  ): { enemy: EnemyInstance; dir: Direction }[] {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const results: { enemy: EnemyInstance; dir: Direction }[] = [];

    for (const d of cardDirs) {
      const nextP = map.wrapPosition(MovementSystem.getNextPosition(pos, d));
      const e = enemies.find(enemy => enemy.isAlive && enemy.pos.x === nextP.x && enemy.pos.y === nextP.y);
      if (e) {
        results.push({ enemy: e, dir: d });
      }
    }
    return results;
  }

  public static findNearestSafeEnemy(
    from: Position,
    enemies: EnemyInstance[],
    map: WorldMap,
    player: Player,
    maxDist: number,
    nav: AdaptiveNavigator
  ): EnemyInstance | null {
    let nearest: EnemyInstance | null = null;
    let minDist = Infinity;

    for (const e of enemies) {
      if (!e.isAlive || e.isPermanentlyFrozen) continue;
      if (nav.isTargetUnreachable(e.pos)) continue;

      const threat = ThreatEvaluator.evaluateThreat(player, e);
      if (threat !== 'ONE_SHOT') continue;

      const dist = map.getTorusDistance(from, e.pos).manhattan;
      if (dist <= maxDist && dist < minDist) {
        minDist = dist;
        nearest = e;
      }
    }
    return nearest;
  }

  /**
   * 周囲1〜3マス以内の岩の背後に移動して直線上の強敵を KICK で狙撃するポジショニング
   */
  public static tryKickSnipePositioning(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    nav: AdaptiveNavigator,
    params: DynamicBotParameters
  ): BehaviorResult | null {
    if (!MagicSystem.canCast(player, 'KICK').allowed || player.experience < 6000) return null;

    // 近傍（距離10以内）の生存敵
    const dangerousEnemies = enemies.filter(e => {
      if (!e.isAlive || e.isPermanentlyFrozen) return false;
      const d = map.getTorusDistance(player.pos, e.pos).manhattan;
      if (d > 10) return false;
      const threat = ThreatEvaluator.evaluateThreat(player, e);
      return threat === 'DANGER' || threat === 'LETHAL' || threat === 'ONE_SHOT';
    });
    if (dangerousEnemies.length === 0) return null;

    const dirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const oppDirs: Record<string, Direction> = {
      UP: 'DOWN',
      DOWN: 'UP',
      LEFT: 'RIGHT',
      RIGHT: 'LEFT',
    };

    // 周囲1〜3マスの BLOCK を探索
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const manhattan = Math.abs(dx) + Math.abs(dy);
        if (manhattan < 1 || manhattan > 3) continue;
        const rockPos = map.wrapPosition({ x: player.pos.x + dx, y: player.pos.y + dy });
        if (map.getObject(rockPos) !== 'BLOCK') continue;

        for (const dir of dirs) {
          let currPos = rockPos;
          let hitEnemy: EnemyInstance | null = null;
          for (let step = 1; step <= KICK_MAX_RANGE; step++) {
            const nextPos = map.wrapPosition(MovementSystem.getNextPosition(currPos, dir));
            const enemy = dangerousEnemies.find(e => e.pos.x === nextPos.x && e.pos.y === nextPos.y);
            if (enemy) {
              hitEnemy = enemy;
              break;
            }
            if (map.getBaseTile(nextPos) === 'WALL_STATIC') break;
            if (map.getObject(nextPos) !== 'NONE') break;
            if (dragon && dragon.getPartAt(nextPos)) break;
            currPos = nextPos;
          }

          if (hitEnemy) {
            const kickDirOpp = oppDirs[dir];
            const standPos = map.wrapPosition(MovementSystem.getNextPosition(rockPos, kickDirOpp));

            if (standPos.x === player.pos.x && standPos.y === player.pos.y) continue;
            if (map.getBaseTile(standPos) === 'WALL_STATIC' || map.getObject(standPos) !== 'NONE') continue;
            if (enemies.some(e => e.isAlive && e.pos.x === standPos.x && e.pos.y === standPos.y)) continue;

            const dirToStand = nav.findPath(player.pos, standPos, map, player, enemies, params, { dragon, extraBlocked: [rockPos] });
            if (dirToStand) {
              return {
                action: { type: 'MOVE', dir: dirToStand },
                description: `🎯 KICK狙撃ポジショニング移動 (${hitEnemy.name} 狙い) -> (${standPos.x}, ${standPos.y})`,
              };
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * 停滞（ヒートマップ飽和・往復・未踏停滞）検知時の安全敵撃破突破（Breakthrough Combat）
   */
  public static tryBreakthroughCombat(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    nav: AdaptiveNavigator,
    params: DynamicBotParameters
  ): BehaviorResult | null {
    if (!player.hasSword) return null;
    if (player.holdItem === 'CROSS') return null;

    // 停滞していない場合は通常行動に任せる
    if (!nav.isStagnated(player, map)) return null;

    const curPos = player.pos;
    const adjacentTargets = this.getAdjacentEnemies(curPos, enemies, map);

    // 1. 直角隣接の安全な敵（被ダメ0 かつ turnsToKill <= 8）を直接攻撃
    for (const { enemy, dir } of adjacentTargets) {
      if (dragon && dragon.getPartAt(enemy.pos)) continue;
      const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
      if (details.defenseThreat === 'NO_DAMAGE' && details.turnsToKill <= 8) {
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
        if (details.defenseThreat === 'NO_DAMAGE' && details.turnsToKill <= 8) {
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
  ): BehaviorResult | null {
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
}
