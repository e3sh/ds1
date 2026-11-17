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
 * 認知層（SituationalPerception.evaluateConfinement）が検知した物理的拘束に対し、
 * 能動的に打開する高優先度ディレクティブ（脱出魔法、岩破壊、強行突破）を発行する。
 * 打開不能な場合の GIVE_UP 判定は上位指揮官（StrategicCommander）へ一本化済み。
 */
export class TacticalStallResolver {
  public static resolveIncarceration(
    snapshot: TacticalSnapshot,
    engine: GameEngine
  ): StrategicDirective | null {
    const confinement = snapshot.confinement;
    if (!confinement || confinement.kind === 'NONE') {
      return null;
    }

    const player = engine.getPlayer();
    const map = snapshot.map;
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const enemies = snapshot.livingEnemies;
    const means = new Set(confinement.escapeMeans);

    // 1. RETURN 脱出
    if (means.has('RETURN')) {
      return {
        type: 'CAST_MAGIC',
        magicToCast: 'RETURN',
        priority: 99,
        reason: '🌀 袋小路拘束打開: RETURN詠唱で我拠点へ緊急脱出',
      };
    }

    // 2. JUMP 脱出
    if (means.has('JUMP')) {
      return {
        type: 'CAST_MAGIC',
        magicToCast: 'JUMP',
        priority: 98,
        reason: '🌀 袋小路拘束打開: JUMP詠唱でランダム脱出',
      };
    }

    // 3. BREAK 岩破壊脱出
    if (means.has('BREAK')) {
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
    if (means.has('FREEZE')) {
      return {
        type: 'CAST_MAGIC',
        magicToCast: 'FREEZE',
        priority: 96,
        reason: '❄️ 袋小路封鎖打開: FREEZE詠唱で包囲敵を永久凍結無力化',
      };
    }
    if (means.has('FLASH')) {
      return {
        type: 'CAST_MAGIC',
        magicToCast: 'FLASH',
        priority: 96,
        reason: '⚡ 袋小路封鎖打開: FLASH詠唱で包囲敵をスタン足止め',
      };
    }

    // 5. 直角隣接の敵に対する強行突破攻撃 (Bump Combat)
    if (means.has('BUMP')) {
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
          const canBreakthroughInShortTurns =
            details.turnsToKill <= 5 &&
            details.damageToEnemy > 1 &&
            details.attackThreat !== 'INEFFECTIVE';
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
          reason: '⚔️ 袋小路封鎖打開: 最小被ダメ敵へ強行突破攻撃',
        };
      }
    }

    // 5-B. 王冠所持中に四方が岩や墓で塞がれた場合: 足元に王冠を一時ドロップして手ぶらに戻り、BREAKで岩を破壊
    if (player.holdItem === 'CROWN' && map.getItem(player.pos) === 'NONE' && MagicSystem.canCast(player, 'BREAK').allowed) {
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

    return {
      type: 'WANDER_SAFELY',
      priority: 85,
      reason: '🌀 局所停滞打開: 冷涼マスへ離脱移動',
    };
  }
}
