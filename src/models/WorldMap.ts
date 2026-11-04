import { WORLD_MAP_WIDTH, WORLD_MAP_HEIGHT } from '../config/Constants.js';
import { Position, TileType } from './Types.js';

export interface WorldMapSaveData {
  width: number;
  height: number;
  baseTiles: TileType[][];
  objectTiles: (TileType | 'NONE')[][];
  itemTiles: (TileType | 'NONE')[][];
  homePos: Position;
  initialHomePos: Position;
  spawnHomePos?: Position;
  dragonCenter?: Position;
  underHomeBaseTile: TileType;
  warpPairs?: [string, Position][];
}

export class WorldMap {
  public readonly width: number;
  public readonly height: number;
  
  // 多層レイヤー
  private baseTiles: TileType[][];                    // 地形下地 (EMPTY, WALL_STATIC, GRAVE, WARP, HOME)
  private objectTiles: (TileType | 'NONE')[][];       // 可動岩・宝箱 (NONE, BLOCK, CHEST, CHEST_DRAGON)
  private itemTiles: (TileType | 'NONE')[][];         // 床上アイテム (NONE, SWORD, COIN, POTION, POWER_STONE, CROSS, KEY, RING, DEATH, CROWN)

  public homePos: Position;
  public initialHomePos: Position;
  public spawnHomePos: Position;
  public dragonCenter: Position;
  private underHomeBaseTile: TileType = 'EMPTY';
  private warpPairs: Map<string, Position> = new Map();

