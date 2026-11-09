import { DIAGONAL_REQUIRED_EXP, MAGIC_TABLE, MagicDefinition } from '../config/MagicTable.js';
import { KICK_MAX_RANGE } from '../config/Constants.js';
import { MagicType, Position } from '../models/Types.js';
import { Player } from '../models/Player.js';
import { WorldMap } from '../models/WorldMap.js';
import { EnemyInstance } from '../models/Enemy.js';
import { Ghost } from '../models/Ghost.js';
import { Dragon } from '../models/Dragon.js';
import { MovementSystem } from './MovementSystem.js';
import { CURRENT_SAVE_VERSION, FullSaveData, SaveManager, SystemSaveData } from '../services/SaveManager.js';
import { SpawnSystem } from './SpawnSystem.js';

export interface CastResult {
  success: boolean;
  message?: string;
  magicType?: MagicType;
  showMap?: boolean;
  kickPath?: Position[];
  kickHitEnemy?: { id: string; pos: Position; name: string };
  kickCrushed?: boolean;
  breakPos?: Position;
  frozenPositions?: Position[];
  warpDestPos?: Position;
}

export class MagicSystem {
  /**
   * プレイヤーが習得済みの魔法一覧を取得
   */
  public static getUnlockedMagics(player: Player): MagicDefinition[] {
    // 経験値に応じた魔法をフィルタリング
    return MAGIC_TABLE.filter(m => player.experience >= m.requiredExp);
  }

  /**
   * プレイヤーの特技・斜め移動の習得チェックと更新
   */
  public static updatePassiveSkills(player: Player): void {
    if (player.experience >= DIAGONAL_REQUIRED_EXP) {
      player.canDiagonal = true;
    }
  }

  /**
   * 指定魔法が発動可能か判定（制限フラグチェック）
   */
  public static canCast(player: Player, magicType: MagicType): { allowed: boolean; reason?: string } {
    // 1. 死神憑依中
    if (player.hasDeath) {
      return { allowed: false, reason: '死神に取り憑かれているため魔法を使用できません' };
    }

    // 2. 十字架所持中
    if (player.holdItem === 'CROSS') {
      return { allowed: false, reason: '十字架を所持しているため魔法を使用できません' };
    }

    // 3. クラウン手持ち中（運搬中のみ魔法無効）
    if (player.holdItem === 'CROWN') {
      return { allowed: false, reason: 'クラウンを所持しているため魔法を使用できません' };
    }

    // 4. MAGICストック不足
    if (player.magic <= 0) {
      return { allowed: false, reason: 'MAGIC（魔法の壺）が不足しています' };
    }

    // 5. 習得経験値チェック
    const def = MAGIC_TABLE.find(m => m.type === magicType);
    if (!def || player.experience < def.requiredExp) {
      return { allowed: false, reason: 'その魔法はまだ習得していません' };
    }

    return { allowed: true };
  }

  /**
   * 魔法の発動実行
   */
  public static cast(
    player: Player,
    magicType: MagicType,
    map: WorldMap,
    enemies: EnemyInstance[] = [],
    ghosts: Ghost[] = [],
    dragon?: Dragon,
    systemInfo?: SystemSaveData
  ): CastResult {
    const check = this.canCast(player, magicType);
    if (!check.allowed) {
      return { success: false, message: check.reason };
    }

    switch (magicType) {
      case 'BREAK':
        return this.castBreak(player, map);

      case 'KICK':
        return this.castKick(player, map, enemies, dragon);

      case 'FREEZE':
        return this.castFreeze(player, enemies);

      case 'FLASH':
        return this.castFlash(player, enemies);

      case 'FLY':
        return this.castFly(player);

      case 'JUMP':
        return this.castJump(player, map, ghosts);

      case 'RETURN':
        return this.castReturn(player, map, systemInfo);

      case 'MAP':
        return this.castMap(player);

      case 'SAVE':
        return this.castSave(player, map, enemies, ghosts, dragon, systemInfo);

      default:
        return { success: false, message: '未知の魔法です' };
    }
  }

