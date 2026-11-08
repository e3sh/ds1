import { Position } from '../models/Types.js';
import { Player } from '../models/Player.js';
import { WorldMap } from '../models/WorldMap.js';
import { EnemyInstance } from '../models/Enemy.js';
import { CombatSystem, CombatResult } from './CombatSystem.js';
import { Dragon } from '../models/Dragon.js';
import { SeedRandom } from '../core/SeedRandom.js';

export class EnemyAISystem {
  public static lastCombatResults: CombatResult[] = [];
  private static defaultRng: SeedRandom = new SeedRandom();

  public static setDefaultRng(rng: SeedRandom): void {
    this.defaultRng = rng;
  }

  /**
   * 全敵のターン行動を実行
   */
  public static updateEnemies(
    enemies: EnemyInstance[],
    player: Player,
    map: WorldMap,
    dragon?: Dragon,
    mitigationRatio: number = 1.0,
    rng?: SeedRandom
  ): void {
    this.lastCombatResults = [];

    // プレイヤーが負傷中（HP < EXPERIENCE）かどうか判定（原作豹変トリガー）
    const isPlayerInjured = player.hp < player.experience;
    const isEnraged = dragon && dragon.defeatedHeadsCount >= 1;

    for (const enemy of enemies) {
      if (!enemy.isAlive) continue;

      // 凍結中の場合は行動スキップ（FREEZE永続凍結は永続スキップ、FLASH等はタイマー減衰）
      if (enemy.isPermanentlyFrozen) {
        continue;
      }
      if (enemy.frozenTimer > 0) {
        enemy.frozenTimer--;
        continue;
      }

      // 移動頻度チェック (首討伐時は全員毎ターン、交戦中モンスターは反撃手番保証、通常時は2ターンに1回または毎ターン)
      enemy.moveCounter++;
      const effectiveInterval = isEnraged ? 1 : enemy.moveInterval;
      const isEngagedWithPlayer = CombatSystem.engagedEnemy?.id === enemy.id;
      if (!isEngagedWithPlayer && enemy.moveCounter % effectiveInterval !== 0) {
        continue; // 今回のターンは待機
      }

      // AI思考: 逃走(FLEE) か 追跡(CHASE) か 徘徊(WANDER) か
      let mode: 'CHASE' | 'FLEE' | 'WANDER' = 'WANDER';

      const { chebyshev: chebyshevToPlayer, manhattan: distToPlayer } = map.getTorusDistance(enemy.pos, player.pos);

      if (isPlayerInjured || isEnraged) {
        // 原作豹変仕様: プレイヤーの HP < EXPERIENCE の瞬間、または首討伐激怒時、弱敵も含め全敵が全域追跡へ豹変
        mode = 'CHASE';
      } else if (enemy.typeId >= 16 || isEngagedWithPlayer) {
        // 上位モンスター（ランク16以上の強敵）や交戦中の敵は、プレイヤーが強くても立ち向かう
        // 交戦中または索敵範囲内(マンハッタン10以下)で追跡、それ以外は徘徊
        mode = (isEngagedWithPlayer || distToPlayer <= 10) ? 'CHASE' : 'WANDER';
      } else {
        // 下位〜中位モンスター
        const isPlayerStronger = player.hasSword && player.effectiveAttack > enemy.def;
        if (isPlayerStronger) {
          // プレイヤーが強い場合:
          // 画面視界内 (チェビシェフ距離 5以下 かつ マンハッタン距離 7以下) でのみ逃走
          // 視界外の遠い敵はプレイヤーに気づかず徘徊する（画面外での過疎化逃走を防止）
          mode = (chebyshevToPlayer <= 5 && distToPlayer <= 7) ? 'FLEE' : 'WANDER';
        } else {
          // プレイヤーが未強化または弱い場合:
          // 感知距離 (マンハッタン距離 8以下) では接近・追跡。遠くの敵は徘徊（序盤の全域殺到を防止）
          mode = distToPlayer <= 8 ? 'CHASE' : 'WANDER';
        }
      }

      this.stepEnemy(enemy, mode, player, map, enemies, mitigationRatio, rng, dragon);
    }
  }