  constructor(width: number = WORLD_MAP_WIDTH, height: number = WORLD_MAP_HEIGHT) {
    this.width = width;
    this.height = height;
    this.homePos = { x: 7, y: 7 };
    this.initialHomePos = { x: 7, y: 7 };
    this.spawnHomePos = { x: 7, y: 7 };
    this.dragonCenter = { x: 32, y: 32 };

    // レイヤー初期化
    this.baseTiles = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => 'EMPTY' as TileType)
    );
    this.objectTiles = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => 'NONE')
    );
    this.itemTiles = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => 'NONE')
    );

    this.buildInitialMap();
  }

  private buildInitialMap(): void {
    // 1. 外周壁のないトーラス・ループ構造化

    // 2. 我が家を初期位置に配置
    this.baseTiles[this.homePos.y][this.homePos.x] = 'HOME';

    // 3. スタート地点・導入チュートリアル (1〜15, 1〜15)
    this.buildStartArea();

    // 4. 64x64 静的テストベッド（開発・回帰テスト用）の各エリア
    if (this.width >= 64 && this.height >= 64) {
      this.buildDragonFortress();      // 中央ドラゴン要塞 (26〜38, 26〜38)
      this.buildNorthWestMaze();       // 北西 宝箱・鍵迷路 (16〜31, 1〜25)
      this.buildNorthEastCatacombs();  // 北東 墓地密集・危険回廊 (33〜62, 1〜25)
      this.buildSouthWestRoute();      // 南西 倉庫番・家押しルート (1〜30, 26〜62)
      this.buildSouthEastMines();      // 南東 パワーストーン鉱脈・深部パズル (33〜62, 26〜62)
      this.buildConnectingCorridors(); // エリア間連絡回廊
      this.setupWarpNetwork();         // ワープゾーンネットワークの配置
    }
  }

  // --- 地形配置安全ヘルパー（重複完全防止） ---

  private placeWall(x: number, y: number): void {
    if (this.isInside({ x, y })) {
      this.baseTiles[y][x] = 'WALL_STATIC';
      this.objectTiles[y][x] = 'NONE';
      this.itemTiles[y][x] = 'NONE';
    }
  }

  private placeWallH(x1: number, x2: number, y: number): void {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    for (let x = minX; x <= maxX; x++) {
      this.placeWall(x, y);
    }
  }

  private placeWallV(x: number, y1: number, y2: number): void {
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    for (let y = minY; y <= maxY; y++) {
      this.placeWall(x, y);
    }
  }

  private placeBlock(x: number, y: number): void {
    if (
      this.isInside({ x, y }) &&
      this.baseTiles[y][x] !== 'WALL_STATIC' &&
      this.baseTiles[y][x] !== 'HOME' &&
      this.itemTiles[y][x] === 'NONE'
    ) {
      this.objectTiles[y][x] = 'BLOCK';
    }
  }

  private placeChest(x: number, y: number): void {
    if (
      this.isInside({ x, y }) &&
      this.baseTiles[y][x] === 'EMPTY' &&
      this.objectTiles[y][x] === 'NONE' &&
      this.itemTiles[y][x] === 'NONE'
    ) {
      this.objectTiles[y][x] = 'CHEST';
    }
  }

  private placeGrave(x: number, y: number): void {
    if (this.isInside({ x, y }) && this.baseTiles[y][x] !== 'HOME') {
      this.baseTiles[y][x] = 'GRAVE';
    }
  }

  private placeItem(x: number, y: number, item: TileType): void {
    if (
      this.isInside({ x, y }) &&
      this.baseTiles[y][x] !== 'WALL_STATIC' &&
      this.baseTiles[y][x] !== 'HOME' &&
      this.objectTiles[y][x] === 'NONE'
    ) {
      this.itemTiles[y][x] = item;
    }
  }


  /**
   * 1. スタート地点・導入チュートリアル部屋 (1〜15, 1〜15)
   * 基本操作、岩押しによる墓封鎖、宝箱開錠を学ぶパズル構造
   */
  private buildStartArea(): void {
    // 部屋の外壁と出入口 (※ (15, 15) 周辺はテスト互換のため常に開ける)
    this.placeWallV(15, 1, 6);
    // (15, 7) は東側迷路への出入口
    this.placeWallV(15, 8, 13);
    // (15, 14), (15, 15) は東南連絡口

    this.placeWallH(1, 6, 15);
    // (7, 15), (8, 15) は南側家押しルートへの出入口
    this.placeWallH(9, 13, 15);
    // (14, 15), (15, 15) は開ける

    // 内部仕切り壁
    this.placeWallV(3, 3, 7);
    this.placeWallH(4, 5, 3);
    this.placeWallV(11, 2, 5);

    // 初期配置アイテム（※既存テストと完全互換）
    this.placeItem(9, 9, 'SWORD');
    this.placeItem(9, 6, 'RING');
    this.placeItem(10, 6, 'KEY');         // テスト5必須マス
    this.placeItem(7, 8, 'CROSS');
    this.placeItem(8, 6, 'POWER_STONE');
    this.placeItem(10, 7, 'COIN');
    this.placeItem(7, 10, 'COIN');
    this.placeItem(6, 6, 'POTION');

    // 宝箱
    this.placeChest(4, 8);
    this.placeChest(11, 11);
    this.placeChest(5, 12);

    // 墓
    this.placeGrave(4, 12);   // 南出口手前の墓
    this.placeGrave(13, 13);  // 東南通路の墓
    this.placeGrave(12, 3);   // 北東角の墓

    // 可動岩（既存互換ブロック）
    const initialBlocks: [number, number][] = [
      [5, 5], [5, 7],
      [7, 5], [9, 5],
      [9, 7], [11, 8],
      [12, 10], [13, 10], [14, 10],
      [8, 12], [9, 12], [10, 12]
    ];
    for (const [bx, by] of initialBlocks) {
      this.placeBlock(bx, by);
    }

    // 墓封鎖用パズル岩
    this.placeBlock(4, 10);   // (4, 12) を塞ぐための岩
    this.placeBlock(13, 11);  // (13, 13) を塞ぐための岩
  }

  /**
   * 2. 中央ドラゴン要塞 (26〜38, 26〜38)
   * 3首ドラゴン、直線火炎弾遮蔽壁、斜め攻略マス、王冠4マス確保
   */
  private buildDragonFortress(): void {
    // 要塞外壁（火炎弾テスト互換のため y=30 の x: 25〜29 は完全開放）
    // 北壁 y=26 (出入口: x=28, 36)
    this.placeWallH(26, 27, 26);
    this.placeWallH(29, 35, 26);
    this.placeWallH(37, 38, 26);

    // 南壁 y=38 (出入口: x=28, 36)
    this.placeWallH(26, 27, 38);
    this.placeWallH(29, 35, 38);
    this.placeWallH(37, 38, 38);

    // 西壁 x=26 (出入口: y=28〜30, 36)
    this.placeWallV(26, 26, 27);
    this.placeWallV(26, 31, 35);
    this.placeWallV(26, 37, 38);

    // 東壁 x=38 (出入口: y=28〜30, 36)
    this.placeWallV(38, 26, 27);
    this.placeWallV(38, 31, 35);
    this.placeWallV(38, 37, 38);

    // 火炎弾射線の正面遮蔽壁・可動岩
    // 中首 (32, 31: 上向き) 正面
    this.placeWall(32, 27);
    this.placeBlock(32, 28);

    // 左首 (31, 32: 左向き) 正面
    this.placeWall(27, 32);
    this.placeBlock(28, 32);

    // 右首 (33, 32: 右向き) 正面
    this.placeWall(37, 32);
    this.placeBlock(36, 32);

    // 尻尾 (32, 33: 下向き) 周辺のトラップ通路と迂回路
    this.placeBlock(31, 35);
    this.placeBlock(33, 35);

    // 要塞守護モンスターの墓と封鎖岩
    this.placeGrave(28, 29);
    this.placeBlock(28, 28);
    this.placeGrave(36, 29);
    this.placeBlock(36, 28);

    // ※重要: クラウン出現予定マス (31, 31), (33, 31), (31, 33), (33, 33) は床(EMPTY)を厳守
    // （ドラゴンの頭・しっぽのすぐ横）
  }

  /**
   * 3. 北西エリア（宝箱・鍵迷路: 16〜31, 1〜25）
   */
  private buildNorthWestMaze(): void {
    // 迷路の仕切り壁
    this.placeWallH(16, 24, 4);
    this.placeWallV(24, 4, 14);
    this.placeWallH(16, 24, 14);
    this.placeWallV(20, 5, 12);
    this.placeWallH(26, 31, 8);
    this.placeWallH(29, 31, 18); // x=27, 28 は開口部とし墓 (27, 18) を壁閉じ込めしない

    // 宝箱
    this.placeChest(18, 6);
    this.placeChest(21, 8);   // (22, 10) の墓と重複しないよう独立配置
    this.placeChest(29, 6);
    this.placeChest(27, 12);
    this.placeChest(19, 18);
    this.placeChest(23, 18);

    // 床置きアイテム
    this.placeItem(18, 8, 'COIN');
    this.placeItem(28, 5, 'POTION');
    this.placeItem(29, 14, 'COIN');
    this.placeItem(22, 22, 'POWER_STONE');

    // 墓と封鎖岩
    this.placeGrave(22, 10);
    this.placeBlock(22, 9);
    this.placeGrave(27, 18);
    this.placeBlock(27, 17);

    // 倉庫番パズル用岩
    this.placeBlock(19, 7);
    this.placeBlock(23, 11);
    this.placeBlock(28, 10);
    this.placeBlock(21, 16);

    // 北西の宝物だまり（小クラスター: 12個）
    for (let y = 20; y <= 23; y++) {
      for (let x = 17; x <= 20; x++) {
        if (x === 18 && y === 21) continue;
        this.placeChest(x, y);
      }
    }
  }

  /**
   * 4. 北東エリア（墓地密集・危険回廊: 33〜62, 1〜25）
   */
  private buildNorthEastCatacombs(): void {
    // 回廊の骨格壁（墓 (45, 15) 周辺に通路開口部を確保し壁閉じ込めを防止）
    this.placeWallV(39, 1, 14);
    this.placeWallH(39, 52, 8);
    this.placeWallV(52, 1, 18);
    this.placeWallH(41, 43, 15);
    this.placeWallH(47, 60, 15);
    this.placeWallV(45, 17, 25);

    // 密集する墓
    const gravePositions: [number, number][] = [
      [45, 15],  // 既存リスト
      [42, 5],
      [48, 5],
      [56, 6],
      [46, 12],
      [57, 12],
      [48, 20],
      [56, 20]
    ];
    for (const [gx, gy] of gravePositions) {
      this.placeGrave(gx, gy);
    }

    // 各墓を封鎖するための戦略配置岩
    const blockPositions: [number, number][] = [
      [45, 14],
      [42, 4],
      [48, 4],
      [56, 5],
      [46, 11],
      [57, 11],
      [48, 19],
      [56, 19]
    ];
    for (const [bx, by] of blockPositions) {
      this.placeBlock(bx, by);
    }

    // 報酬宝箱とアイテム
    this.placeChest(60, 4);
    this.placeChest(60, 8);
    this.placeChest(50, 10);
    this.placeChest(59, 15);
    this.placeItem(59, 3, 'POWER_STONE');
    this.placeItem(43, 6, 'COIN');
    this.placeItem(60, 14, 'POTION');
    this.placeItem(50, 22, 'COIN');

    // 北東奥地の宝物庫クラスター（16個）
    for (let y = 17; y <= 20; y++) {
      for (let x = 54; x <= 59; x++) {
        if ((x === 56 && y === 20) || (x === 56 && y === 19)) continue;
        this.placeChest(x, y);
      }
    }
  }

  /**
   * 5. 南西エリア（倉庫番・家押しルート: 1〜30, 26〜62）
   * 我が家（HOME）を指輪で押して前線基地として運ぶ専用ハイウェイ
   */
  private buildSouthWestRoute(): void {
    // 南下ハイウェイの側壁（幅2〜3マスの直進路と退避ポケット）
    this.placeWallV(5, 16, 42);
    this.placeWallV(11, 16, 42);

    // 東進ハイウェイ（要塞南側へ至る回廊）
    this.placeWallH(5, 25, 43);
    this.placeWallH(5, 25, 47);

    // ハイウェイ上の退避パズル岩（ポケットに退避させて家を通す）
    this.placeBlock(8, 24);
    this.placeBlock(8, 34);
    this.placeBlock(18, 45);

    // 沿道の墓と封鎖岩
    this.placeGrave(10, 22);  // 既存リスト
    this.placeBlock(10, 21);
    this.placeGrave(20, 48);  // 既存リスト
    this.placeBlock(20, 49);
    this.placeGrave(6, 28);
    this.placeBlock(6, 27);
    this.placeGrave(8, 40);
    this.placeBlock(8, 39);

    // 宝箱とアイテム
    this.placeChest(4, 26);
    this.placeChest(4, 38);
    this.placeChest(13, 30);
    this.placeChest(13, 40);
    this.placeItem(4, 28, 'POTION');
    this.placeItem(13, 32, 'COIN');

    // 最南西の離れ小部屋・宝物地帯（x: 2〜12, y: 50〜60）
    this.placeItem(7, 55, 'POWER_STONE');
    this.placeChest(5, 57);
    this.placeChest(9, 57);
    this.placeItem(7, 58, 'COIN');
    for (let y = 51; y <= 54; y++) {
      for (let x = 3; x <= 10; x++) {
        if (x % 2 === 1) {
          this.placeChest(x, y); // 16個の宝物列
        }
      }
    }
  }

  /**
   * 6. 南東エリア（パワーストーン鉱脈・深部パズル: 33〜62, 26〜62）
   */
  private buildSouthEastMines(): void {
    // 鉱脈大広間の外壁
    this.placeWallH(36, 43, 34);
    this.placeWallH(47, 60, 34);
    this.placeWallV(36, 34, 40);
    this.placeWallV(36, 44, 52);
    this.placeWallH(36, 43, 52);
    this.placeWallH(47, 60, 52);
    this.placeWallV(60, 34, 40);
    this.placeWallV(60, 44, 52);

    // 内部の柱（倉庫番パズル用支柱）
    this.placeWall(42, 40);
    this.placeWall(42, 46);
    this.placeWall(48, 40);
    this.placeWall(48, 46);
    this.placeWall(54, 40);
    this.placeWall(54, 46);

    // 墓と封鎖岩
    this.placeGrave(35, 35);  // ドラゴン手前
    this.placeBlock(35, 34);
    this.placeGrave(50, 50);  // 南東深部
    this.placeBlock(50, 51);
    this.placeGrave(44, 42);
    this.placeBlock(44, 41);
    this.placeGrave(52, 42);
    this.placeBlock(52, 41);
    this.placeGrave(45, 56);
    this.placeBlock(45, 55);
    this.placeGrave(55, 56);
    this.placeBlock(55, 55);

    // 床置きアイテム（先に配置して宝箱との重複を防止）
    this.placeItem(48, 43, 'POWER_STONE');
    this.placeItem(45, 45, 'POTION');
    this.placeItem(51, 45, 'COIN');
    this.placeItem(48, 56, 'POWER_STONE');

    // パワーストーン鉱脈・大宝物地帯（密集クラスター群）
    this.placeChest(44, 38);
    this.placeChest(46, 38);
    this.placeChest(50, 38);
    this.placeChest(52, 38);
    this.placeChest(44, 48);
    this.placeChest(46, 48);
    this.placeChest(50, 48);
    this.placeChest(52, 48);
    this.placeChest(58, 55);

    // 鉱脈大広間の南北宝物列（計30個以上）
    for (let x = 38; x <= 58; x++) {
      if (x % 2 === 0) {
        this.placeChest(x, 36);
        this.placeChest(x, 38);
        this.placeChest(x, 48);
        this.placeChest(x, 50);
      }
    }
    // 南東最深部の宝物庫（x: 38〜56, y: 58〜60）
    for (let y = 58; y <= 60; y += 2) {
      for (let x = 38; x <= 56; x += 2) {
        this.placeChest(x, y);
      }
    }
  }

  /**
   * 7. エリア間連絡回廊
   */
  private buildConnectingCorridors(): void {
    // 北部連絡回廊（北西と北東を繋ぐ: y=2〜3）
    this.placeWallH(28, 35, 1);
    // (28〜35, 2〜3) は安全な通路床

    // 東部連絡回廊（北東と南東を繋ぐ: x=61〜62）
    // (61, 20〜30) は安全な通路床

    // 南部連絡ハイウェイ（南西と南東を繋ぐ: y=55〜56）
    // (26〜35, 55〜56) は安全な通路床

    // 中央要塞への4方連絡通路
    // 北口: (28, 25), (36, 25)
    // 南口: (28, 39), (36, 39)
    // 西口: (25, 28), (25, 36)
    // 東口: (39, 28), (39, 36)
  }

  /**
   * 8. ワープネットワークの配置
   */
  private setupWarpNetwork(): void {
    // 既存テスト完全互換ペア
    this.addWarpPair({ x: 16, y: 16 }, { x: 48, y: 48 });
    this.addWarpPair({ x: 16, y: 48 }, { x: 48, y: 16 });

    // 要塞秘密侵入ルート
    this.addWarpPair({ x: 58, y: 58 }, { x: 27, y: 27 });
  }

  /**
   * 登録済みワープゾーンペアを全消去（プロシージャルマップ再構築用）
   */
  public clearWarpPairs(): void {
    this.warpPairs.clear();
  }

  /**
   * 任意の座標をトーラスマップ範囲内 [0, width-1] × [0, height-1] に正規化（Wrap）
   */
  public wrapPosition(pos: Position | number, optY?: number): Position {
    let x: number;
    let y: number;
    if (typeof pos === 'number') {
      x = pos;
      y = optY ?? 0;
    } else {
      x = pos?.x ?? 0;
      y = pos?.y ?? 0;
    }
    const wrappedX = ((x % this.width) + this.width) % this.width;
    const wrappedY = ((y % this.height) + this.height) % this.height;
    return { x: wrappedX, y: wrappedY };
  }

  /**
   * トーラス上の2点間の最短方向差分ベクトル (from -> to)
   */
  public getTorusDelta(from: Position, to: Position): { dx: number; dy: number } {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    const halfW = this.width / 2;
    const halfH = this.height / 2;
    if (dx > halfW) dx -= this.width;
    else if (dx < -halfW) dx += this.width;
    if (dy > halfH) dy -= this.height;
    else if (dy < -halfH) dy += this.height;
    return { dx, dy };
  }

  /**
   * トーラス上の2点間の最短距離（チェビシェフ距離・マンハッタン距離）
   */
  public getTorusDistance(a: Position, b: Position): { chebyshev: number; manhattan: number } {
    const { dx, dy } = this.getTorusDelta(a, b);
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    return {
      chebyshev: Math.max(absX, absY),
      manhattan: absX + absY,
    };
  }

  /**
   * ワープゾーンのペアを登録
   */
  public addWarpPair(posA: Position, posB: Position): void {
    if (!this.isInside(posA) || !this.isInside(posB)) return;
    const pA = this.wrapPosition(posA);
    const pB = this.wrapPosition(posB);
    this.baseTiles[pA.y][pA.x] = 'WARP';
    this.objectTiles[pA.y][pA.x] = 'NONE';
    this.baseTiles[pB.y][pB.x] = 'WARP';
    this.objectTiles[pB.y][pB.x] = 'NONE';
    const keyA = `${pA.x},${pA.y}`;
    const keyB = `${pB.x},${pB.y}`;
    this.warpPairs.set(keyA, { ...pB });
    this.warpPairs.set(keyB, { ...pA });
  }

  /**
   * 指定座標のワープゾーンの対向移動先座標を取得
   */
  public getWarpDestination(pos: Position): Position | null {
    const p = this.wrapPosition(pos);
    const key = `${p.x},${p.y}`;
    const dest = this.warpPairs.get(key);
    return dest ? { ...dest } : null;
  }

  public isInside(pos: Position | number, optY?: number): boolean {
    const x = typeof pos === 'number' ? pos : pos.x;
    const y = typeof pos === 'number' ? (optY ?? 0) : pos.y;
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /**
   * 表面に見える最上位タイルを取得（後方互換用）
   */
  public getTile(pos: Position | number, optY?: number): TileType {
    const p = this.wrapPosition(pos, optY);
    
    // 1. オブジェクト（岩・宝箱）
    const obj = this.objectTiles[p.y][p.x];
    if (obj !== 'NONE') return obj;

    // 2. 床上アイテム
    const item = this.itemTiles[p.y][p.x];
    if (item !== 'NONE') return item;

    // 3. 地形下地
    return this.baseTiles[p.y][p.x];
  }

  public getBaseTile(pos: Position | number, optY?: number): TileType {
    const p = this.wrapPosition(pos, optY);
    return this.baseTiles[p.y][p.x];
  }

  public getItem(pos: Position | number, optY?: number): TileType | 'NONE' {
    const p = this.wrapPosition(pos, optY);
    return this.itemTiles[p.y][p.x];
  }

  public setItem(pos: Position | number, itemOrOptY: TileType | 'NONE' | number, optItem?: TileType | 'NONE'): void {
    if (typeof pos === 'number') {
      const p = this.wrapPosition(pos, itemOrOptY as number);
      this.itemTiles[p.y][p.x] = optItem ?? 'NONE';
    } else {
      const p = this.wrapPosition(pos);
      this.itemTiles[p.y][p.x] = itemOrOptY as TileType | 'NONE';
    }
  }

  public getObject(pos: Position | number, optY?: number): TileType | 'NONE' {
    const p = this.wrapPosition(pos, optY);
    return this.objectTiles[p.y][p.x];
  }

  public setObject(pos: Position | number, objOrOptY: TileType | 'NONE' | number, optObj?: TileType | 'NONE'): void {
    if (typeof pos === 'number') {
      const p = this.wrapPosition(pos, objOrOptY as number);
      this.objectTiles[p.y][p.x] = optObj ?? 'NONE';
    } else {
      const p = this.wrapPosition(pos);
      this.objectTiles[p.y][p.x] = objOrOptY as TileType | 'NONE';
    }
  }

  public setTile(pos: Position | number, tileOrOptY: TileType | number, optTile?: TileType): void {
    let p: Position;
    let tile: TileType;
    if (typeof pos === 'number') {
      p = this.wrapPosition(pos, tileOrOptY as number);
      tile = optTile as TileType;
    } else {
      p = this.wrapPosition(pos);
      tile = tileOrOptY as TileType;
    }

    if (tile === 'BLOCK' || tile === 'CHEST' || tile === 'CHEST_DRAGON') {
      this.objectTiles[p.y][p.x] = tile;
    } else if (tile === 'EMPTY') {
      if (this.objectTiles[p.y][p.x] !== 'NONE') {
        this.objectTiles[p.y][p.x] = 'NONE';
      } else {
        this.itemTiles[p.y][p.x] = 'NONE';
      }
    } else if (
      tile === 'SWORD' ||
      tile === 'COIN' ||
      tile === 'POTION' ||
      tile === 'POWER_STONE' ||
      tile === 'CROSS' ||
      tile === 'KEY' ||
      tile === 'RING' ||
      tile === 'DEATH' ||
      tile === 'CROWN'
    ) {
      this.itemTiles[p.y][p.x] = tile;
      this.objectTiles[p.y][p.x] = 'NONE';
    } else {
      this.baseTiles[p.y][p.x] = tile;
      this.objectTiles[p.y][p.x] = 'NONE';
      this.itemTiles[p.y][p.x] = 'NONE';
    }
  }

  public setBaseTile(pos: Position, tile: TileType): void {
    const p = this.wrapPosition(pos);
    this.baseTiles[p.y][p.x] = tile;
  }

  /**
   * プレイヤーが進入可能か（壁や岩は直接進入不可。宝箱やアイテム、家には乗れる/入れる）
   */
  public isPassable(pos: Position): boolean {
    const p = this.wrapPosition(pos);

    // 外壁は進入不可
    if (this.baseTiles[p.y][p.x] === 'WALL_STATIC') return false;

    // 岩（BLOCK）は直接進入不可（指輪で押す）
    const obj = this.objectTiles[p.y][p.x];
    if (obj === 'BLOCK') return false;

    // 墓に直接入ることはできない（塞ぐか敵が湧く）
    if (this.baseTiles[p.y][p.x] === 'GRAVE') return false;

    // 宝箱（CHEST, CHEST_DRAGON）は床オブジェクトのため上に乗れる
    return true;
  }

  /**
   * ブロックや家を押し出せるマスか（外壁・岩・宝箱・家・墓がなく、アイテムと重複しない通過可能床）
   * 生存敵がいるマスにも押し出し不可（壁埋まり・壁抜け防止）
   * 墓（GRAVE）は固定障害物のため、上に岩や家を押し込むことはできない
   */
  public isPushDestinationValid(pos: Position, enemies?: { isAlive: boolean; pos: Position }[]): boolean {
    const p = this.wrapPosition(pos);
    if (this.baseTiles[p.y][p.x] === 'WALL_STATIC') return false;
    if (this.baseTiles[p.y][p.x] === 'HOME') return false;
    if (this.baseTiles[p.y][p.x] === 'GRAVE') return false;
    if (this.objectTiles[p.y][p.x] !== 'NONE') return false;
    // アイテム（KEY, SWORD等）のあるマスにはブロックを重ねられない（重複不可）
    if (this.itemTiles[p.y][p.x] !== 'NONE') return false;
    // 生存している敵がいるマスには重ねられない
    if (enemies && enemies.some(e => {
      if (!e.isAlive) return false;
      const ep = this.wrapPosition(e.pos);
      return ep.x === p.x && ep.y === p.y;
    })) return false;
    return true;
  }

  /**
   * オブジェクト（岩や家）を移動
   * 家（HOME）の移動時は、通過したワープゾーンや墓などの下地タイルを元通り復元する
   */
  public moveTile(from: Position, to: Position): boolean {
    const f = this.wrapPosition(from);
    const t = this.wrapPosition(to);

    // 家の移動
    if (this.baseTiles[f.y][f.x] === 'HOME') {
      this.baseTiles[f.y][f.x] = this.underHomeBaseTile;
      this.underHomeBaseTile = this.baseTiles[t.y][t.x];
      this.baseTiles[t.y][t.x] = 'HOME';
      if (f.x === this.homePos.x && f.y === this.homePos.y) {
        this.homePos = { ...t };
      }
      if (this.spawnHomePos && f.x === this.spawnHomePos.x && f.y === this.spawnHomePos.y) {
        this.spawnHomePos = { ...t };
      }
      return true;
    }

    // 岩（BLOCK）の移動
    const movingObj = this.objectTiles[f.y][f.x];
    if (movingObj !== 'NONE') {
      this.objectTiles[f.y][f.x] = 'NONE';
      this.objectTiles[t.y][t.x] = movingObj;
      return true;
    }

    return false;
  }

  /**
   * 墓（GRAVE）の上にブロック等の障害物が乗って塞がれているか判定
   */
  public isGraveBlocked(pos: Position): boolean {
    const p = this.wrapPosition(pos);
    return this.baseTiles[p.y][p.x] === 'GRAVE' && this.objectTiles[p.y][p.x] === 'BLOCK';
  }

  /**
   * 一般モンスターおよびゴーストが進入可能か
   * 十字架（CROSS）の上には進入不可（結界）
   */
  public isPassableByEnemy(pos: Position): boolean {
    const p = this.wrapPosition(pos);

    // 外壁・家・岩・宝箱は進入不可
    if (this.baseTiles[p.y][p.x] === 'WALL_STATIC') return false;
    if (this.baseTiles[p.y][p.x] === 'HOME') return false;
    if (this.objectTiles[p.y][p.x] !== 'NONE') return false;

    // 床に十字架（CROSS）があるマスには進入不可
    if (this.itemTiles[p.y][p.x] === 'CROSS') return false;

    return true;
  }

  /**
   * 本物の我が家の座標を取得
   */
  public get realHomePos(): Position {
    return this.homePos;
  }

  /**
   * 本物の我が家の座標を設定（複数ある場合、最後に押した家）
   */
  public setRealHomePos(pos: Position): void {
    this.homePos = { ...pos };
  }

  /**
   * ドラゴン首討伐時等に初期位置へ我が家（HOME）を復活配置
   * 移動させた家は維持し、初期位置を敵の湧き場（spawnHomePos）として再興する
   */
  public respawnInitialHome(): void {
    const p = this.wrapPosition(this.initialHomePos);
    this.spawnHomePos = { ...p };

    // 既にそのマスが HOME の場合は何もしない
    if (this.baseTiles[p.y][p.x] === 'HOME') {
      return;
    }

    // 初期位置に岩（BLOCK）や宝箱などのオブジェクトがある場合、隣接空きマスへ退避
    const obj = this.objectTiles[p.y][p.x];
    if (obj !== 'NONE') {
      const neighbors: Position[] = [
        { x: p.x + 1, y: p.y },
        { x: p.x - 1, y: p.y },
        { x: p.x, y: p.y + 1 },
        { x: p.x, y: p.y - 1 },
      ];
      for (const n of neighbors) {
        const np = this.wrapPosition(n);
        if (this.isPushDestinationValid(np)) {
          this.objectTiles[np.y][np.x] = obj;
          break;
        }
      }
      this.objectTiles[p.y][p.x] = 'NONE';
    }

    // 初期位置に床上アイテムがある場合も退避
    const item = this.itemTiles[p.y][p.x];
    if (item !== 'NONE') {
      const neighbors: Position[] = [
        { x: p.x + 1, y: p.y },
        { x: p.x - 1, y: p.y },
        { x: p.x, y: p.y + 1 },
        { x: p.x, y: p.y - 1 },
      ];
      for (const n of neighbors) {
        const np = this.wrapPosition(n);
        if (
          this.baseTiles[np.y][np.x] === 'EMPTY' &&
          this.objectTiles[np.y][np.x] === 'NONE' &&
          this.itemTiles[np.y][np.x] === 'NONE'
        ) {
          this.itemTiles[np.y][np.x] = item;
          break;
        }
      }
      this.itemTiles[p.y][p.x] = 'NONE';
    }

    // 下地を HOME に設定
    this.baseTiles[p.y][p.x] = 'HOME';
  }

  public setInitialHomePos(pos: Position): void {
    this.initialHomePos = { ...pos };
    this.homePos = { ...pos };
    this.spawnHomePos = { ...pos };
  }

  public setDragonCenter(pos: Position): void {
    this.dragonCenter = { ...pos };
  }

  public serialize(): WorldMapSaveData {
    return {
      width: this.width,
      height: this.height,
      baseTiles: this.baseTiles.map(row => [...row]),
      objectTiles: this.objectTiles.map(row => [...row]),
      itemTiles: this.itemTiles.map(row => [...row]),
      homePos: { ...this.homePos },
      initialHomePos: { ...this.initialHomePos },
      spawnHomePos: { ...this.spawnHomePos },
      dragonCenter: { ...this.dragonCenter },
      underHomeBaseTile: this.underHomeBaseTile,
      warpPairs: Array.from(this.warpPairs.entries()).map(([k, v]) => [k, { ...v }]),
    };
  }

  public deserialize(data: WorldMapSaveData): void {
    this.homePos = { ...data.homePos };
    this.initialHomePos = { ...data.initialHomePos };
    this.spawnHomePos = data.spawnHomePos ? { ...data.spawnHomePos } : { ...this.initialHomePos };
    this.dragonCenter = data.dragonCenter ? { ...data.dragonCenter } : { x: 32, y: 32 };
    this.underHomeBaseTile = data.underHomeBaseTile ?? 'EMPTY';
    this.baseTiles = data.baseTiles.map(row => [...row]);
    this.objectTiles = data.objectTiles.map(row => [...row]);
    this.itemTiles = data.itemTiles.map(row => [...row]);
    if (data.warpPairs && data.warpPairs.length > 0) {
      this.warpPairs = new Map(data.warpPairs.map(([k, v]) => [k, { ...v }]));
    } else {
      this.setupWarpNetwork();
    }
  }
}
