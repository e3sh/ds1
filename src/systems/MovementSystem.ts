import { Direction, HoldItemType, Position, TileType, DungeonTuningParams } from '../models/Types.js';
import { Player, HomeEventResult } from '../models/Player.js';
import { WorldMap } from '../models/WorldMap.js';
import { ChestSystem } from './ChestSystem.js';
import { EnemyInstance } from '../models/Enemy.js';
import { CombatSystem, CombatResult } from './CombatSystem.js';
import { Dragon } from '../models/Dragon.js';
import { Ghost } from '../models/Ghost.js';

export interface SpaceActionResult {
  action: 'PICKUP' | 'DROP' | 'SWAP' | 'OPEN_CHEST' | 'WAIT';
  message: string;
  item?: string;
  cappedFallbackFrom?: TileType;
}

export class MovementSystem {
  public static lastCombatResult: CombatResult | null = null;
  public static lastSpaceActionResult: SpaceActionResult | null = null;
  public static lastWarped: boolean = false;
  public static lastHomeEvent: HomeEventResult | null = null;
  public static lastPushed: TileType | null = null;

  public static getNextPosition(current: Position, dir: Direction): Position {
    let dx = 0;
    let dy = 0;

    switch (dir) {
      case 'UP':
        dy = -1;
        break;
      case 'DOWN':
        dy = 1;
        break;
      case 'LEFT':
        dx = -1;
        break;
      case 'RIGHT':
        dx = 1;
        break;
      case 'UP_LEFT':
        dx = -1;
        dy = -1;
        break;
      case 'UP_RIGHT':
        dx = 1;
        dy = -1;
        break;
      case 'DOWN_LEFT':
        dx = -1;
        dy = 1;
        break;
      case 'DOWN_RIGHT':
        dx = 1;
        dy = 1;
        break;
    }

    return { x: current.x + dx, y: current.y + dy };
  }

  /**
   * 指定座標の反対（背後）マスを取得
   */
  public static getBehindPosition(current: Position, dir: Direction): Position {
    const next = this.getNextPosition(current, dir);
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    return { x: current.x - dx, y: current.y - dy };
  }

