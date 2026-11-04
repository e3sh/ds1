import { Position, TileType } from '../models/Types.js';
import { Player } from '../models/Player.js';
import { WorldMap } from '../models/WorldMap.js';
import { Ghost } from '../models/Ghost.js';
import { SeedRandom } from '../core/SeedRandom.js';

export class GhostAISystem {
  private static defaultRng: SeedRandom = new SeedRandom();

  public static setDefaultRng(rng: SeedRandom): void {
    this.defaultRng = rng;
  }
  public static readonly MIN_CARRY_STEPS = 25;
  public static readonly MAX_CARRY_STEPS = 45;
  public static readonly MIN_CRUISE_STEPS = 20;
  public static readonly MAX_CRUISE_STEPS = 35;

  public static readonly DIRECTIONS_8: { vx: number; vy: number }[] = [
    { vx: 0, vy: -1 },  // UP
    { vx: 0, vy: 1 },   // DOWN
    { vx: -1, vy: 0 },  // LEFT
    { vx: 1, vy: 0 },   // RIGHT
    { vx: -1, vy: -1 }, // UP_LEFT
    { vx: 1, vy: -1 },  // UP_RIGHT
    { vx: -1, vy: 1 },  // DOWN_LEFT
    { vx: 1, vy: 1 },   // DOWN_RIGHT
  ];

  /**
   * リアルタイムタイマー更新によるゴーストの直線滑空・反射・アイテム強奪
   */
  public static updateGhosts(
    ghosts: Ghost[],
    deltaMs: number,
    player: Player,
    map: WorldMap,
    rng?: SeedRandom
  ): void {
    for (const ghost of ghosts) {
      ghost.moveTimer += deltaMs;
      while (ghost.moveTimer >= ghost.moveIntervalMs) {
        ghost.moveTimer -= ghost.moveIntervalMs;
        this.stepGhost(ghost, player, map, rng);
      }
    }
  }

  /**
   * アイテム取得時に最低運搬歩数をランダム決定
   */
  public static resetCarryGoal(ghost: Ghost, rng?: SeedRandom): void {
    const effectiveRng = rng ?? this.defaultRng;
    ghost.carrySteps = 0;
    ghost.targetCarrySteps = effectiveRng.nextInt(this.MIN_CARRY_STEPS, this.MAX_CARRY_STEPS);
  }

  /**
   * 通常巡回時に次のランダム方向転換までの目標歩数を設定
   */
  public static resetCruiseGoal(ghost: Ghost, rng?: SeedRandom): void {
    const effectiveRng = rng ?? this.defaultRng;
    ghost.cruiseSteps = 0;
    ghost.targetCruiseSteps = effectiveRng.nextInt(this.MIN_CRUISE_STEPS, this.MAX_CRUISE_STEPS);
  }

  /**
   * 現在の向きおよび真後ろ（180度反転）を除く有効なランダム方向へベクトルを転換
   */
  public static turnToRandomOtherDirection(ghost: Ghost, rng?: SeedRandom): void {
    const effectiveRng = rng ?? this.defaultRng;
    const candidates = this.DIRECTIONS_8.filter(
      d => !(d.vx === ghost.vx && d.vy === ghost.vy) &&
           !(d.vx === -ghost.vx && d.vy === -ghost.vy)
    );
    const list = candidates.length > 0 ? candidates : this.DIRECTIONS_8;
    const chosen = effectiveRng.choice(list);
    ghost.vx = chosen.vx;
    ghost.vy = chosen.vy;
  }