  /**
   * BREAK: 目の前のブロックを破壊（実質MAGIC消費0）
   */
  private static castBreak(player: Player, map: WorldMap): CastResult {
    const targetPos = map.wrapPosition(MovementSystem.getNextPosition(player.pos, player.dir));
    const tile = map.getTile(targetPos);

    if (tile === 'BLOCK' || map.getObject(targetPos) === 'BLOCK') {
      // ブロックオブジェクトのみを破壊し、床上アイテムがあれば保持する
      map.setObject(targetPos, 'NONE');
      // 実質消費0（ストックは減らない）
      return { success: true, message: '目の前のブロックを破壊した！', magicType: 'BREAK', breakPos: { ...targetPos } };
    }

    return { success: false, message: '破壊できるブロックがありません' };
  }

  /**
   * KICK: 目の前の岩を蹴り飛ばし、直線方向に敵または障害物に衝突するまでスライド（長距離射出）させる
   */
  private static castKick(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon?: Dragon
  ): CastResult {
    const targetPos = map.wrapPosition(MovementSystem.getNextPosition(player.pos, player.dir));
    const tile = map.getTile(targetPos);

    if (tile !== 'BLOCK') {
      return { success: false, message: '蹴ることができる岩がありません' };
    }

    let currPos = targetPos;
    let stepsMoved = 0;
    const maxSteps = KICK_MAX_RANGE;
    const kickPath: Position[] = [{ ...targetPos }];

    for (let step = 1; step <= maxSteps; step++) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(currPos, player.dir));

      // A. 生存している敵に衝突した場合
      const hitEnemy = enemies.find(e => e.isAlive && e.pos.x === nextPos.x && e.pos.y === nextPos.y);
      if (hitEnemy) {
        // 敵に即死ダメージを与えて撃破
        hitEnemy.takeDamage(999999);
        hitEnemy.isAlive = false;

        const expGain = Math.floor(hitEnemy.def / 2) + 50;
        player.addExperience(expGain);

        // 元の targetPos の岩を消去
        map.setTile(targetPos, 'EMPTY');

        // 敵がいたマスが配置可能ならそこに岩を配置
        if (map.isPushDestinationValid(nextPos)) {
          map.setTile(nextPos, 'BLOCK');
        }

        kickPath.push({ ...nextPos });

        // モンスターに命中したため MAGIC を 1 消費
        player.magic = Math.max(0, player.magic - 1);
        return {
          success: true,
          message: `岩を一直線に蹴り飛ばし ${hitEnemy.name} を撃退した！`,
          magicType: 'KICK',
          kickPath,
          kickHitEnemy: { id: hitEnemy.id, pos: { ...nextPos }, name: hitEnemy.name },
          kickCrushed: false,
        };
      }

      // ドラゴン部位への衝突チェック
      const dragonPart = dragon ? dragon.getPartAt(nextPos) : null;

      // プレイヤー自身への衝突チェック（一周して背後から突入するのを防止）
      const isPlayerAtNext = nextPos.x === player.pos.x && nextPos.y === player.pos.y;

      // B. 障害物に衝突した場合（プレイヤー、壁、岩、家、墓、宝箱、床アイテム、ドラゴン部位等）
      const isBlocked = isPlayerAtNext || dragonPart !== null || !map.isPushDestinationValid(nextPos, enemies);
      if (isBlocked) {
        if (stepsMoved === 0) {
          // 1マスも動けなかった場合: BREAKと同様にその場で岩が砕けて消滅。MAGIC消費0
          map.setTile(targetPos, 'EMPTY');
          return {
            success: true,
            message: '岩を砕いた！',
            magicType: 'KICK',
            kickPath,
            kickCrushed: true,
          };
        } else {
          // 1マス以上進んだ場合: 障害物の直前の空きマスまで岩を移動。MAGIC消費0
          map.moveTile(targetPos, currPos);
          return {
            success: true,
            message: `岩を一直線に蹴り飛ばした！（${stepsMoved}マス滑走）`,
            magicType: 'KICK',
            kickPath,
            kickCrushed: false,
          };
        }
      }

