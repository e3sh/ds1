import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { IStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { Direction, Position } from '../../../models/Types.js';
import { WorldMap } from '../../../models/WorldMap.js';
import { MagicSystem } from '../../../systems/MagicSystem.js';
import { ThreatEvaluator } from '../../../systems/ThreatEvaluator.js';
import { MovementSystem } from '../../../systems/MovementSystem.js';

/**
 * SlayDragonMission (ドラゴン討伐決戦作戦)
 *
 * 決戦準備完了後、ドラゴンの各首を接近・撃破し、ドラゴンを完全討伐する。
 * 戦術層に丸投げせず、ミッション内部でサブステップを明示的に管理：
 * 1. 決戦前の身軽化（不要手持ち品ドロップ）
 * 2. HP危機時・MP枯渇時の一時帰還
 * 3. 首の斜め隣接マスからの直接攻撃 (ATTACK_TARGET)
 * 4. ブレス射線を避けた斜め安全マスへの位置取り進軍 (NAVIGATE_TO_POSITION)
 */
export class SlayDragonMission implements IStrategicMission {
  public readonly id = 'SLAY_DRAGON';
  public readonly name = '🐉 ドラゴン討伐決戦作戦';
  public readonly maxTurns = 800;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    const dragon = engine.getDragon();
    if (!dragon || dragon.isAllHeadsDefeated || dragon.heads.every(h => !h.isAlive)) {
      return 'COMPLETED';
    }

    if (this.turnsElapsed >= this.maxTurns) {
      return 'ABORTED';
    }

    // 要件3: 生存首の攻撃スポットがすべて到達不能な場合は早期アボートして開削・準備へ回る
    const livingHeads = dragon.heads.filter(h => h.isAlive);
    const map = snapshot.map;
    const hasAnyReachableSpot = livingHeads.some(head => {
      const spots = snapshot.spatial.calculateHeadAttackSpots(head, dragon, map);
      return spots.some(spot => !snapshot.memory.isTargetUnreachable(spot, snapshot.totalTurns));
    });
    if (!hasAnyReachableSpot) {
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    const dragon = engine.getDragon();
    const player = engine.getPlayer();
    const map = snapshot.map;

    if (!dragon) {
      return { type: 'WANDER_SAFELY', priority: 10, reason: 'ドラゴン不在' };
    }

    const livingHeads = dragon.heads.filter(h => h.isAlive);
    if (livingHeads.length === 0) {
      return { type: 'WANDER_SAFELY', priority: 10, reason: '全首討伐済み' };
    }

    // サブステップ 1: 不要アイテムの手放し（手ぶら化）
    // 決戦時は身軽である必要があり、足元が空床なら即座にドロップ
    if (player.holdItem !== 'NONE') {
      return {
        type: 'DROP_HOLD_ITEM',
        priority: 100,
        reason: `決戦前不要アイテム手放し [${player.holdItem}]`,
      };
    }

    const enemies = snapshot.livingEnemies;
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const allHomes = map.getAllHomePositions();
    let bestHome = map.realHomePos;
    let minHomeDist = Infinity;
    for (const h of allHomes) {
      const d = map.getTorusDistance(player.pos, h).manhattan;
      if (d < minHomeDist) {
        minHomeDist = d;
        bestHome = h;
      }
    }

    // サブステップ 1-B: 直角隣接の未凍結・未スタン危険敵（被ダメ大・即死）をFREEZE/FLASHで即時無力化
    const adjacentDangerous = cardDirs.some(d => {
      const np = map.wrapPosition(MovementSystem.getNextPosition(player.pos, d));
      const e = enemies.find(enemy => enemy.isAlive && !enemy.isPermanentlyFrozen && (enemy.frozenTimer ?? 0) <= 0 && enemy.pos.x === np.x && enemy.pos.y === np.y);
      if (!e) return false;
      const details = ThreatEvaluator.evaluateThreatDetails(player, e);
      return details.defenseThreat === 'LETHAL' || (details.defenseThreat === 'TAKES_DAMAGE' && details.attackThreat !== 'ONE_SHOT');
    });

    if (adjacentDangerous && player.magic > 0 && !player.hasDeath) {
      const isNearHome = allHomes.some(h => map.getTorusDistance(player.pos, h).chebyshev <= 2);
      if (!isNearHome && MagicSystem.canCast(player, 'FREEZE').allowed) {
        return {
          type: 'CAST_MAGIC',
          magicToCast: 'FREEZE',
          priority: 99,
          reason: '❄️ 首決戦中の隣接危険敵FREEZE無力化',
        };
      }
      if (MagicSystem.canCast(player, 'FLASH').allowed) {
        return {
          type: 'CAST_MAGIC',
          magicToCast: 'FLASH',
          priority: 99,
          reason: '⚡ 首決戦中の隣接危険敵FLASH足止め',
        };
      }
    }

    // サブステップ 2: HP危機時 (HP < 35% かつ HP < 20,000) の一時帰還
    const isHpDanger = player.hp < player.maxHp * 0.35 && player.hp < 20000;
    if (isHpDanger) {
      // ポーション温存のため前線基地（我が家）へ徒歩帰還を優先
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: bestHome,
        priority: 99,
        reason: `決戦中HP回復のため前線基地(${bestHome.x}, ${bestHome.y})へ一時帰還`,
      };
    }

    // サブステップ 3: 最後の首撃破前の MP 補給 (残存首1体かつ MP < 2)
    // （王冠脱出時の魔法 FLASH/RETURN/FREEZE 用のMPを確保）
    // ※我が家ではMPは回復しないため、マップ上の安全なポーションのみを探索
    if (livingHeads.length === 1 && player.magic < 2) {
      if (map.getItem(player.pos) === 'POTION') {
        return {
          type: 'PICKUP_ITEM',
          targetItemType: 'POTION',
          priority: 96,
          reason: '最終首決戦前のMP補給（足元のポーション取得）',
        };
      }
      const nearestPotion = this.findNearestPotion(player.pos, map, snapshot);
      if (nearestPotion) {
        return {
          type: 'NAVIGATE_TO_POSITION',
          targetPos: nearestPotion,
          targetItemType: 'POTION',
          priority: 95,
          reason: `最終首決戦前のMP補給ポーションへ移動 (${nearestPotion.x}, ${nearestPotion.y})`,
        };
      }
      // マップ上にポーションがなければ我が家には戻らず、そのまま首攻撃へフォールスルー
    }

    // プレイヤーのSTRで倒せる首（killableHeads）を優先
    const killableHeads = livingHeads.filter(h => player.strength > h.def);
    const candidateHeads = killableHeads.length > 0
      ? killableHeads
      : [livingHeads.slice().sort((a, b) => a.def - b.def)[0]];

    // サブステップ 4: 首の斜め隣接マスにいる場合 -> 斜め攻撃実行！
    for (const head of candidateHeads) {
      if (this.isDiagonalAdjacent(player.pos, head.pos, map)) {
        return {
          type: 'ATTACK_TARGET',
          targetPos: head.pos,
          priority: 98,
          reason: `🐉 ドラゴン首(${head.pos.x}, ${head.pos.y})へ斜め攻撃実行！[首DEF:${head.def}]`,
        };
      }
    }

    // サブステップ 5: 斜め安全攻撃可能マス (Attack Spot) への位置取り進軍
    // 要件3: isTargetUnreachable を必ず検査し、到達不能スポット・首は候補から除外
    let bestSpot: Position | null = null;
    let targetHead = null;
    let minDistance = Infinity;

    for (const head of candidateHeads) {
      const attackSpots = snapshot.spatial.calculateHeadAttackSpots(head, dragon, map);
      for (const spot of attackSpots) {
        if (snapshot.memory.isTargetUnreachable(spot, snapshot.totalTurns)) {
          continue;
        }
        const d = map.getTorusDistance(player.pos, spot).chebyshev;
        if (d < minDistance) {
          minDistance = d;
          bestSpot = spot;
          targetHead = head;
        }
      }
    }

    if (bestSpot && targetHead) {
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: bestSpot,
        priority: 90,
        reason: `🐉 首(${targetHead.pos.x}, ${targetHead.pos.y})の斜め安全位置(${bestSpot.x}, ${bestSpot.y})へ進軍 [距離:${minDistance}]`,
      };
    }

    // 全首が到達不能な場合は作戦をアボートして開削または準備へ回る
    this.status = 'ABORTED';
    return {
      type: 'WANDER_SAFELY',
      priority: 10,
      reason: '全ドラゴンの攻撃スポットが到達不能のため決戦を中断し開削・準備へ転進',
    };

    // フォールバック: 生存首のいずれかの近傍へ安全徘徊・接近
    return {
      type: 'WANDER_SAFELY',
      priority: 10,
      reason: 'ドラゴンの安全な攻撃スポットへ進軍路模索中',
    };
  }

  private isDiagonalAdjacent(p1: Position, p2: Position, map: WorldMap): boolean {
    let dx = Math.abs(p1.x - p2.x);
    if (dx > map.width / 2) dx = map.width - dx;
    let dy = Math.abs(p1.y - p2.y);
    if (dy > map.height / 2) dy = map.height - dy;
    return dx === 1 && dy === 1;
  }

  private findNearestPotion(from: Position, map: WorldMap, snapshot: TacticalSnapshot): Position | null {
    let nearest: Position | null = null;
    let minDist = Infinity;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (map.getItem(p) === 'POTION' && !snapshot.memory.isTargetUnreachable(p, snapshot.totalTurns)) {
          const d = map.getTorusDistance(from, p).manhattan;
          if (d < minDist) {
            minDist = d;
            nearest = p;
          }
        }
      }
    }
    return nearest;
  }
}
