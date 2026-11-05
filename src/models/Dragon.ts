import { Direction, DragonPartType, Fireball, Position } from './Types.js';
import { Player } from './Player.js';
import { WorldMap } from './WorldMap.js';
import { Ghost } from './Ghost.js';
import { GhostAISystem } from '../systems/GhostAISystem.js';

export interface DragonPart {
  type: DragonPartType;
  pos: Position;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  isAlive: boolean;
  facingDir: Direction;
}

export interface DragonSaveData {
  centerPos: Position;
  defeatedHeadsCount: number;
  crownsSpawned: boolean;
  body: DragonPart;
  heads: DragonPart[];
  tail: DragonPart;
  fireballs: Fireball[];
}

export class Dragon {
  public centerPos: Position;
  public body: DragonPart;
  public heads: DragonPart[]; // [LEFT_HEAD, CENTER_HEAD, RIGHT_HEAD]
  public tail: DragonPart;
  public fireballs: Fireball[];
  public defeatedHeadsCount: number;
  public crownsSpawned: boolean;

  constructor(centerPos: Position = { x: 32, y: 32 }, dragonDefRatio: number = 1.0) {
    this.centerPos = { ...centerPos };
    this.defeatedHeadsCount = 0;
    this.crownsSpawned = false;
    this.fireballs = [];

    // 胴体 (BODY: 戦闘不可・通過不可: HP 655,340, DEF 655,350)
    this.body = {
      type: 'BODY',
      pos: { x: centerPos.x, y: centerPos.y },
      hp: 655340,
      maxHp: 655340,
      atk: 0,
      def: 655350,
      isAlive: true,
      facingDir: 'DOWN',
    };

    // 3つの首 (標準パラメータ)
    // LEFT: HP 650,000 / ATK 600,000 / DEF 300,000 (* dragonDefRatio)
    // CENTER: HP 650,000 / ATK 500,000 / DEF 400,000 (* dragonDefRatio)
    // RIGHT: HP 650,000 / ATK 500,000 / DEF 380,000 (* dragonDefRatio)
    this.heads = [
      {
        type: 'LEFT_HEAD',
        pos: { x: centerPos.x - 1, y: centerPos.y },
        hp: Math.floor(650000 * dragonDefRatio),
        maxHp: Math.floor(650000 * dragonDefRatio),
        atk: Math.floor(600000 * dragonDefRatio),
        def: Math.floor(300000 * dragonDefRatio),
        isAlive: true,
        facingDir: 'LEFT',
      },
      {
        type: 'CENTER_HEAD',
        pos: { x: centerPos.x, y: centerPos.y - 1 },
        hp: Math.floor(650000 * dragonDefRatio),
        maxHp: Math.floor(650000 * dragonDefRatio),
        atk: Math.floor(500000 * dragonDefRatio),
        def: Math.floor(400000 * dragonDefRatio),
        isAlive: true,
        facingDir: 'UP',
      },
      {
        type: 'RIGHT_HEAD',
        pos: { x: centerPos.x + 1, y: centerPos.y },
        hp: Math.floor(650000 * dragonDefRatio),
        maxHp: Math.floor(650000 * dragonDefRatio),
        atk: Math.floor(500000 * dragonDefRatio),
        def: Math.floor(380000 * dragonDefRatio),
        isAlive: true,
        facingDir: 'RIGHT',
      },
    ];

    // 尻尾 (TAIL: 下側, 接触で初期地点へ弾き飛ばす)
    this.tail = {
      type: 'TAIL',
      pos: { x: centerPos.x, y: centerPos.y + 1 },
      hp: 655340,
      maxHp: 655340,
      atk: 0,
      def: 655350,
      isAlive: true,
      facingDir: 'DOWN',
    };
  }

  /**
   * 指定座標にある部位を取得（なければnull）
   */
  public getPartAt(pos: Position): DragonPart | null {
    if (this.body.pos.x === pos.x && this.body.pos.y === pos.y) {
      return this.body;
    }
    if (this.tail.pos.x === pos.x && this.tail.pos.y === pos.y) {
      return this.tail;
    }
    for (const head of this.heads) {
      if (head.isAlive && head.pos.x === pos.x && head.pos.y === pos.y) {
        return head;
      }
    }
    return null;
  }

  /**
   * 首への攻撃とダメージ処理
   * @returns 撃破されたかどうか
   */
  public damageHead(head: DragonPart, damage: number): boolean {
    if (!head.isAlive || head.type === 'BODY' || head.type === 'TAIL') {
      return false;
    }
    head.hp = Math.max(0, head.hp - damage);
    if (head.hp <= 0) {
      head.isAlive = false;
      this.defeatedHeadsCount++;
      return true;
    }
    return false;
  }

  /**
   * 全首討伐完了か
   */
  public get isAllHeadsDefeated(): boolean {
    return this.defeatedHeadsCount >= 3;
  }

