import { Direction, Position } from '../../../models/Types.js';
import { WorldMap } from '../../../models/WorldMap.js';
import { Player } from '../../../models/Player.js';
import { EnemyInstance } from '../../../models/Enemy.js';
import { Dragon } from '../../../models/Dragon.js';
import { Ghost } from '../../../models/Ghost.js';
import { ThreatEvaluator } from '../../../systems/ThreatEvaluator.js';
import { MagicSystem } from '../../../systems/MagicSystem.js';
import { MovementSystem } from '../../../systems/MovementSystem.js';
import { BehaviorResult, DynamicBotParameters } from '../BotTypesV2.js';
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
    const homePos = map.realHomePos;

    // 0. 不要アイテムの手放し (CROSS, KEY, RING等)
    if (player.holdItem !== 'NONE' && player.holdItem !== 'CROWN') {
      if (map.getItem(curPos) === 'NONE' && map.getObject(curPos) === 'NONE' &&
          map.getBaseTile(curPos) !== 'WALL_STATIC' && map.getBaseTile(curPos) !== 'WARP') {
        return { action: { type: 'SPACE' }, description: '👑 王冠回収のため不要アイテム手放し' };
      }
      const dropDir = this.findAdjacentDropTile(curPos, map, enemies, dragon, player, nav);
      if (dropDir) {
        return { action: { type: 'MOVE', dir: dropDir }, description: '👑 アイテム手放し空床へ移動' };
      }
      return { action: { type: 'SPACE' }, description: '👑 不要アイテム強制手放し' };
    }

    // 1. 王冠所持中 (holdItem === 'CROWN')
    if (player.holdItem === 'CROWN') {
      // 1-A. 我が家到着: 奉納完了
      if (curPos.x === homePos.x && curPos.y === homePos.y || map.getBaseTile(curPos) === 'HOME') {
        return {
          action: { type: 'SPACE' },
          description: '👑 我が家に王冠を奉納！',
        };
      }

      // 1-B. 直角隣接に即死敵（LETHAL）が迫っている場合の緊急回避または王冠ドロップ
      const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
      const adjacentLethal = cardDirs.some(d => {
        const np = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
        const e = enemies.find(enemy => enemy.isAlive && !enemy.isPermanentlyFrozen && enemy.pos.x === np.x && enemy.pos.y === np.y);
        return e && ThreatEvaluator.evaluateThreat(player, e) === 'LETHAL';
      });

      if (adjacentLethal) {
        const evadeDir = nav.findEvadeDirection(curPos, map, enemies, player, dragon);
        if (evadeDir) {
          return { action: { type: 'MOVE', dir: evadeDir }, description: '👑 王冠運搬中緊急退避' };
        }
        // 逃げ場がない場合、王冠を一時ドロップして魔法封印を解除し次ターン反撃
        if (map.getItem(curPos) === 'NONE') {
          return { action: { type: 'SPACE' }, description: '👑 魔法封印解除のため王冠一時ドロップ' };
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
      // 2-A. 足元の王冠回収（安全確認＆事前開通チェック）
      if (map.getItem(curPos) === 'CROWN') {
        // 王冠を持った状態で我が家に帰還できるか事前シミュレーション
        const testPlayer = { ...player, holdItem: 'CROWN' } as Player;
        const dirWithCrown = nav.findPath(curPos, homePos, map, testPlayer, enemies, params, {
          dragon,
          isEscapePhase: true,
          ghosts,
        });

        if (!dirWithCrown) {
          // 王冠を持つと道が塞がれる！手ぶらのうちに道を拓く
          // 直角隣接の ONE_SHOT 敵を攻撃排除
          const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
          for (const d of cardDirs) {
            const adj = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
            const enemy = enemies.find(e => e.isAlive && e.pos.x === adj.x && e.pos.y === adj.y);
            if (enemy && ThreatEvaluator.evaluateThreat(player, enemy) === 'ONE_SHOT') {
              return { action: { type: 'MOVE', dir: d }, description: `⚔️ 王冠開通露払い (${enemy.name})` };
            }
          }

          // 直角隣接にブロックがあれば BREAK
          for (const d of cardDirs) {
            const adj = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
            if (map.getObject(adj) === 'BLOCK' && MagicSystem.canCast(player, 'BREAK').allowed) {
              player.dir = d;
              return { action: { type: 'MAGIC', magic: 'BREAK' }, description: '🔨 王冠開通BREAK' };
            }
          }

          // 周囲に敵がいれば FREEZE または FLASH
          if (player.magic > 0 && !player.hasDeath) {
            if (MagicSystem.canCast(player, 'FREEZE').allowed) {
              return { action: { type: 'MAGIC', magic: 'FREEZE' }, description: '❄️ 王冠開通FREEZE' };
            }
            if (MagicSystem.canCast(player, 'FLASH').allowed) {
              return { action: { type: 'MAGIC', magic: 'FLASH' }, description: '⚡ 王冠開通FLASH' };
            }
          }
        }

        // 周囲2マス以内に危険敵（LETHAL/DANGER）がいれば、拾う前に FREEZE または FLASH で無力化
        const nearbyDangerous = enemies.find(e => {
          if (!e.isAlive || e.isPermanentlyFrozen) return false;
          const d = map.getTorusDistance(curPos, e.pos).manhattan;
          if (d > 2) return false;
          const threat = ThreatEvaluator.evaluateThreat(player, e);
          return threat === 'LETHAL' || threat === 'DANGER';
        });

        if (nearbyDangerous && player.magic > 0 && !player.hasDeath) {
          if (MagicSystem.canCast(player, 'FREEZE').allowed) {
            return { action: { type: 'MAGIC', magic: 'FREEZE' }, description: `❄️ 王冠取得前自衛FREEZE (${nearbyDangerous.name})` };
          }
          if (MagicSystem.canCast(player, 'FLASH').allowed) {
            return { action: { type: 'MAGIC', magic: 'FLASH' }, description: '⚡ 王冠取得前自衛FLASH' };
          }
        }

        // 安全確認完了: 王冠を取得！
        return {
          action: { type: 'SPACE' },
          description: '👑 床の王冠を取得',
        };
      }

      // 2-B. 近傍の危険敵への自衛対応
      const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
      const adjacentDangerous = cardDirs.some(d => {
        const np = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
        const e = enemies.find(enemy => enemy.isAlive && !enemy.isPermanentlyFrozen && enemy.pos.x === np.x && enemy.pos.y === np.y);
        return e && (ThreatEvaluator.evaluateThreat(player, e) === 'LETHAL' || ThreatEvaluator.evaluateThreat(player, e) === 'DANGER');
      });

      if (adjacentDangerous && player.magic > 0 && !player.hasDeath) {
        if (MagicSystem.canCast(player, 'FREEZE').allowed) {
          return { action: { type: 'MAGIC', magic: 'FREEZE' }, description: '❄️ 緊急自衛FREEZE' };
        }
        if (MagicSystem.canCast(player, 'FLASH').allowed) {
          return { action: { type: 'MAGIC', magic: 'FLASH' }, description: '⚡ 緊急自衛FLASH' };
        }
      }

      // 2-C. MP枯渇時のポーション回収 (magic < 2)
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
}
