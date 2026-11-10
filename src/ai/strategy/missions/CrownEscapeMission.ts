import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { IStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { Direction, Position } from '../../../models/Types.js';
import { WorldMap } from '../../../models/WorldMap.js';
import { MagicSystem } from '../../../systems/MagicSystem.js';
import { ThreatEvaluator } from '../../../systems/ThreatEvaluator.js';
import { MovementSystem } from '../../../systems/MovementSystem.js';
import { EnemyInstance } from '../../../models/Enemy.js';

/**
 * CrownEscapeMission (カテゴリ1: 王冠回収＆我が家脱出作戦)
 *
 * 全首撃破後に出現した王冠（最大4個）を回収し、我が家へ持ち帰って脱出・ゲームクリアする。
 * 王冠所持による「魔法封印」の制約を先読みし、以下の高度な自衛・状態制御を行う：
 * 1. 王冠取得前の事前安全確保（危険敵への事前 FREEZE/FLASH 詠唱）
 * 2. 王冠取得前の事前 MP 補給（近傍ポーション回収）
 * 3. 王冠運搬中の先読み自衛（危険敵接近時の安全距離一時ドロップ＆魔法迎撃、自殺ドロップ防止）
 * 4. 王冠4個完遂までのサイクル管理および王冠所持ゴースト追跡
 */
export class CrownEscapeMission implements IStrategicMission {
  public readonly id = 'CROWN_ESCAPE';
  public readonly name = '👑 王冠回収＆我が家脱出作戦';
  public readonly maxTurns = 1500;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';

  public evaluateStatus(_snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    if (engine.getState() === 'STAGECLEAR') {
      return 'COMPLETED';
    }

    if (this.turnsElapsed >= this.maxTurns) {
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    const player = engine.getPlayer();
    const map = snapshot.map;
    const enemies = snapshot.livingEnemies;
    const curPos = player.pos;
    const homePos = this.getBestHomePos(curPos, map, snapshot);
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

    // 0. 不要な手持ち品（KEY, RING, CROSS等）の手放し
    if (player.holdItem !== 'NONE' && player.holdItem !== 'CROWN') {
      return {
        type: 'DROP_HOLD_ITEM',
        priority: 100,
        reason: `👑 王冠回収のため不要アイテム手放し [${player.holdItem}]`,
      };
    }

    // 0-B. 我が家マス上または我が家直前の敵排除（FREEZE封鎖・居座り対策）
    // プレイヤーが手ぶら、または我が家に直近の場合で、我が家マス上または我が家隣接に敵がいるなら露払い攻撃
    const allHomes = map.getAllHomePositions();
    const isNearRealHome = map.getTorusDistance(curPos, map.realHomePos).chebyshev <= 2;
    if (player.holdItem === 'NONE' || isNearRealHome) {
      for (const d of cardDirs) {
        const adj = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
        const isAdjHome = map.getBaseTile(adj) === 'HOME' || allHomes.some(h => h.x === adj.x && h.y === adj.y);
        if (isAdjHome) {
          const enemyOnHome = enemies.find(e => e.isAlive && e.pos.x === adj.x && e.pos.y === adj.y);
          if (enemyOnHome) {
            return {
              type: 'ATTACK_TARGET',
              targetPos: enemyOnHome.pos,
              priority: 101,
              reason: `⚔️ 我が家マス上の敵を排除突破 (${enemyOnHome.name})`,
            };
          }
        }
      }
    }

    // 0-C. 敵湧き場（spawnHomePos）のFREEZE家封鎖戦術:
    // 首討伐後に初期位置の家から敵が湧き出す場合、その周辺の敵をFREEZEで凍結して湧き出し口をバリケード封鎖！
    if (map.spawnHomePos && player.magic > 0 && !player.hasDeath && MagicSystem.canCast(player, 'FREEZE').allowed) {
      const isNearSpawnHome = map.getTorusDistance(curPos, map.spawnHomePos).chebyshev <= 3;
      if (isNearSpawnHome && !isNearRealHome) {
        const enemyNearSpawnHome = enemies.find(e => {
          if (!e.isAlive || e.isPermanentlyFrozen || (e.frozenTimer ?? 0) > 0) return false;
          return map.getTorusDistance(e.pos, map.spawnHomePos!).chebyshev <= 2;
        });
        if (enemyNearSpawnHome) {
          return {
            type: 'CAST_MAGIC',
            magicToCast: 'FREEZE',
            priority: 102,
            reason: `❄️ 敵湧き家封鎖FREEZEバリケード (${enemyNearSpawnHome.name})`,
          };
        }
      }
    }

    // -------------------------------------------------------------
    // 1. 王冠所持中 (holdItem === 'CROWN') の自衛＆我が家帰還
    // -------------------------------------------------------------
    if (player.holdItem === 'CROWN') {
      // 1-A. 我が家到着: 自動奉納されるため、我が家マスへ入る移動を優先
      const isHome = map.getBaseTile(curPos) === 'HOME' || allHomes.some(h => curPos.x === h.x && curPos.y === h.y);
      if (isHome) {
        // 我が家に到達した直後は奉納処理が走り、次ターン手ぶらになる
        return {
          type: 'WANDER_SAFELY',
          priority: 20,
          reason: '👑 我が家にて王冠奉納完了',
        };
      }

      // 1-B. 直角隣接（マンハッタン距離1）に即死敵（LETHAL）がいる場合の対応
      const adjacentLethal = cardDirs
        .map(d => {
          const np = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
          const e = enemies.find(enemy => enemy.isAlive && !enemy.isPermanentlyFrozen && (enemy.frozenTimer ?? 0) <= 0 && enemy.pos.x === np.x && enemy.pos.y === np.y);
          return e && ThreatEvaluator.evaluateThreatDetails(player, e).defenseThreat === 'LETHAL'
            ? { enemy: e, dir: d }
            : null;
        })
        .filter((x): x is { enemy: EnemyInstance; dir: Direction } => x !== null);

      if (adjacentLethal.length > 0) {
        // 直角隣接の敵を一撃撃破（ONE_SHOT）可能なら直接排除（自殺ドロップの絶対防止）
        const oneShotTarget = adjacentLethal.find(
          item => ThreatEvaluator.evaluateThreatDetails(player, item.enemy).attackThreat === 'ONE_SHOT'
        );
        if (oneShotTarget) {
          return {
            type: 'ATTACK_TARGET',
            targetPos: oneShotTarget.enemy.pos,
            priority: 100,
            reason: `⚔️ 王冠運搬中・隣接即死敵を一撃撃破突破 (${oneShotTarget.enemy.name})`,
          };
        }

        // ワンパンできない場合: ドロップすると次手番で殴られて即死するため、安全方向へ緊急退避
        return {
          type: 'EVADE_DANGER',
          priority: 99,
          reason: '🚨 王冠運搬中・隣接即死敵から緊急退避（自殺ドロップ防止）',
        };
      }

      // 1-C. 【安全距離での先読み一時ドロップ】
      // 直角隣接（距離1）には即死敵がいないが、近傍（チェビシェフ<=2 かつ マンハッタン<=3）に危険な敵が接近している場合:
      // このターンに王冠を安全に床へ置き、次ターン手ぶら（魔法詠唱可能）状態で安全にFREEZE/FLASH無力化できる
      // ※ただし我が家の至近距離（チェビシェフ<=2）では王冠ドロップやFREEZEは封鎖リスクが高いため避ける
      const canCastMagic = player.magic > 0 && !player.hasDeath;
      if (canCastMagic && map.getItem(curPos) === 'NONE' && !isNearRealHome) {
        const approachingLethal = enemies.find(e => {
          if (!e.isAlive || e.isPermanentlyFrozen || (e.frozenTimer ?? 0) > 0) return false;
          const d = map.getTorusDistance(curPos, e.pos);
          if (d.chebyshev > 2 || d.manhattan > 3 || d.manhattan < 2) return false;
          const details = ThreatEvaluator.evaluateThreatDetails(player, e);
          const isDanger = details.defenseThreat === 'LETHAL' || details.damageToPlayer >= player.hp * 0.40;
          return isDanger && details.attackThreat !== 'ONE_SHOT';
        });

        if (approachingLethal) {
          return {
            type: 'DROP_HOLD_ITEM',
            priority: 98,
            reason: `👑 即死敵接近につき安全距離で王冠一時ドロップ＆魔法迎撃準備 (${approachingLethal.name})`,
          };
        }
      }

      // 1-C. 道が岩（BLOCK）で遮断されている場合の一時ドロップ開削
      // 足元にアイテムがなく、かつ直角隣接に即死敵がいない場合は、王冠を一時ドロップして手ぶら化し、BREAK詠唱可能にする
      const hasClearRoad = this.canWalkToHomeWithoutMagic(curPos, homePos, map);
      if (!hasClearRoad && map.getItem(curPos) === 'NONE') {
        const hasBlockNearby = cardDirs.some(d => {
          const adj = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
          return map.getObject(adj) === 'BLOCK';
        });
        const hasAdjacentLethal = cardDirs.some(d => {
          const adj = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
          const e = enemies.find(en => en.isAlive && en.pos.x === adj.x && en.pos.y === adj.y);
          return e && ThreatEvaluator.evaluateThreatDetails(player, e).defenseThreat === 'LETHAL';
        });

        if (hasBlockNearby && !hasAdjacentLethal && player.magic > 0 && player.experience >= 4000) {
          return {
            type: 'DROP_HOLD_ITEM',
            priority: 97,
            reason: '👑 王冠運搬路遮断: 岩開削のため王冠一時ドロップ（手ぶら化してBREAK詠唱準備）',
          };
        }
      }

      // 1-D. 最適な我が家へ最速直行
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: homePos,
        priority: 90,
        policy: { disallowFreezeNearHome: true },
        reason: `👑 王冠所持: 我が家 (${homePos.x}, ${homePos.y}) へ最速脱出帰還`,
      };
    }

    // -------------------------------------------------------------
    // 2. 手ぶら時 (holdItem === 'NONE') の安全確認・事前開通・王冠回収
    // -------------------------------------------------------------

    // 2-A. 足元の王冠回収（安全確認＆事前スタン・露払い）
    if (map.getItem(curPos) === 'CROWN') {
      // ① 周囲2マス以内に未凍結・未スタンの危険敵（被ダメージあり）がいる場合:
      const nearbyDangerousEnemies = enemies.filter(e => {
        if (!e.isAlive || e.isPermanentlyFrozen || (e.frozenTimer ?? 0) > 0) return false;
        const d = map.getTorusDistance(curPos, e.pos).manhattan;
        if (d > 2) return false;
        const details = ThreatEvaluator.evaluateThreatDetails(player, e);
        return details.defenseThreat !== 'NO_DAMAGE';
      });

      if (nearbyDangerousEnemies.length > 0) {
        // 脱出・帰還先である前線基地（チェビシェフ<=2）では進入路封鎖を防ぐためFLASH優先！
        const isNearEscapeHome = map.getTorusDistance(curPos, map.realHomePos).chebyshev <= 2;
        const hasAdjacentDangerous = nearbyDangerousEnemies.some(e => map.getTorusDistance(curPos, e.pos).chebyshev <= 1);

        // 1. 前線基地近傍、または周囲1マスに敵がいない（チェビシェフ2にいる）場合は FLASH
        if ((isNearEscapeHome || !hasAdjacentDangerous) && player.magic > 0 && !player.hasDeath && MagicSystem.canCast(player, 'FLASH').allowed) {
          return {
            type: 'CAST_MAGIC',
            magicToCast: 'FLASH',
            priority: 98,
            reason: '⚡ 王冠取得前安全確保FLASHスタン（全画面足止め）',
          };
        }

        // 2. 前線基地から離れており、周囲1マスに敵がいる場合は FREEZE
        if (!isNearEscapeHome && hasAdjacentDangerous && player.magic > 0 && !player.hasDeath && MagicSystem.canCast(player, 'FREEZE').allowed) {
          return {
            type: 'CAST_MAGIC',
            magicToCast: 'FREEZE',
            priority: 98,
            reason: `❄️ 王冠取得前自衛FREEZE (${nearbyDangerousEnemies[0].name})`,
          };
        }

        // 3. FLASH フォールバック
        if (player.magic > 0 && !player.hasDeath && MagicSystem.canCast(player, 'FLASH').allowed) {
          return {
            type: 'CAST_MAGIC',
            magicToCast: 'FLASH',
            priority: 97,
            reason: '⚡ 王冠取得前FLASHスタン',
          };
        }

        // 直角隣接のワンパン敵がいれば排除
        const adjOneShot = cardDirs
          .map(d => {
            const np = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
            const e = enemies.find(enemy => enemy.isAlive && enemy.pos.x === np.x && enemy.pos.y === np.y);
            return e && ThreatEvaluator.evaluateThreatDetails(player, e).attackThreat === 'ONE_SHOT' ? e : null;
          })
          .filter((x): x is EnemyInstance => x !== null);

        if (adjOneShot.length > 0) {
          return {
            type: 'ATTACK_TARGET',
            targetPos: adjOneShot[0].pos,
            priority: 96,
            reason: `⚔️ 王冠取得前露払い (${adjOneShot[0].name})`,
          };
        }

        // 魔法もワンパンも無理なら即死を避けて緊急退避（自殺取得の防止）
        return {
          type: 'EVADE_DANGER',
          priority: 95,
          reason: '🚨 王冠上の即死敵から緊急退避',
        };
      }

      // ② 王冠取得前の全敵 FLASH スタン（安全な運搬時間の確保）
      // 王冠を持つと一切の魔法が封印されるため、フロア内に活動中の危険敵がいるなら拾う直前に FLASH！
      const hasActiveDangerousEnemies = enemies.some(e => {
        if (!e.isAlive || e.isPermanentlyFrozen || (e.frozenTimer ?? 0) > 0) return false;
        const details = ThreatEvaluator.evaluateThreatDetails(player, e);
        return details.defenseThreat === 'LETHAL' || details.damageToPlayer >= player.hp * 0.35;
      });

      if (hasActiveDangerousEnemies && player.magic > 0 && !player.hasDeath && MagicSystem.canCast(player, 'FLASH').allowed) {
        return {
          type: 'CAST_MAGIC',
          magicToCast: 'FLASH',
          priority: 94,
          reason: '⚡ 王冠取得前・安全確保の全フロアFLASHスタン',
        };
      }

      // ③ 我が家までの進軍ルートが開通しているかチェック（魔法封印前の事前開削）
      const hasClearRoadToHome = this.canWalkToHomeWithoutMagic(curPos, homePos, map);
      if (!hasClearRoadToHome && player.experience >= 4000) {
        // 直角4方向に岩があれば、即座にBREAKで破壊
        for (const d of cardDirs) {
          const adj = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
          if (map.getObject(adj) === 'BLOCK' && MagicSystem.canCast(player, 'BREAK').allowed) {
            return {
              type: 'BREACH_SHORTCUT',
              targetPos: adj,
              priority: 95,
              reason: '🔨 王冠運搬路の事前開削: 直角隣接の岩を破壊',
            };
          }
        }

        // 我が家への開拓進軍（手ぶら状態で岩を掘りながら進む）
        return {
          type: 'NAVIGATE_TO_POSITION',
          targetPos: homePos,
          priority: 92,
          policy: { disallowFreezeNearHome: true },
          reason: '🔨 王冠運搬路の事前開拓へ移動（手ぶらのうちに帰還ルートを開削）',
        };
      }

      // ④ 完全開通確認済み: 安全に王冠を取得！
      return {
        type: 'PICKUP_ITEM',
        targetItemType: 'CROWN',
        priority: 93,
        reason: '👑 進軍ルート開通確認完了: 床の王冠を取得',
      };
    }

    // 2-B. 周囲2〜3マスに即死敵（LETHAL）が接近している場合 -> 全画面 FLASH で足止め（大局安全確保）
    const approachingLethal = enemies.find(e => {
      if (!e.isAlive || e.isPermanentlyFrozen || (e.frozenTimer ?? 0) > 0) return false;
      const d = map.getTorusDistance(curPos, e.pos);
      if (d.chebyshev > 3 || d.chebyshev <= 1) return false;
      return ThreatEvaluator.evaluateThreat(player, e) === 'LETHAL';
    });

    if (approachingLethal && player.magic > 0 && !player.hasDeath && MagicSystem.canCast(player, 'FLASH').allowed) {
      return {
        type: 'CAST_MAGIC',
        magicToCast: 'FLASH',
        priority: 96,
        reason: `⚡ 即死敵接近足止めFLASH (${approachingLethal.name})`,
      };
    }

    // 2-C. 足元のポーション即時回収 ＆ 脱出用MP補給 (magic < 2)
    if (map.getItem(curPos) === 'POTION') {
      return {
        type: 'PICKUP_ITEM',
        targetItemType: 'POTION',
        priority: 92,
        reason: '🧪 脱出用ポーションを取得',
      };
    }

    if (player.magic < 2) {
      const potionPos = this.findNearestItem(curPos, 'POTION', map, snapshot);
      if (potionPos) {
        return {
          type: 'NAVIGATE_TO_POSITION',
          targetPos: potionPos,
          targetItemType: 'POTION',
          priority: 89,
          reason: `🧪 脱出用MP補給 (${potionPos.x}, ${potionPos.y})`,
        };
      }
    }

    // 2-D. 床の王冠へ移動（最寄りの王冠候補）
    const nearestCrown = this.findNearestItem(curPos, 'CROWN', map, snapshot);
    if (nearestCrown) {
      const dist = map.getTorusDistance(curPos, nearestCrown).manhattan;
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: nearestCrown,
        targetItemType: 'CROWN',
        priority: 88,
        reason: `👑 床の王冠へ移動 (${nearestCrown.x}, ${nearestCrown.y}) [距離:${dist}]`,
      };
    }

    // 2-E. 床に王冠がなく、ゴーストが王冠を運んでいる場合の追跡
    const ghosts = engine.getGhosts ? engine.getGhosts() : [];
    const crownGhost = ghosts.find((g: any) => g.carriedItem === 'CROWN');
    if (crownGhost) {
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: crownGhost.pos,
        priority: 87,
        reason: `👻 王冠所持ゴースト追跡 (${crownGhost.pos.x}, ${crownGhost.pos.y})`,
      };
    }

    // 2-F. 直角隣接の ONE_SHOT 敵を露払い排除
    for (const d of cardDirs) {
      const adj = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
      const enemy = enemies.find(e => e.isAlive && e.pos.x === adj.x && e.pos.y === adj.y);
      if (enemy && ThreatEvaluator.evaluateThreat(player, enemy) === 'ONE_SHOT') {
        return {
          type: 'ATTACK_TARGET',
          targetPos: enemy.pos,
          priority: 85,
          reason: `⚔️ 脱出進路露払い (${enemy.name})`,
        };
      }
    }

    // 2-G. フォールバック: 我が家へ移動
    return {
      type: 'NAVIGATE_TO_POSITION',
      targetPos: homePos,
      priority: 50,
      reason: '王冠探索または我が家へ移動',
    };
  }

  private findNearestItem(from: Position, itemType: string, map: WorldMap, snapshot: TacticalSnapshot): Position | null {
    let nearest: Position | null = null;
    let minDist = Infinity;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (map.getItem(p) === itemType && !snapshot.memory.isTargetUnreachable(p, snapshot.totalTurns)) {
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

  /**
   * 複数の我が家（復活した初期配置HOMEと移転後の前線HOME）から、
   * 到達可能かつ最短距離の最適な家を動的に選定する。
   */
  private getBestHomePos(from: Position, map: WorldMap, snapshot: TacticalSnapshot): Position {
    // 前線基地（realHomePos）が到達可能なら最優先（初期位置の家は敵湧き場のため避ける）
    const realHome = map.realHomePos;
    if (!snapshot.memory.isTargetUnreachable(realHome, snapshot.totalTurns)) {
      return realHome;
    }

    const allHomes = map.getAllHomePositions();
    if (allHomes.length === 0) {
      return realHome;
    }

    // 到達不能（ブラックリスト）に登録されていない家を優先
    const reachableHomes = allHomes.filter(h => !snapshot.memory.isTargetUnreachable(h, snapshot.totalTurns));
    const candidates = reachableHomes.length > 0 ? reachableHomes : allHomes;

    let bestHome = candidates[0];
    let minDist = Infinity;
    for (const h of candidates) {
      const d = map.getTorusDistance(from, h).manhattan;
      if (d < minDist) {
        minDist = d;
        bestHome = h;
      }
    }
    return bestHome;
  }

  /**
   * 魔法（BREAK）を使わずに、壁・岩・墓を避けて我が家へ徒歩で到達できるか（BFS計測）
   */
  private canWalkToHomeWithoutMagic(from: Position, home: Position, map: WorldMap): boolean {
    const queue: Position[] = [{ ...from }];
    const visited = new Set<string>();
    visited.add(`${from.x},${from.y}`);

    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.x === home.x && cur.y === home.y) {
        return true;
      }

      for (const d of cardDirs) {
        const nextP = map.wrapPosition(MovementSystem.getNextPosition(cur, d));
        const key = `${nextP.x},${nextP.y}`;
        if (visited.has(key)) continue;
        visited.add(key);

        const base = map.getBaseTile(nextP);
        const obj = map.getObject(nextP);
        // 壁、岩、墓は歩行不可（魔法なしで通行不能）
        if (base === 'WALL_STATIC') continue;
        if (obj === 'BLOCK') continue;
        if (base === 'GRAVE' && obj === 'NONE') continue;

        queue.push(nextP);
      }
    }

    return false;
  }
}