  /**
   * ゴーストの1歩直線滑空処理 (8方向移動・壁無視・バウンド反射・アイテム取得時急転換・十字架散乱回避・空床限定ポイ捨て)
   */
  public static stepGhost(ghost: Ghost, player: Player, map: WorldMap, rng?: SeedRandom): void {
    const effectiveRng = rng ?? this.defaultRng;
    // 速度ベクトルが完全に未設定（0, 0）の場合は全8方向からランダムに初期化
    if (!ghost.vx && !ghost.vy) {
      const dir = effectiveRng.choice(this.DIRECTIONS_8);
      ghost.vx = dir.vx;
      ghost.vy = dir.vy;
    }

    // トーラス構造: 外周での反射は行わず、マップ端を突き抜けて反対側へ直進ループ
    let nextPos: Position = map.wrapPosition({
      x: ghost.pos.x + ghost.vx,
      y: ghost.pos.y + ghost.vy,
    });

    // 十字架結界チェック (地面のCROSSマスは侵入不可)
    if (this.isCrossTile(nextPos, map)) {
      // 往復ループを完全に防ぐため、十字架を避ける有効な別方向（8方向）へランダムに弾き飛ばす
      const shuffledDirs = effectiveRng.shuffle(this.DIRECTIONS_8);

      let foundSafeDir = false;
      for (const dir of shuffledDirs) {
        const testPos = map.wrapPosition({ x: ghost.pos.x + dir.vx, y: ghost.pos.y + dir.vy });
        if (!this.isCrossTile(testPos, map)) {
          ghost.vx = dir.vx;
          ghost.vy = dir.vy;
          nextPos = testPos;
          foundSafeDir = true;
          break;
        }
      }

      if (!foundSafeDir) {
        nextPos = { ...ghost.pos }; // 動けない場合はその場待機
      }
    }

    // 内部の岩（BLOCK）や壁（WALL_STATIC）、墓、宝箱は完全に無視して直進
    ghost.pos = nextPos;

    // 1. プレイヤーと接触した場合のアイテム強奪処理 (十字架も含めひったくり & 急転換)
    if (ghost.pos.x === player.pos.x && ghost.pos.y === player.pos.y) {
      if (player.holdItem !== 'NONE') {
        const stolenItem = player.holdItem;
        player.holdItem = 'NONE';
        ghost.carriedItem = stolenItem as TileType;
        this.resetCarryGoal(ghost);
        ghost.cruiseSteps = 0;
        this.turnToRandomOtherDirection(ghost);
      }
      return;
    }

    // 2. 床アイテムの自動吸引判定 & アイテム取得時の急転換
    const currentItem = map.getItem(ghost.pos);
    const currentBase = map.getBaseTile(ghost.pos);
    const isFloorItem =
      currentItem === 'SWORD' ||
      currentItem === 'COIN' ||
      currentItem === 'POTION' ||
      currentItem === 'POWER_STONE' ||
      currentItem === 'KEY' ||
      currentItem === 'RING' ||
      currentItem === 'DEATH' ||
      currentItem === 'CROWN';

    if (isFloorItem && !ghost.carriedItem) {
      ghost.carriedItem = currentItem;
      this.resetCarryGoal(ghost);
      ghost.cruiseSteps = 0;
      map.setItem(ghost.pos, 'NONE');
      // アイテム取得時: その場でランダムな別方向へベクトルを急転換して飛び去る
      this.turnToRandomOtherDirection(ghost);
    } else if (ghost.carriedItem) {
      // 3. 運搬中アイテムのポイ捨て判定（最低運搬歩数達成 + 空床限定で確定ドロップ）
      ghost.carrySteps++;

      // 岩や壁の中ではなく、隔離エリアや遠隔通路の「何もない空床」の上にポイ捨てする
      const isPureEmptyFloor =
        currentBase === 'EMPTY' &&
        map.getObject(ghost.pos) === 'NONE' &&
        map.getItem(ghost.pos) === 'NONE' &&
        !(ghost.pos.x === player.pos.x && ghost.pos.y === player.pos.y) &&
        !(ghost.pos.x === map.homePos.x && ghost.pos.y === map.homePos.y);

      const distToPlayer = map.getTorusDistance(ghost.pos, player.pos).manhattan;

      // 最低運搬ノルマ歩数を達成し、プレイヤーから離れており(5マス以上)、何もない空床マスへ到達した時に確実にドロップ
      if (ghost.carrySteps >= ghost.targetCarrySteps && distToPlayer >= 5 && isPureEmptyFloor) {
        map.setItem(ghost.pos, ghost.carriedItem);
        ghost.carriedItem = null;
        ghost.carrySteps = 0;
        ghost.targetCarrySteps = 0;
        this.turnToRandomOtherDirection(ghost);
        this.resetCruiseGoal(ghost);
      }
    } else {
      // 4. アイテム未運搬状態での飛行距離（巡回歩数）による周期的な方向転換
      if (ghost.targetCruiseSteps <= 0) {
        this.resetCruiseGoal(ghost);
      }
      ghost.cruiseSteps++;
      if (ghost.cruiseSteps >= ghost.targetCruiseSteps) {
        this.turnToRandomOtherDirection(ghost);
        this.resetCruiseGoal(ghost);
      }
    }
  }

  /**
   * 指定座標が地面の十字架（結界）マスであるか判定
   */
  private static isCrossTile(pos: Position, map: WorldMap): boolean {
    if (!map.isInside(pos)) return false;
    return map.getItem(pos) === 'CROSS' || map.getTile(pos) === 'CROSS';
  }
}