  /**
   * プレイヤーの移動試行（敵との体当たり戦闘、岩・家のプッシュ移動含む）
   * - 宝箱(CHEST)や床上アイテムの上には歩いて乗ることができる（触れただけで勝手に開いたり拾ったりしない）
   * - 指輪所持時は岩・家を押し出す。指輪なし時は家に入って全快回復する。
   */
  public static tryMove(
    player: Player,
    dir: Direction,
    map: WorldMap,
    enemies?: EnemyInstance[],
    dragon?: Dragon,
    mitigationRatio: number = 1.0,
    progressionConfig?: DungeonTuningParams['progressionConfig']
  ): boolean {
    this.lastCombatResult = null;
    this.lastSpaceActionResult = null;
    this.lastWarped = false;
    this.lastHomeEvent = null;
    this.lastPushed = null;

    // 向きは常に更新
    player.dir = dir;
    const prevPos = { ...player.pos };

    // FLY 中の無敵飛行: 外壁以外をすり抜ける
    if (player.isFlying) {
      const nextPos = map.wrapPosition(this.getNextPosition(player.pos, dir));
      if (map.getBaseTile(nextPos) === 'WALL_STATIC') {
        return false;
      }
      player.pos = nextPos;
      player.stepCountSinceStone++;

      if (player.hasDeath) {
        player.deathFollowerPos = { ...prevPos };
      }

      if (map.getBaseTile(player.pos) === 'WARP') {
        const warpDest = map.getWarpDestination(player.pos);
        if (warpDest) {
          player.pos = { ...warpDest };
          this.lastWarped = true;
        }
      }
      return true;
    }

    // 斜め移動の可否チェック (FLY中または斜め移動フラグON)
    const isDiagonal = dir.includes('_');
    if (isDiagonal && !player.canDiagonal && !player.isFlying) {
      return false;
    }

    const nextPos = map.wrapPosition(this.getNextPosition(player.pos, dir));

    // 0-A. ドラゴン部位への接触判定
    if (dragon) {
      const part = dragon.getPartAt(nextPos);
      if (part) {
        if (part.type === 'TAIL') {
          dragon.repulsePlayerByTail(player, map);
          player.stepCountSinceStone++;
          return true;
        }

        if (part.type === 'BODY') {
          return false;
        }

        if (part.type === 'LEFT_HEAD' || part.type === 'CENTER_HEAD' || part.type === 'RIGHT_HEAD') {
          if (player.holdItem === 'CROSS') {
            return false;
          }
          const combat = CombatSystem.resolvePlayerAttackDragon(player, dragon, part, dir, map, mitigationRatio);
          this.lastCombatResult = combat;
          player.stepCountSinceStone++;
          return true;
        }
      }
    }

    // 0-B. 敵マス進入時の体当たり戦闘判定（交互バトル調停: プレイヤー手番のみ攻撃）
    if (enemies && enemies.length > 0) {
      const enemy = enemies.find(e => {
        if (!e.isAlive) return false;
        const ep = map.wrapPosition(e.pos);
        return ep.x === nextPos.x && ep.y === nextPos.y;
      });
      if (enemy) {
        // 一般敵への斜めマスからの体当たり攻撃は禁止（一方的なハメ倒し防止）
        if (isDiagonal) {
          return false;
        }

        if (player.holdItem === 'CROSS') {
          return false; // 十字架所持時は攻撃不可
        }

        // 調停モード: immediateCounter = false (反撃は敵ターンで処理)
        const combat = CombatSystem.resolvePlayerAttack(player, enemy, false, mitigationRatio, progressionConfig, dragon);
        this.lastCombatResult = combat;

        if (combat.enemyKilled) {
          // 敵を撃破した場合はそのマスへ前進せずその場に留まる（破裂エフェクトとともに敵消滅）
          player.stepCountSinceStone++;
          CombatSystem.clearEngagedEnemy();
        } else {
          // 敵が生き残った場合は押し合いとなりその場に留まるがターンは消費し交戦状態に設定
          CombatSystem.engagedEnemy = enemy;
        }
        return true;
      }
    }

    // 1. 静的外壁は侵入不可
    if (map.getBaseTile(nextPos) === 'WALL_STATIC') {
      return false;
    }

    // 2. 墓（GRAVE）への進入不可
    const objTile = map.getObject(nextPos);
    if (map.getBaseTile(nextPos) === 'GRAVE' && objTile === 'NONE') {
      return false;
    }

    // 3. 可動ブロック(岩: BLOCK) の押し出し処理
    if (objTile === 'BLOCK') {
      if (player.holdItem === 'RING') {
        const pushPos = map.wrapPosition(this.getNextPosition(nextPos, dir));
        if (map.isPushDestinationValid(pushPos, enemies)) {
          map.moveTile(nextPos, pushPos);
          this.lastPushed = 'BLOCK';
          player.pos = nextPos;
          player.stepCountSinceStone++;
          if (player.hasDeath) {
            player.deathFollowerPos = { ...prevPos };
          }
          return true;
        }
      }
      return false; // 指輪がないか、押し出し先が塞がっている
    }

    // 4. 我が家(HOME) の処理: 入る（指輪なし） または 押し出し移動（指輪あり）
    if (map.getBaseTile(nextPos) === 'HOME') {
      if (player.holdItem === 'RING') {
        // 指輪所持時: 家を押して動かす（倉庫番）
        const pushPos = map.wrapPosition(this.getNextPosition(nextPos, dir));
        if (map.isPushDestinationValid(pushPos, enemies)) {
          map.moveTile(nextPos, pushPos);
          map.setRealHomePos(pushPos);
          this.lastPushed = 'HOME';
          player.pos = nextPos;
          player.stepCountSinceStone++;
          if (player.hasDeath) {
            player.deathFollowerPos = { ...prevPos };
          }
          return true;
        }
        return false; // 押し出し先が塞がっている
      } else {
        // 指輪なし時: 我が家の中に入って全快回復（死神も成仏）
        player.pos = nextPos;
        map.setRealHomePos(nextPos);
        player.stepCountSinceStone++;
        this.lastHomeEvent = player.healAtHome(progressionConfig);
        return true;
      }
    }

    // 5. 十字架マス通過または十字架所持時の死神成仏・消滅
    if ((map.getItem(nextPos) === 'CROSS' || player.holdItem === 'CROSS') && player.hasDeath) {
      player.hasDeath = false;
      player.deathFollowerPos = null;
    }

    // 6. 地面の死神（DEATH）への進入（取り憑かれる）
    if (map.getItem(nextPos) === 'DEATH') {
      if (!player.hasDeath) {
        player.hasDeath = true;
        player.deathFollowerPos = { ...prevPos };
      }
      map.setItem(nextPos, 'NONE');
    }

    // 7. 前進確定（宝箱やアイテムの上には歩いて乗る）
    player.pos = nextPos;
    player.stepCountSinceStone++;
    if (player.hasDeath && !player.deathFollowerPos) {
      player.deathFollowerPos = { ...prevPos };
    } else if (player.hasDeath) {
      player.deathFollowerPos = { ...prevPos };
    }

    // 8. ワープゾーン（WARP）の移動判定
    if (map.getBaseTile(player.pos) === 'WARP') {
      const warpDest = map.getWarpDestination(player.pos);
      if (warpDest) {
        player.pos = { ...warpDest };
        this.lastWarped = true;
      }
    }

    return true;
  }