  /**
   * 尻尾への接触判定
   */
  public checkTailContact(player: Player): boolean {
    return player.pos.x === this.tail.pos.x && player.pos.y === this.tail.pos.y;
  }

  /**
   * プレイヤーが尻尾マスに接触した際に初期地点付近へ弾き飛ばす
   */
  public repulsePlayerByTail(player: Player, map: WorldMap): Position {
    const dest = { ...map.initialHomePos };
    // 初期位置の隣が空いていればそこへ、塞がっていれば初期位置へ
    const candidate = map.wrapPosition({ x: dest.x + 1, y: dest.y });
    if (map.isPassable(candidate)) {
      player.pos = candidate;
    } else {
      player.pos = dest;
    }
    return player.pos;
  }

  /**
   * 首の正面直線への火炎弾発射チェック
   * プレイヤーが正面直線上におり、間に遮る壁がない場合に火炎弾を発射する
   */
  public updateFireballs(player: Player, map: WorldMap): void {
    // 既存火炎弾の進行・当たり判定
    for (const fb of this.fireballs) {
      if (!fb.isAlive) continue;

      // 移動
      let dx = 0;
      let dy = 0;
      if (fb.dir === 'UP') dy = -1;
      else if (fb.dir === 'DOWN') dy = 1;
      else if (fb.dir === 'LEFT') dx = -1;
      else if (fb.dir === 'RIGHT') dx = 1;

      fb.pos = map.wrapPosition({ x: fb.pos.x + dx, y: fb.pos.y + dy });

      // プレイヤーへの衝突
      if (fb.pos.x === player.pos.x && fb.pos.y === player.pos.y) {
        player.takeDamage(fb.damage, {
          cause: 'FIREBALL',
          damage: fb.damage,
        });
        fb.isAlive = false;
        continue;
      }

      // 壁に当たったら消滅
      if (map.getTile(fb.pos) === 'WALL_STATIC' || map.getTile(fb.pos) === 'BLOCK') {
        fb.isAlive = false;
      }
    }

    // 不要な火炎弾を除去
    this.fireballs = this.fireballs.filter(fb => fb.isAlive);

    // 各首からの火炎弾発射試行
    for (const head of this.heads) {
      if (!head.isAlive) continue;

      if (this.canHeadSeePlayer(head, player.pos, map)) {
        // 火炎弾発射
        this.fireballs.push({
          id: `fb_${Date.now()}_${Math.random()}`,
          pos: { ...head.pos },
          dir: head.facingDir,
          damage: Math.max(50, Math.floor(head.atk / 2)),
          isAlive: true,
        });
      }
    }
  }

  /**
   * 首が正面直線上にプレイヤーを視認できるか（視界最大12マス）
   */
  public canHeadSeePlayer(head: DragonPart, playerPos: Position, map: WorldMap): boolean {
    const maxRange = 12;
    if (head.facingDir === 'UP') {
      if (playerPos.x === head.pos.x && playerPos.y < head.pos.y && head.pos.y - playerPos.y <= maxRange) {
        return this.isLineClear(head.pos, playerPos, 0, -1, map);
      }
    } else if (head.facingDir === 'LEFT') {
      if (playerPos.y === head.pos.y && playerPos.x < head.pos.x && head.pos.x - playerPos.x <= maxRange) {
        return this.isLineClear(head.pos, playerPos, -1, 0, map);
      }
    } else if (head.facingDir === 'RIGHT') {
      if (playerPos.y === head.pos.y && playerPos.x > head.pos.x && playerPos.x - head.pos.x <= maxRange) {
        return this.isLineClear(head.pos, playerPos, 1, 0, map);
      }
    }
    return false;
  }

  /**
   * 指定した座標が生存している首の上下左右（4方向）に隣接しているか判定
   */
  public isHeadAdjacent(head: DragonPart, targetPos: Position, map?: WorldMap): boolean {
    if (!head.isAlive || head.type === 'BODY' || head.type === 'TAIL') {
      return false;
    }
    let dx = Math.abs(targetPos.x - head.pos.x);
    let dy = Math.abs(targetPos.y - head.pos.y);
    if (map) {
      if (dx > map.width / 2) dx = map.width - dx;
      if (dy > map.height / 2) dy = map.height - dy;
    }
    return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
  }

  /**
   * プレイヤー座標に上下左右4方向で隣接している攻撃実行首を取得
   * 複数の首に隣接している場合（宝箱マス等）は最もATKが高い首を優先
   */
  public getAdjacentAttackingHead(playerPos: Position, map?: WorldMap): DragonPart | null {
    let bestHead: DragonPart | null = null;
    for (const head of this.heads) {
      if (!head.isAlive) continue;
      if (this.isHeadAdjacent(head, playerPos, map)) {
        if (!bestHead || head.atk > bestHead.atk) {
          bestHead = head;
        }
      }
    }
    return bestHead;
  }

