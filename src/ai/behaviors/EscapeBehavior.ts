import { Direction, Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { Player } from '../../models/Player.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { Dragon } from '../../models/Dragon.js';
import { Ghost } from '../../models/Ghost.js';
import { ThreatEvaluator } from '../../systems/ThreatEvaluator.js';
import { MagicSystem } from '../../systems/MagicSystem.js';
import { MovementSystem } from '../../systems/MovementSystem.js';
import { BehaviorResult, DynamicBotParameters } from '../BotTypes.js';
import { AdaptiveNavigator } from '../AdaptiveNavigator.js';
import { TacticalContext } from '../TacticalContext.js';

/**
 * EscapeBehavior
 *
 * 全首撃破後の魔法封印下における王冠4個運搬・脱出戦術。
 * 安全確認、事前開通シミュレーション、複数候補探索、緊急王冠ドロップ自衛を完備。
 */
export class EscapeBehavior {
  public static execute(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    ghosts: Ghost[],
    nav: AdaptiveNavigator,
    _context: TacticalContext,
    params: DynamicBotParameters
  ): BehaviorResult | null {
    const curPos = player.pos;
    const allHomes = map.getAllHomePositions();
    const homePos = this.getBestHomePos(curPos, map);
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

    // 0. 不要アイテムの手放し (CROSS, KEY, RING等)
    if (player.holdItem !== 'NONE' && player.holdItem !== 'CROWN') {
      const isHome = map.getBaseTile(curPos) === 'HOME' || allHomes.some(h => curPos.x === h.x && curPos.y === h.y);
      if (!isHome && map.getItem(curPos) === 'NONE' && map.getObject(curPos) === 'NONE' &&
          map.getBaseTile(curPos) !== 'WALL_STATIC' && map.getBaseTile(curPos) !== 'WARP') {
        return { action: { type: 'SPACE' }, description: '👑 王冠回収のため不要アイテム手放し' };
      }
      const dropDir = this.findAdjacentDropTile(curPos, map, enemies, dragon, player, nav);
      if (dropDir) {
        return { action: { type: 'MOVE', dir: dropDir }, description: '👑 アイテム手放し空床へ移動' };
      }
      if (!isHome) {
        return { action: { type: 'SPACE' }, description: '👑 不要アイテム強制手放し' };
      }
    }

    // 0-B. 我が家マス上または直前の敵排除（FREEZE封鎖・居座り対策）
    const isNearRealHome = map.getTorusDistance(curPos, map.realHomePos).chebyshev <= 2;
    if (player.holdItem === 'NONE' || isNearRealHome) {
      for (const d of cardDirs) {
        const adj = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
        const isAdjHome = map.getBaseTile(adj) === 'HOME' || allHomes.some(h => h.x === adj.x && h.y === adj.y);
        if (isAdjHome) {
          const enemyOnHome = enemies.find(e => e.isAlive && e.pos.x === adj.x && e.pos.y === adj.y);
          if (enemyOnHome) {
            return {
              action: { type: 'MOVE', dir: d },
              description: `⚔️ 我が家マス上の敵を排除突破 (${enemyOnHome.name})`,
            };
          }
        }
      }
    }

    // 0-C. 敵湧き家（spawnHomePos）のFREEZE家封鎖戦術
    if (map.spawnHomePos && player.magic > 0 && !player.hasDeath && MagicSystem.canCast(player, 'FREEZE').allowed) {
      const isNearSpawnHome = map.getTorusDistance(curPos, map.spawnHomePos).chebyshev <= 3;
      if (isNearSpawnHome && !isNearRealHome) {
        const enemyNearSpawn = enemies.find(e => {
          if (!e.isAlive || e.isPermanentlyFrozen || (e.frozenTimer ?? 0) > 0) return false;
          return map.getTorusDistance(e.pos, map.spawnHomePos!).chebyshev <= 2;
        });
        if (enemyNearSpawn) {
          return {
            action: { type: 'MAGIC', magic: 'FREEZE' },
            description: `❄️ 敵湧き家封鎖FREEZEバリケード (${enemyNearSpawn.name})`,
          };
        }
      }
    }

    // 1. 王冠所持中 (holdItem === 'CROWN')
    if (player.holdItem === 'CROWN') {
      // 1-A. 我が家到着: 奉納完了
      if (allHomes.some(h => curPos.x === h.x && curPos.y === h.y) || map.getBaseTile(curPos) === 'HOME') {
        return {
          action: { type: 'SPACE' },
          description: '👑 我が家に王冠を奉納！',
        };
      }

      // 1-B. 直角隣接に未凍結・未スタンの即死敵（defenseThreat === 'LETHAL'）が迫っている場合の緊急対応
      const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
      const adjacentLethalList = cardDirs
        .map(d => {
          const np = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
          const e = enemies.find(enemy => this.isActiveEnemy(enemy) && enemy.pos.x === np.x && enemy.pos.y === np.y);
          return e && ThreatEvaluator.evaluateThreatDetails(player, e).defenseThreat === 'LETHAL'
            ? { enemy: e, dir: d }
            : null;
        })
        .filter((x): x is { enemy: EnemyInstance; dir: Direction } => x !== null);

      if (
        adjacentLethalList.length === 1 &&
        ThreatEvaluator.evaluateThreatDetails(player, adjacentLethalList[0].enemy).attackThreat === 'ONE_SHOT'
      ) {
        return {
          action: { type: 'MOVE', dir: adjacentLethalList[0].dir },
          description: `⚔️ 王冠運搬中・即死級敵を一撃排除 (${adjacentLethalList[0].enemy.name})`,
        };
      }

      if (adjacentLethalList.length > 0) {
        // 1. 直角隣接の即死敵の中に一撃撃破（ONE_SHOT）可能な敵がいれば直接攻撃で排除
        const oneShotTarget = adjacentLethalList.find(
          item => ThreatEvaluator.evaluateThreatDetails(player, item.enemy).attackThreat === 'ONE_SHOT'
        );
        if (oneShotTarget) {
          return {
            action: { type: 'MOVE', dir: oneShotTarget.dir },
            description: `⚔️ 王冠運搬中・隣接即死敵を一撃撃破突破 (${oneShotTarget.enemy.name})`,
          };
        }

        // 2. 安全な方向への退避移動
        const evadeDir = nav.findEvadeDirection(curPos, map, enemies, player, dragon);
        if (evadeDir) {
          return { action: { type: 'MOVE', dir: evadeDir }, description: '👑 王冠運搬中緊急退避' };
        }

        // 3. 【自殺ドロップの絶対禁止】
        // 距離1に即死敵が隣接している状態で SPACE を押すと、ドロップ直後の敵手番で100%確実に殴られて即死する。
        // そのため SPACE は絶対に押さず、非即死マスへの強行移動または隣接敵への迎撃を選択する。
        const desperateDir = this.findDesperateEscapeDir(curPos, map, enemies, player, dragon);
        if (desperateDir) {
          return {
            action: { type: 'MOVE', dir: desperateDir.dir },
            description: `🚨 王冠運搬中・強行突破移動 (${desperateDir.reason})`,
          };
        }
      }

      // 1-B2. 直角隣接（manhattan=1）には即死敵がいないが、近傍（chebyshev <= 2 かつ manhattan <= 3）に危険な敵が迫っている場合:
      // このターンにその場で王冠をドロップしても直角隣接敵はいないため攻撃を受けず、次ターン手ぶら（魔法詠唱可能）状態で安全にFREEZE/FLASH無力化できる
      const distHomeNow = map.getTorusDistance(curPos, homePos).manhattan;
      const isHomeTile = map.getBaseTile(curPos) === 'HOME';
      if (!isHomeTile && player.magic > 0 && !player.hasDeath && map.getItem(curPos) === 'NONE' && distHomeNow > 2) {
        const approachingLethal = enemies.find(e => {
          if (!this.isActiveEnemy(e)) return false;
          const d = map.getTorusDistance(curPos, e.pos);
          if (d.chebyshev > 2 || d.manhattan > 3 || d.manhattan < 2) return false;
          const details = ThreatEvaluator.evaluateThreatDetails(player, e);
          const rawDmg = Math.max(0, e.atk - Math.floor(player.experience));
          const isLethalOrTwoShot = details.defenseThreat === 'LETHAL' || rawDmg >= player.hp * 0.40;
          return isLethalOrTwoShot && details.attackThreat !== 'ONE_SHOT';
        });
        if (approachingLethal) {
          return {
            action: { type: 'SPACE' },
            description: `👑 即死敵接近につき安全距離で王冠一時ドロップ (${approachingLethal.name})`,
          };
        }
      }

      // 1-C. 我が家へ最短直行
      const dirToHome = nav.findPath(curPos, homePos, map, player, enemies, params, {
        dragon,
        isEscapePhase: true,
        ghosts,
      });
      if (dirToHome) {
        const dist = map.getTorusDistance(curPos, homePos).manhattan;
        return {
          action: { type: 'MOVE', dir: dirToHome },
          description: `👑 王冠運搬中 -> HOME [距離: ${dist}]`,
        };
      }

      // 経路完全遮断時（岩や敵で道がない）: 王冠を一時ドロップして道を拓く
      if (map.getItem(curPos) === 'NONE') {
        return { action: { type: 'SPACE' }, description: '👑 道切り開きのため王冠ドロップ' };
      }
    }

    // 2. 手ぶら時 (holdItem === 'NONE')
    if (player.holdItem === 'NONE') {
      const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

      // 2-A. 足元の王冠回収（安全確認＆事前開通チェック）
      if (map.getItem(curPos) === 'CROWN') {
        // まず周囲2マス以内に未凍結・未スタンの危険敵（被ダメあり・即死級）がいれば、王冠を拾う前に排除・無力化
        const adjacentLethalOnCrown = cardDirs
          .map(d => {
            const np = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
            const e = enemies.find(enemy => this.isActiveEnemy(enemy) && enemy.pos.x === np.x && enemy.pos.y === np.y);
            return e && ThreatEvaluator.evaluateThreatDetails(player, e).defenseThreat !== 'NO_DAMAGE'
              ? { enemy: e, dir: d }
              : null;
          })
          .filter((x): x is { enemy: EnemyInstance; dir: Direction } => x !== null);

        if (adjacentLethalOnCrown.length > 0) {
          const isNearEscapeHome = map.getTorusDistance(curPos, map.realHomePos).chebyshev <= 2;
          // 前線基地近傍（チェビシェフ<=2）では進入路封鎖を防ぐためFLASH優先！
          if (isNearEscapeHome && player.magic > 0 && !player.hasDeath && MagicSystem.canCast(player, 'FLASH').allowed) {
            return { action: { type: 'MAGIC', magic: 'FLASH' }, description: '⚡ 前線基地近傍・王冠取得前安全確保FLASHスタン（進入路封鎖抑止）' };
          }
          // 1-A. FREEZE 詠唱で周囲の即死敵を一斉に凍結無力化（前線基地から離れている場合のみ）
          if (!isNearEscapeHome && player.magic > 0 && !player.hasDeath && MagicSystem.canCast(player, 'FREEZE').allowed) {
            return { action: { type: 'MAGIC', magic: 'FREEZE' }, description: `❄️ 王冠取得前自衛FREEZE (${adjacentLethalOnCrown[0].enemy.name})` };
          }
          // 1-B. FLASH 詠唱で足止め
          if (player.magic > 0 && !player.hasDeath && MagicSystem.canCast(player, 'FLASH').allowed) {
            return { action: { type: 'MAGIC', magic: 'FLASH' }, description: '⚡ 王冠取得前FLASHスタン' };
          }
          // 1-C. 直角隣接の即死敵が1体のみで、かつ確実にワンパン撃破できるなら排除
          if (
            adjacentLethalOnCrown.length === 1 &&
            ThreatEvaluator.evaluateThreatDetails(player, adjacentLethalOnCrown[0].enemy).attackThreat === 'ONE_SHOT'
          ) {
            return {
              action: { type: 'MOVE', dir: adjacentLethalOnCrown[0].dir },
              description: `⚔️ 王冠取得前露払い (${adjacentLethalOnCrown[0].enemy.name})`,
            };
          }
          // 1-D. 魔法もワンパンも無理なら即死を避けて緊急退避（自殺取得の防止）
          const evadeDir = nav.findEvadeDirection(curPos, map, enemies, player, dragon);
          if (evadeDir) {
            return { action: { type: 'MOVE', dir: evadeDir }, description: '🚨 王冠上の即死敵から緊急退避' };
          }
        }

        // 2. MP不足時、近傍（距離15以内）にPOTIONがあれば王冠を拾う前に補給へ
        if (player.magic < 2) {
          const potionCandidates = nav.findNearestItemCandidates(curPos, 'POTION', map, enemies, player, 4);
          for (const potionPos of potionCandidates) {
            const dist = map.getTorusDistance(curPos, potionPos).manhattan;
            if (dist <= 15) {
              const dir = nav.findPath(curPos, potionPos, map, player, enemies, params, { dragon, isEscapePhase: true, ghosts });
              if (dir) {
                return {
                  action: { type: 'MOVE', dir },
                  description: `🧪 王冠取得前MP補充 (${potionPos.x}, ${potionPos.y}) [距離: ${dist}]`,
                };
              }
            }
          }
        }

        // 3. 王冠を持つと一切の魔法が封印されるため、フロア内に未凍結・未スタンの即死・危険敵が存在する場合、
        // 拾う直前に FLASH（全敵スタン）を詠唱して安全な運搬時間を確保する！
        const hasActiveDangerousEnemies = enemies.some(e => {
          if (!this.isActiveEnemy(e)) return false;
          const threat = ThreatEvaluator.evaluateThreat(player, e);
          const rawDmg = Math.max(0, e.atk - Math.floor(player.experience));
          return threat === 'LETHAL' || threat === 'DANGER' || rawDmg >= player.hp * 0.35;
        });

        if (hasActiveDangerousEnemies && player.magic > 0 && !player.hasDeath && MagicSystem.canCast(player, 'FLASH').allowed) {
          return { action: { type: 'MAGIC', magic: 'FLASH' }, description: '⚡ 王冠取得前・安全確保の全フロアFLASHスタン' };
        }

        // 王冠を持った状態で我が家に帰還できるか事前シミュレーション（Playerプロトタイプを維持して評価）
        const prevHold = player.holdItem;
        player.holdItem = 'CROWN';
        const dirWithCrown = nav.findPath(curPos, homePos, map, player, enemies, params, {
          dragon,
          isEscapePhase: true,
          ghosts,
        });
        player.holdItem = prevHold;

        if (!dirWithCrown) {
          // 王冠を持つと道が塞がれる！手ぶらのうちに道を拓く
          // 1. 周囲に未凍結・未スタンの敵がいれば FREEZE または FLASH で無力化を最優先
          if (player.magic > 0 && !player.hasDeath) {
            if (isNearRealHome && MagicSystem.canCast(player, 'FLASH').allowed) {
              return { action: { type: 'MAGIC', magic: 'FLASH' }, description: '⚡ 前線基地近傍・王冠開通FLASH（進入路封鎖抑止）' };
            }
            if (!isNearRealHome && this.hasNearbyActiveEnemyForFreeze(curPos, enemies, map) && MagicSystem.canCast(player, 'FREEZE').allowed) {
              return { action: { type: 'MAGIC', magic: 'FREEZE' }, description: '❄️ 王冠開通FREEZE' };
            }
            if (enemies.some(e => e.isAlive && !e.isPermanentlyFrozen && e.frozenTimer <= 0) && MagicSystem.canCast(player, 'FLASH').allowed) {
              return { action: { type: 'MAGIC', magic: 'FLASH' }, description: '⚡ 王冠開通FLASH' };
            }
          }

          // 2. 直角隣接の敵を攻撃排除（周囲に未凍結即死敵がいない安全時のみ）
          const hasActiveLethalNearby = enemies.some(
            e => e.isAlive && !e.isPermanentlyFrozen && e.frozenTimer <= 0 &&
                 map.getTorusDistance(curPos, e.pos).manhattan <= 2 &&
                 ThreatEvaluator.evaluateThreatDetails(player, e).defenseThreat === 'LETHAL'
          );

          if (!hasActiveLethalNearby) {
            for (const d of cardDirs) {
              const adj = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
              const enemy = enemies.find(e => e.isAlive && e.pos.x === adj.x && e.pos.y === adj.y);
              if (enemy) {
                const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
                if (details.attackThreat === 'ONE_SHOT' || details.defenseThreat === 'NO_DAMAGE') {
                  return { action: { type: 'MOVE', dir: d }, description: `⚔️ 王冠開通露払い (${enemy.name})` };
                }
              }
            }
          }

          // 3. 直角隣接にブロックがあれば BREAK
          for (const d of cardDirs) {
            const adj = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
            if (map.getObject(adj) === 'BLOCK' && MagicSystem.canCast(player, 'BREAK').allowed) {
              player.dir = d;
              return { action: { type: 'MAGIC', magic: 'BREAK' }, description: '🔨 王冠開通BREAK' };
            }
          }

          // 手ぶら状態（BREAK開通あり）で我が家への経路があるなら、まず邪魔な岩・敵を排除しに進む
          const dirToClearRoad = nav.findPath(curPos, homePos, map, player, enemies, params, {
            dragon,
            isEscapePhase: true,
            ghosts,
          });
          if (dirToClearRoad) {
            return {
              action: { type: 'MOVE', dir: dirToClearRoad },
              description: '🔨 王冠運搬路の開拓へ移動',
            };
          }

          if (player.magic > 0 && !player.hasDeath && this.hasAnyActiveEnemy(enemies) && MagicSystem.canCast(player, 'FLASH').allowed) {
            return { action: { type: 'MAGIC', magic: 'FLASH' }, description: '⚡ 王冠開通FLASH' };
          }
        }

        // 直角隣接に未凍結即死敵がいる場合は絶対に拾わない（自殺取得の絶対防止）
        const fatalEnemyAdj = cardDirs.some(d => {
          const np = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
          const e = enemies.find(enemy => this.isActiveEnemy(enemy) && enemy.pos.x === np.x && enemy.pos.y === np.y);
          return e && ThreatEvaluator.evaluateThreatDetails(player, e).defenseThreat === 'LETHAL';
        });
        if (fatalEnemyAdj) {
          const evadeDir = nav.findEvadeDirection(curPos, map, enemies, player, dragon);
          if (evadeDir) {
            return { action: { type: 'MOVE', dir: evadeDir }, description: '🚨 即死敵隣接のため王冠取得を中止し退避' };
          }
          return { action: { type: 'WAIT' }, description: '🚨 即死敵隣接のため王冠取得を一時見合わせ' };
        }

        // 安全確認完了: 王冠を取得！
        return {
          action: { type: 'SPACE' },
          description: '👑 床の王冠を取得',
        };
      }

      // 2-B. 近傍の未凍結・未スタン危険敵への自衛対応
      const adjacentDangerous = cardDirs.some(d => {
        const np = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
        const e = enemies.find(enemy => this.isActiveEnemy(enemy) && enemy.pos.x === np.x && enemy.pos.y === np.y);
        if (!e) return false;
        const details = ThreatEvaluator.evaluateThreatDetails(player, e);
        return details.defenseThreat === 'LETHAL' || (details.defenseThreat === 'TAKES_DAMAGE' && details.attackThreat !== 'ONE_SHOT');
      });

      if (adjacentDangerous && player.magic > 0 && !player.hasDeath) {
        const isNearEscapeHome = map.getTorusDistance(curPos, map.realHomePos).chebyshev <= 2;
        if (!isNearEscapeHome && this.hasNearbyActiveEnemyForFreeze(curPos, enemies, map) && MagicSystem.canCast(player, 'FREEZE').allowed) {
          return { action: { type: 'MAGIC', magic: 'FREEZE' }, description: '❄️ 緊急自衛FREEZE' };
        }
        if (this.hasAnyActiveEnemy(enemies) && MagicSystem.canCast(player, 'FLASH').allowed) {
          return { action: { type: 'MAGIC', magic: 'FLASH' }, description: '⚡ 緊急自衛FLASH' };
        }
      }

      // 2-C. 足元のポーション即時回収 ＆ MP枯渇時のポーション回収 (magic < 2)
      if (map.getItem(curPos) === 'POTION') {
        return {
          action: { type: 'SPACE' },
          description: '🧪 脱出用ポーションを取得',
        };
      }
      if (player.magic < 2) {
        const potionCandidates = nav.findNearestItemCandidates(curPos, 'POTION', map, enemies, player, 4);
        for (const potionPos of potionCandidates) {
          const dir = nav.findPath(curPos, potionPos, map, player, enemies, params, { dragon, isEscapePhase: true, ghosts });
          if (dir) {
            return {
              action: { type: 'MOVE', dir },
              description: `🧪 脱出用MP補給 (${potionPos.x}, ${potionPos.y})`,
            };
          } else {
            nav.markTargetUnreachable(potionPos, 8);
          }
        }
      }

      // 2-D. 床の王冠へ移動（複数候補探索）
      const crownCandidates = nav.findNearestItemCandidates(curPos, 'CROWN', map, enemies, player, 8);
      for (const crownPos of crownCandidates) {
        const dir = nav.findPath(curPos, crownPos, map, player, enemies, params, {
          dragon,
          isEscapePhase: true,
          ghosts,
        });
        if (dir) {
          const dist = map.getTorusDistance(curPos, crownPos).manhattan;
          return {
            action: { type: 'MOVE', dir },
            description: `👑 床の王冠へ移動 (${crownPos.x}, ${crownPos.y}) [距離: ${dist}]`,
          };
        } else {
          nav.markTargetUnreachable(crownPos, 8);
        }
      }

      // 2-E. 床に王冠がなく、ゴーストが王冠を持っている場合
      const crownGhost = ghosts.find(g => g.carriedItem === 'CROWN');
      if (crownGhost) {
        const dirGhost = nav.findPath(curPos, crownGhost.pos, map, player, enemies, params, { dragon, isEscapePhase: true, ghosts });
        if (dirGhost) {
          return {
            action: { type: 'MOVE', dir: dirGhost },
            description: `👻 王冠所持ゴースト追跡 (${crownGhost.pos.x}, ${crownGhost.pos.y})`,
          };
        }
      }

      // 2-F. 直角隣接の ONE_SHOT 敵を排除
      for (const d of cardDirs) {
        const adj = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
        const enemy = enemies.find(e => e.isAlive && e.pos.x === adj.x && e.pos.y === adj.y);
        if (enemy && ThreatEvaluator.evaluateThreat(player, enemy) === 'ONE_SHOT') {
          return {
            action: { type: 'MOVE', dir: d },
            description: `⚔️ 脱出進路露払い (${enemy.name})`,
          };
        }
      }

      // 2-G. 前線基地（我が家）へ移動して待機
      const dirToHome = nav.findPath(curPos, homePos, map, player, enemies, params, { dragon, isEscapePhase: true, ghosts });
      if (dirToHome) {
        return {
          action: { type: 'MOVE', dir: dirToHome },
          description: '🏠 前線基地（我が家）へ移動して王冠待機',
        };
      }
    }

    return null;
  }

  private static findAdjacentDropTile(
    pos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    _player: Player,
    nav: AdaptiveNavigator
  ): Direction | null {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    for (const d of cardDirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(pos, d));
      if (map.getBaseTile(nextPos) === 'WALL_STATIC') continue;
      if (map.getBaseTile(nextPos) === 'WARP') continue;
      if (map.getBaseTile(nextPos) === 'HOME') continue;
      if (map.getObject(nextPos) !== 'NONE') continue;
      if (map.getItem(nextPos) !== 'NONE') continue;
      if (dragon && nav.isDragonFireLine(nextPos, dragon, map)) continue;

      const hasEnemy = enemies.some(e => e.isAlive && e.pos.x === nextPos.x && e.pos.y === nextPos.y);
      if (hasEnemy) continue;

      return d;
    }
    return null;
  }

  /**
   * 未凍結かつ未スタン（行動可能な脅威）の生存敵であるか判定
   */
  private static isActiveEnemy(enemy: EnemyInstance): boolean {
    return enemy.isAlive && !enemy.isPermanentlyFrozen && enemy.frozenTimer <= 0;
  }

  /**
   * 画面内に未凍結かつ未スタンの生存敵が1体以上存在するか判定（FLASH空撃ち防止）
   */
  private static hasAnyActiveEnemy(enemies: EnemyInstance[]): boolean {
    return enemies.some(e => this.isActiveEnemy(e));
  }

  /**
   * FREEZEの有効範囲（周囲8方向・チェビシェフ距離1以内）に未凍結・未スタンの生存敵がいるか判定
   */
  private static hasNearbyActiveEnemyForFreeze(
    curPos: Position,
    enemies: EnemyInstance[],
    map: WorldMap
  ): boolean {
    return enemies.some(
      e => this.isActiveEnemy(e) && map.getTorusDistance(curPos, e.pos).chebyshev <= 1
    );
  }
  /**
   * 逃げ場がない（全周囲が危険）場合の強行突破・悪あがき移動方向を探索
   * SPACE でその場待機して確実に即死するのを防止する。
   */
  private static findDesperateEscapeDir(
    curPos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    player: Player,
    dragon?: Dragon
  ): { dir: Direction; reason: string } | null {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const diagDirs: Direction[] = ['UP_LEFT', 'UP_RIGHT', 'DOWN_LEFT', 'DOWN_RIGHT'];
    const dirs = (player.canDiagonal || player.experience >= 12000) ? [...cardDirs, ...diagDirs] : cardDirs;

    const candidates: { dir: Direction; damage: number; reason: string }[] = [];
    const effectiveDef = Math.floor(player.experience * 1.0);

    for (const d of dirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
      if (map.getBaseTile(nextPos) === 'WALL_STATIC') continue;
      if (map.getObject(nextPos) !== 'NONE') continue;
      if (map.getBaseTile(nextPos) === 'GRAVE') continue;
      if (dragon && dragon.getPartAt(nextPos)) continue;

      const enemyOnTile = enemies.find(e => e.isAlive && e.pos.x === nextPos.x && e.pos.y === nextPos.y);
      if (enemyOnTile) {
        // 斜め方向の敵マス進入は不可
        if (d.includes('_')) continue;
        const rawDmg = Math.max(0, enemyOnTile.atk - effectiveDef);
        candidates.push({ dir: d, damage: rawDmg, reason: `敵マス突破 (${enemyOnTile.name})` });
        continue;
      }

      // 空きマスの場合、そのマスで受ける被ダメージを推定
      let totalDmg = 0;
      for (const e of enemies) {
        if (!e.isAlive || e.isPermanentlyFrozen || e.frozenTimer > 0) continue;
        if (map.getTorusDistance(nextPos, e.pos).manhattan === 1) {
          totalDmg += Math.max(0, e.atk - effectiveDef);
        }
      }
      candidates.push({ dir: d, damage: totalDmg, reason: `被ダメ最小マスへ移動` });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.damage - b.damage);
    return { dir: candidates[0].dir, reason: candidates[0].reason };
  }

  /**
   * 複数の我が家（初期HOMEおよび前線HOME）から、最も近い我が家を動的に選定する
   */
  private static getBestHomePos(_from: Position, map: WorldMap): Position {
    // 脱出先は前線基地（realHomePos）を最優先（初期位置の家は敵湧き場のため避ける）
    return map.realHomePos;
  }
}
