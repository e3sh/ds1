import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { MagicSystem } from '../../../systems/MagicSystem.js';
import { MovementSystem } from '../../../systems/MovementSystem.js';
import { ThreatEvaluator } from '../../../systems/ThreatEvaluator.js';
import { Direction, Position } from '../../../models/Types.js';

/**
 * TacticalStallResolver (戦略層: 袋小路拘束・孤立打開リゾルバー)
 *
 * 袋小路・敵封鎖による物理的詰みを検知し、
 * 能動的に打開する高優先度ディレクティブ（脱出魔法、岩破壊、強行突破、正式ギブアップ）を発行する。
 */
export class TacticalStallResolver {
  /**
   * 袋小路拘束・孤立ハマりの検知と打開ディレクティブ発行
   */
  public static resolveIncarceration(
    snapshot: TacticalSnapshot,
    engine: GameEngine
  ): StrategicDirective | null {
    const player = engine.getPlayer();
    const map = snapshot.map;

    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const enemies = snapshot.livingEnemies;
    const effectiveDef = Math.floor(player.experience * 1.0);

    // 直角4方向すべてが「壁」「破壊不能な岩」「倒せない敵」または「進入即死マス」で塞がれ、
    // 安全に1マスも移動できない敵封鎖・地形閉塞状態
    const isTotallySealedByTerrainOrEnemy = cardDirs.every(d => {
      const adjPos = map.wrapPosition(MovementSystem.getNextPosition(player.pos, d));
      const base = map.getBaseTile(adjPos);
      const obj = map.getObject(adjPos);
      if (base === 'WALL_STATIC') return true;
      if (base === 'GRAVE' && obj === 'NONE') return true;
      if (obj === 'BLOCK' && !MagicSystem.canCast(player, 'BREAK').allowed) return true;

      const enemy = enemies.find(e => e.isAlive && e.pos.x === adjPos.x && e.pos.y === adjPos.y);
      if (enemy) {
        const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
        if (details.defenseThreat !== 'NO_DAMAGE' || details.turnsToKill > 8) return true;
      }

      const isLethalTrap = enemies.some(e => {
        if (!e.isAlive || e.isPermanentlyFrozen || (e.frozenTimer ?? 0) > 0) return false;
        if (map.getTorusDistance(adjPos, e.pos).manhattan !== 1) return false;
        return Math.max(0, e.atk - effectiveDef) >= player.hp;
      });
      if (isLethalTrap) return true;

      return false;
    });

    if (!isTotallySealedByTerrainOrEnemy && !snapshot.stagnation?.isPhysicallyTrapped) {
      return null;
    }

    // 1. RETURN 脱出
    if (MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying) {
      return {
        type: 'CAST_MAGIC',
        magicToCast: 'RETURN',
        priority: 99,
        reason: '🌀 袋小路拘束打開: RETURN詠唱で我拠点へ緊急脱出',
      };
    }

    // 2. JUMP 脱出
    if (MagicSystem.canCast(player, 'JUMP').allowed) {
      return {
        type: 'CAST_MAGIC',
        magicToCast: 'JUMP',
        priority: 98,
        reason: '🌀 袋小路拘束打開: JUMP詠唱でランダム脱出',
      };
    }

    // 3. BREAK 岩破壊脱出
    if (MagicSystem.canCast(player, 'BREAK').allowed) {
      for (const d of cardDirs) {
        const adjPos = map.wrapPosition(MovementSystem.getNextPosition(player.pos, d));
        if (map.getObject(adjPos) === 'BLOCK') {
          return {
            type: 'BREACH_SHORTCUT',
            targetPos: adjPos,
            priority: 97,
            reason: `⛏️ 袋小路拘束打開: BREAKで岩を破壊して道を開通 (${adjPos.x}, ${adjPos.y})`,
          };
        }
      }
    }

    // 4. 敵封鎖に対する魔法無力化 (FREEZE / FLASH)
    const hasAdjEnemy = cardDirs.some(d => {
      const adjPos = map.wrapPosition(MovementSystem.getNextPosition(player.pos, d));
      return enemies.some(e => e.isAlive && !e.isPermanentlyFrozen && (e.frozenTimer ?? 0) <= 0 && e.pos.x === adjPos.x && e.pos.y === adjPos.y);
    });

    // BREAK用 MP=1 温存: EXP >= 4000 で BREAK が解禁されている場合は MP > 1 の時のみ魔法を使用（最後の1個は岩破壊用に死守）
    const canSpendMagicForFreeze = !player.hasDeath && (player.experience < 4000 ? player.magic > 0 : player.magic > 1);
    if (hasAdjEnemy && canSpendMagicForFreeze) {
      const allHomes = map.getAllHomePositions();
      const isNearHome = allHomes.some(h => map.getTorusDistance(player.pos, h).chebyshev <= 2);
      if (!isNearHome && MagicSystem.canCast(player, 'FREEZE').allowed) {
        return {
          type: 'CAST_MAGIC',
          magicToCast: 'FREEZE',
          priority: 96,
          reason: '❄️ 袋小路封鎖打開: FREEZE詠唱で包囲敵を永久凍結無力化',
        };
      }
      if (MagicSystem.canCast(player, 'FLASH').allowed) {
        return {
          type: 'CAST_MAGIC',
          magicToCast: 'FLASH',
          priority: 96,
          reason: '⚡ 袋小路封鎖打開: FLASH詠唱で包囲敵をスタン足止め',
        };
      }
    }

    // 5. 直角隣接の敵に対する強行突破攻撃 (Bump Combat)
    // ワンパン撃破できる敵、または被ダメージが最小の敵を殴り倒して脱出路を開く
    let bestBreakthroughTarget: Position | null = null;
    let minDmg = Infinity;
    for (const d of cardDirs) {
      const adjPos = map.wrapPosition(MovementSystem.getNextPosition(player.pos, d));
      const enemy = enemies.find(e => e.isAlive && e.pos.x === adjPos.x && e.pos.y === adjPos.y);
      if (enemy) {
        const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
        if (details.attackThreat === 'ONE_SHOT') {
          return {
            type: 'ATTACK_TARGET',
            targetPos: enemy.pos,
            priority: 95,
            reason: `⚔️ 袋小路封鎖打開: ワンパン敵を撃破突破 (${enemy.name})`,
          };
        }
        // 強行突破できるのは、短手数（turnsToKill <= 5）で倒せる敵のみ！
        // 与ダメ1で何百ターンもかかる敵（INEFFECTIVE）は強行突破の対象外
        const canBreakthroughInShortTurns = details.turnsToKill <= 5 && details.damageToEnemy > 1 && details.attackThreat !== 'INEFFECTIVE';
        if (canBreakthroughInShortTurns && details.damageToPlayer < minDmg && details.damageToPlayer < player.hp) {
          minDmg = details.damageToPlayer;
          bestBreakthroughTarget = enemy.pos;
        }
      }
    }

    if (bestBreakthroughTarget) {
      return {
        type: 'ATTACK_TARGET',
        targetPos: bestBreakthroughTarget,
        priority: 94,
        reason: `⚔️ 袋小路封鎖打開: 最小被ダメ敵へ強行突破攻撃`,
      };
    }

    // 5-B. 王冠所持中に四方が岩や墓で塞がれた場合: 足元に王冠を一時ドロップして手ぶらに戻り、BREAKで岩を破壊
    if (player.holdItem === 'CROWN' && map.getItem(player.pos) === 'NONE') {
      const hasAdjacentLethal = cardDirs.some(d => {
        const adjPos = map.wrapPosition(MovementSystem.getNextPosition(player.pos, d));
        const enemy = enemies.find(e => e.isAlive && e.pos.x === adjPos.x && e.pos.y === adjPos.y);
        return enemy && ThreatEvaluator.evaluateThreatDetails(player, enemy).defenseThreat === 'LETHAL';
      });

      if (!hasAdjacentLethal) {
        return {
          type: 'DROP_HOLD_ITEM',
          priority: 98,
          reason: '👑 袋小路拘束打開: 岩破壊のため王冠を一時ドロップ（手ぶら化してBREAK詠唱準備）',
        };
      }
    }

    // 6. 脱出魔法皆無かつ敵・地形により完全に移動不可能な場合は正式ギブアップ
    if (player.hp > 0 && (isTotallySealedByTerrainOrEnemy || !!snapshot.stagnation?.isPhysicallyTrapped)) {
      const dirDetails: string[] = [];
      for (const d of cardDirs) {
        const adjPos = map.wrapPosition(MovementSystem.getNextPosition(player.pos, d));
        const base = map.getBaseTile(adjPos);
        const obj = map.getObject(adjPos);
        const enemy = enemies.find(e => e.isAlive && e.pos.x === adjPos.x && e.pos.y === adjPos.y);

        if (base === 'WALL_STATIC') {
          dirDetails.push(`${d}:壁`);
        } else if (base === 'GRAVE' && obj === 'NONE') {
          dirDetails.push(`${d}:墓`);
        } else if (obj === 'BLOCK') {
          const breakCheck = MagicSystem.canCast(player, 'BREAK');
          dirDetails.push(`${d}:岩(${breakCheck.allowed ? 'BREAK可' : breakCheck.reason})`);
        } else if (enemy) {
          const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
          dirDetails.push(`${d}:敵(${enemy.name},被ダメ${details.damageToPlayer},撃破${details.turnsToKill}T)`);
        } else {
          dirDetails.push(`${d}:即死危険マス`);
        }
      }

      return {
        type: 'GIVE_UP',
        priority: 100,
        reason: `💀 詰み検知 [四方閉塞: ${dirDetails.join(', ')}] (HP:${player.hp}/${player.maxHp}, MP:${player.magic}, STR:${player.strength}, EXP:${player.experience}, Item:${player.holdItem})`,
      };
    }

    return {
      type: 'WANDER_SAFELY',
      priority: 85,
      reason: '🌀 局所停滞打開: 冷涼マスへ離脱移動',
    };
  }
}