  /**
   * 単一エネミーの1歩移動・行動処理
   */
  public static stepEnemy(
    enemy: EnemyInstance,
    mode: 'CHASE' | 'FLEE' | 'WANDER',
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    mitigationRatio: number = 1.0,
    rng?: SeedRandom,
    dragon?: Dragon
  ): void {
    const effectiveRng = rng ?? this.defaultRng;

    const directions: { dx: number; dy: number }[] = [
      { dx: 0, dy: -1 }, // UP
      { dx: 0, dy: 1 },  // DOWN
      { dx: -1, dy: 0 }, // LEFT
      { dx: 1, dy: 0 },  // RIGHT
      { dx: -1, dy: -1 }, // UP_LEFT
      { dx: 1, dy: -1 },  // UP_RIGHT
      { dx: -1, dy: 1 },  // DOWN_LEFT
      { dx: 1, dy: 1 },   // DOWN_RIGHT
    ];

    // フェイルセーフ: 万一敵がドラゴン部位の上に既に存在している場合、即座に安全な隣接床へ退去
    if (dragon && dragon.getPartAt(enemy.pos)) {
      for (const dir of directions) {
        const escapePos = map.wrapPosition({ x: enemy.pos.x + dir.dx, y: enemy.pos.y + dir.dy });
        if (
          map.isPassableByEnemy(escapePos) &&
          !dragon.getPartAt(escapePos) &&
          escapePos.x !== player.pos.x &&
          escapePos.y !== player.pos.y &&
          !enemies.some(e => e.isAlive && e.id !== enemy.id && e.pos.x === escapePos.x && e.pos.y === escapePos.y)
        ) {
          enemy.pos = escapePos;
          break;
        }
      }
    }

    const isPlayerInHome = map.getBaseTile(player.pos) === 'HOME';
    const { manhattan: currentDist } = map.getTorusDistance(enemy.pos, player.pos);
    const isEngaged = CombatSystem.engagedEnemy?.id === enemy.id;

    // プレイヤーが我が家(HOME)にいる場合は安全地帯（家の外壁の向こうから攻撃されない）
    // プレイヤーに隣接しており、かつ家の中にいない場合のみ体当たり反撃・攻撃
    if (currentDist === 1 && !isPlayerInHome && (isEngaged || mode === 'CHASE')) {
      const combat = CombatSystem.resolveEnemyAttack(enemy, player, mitigationRatio);
      EnemyAISystem.lastCombatResults.push(combat);
      return;
    }

    if (mode === 'WANDER') {
      // 徘徊モード: 周囲の侵入可能マスの中からランダムに移動（その場にとどまる選択肢も含む）
      const validCandidates: Position[] = [];
      for (const dir of directions) {
        const candidate: Position = map.wrapPosition({
          x: enemy.pos.x + dir.dx,
          y: enemy.pos.y + dir.dy,
        });
        if (!map.isPassableByEnemy(candidate)) continue;
        if (dragon && dragon.getPartAt(candidate)) continue; // ドラゴン部位（頭・体・尾）への侵入禁止
        if (candidate.x === player.pos.x && candidate.y === player.pos.y) continue;
        const occupied = enemies.some(
          e => e.isAlive && e.id !== enemy.id && e.pos.x === candidate.x && e.pos.y === candidate.y
        );
        if (occupied) continue;
        validCandidates.push(candidate);
      }
      if (validCandidates.length > 0 && effectiveRng.chance(0.75)) {
        enemy.pos = effectiveRng.choice(validCandidates);
      }
      return;
    }

    let bestPos: Position | null = null;
    let bestScore = mode === 'CHASE' ? Infinity : -Infinity;

    // 候補マスをシャッフルまたは評価
    for (const dir of directions) {
      const candidate: Position = map.wrapPosition({
        x: enemy.pos.x + dir.dx,
        y: enemy.pos.y + dir.dy,
      });

      // 1. 地形侵入判定（十字架(CROSS)の上には入れない）
      if (!map.isPassableByEnemy(candidate)) {
        continue;
      }

      // 1-B. ドラゴン部位（頭・胴体・尻尾）への侵入禁止
      if (dragon && dragon.getPartAt(candidate)) {
        continue;
      }

      // 2. プレイヤーがいるマスの場合（プレイヤーが家にいる場合は侵入・攻撃不可）
      if (candidate.x === player.pos.x && candidate.y === player.pos.y) {
        // 戦闘判定は上下左右（4方向）のみ。斜めからの敵攻撃は発生させない
        const isOrthogonal = dir.dx === 0 || dir.dy === 0;
        if (isOrthogonal && !isPlayerInHome && (mode === 'CHASE' || isEngaged)) {
          // プレイヤーへ攻撃
          const combat = CombatSystem.resolveEnemyAttack(enemy, player, mitigationRatio);
          EnemyAISystem.lastCombatResults.push(combat);
          return;
        } else {
          // 斜めの場合やFLEE時、プレイヤーが家の中にいる時は進入・攻撃しない
          continue;
        }
      }

      // 3. 他の生存敵との重複チェック
      const occupiedByOther = enemies.some(
        e => e.isAlive && e.id !== enemy.id && e.pos.x === candidate.x && e.pos.y === candidate.y
      );
      if (occupiedByOther) {
        continue;
      }

      // 4. 距離スコア算出（チェビシェフ距離を主軸、マンハッタン距離を副軸、トーラス距離）
      const { chebyshev, manhattan } = map.getTorusDistance(candidate, player.pos);
      const dist = chebyshev * 10 + manhattan;

      if (mode === 'CHASE') {
        if (dist < bestScore) {
          bestScore = dist;
          bestPos = candidate;
        }
      } else {
        if (dist > bestScore) {
          bestScore = dist;
          bestPos = candidate;
        }
      }
    }

    // 最適マスへ移動
    if (bestPos) {
      enemy.pos = bestPos;
    }
  }
}