  private isLineClear(from: Position, to: Position, dx: number, dy: number, map: WorldMap): boolean {
    let curX = from.x + dx;
    let curY = from.y + dy;
    while (curX !== to.x || curY !== to.y) {
      const tile = map.getTile({ x: curX, y: curY });
      if (tile === 'WALL_STATIC' || tile === 'BLOCK') {
        return false;
      }
      curX += dx;
      curY += dy;
    }
    return true;
  }

  /**
   * 首討伐時の世界変化処理
   */
  public applyWorldChanges(
    map: WorldMap,
    ghosts?: Ghost[]
  ): {
    resetHome: boolean;
    allEnemiesFromHome: boolean;
    darkPalette: boolean;
    crownsSpawned: boolean;
  } {
    const result = {
      resetHome: false,
      allEnemiesFromHome: false,
      darkPalette: false,
      crownsSpawned: false,
    };

    if (this.defeatedHeadsCount === 1) {
      // 首1本討伐: 移動先の我が家は維持したまま、初期位置に我が家が復活配置される（家が2軒化）
      result.resetHome = true;
      map.respawnInitialHome();
    } else if (this.defeatedHeadsCount === 2) {
      // 首2本討伐: 全モンスターが家から湧き出す
      result.allEnemiesFromHome = true;
    } else if (this.defeatedHeadsCount >= 3) {
      // 首3本討伐（全首撃破）: パレットが黒色（DARK）に変化、王冠4個出現
      result.darkPalette = true;
      result.crownsSpawned = true;
      this.crownsSpawned = true;

      // ドラゴンの宝箱（CHEST_DRAGON: 頭としっぽのすぐ横）を開いて王冠を4個出現させる
      const crownPositions: Position[] = [
        { x: this.centerPos.x - 1, y: this.centerPos.y - 1 },
        { x: this.centerPos.x + 1, y: this.centerPos.y - 1 },
        { x: this.centerPos.x - 1, y: this.centerPos.y + 1 },
        { x: this.centerPos.x + 1, y: this.centerPos.y + 1 },
      ];

      for (const rawPos of crownPositions) {
        const pos = map.wrapPosition(rawPos);
        if (map.getObject(pos) === 'CHEST_DRAGON') {
          map.setObject(pos, 'NONE');
        }
        map.setTile(pos, 'CROWN');
      }

      // ゴーストによる王冠四方散乱シークエンス
      if (ghosts) {
        this.scatterCrownsWithGhosts(map, ghosts);
      }
    }

    return result;
  }

  /**
   * ドラゴン討伐時: ゴーストが王冠を掴み四方へ散開して飛び去るシークエンス
   */
  public scatterCrownsWithGhosts(map: WorldMap, ghosts: Ghost[]): void {
    const crownScatterConfigs = [
      { pos: { x: this.centerPos.x - 1, y: this.centerPos.y - 1 }, vx: -1, vy: -1 },
      { pos: { x: this.centerPos.x + 1, y: this.centerPos.y - 1 }, vx: 1, vy: -1 },
      { pos: { x: this.centerPos.x - 1, y: this.centerPos.y + 1 }, vx: -1, vy: 1 },
      { pos: { x: this.centerPos.x + 1, y: this.centerPos.y + 1 }, vx: 1, vy: 1 },
    ];

    for (const config of crownScatterConfigs) {
      const pos = map.wrapPosition(config.pos);
      // 宝箱を開放し、床の王冠をゴーストが掴む
      map.setObject(pos, 'NONE');
      map.setItem(pos, 'NONE');

      const ghost = new Ghost({
        pos: { ...pos },
        vx: config.vx,
        vy: config.vy,
      });
      ghost.carriedItem = 'CROWN';
      GhostAISystem.resetCarryGoal(ghost);
      ghosts.push(ghost);
    }
  }

  public serialize(): DragonSaveData {
    return {
      centerPos: { ...this.centerPos },
      defeatedHeadsCount: this.defeatedHeadsCount,
      crownsSpawned: this.crownsSpawned,
      body: { ...this.body, pos: { ...this.body.pos } },
      heads: this.heads.map(h => ({ ...h, pos: { ...h.pos } })),
      tail: { ...this.tail, pos: { ...this.tail.pos } },
      fireballs: this.fireballs.map(fb => ({
        ...fb,
        pos: { ...fb.pos },
        dir: fb.dir,
      })),
    };
  }

  public deserialize(data: DragonSaveData): void {
    this.centerPos = { ...data.centerPos };
    this.defeatedHeadsCount = data.defeatedHeadsCount;
    this.crownsSpawned = data.crownsSpawned ?? false;
    this.body = { ...data.body, pos: { ...data.body.pos } };
    this.heads = data.heads.map(h => ({ ...h, pos: { ...h.pos } }));
    this.tail = { ...data.tail, pos: { ...data.tail.pos } };
    this.fireballs = (data.fireballs ?? []).map(fb => ({
      ...fb,
      pos: { ...fb.pos },
      dir: fb.dir,
    }));
  }
}