      // 障害物がなければ1マス進行
      currPos = nextPos;
      stepsMoved++;
      kickPath.push({ ...currPos });
    }

    // maxSteps（最大射程）まで何にも衝突しなかった場合: 最大射程の空きマスに岩を配置
    if (stepsMoved > 0) {
      map.moveTile(targetPos, currPos);
    }
    return {
      success: true,
      message: `岩を一直線に蹴り飛ばした！（${stepsMoved}マス滑走）`,
      magicType: 'KICK',
      kickPath,
      kickCrushed: false,
    };
  }

  /**
   * FREEZE: 周囲モンスターを永久凍結（倒されるまで二度と動かない）
   */
  private static castFreeze(player: Player, enemies: EnemyInstance[]): CastResult {
    player.magic = Math.max(0, player.magic - 1);

    let frozenCount = 0;
    const frozenPositions: Position[] = [];
    for (const enemy of enemies) {
      if (!enemy.isAlive) continue;
      const dx = Math.abs(enemy.pos.x - player.pos.x);
      const dy = Math.abs(enemy.pos.y - player.pos.y);
      // 周囲1マス（8方向）
      if (dx <= 1 && dy <= 1) {
        enemy.isPermanentlyFrozen = true;
        enemy.frozenTimer = Infinity;
        frozenCount++;
        frozenPositions.push({ ...enemy.pos });
      }
    }

    return {
      success: true,
      message: `FREEZE発動！ 周囲のモンスター(${frozenCount}体)を永久凍結させた！`,
      magicType: 'FREEZE',
      frozenPositions,
    };
  }

  /**
   * FLASH: 画面内（全モンスター）を一定時間（一時的）行動不能にする
   */
  private static castFlash(player: Player, enemies: EnemyInstance[]): CastResult {
    player.magic = Math.max(0, player.magic - 1);

    let count = 0;
    for (const enemy of enemies) {
      if (!enemy.isAlive) continue;
      // 既に永久凍結されている敵は永続状態を維持
      if (!enemy.isPermanentlyFrozen) {
        enemy.frozenTimer = 8; // 8ターン一時停止
      }
      count++;
    }

    return {
      success: true,
      message: `FLASH発動！ 全モンスター(${count}体)の行動を一時停止させた！`,
      magicType: 'FLASH',
    };
  }

  /**
   * FLY: 鳥に変身して一定時間無敵飛行
   */
  private static castFly(player: Player): CastResult {
    player.magic = Math.max(0, player.magic - 1);
    player.isFlying = true;
    player.flyTimer = 12; // 12ターン飛行

    return {
      success: true,
      message: 'FLY発動！ 鳥に変身して空を飛んだ！',
      magicType: 'FLY',
    };
  }

  /**
   * JUMP: 徘徊中のゴーストの場所へランダムワープ（壁通過中の場合は安全な最寄り床へ着地）
   */
  private static castJump(player: Player, map: WorldMap, ghosts: Ghost[]): CastResult {
    player.magic = Math.max(0, player.magic - 1);

    if (ghosts.length > 0) {
      const idx = Math.floor(Math.random() * ghosts.length);
      const targetGhost = ghosts[idx];

      // ゴーストのマスが通過可能であれば直接ワープ
      if (map.isPassable(targetGhost.pos)) {
        player.pos = { ...targetGhost.pos };
        return { success: true, message: 'JUMP発動！ ゴーストの場所へワープした！', magicType: 'JUMP', warpDestPos: { ...player.pos } };
      }

      // ゴーストが壁を通過中の場合: 最も近い安全な通過可能マスを探索して着地
      let nearestPassable: Position | null = null;
      let minDistance = Infinity;

      for (let r = 1; r <= 5; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const checkPos: Position = { x: targetGhost.pos.x + dx, y: targetGhost.pos.y + dy };
            if (map.isPassable(checkPos)) {
              const dist = Math.abs(dx) + Math.abs(dy);
              if (dist < minDistance) {
                minDistance = dist;
                nearestPassable = checkPos;
              }
            }
          }
        }
        if (nearestPassable) break;
      }

      if (nearestPassable !== null) {
        const dest: Position = nearestPassable;
        player.pos = { x: dest.x, y: dest.y };
        return { success: true, message: 'JUMP発動！ ゴーストの近くの通路へワープした！', magicType: 'JUMP', warpDestPos: { ...player.pos } };
      }

      // 万一最寄りが見つからない場合でもゴースト位置へ
      player.pos = { ...targetGhost.pos };
      return { success: true, message: 'JUMP発動！ ゴーストの場所へワープした！', magicType: 'JUMP', warpDestPos: { ...player.pos } };
    }

    // ゴーストがいない場合はランダムな空きマス
    for (let attempts = 0; attempts < 50; attempts++) {
      const rx = Math.floor(Math.random() * (map.width - 2)) + 1;
      const ry = Math.floor(Math.random() * (map.height - 2)) + 1;
      if (map.isPassable({ x: rx, y: ry })) {
        player.pos = { x: rx, y: ry };
        break;
      }
    }

    return { success: true, message: 'JUMP発動！ マップのどこかへワープした！', magicType: 'JUMP', warpDestPos: { ...player.pos } };
  }

  /**
   * RETURN: 本物の我が家へ瞬時テレポート
   */
  private static castReturn(player: Player, map: WorldMap, systemInfo?: SystemSaveData): CastResult {
    player.magic = Math.max(0, player.magic - 1);
    player.pos = { ...map.homePos };
    MovementSystem.lastHomeEvent = player.healAtHome(systemInfo?.tuningParams?.progressionConfig);

    return {
      success: true,
      message: 'RETURN発動！ 我が家へ帰還した！',
      magicType: 'RETURN',
      warpDestPos: { ...player.pos },
    };
  }

  /**
   * MAP: レトロ縮小マップ表示
   */
  private static castMap(player: Player): CastResult {
    player.magic = Math.max(0, player.magic - 1);
    return {
      success: true,
      message: 'MAP発動！ 縮小マップを展開した',
      magicType: 'MAP',
      showMap: true,
    };
  }

  /**
   * SAVE: ゲームの進行状況を保存（完全シリアライズ保存）
   */
  private static castSave(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[] = [],
    ghosts: Ghost[] = [],
    dragon?: Dragon,
    systemInfo?: SystemSaveData
  ): CastResult {
    player.magic = Math.max(0, player.magic - 1);

    const fullData: FullSaveData = {
      version: CURRENT_SAVE_VERSION,
      savedAt: new Date().toISOString(),
      player: player.serialize(),
      map: map.serialize(),
      enemies: enemies.map(e => e.serialize()),
      dragon: dragon ? dragon.serialize() : new Dragon({ x: 32, y: 32 }).serialize(),
      ghosts: ghosts.map(g => g.serialize()),
      system: systemInfo ?? {
        totalTurns: 0,
        paletteMode: 'NORMAL',
        selectedMagicIndex: 0,
        showMiniMap: false,
        spawnTurnCounter: SpawnSystem.getTurnCounter(),
      },
    };

    const success = SaveManager.save(fullData);
    if (success) {
      return { success: true, message: '★ SAVE完了！ 冒険の全記録を保存した ★', magicType: 'SAVE' };
    } else {
      return { success: false, message: 'セーブデータの保存に失敗しました' };
    }
  }

  /**
   * 毎ターンの魔法ステータス進行（FLY持続時間などのカウントダウン）
   */
  public static onTurnEnd(player: Player, enemies: EnemyInstance[] = []): void {
    // 1. FLYタイマーの減衰
    if (player.isFlying) {
      player.flyTimer--;
      if (player.flyTimer <= 0) {
        player.isFlying = false;
        player.flyTimer = 0;
      }
    }

    // 2. モンスター凍結タイマーの減衰（FLASH等の一時停止のみ。FREEZE永続凍結は減衰しない）
    for (const enemy of enemies) {
      if (enemy.isAlive && !enemy.isPermanentlyFrozen && enemy.frozenTimer > 0) {
        enemy.frozenTimer--;
      }
    }

    // 3. 特技の自動アンロック
    this.updatePassiveSkills(player);
  }
}