  /**
   * SPACEキー押下時のアクション処理
   * - 宝箱の上に乗った状態で鍵を持ってSPACE -> 宝箱解錠
   * - 足元アイテムの取得・交換
   * - 手持ちアイテムの床への配置（ドロップ）
   * - 待機パス
   */
  public static executeSpaceAction(
    player: Player,
    map: WorldMap,
    context?: {
      ghosts?: Ghost[];
      resourceCapConfig?: DungeonTuningParams['resourceCapConfig'];
    }
  ): SpaceActionResult {
    const curPos = player.pos;

    // 1. 足元が宝箱（CHEST）の場合
    const obj = map.getObject(curPos);
    if (obj === 'CHEST') {
      if (player.holdItem === 'KEY') {
        const hadDeathBefore = player.hasDeath;
        const result = ChestSystem.openChest(player, curPos, map, context);
        // 宝箱オブジェクトを消去
        map.setObject(curPos, 'NONE');

        // 死神の場合の取り憑き判定
        if (result.item === 'DEATH') {
          if (!hadDeathBefore) {
            // 未憑依の場合: プレイヤーに取り憑き、床の死神は消滅（背後に追従出現）
            player.hasDeath = true;
            player.deathFollowerPos = map.wrapPosition(this.getBehindPosition(curPos, player.dir));
            map.setItem(curPos, 'NONE');
          } else {
            // 既に憑依中の場合: 死神はその場に残る
            map.setItem(curPos, 'DEATH');
          }
        } else {
          // 通常アイテムは足元の床上に出現
          map.setItem(curPos, result.item as TileType);
        }

        const res: SpaceActionResult = {
          action: 'OPEN_CHEST',
          message: `鍵を使って宝箱を開けた！ 中から [${result.item}] が現れた！`,
          item: result.item,
          cappedFallbackFrom: result.cappedFallbackFrom,
        };
        this.lastSpaceActionResult = res;
        return res;
      } else {
        const res: SpaceActionResult = {
          action: 'WAIT',
          message: '足元に宝箱があるが、鍵（KEY）を持っていないため開けられない',
        };
        this.lastSpaceActionResult = res;
        return res;
      }
    }

    // 2. 足元にアイテムがある場合
    const floorItem = map.getItem(curPos);
    if (floorItem !== 'NONE') {
      // 手持ちアイテム（道具）がある場合、床のアイテムは拾えない（取得ブロック）
      if (player.holdItem !== 'NONE') {
        const res: SpaceActionResult = {
          action: 'WAIT',
          message: `[${player.holdItem}] を持っているため拾えない。先に手持ちを置く必要がある`,
        };
        this.lastSpaceActionResult = res;
        return res;
      }

      // 手ぶら（holdItem === 'NONE'）時のみ取得可能
      if (floorItem === 'COIN') {
        player.gold += 1;
        map.setItem(curPos, 'NONE');
        const res: SpaceActionResult = { action: 'PICKUP', message: `金貨を拾った！ (所持金: ${player.gold})`, item: 'COIN' };
        this.lastSpaceActionResult = res;
        return res;
      }

      if (floorItem === 'POTION') {
        player.magic += 1;
        map.setItem(curPos, 'NONE');
        const res: SpaceActionResult = { action: 'PICKUP', message: `魔法の壺を拾った！ (MAGIC: ${player.magic})`, item: 'POTION' };
        this.lastSpaceActionResult = res;
        return res;
      }

      if (floorItem === 'SWORD') {
        player.hasSword = true;
        map.setItem(curPos, 'NONE');
        const res: SpaceActionResult = { action: 'PICKUP', message: '剣を装備した！ 攻撃力が真価を発揮する！', item: 'SWORD' };
        this.lastSpaceActionResult = res;
        return res;
      }

      // 携帯アイテム（POWER_STONE, CROSS, KEY, RING, CROWN）
      const isHoldable = ['POWER_STONE', 'CROSS', 'KEY', 'RING', 'CROWN'].includes(floorItem);
      if (isHoldable) {
        const newHold = floorItem as HoldItemType;
        player.holdItem = newHold;
        map.setItem(curPos, 'NONE');

        // 十字架を手に入れた瞬間に死神を成仏・消滅
        if (newHold === 'CROSS' && player.hasDeath) {
          player.hasDeath = false;
          player.deathFollowerPos = null;
        }

        const res: SpaceActionResult = {
          action: 'PICKUP',
          message: newHold === 'CROWN' ? `王冠を手に入れた！ 我が家へ持ち帰ろう！` : `[${newHold}] を手に入れた！`,
          item: newHold,
        };
        this.lastSpaceActionResult = res;
        return res;
      }
    }

    // 3. 足元にアイテムがない床の場合
    if (player.holdItem !== 'NONE') {
      // 我が家（HOME）の中ではアイテムを床に置けない（家の中に隠れるのを防止）
      if (map.getBaseTile(curPos) === 'HOME') {
        const res: SpaceActionResult = {
          action: 'WAIT',
          message: '我が家（HOME）の中ではアイテムを床に置けません',
        };
        this.lastSpaceActionResult = res;
        return res;
      }

      // 現在の手持ちアイテムを床に置く（ドロップ）
      const dropped = player.holdItem;
      player.holdItem = 'NONE';
      map.setItem(curPos, dropped as TileType);
      const res: SpaceActionResult = {
        action: 'DROP',
        message: `[${dropped}] を足元に置いた！`,
        item: dropped,
      };
      this.lastSpaceActionResult = res;
      return res;
    }

    // 4. 何も持っておらず足元にも何もない場合 -> 待機（パス）
    const res: SpaceActionResult = { action: 'WAIT', message: 'その場で待機した' };
    this.lastSpaceActionResult = res;
    return res;
  }
}
