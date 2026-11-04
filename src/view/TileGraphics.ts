import { PALETTE, TILE_SIZE } from '../config/Constants.js';
import { Direction, Fireball, HoldItemType, PaletteMode, TileType } from '../models/Types.js';
import { PaletteManager } from './PaletteManager.js';
import { EnemyInstance } from '../models/Enemy.js';
import { Ghost } from '../models/Ghost.js';
import { DragonPart } from '../models/Dragon.js';
import { MonsterGraphics } from './MonsterGraphics.js';

export class TileGraphics {
  public static readonly TILE_TYPES: readonly TileType[] = [
    'EMPTY',
    'WALL_STATIC',
    'BLOCK',
    'HOME',
    'GRAVE',
    'CHEST',
    'CHEST_DRAGON',
    'WARP',
    'SWORD',
    'COIN',
    'POTION',
    'POWER_STONE',
    'CROSS',
    'KEY',
    'RING',
    'DEATH',
    'CROWN',
  ] as const;

  public static readonly PALETTE_MODES: readonly PaletteMode[] = ['NORMAL', 'PINCH', 'DARK'] as const;
  public static readonly ROW_NORMAL = 0;
  public static readonly ROW_PINCH = 1;
  public static readonly ROW_DARK = 2;

  private static readonly TILE_INDEX_MAP: Record<TileType, number> = {
    EMPTY: 0,
    WALL_STATIC: 1,
    BLOCK: 2,
    HOME: 3,
    GRAVE: 4,
    CHEST: 5,
    CHEST_DRAGON: 6,
    WARP: 7,
    SWORD: 8,
    COIN: 9,
    POTION: 10,
    POWER_STONE: 11,
    CROSS: 12,
    KEY: 13,
    RING: 14,
    DEATH: 15,
    CROWN: 16,
  };

  private static readonly PALETTE_ROW_MAP: Record<PaletteMode, number> = {
    NORMAL: 0,
    PINCH: 1,
    DARK: 2,
  };

  private static spriteSheet: HTMLCanvasElement | null = null;

  /**
   * オフスクリーンスプライトシート（544x96: 17種 × 3パレット段）を生成・取得
   */
  public static getOrCreateSpriteSheet(
    canvasFactory?: (width: number, height: number) => HTMLCanvasElement | null
  ): HTMLCanvasElement | null {
    if (this.spriteSheet && !canvasFactory) {
      return this.spriteSheet;
    }

    const sheetWidth = this.TILE_TYPES.length * TILE_SIZE; // 17 * 32 = 544px
    const sheetHeight = this.PALETTE_MODES.length * TILE_SIZE; // 3 * 32 = 96px

    let canvas: HTMLCanvasElement | null = null;
    if (canvasFactory) {
      canvas = canvasFactory(sheetWidth, sheetHeight);
    } else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const el = document.createElement('canvas');
      el.width = sheetWidth;
      el.height = sheetHeight;
      canvas = el;
    }

    if (!canvas || typeof canvas.getContext !== 'function') {
      return null;
    }

    const sheetCtx = canvas.getContext('2d');
    if (!sheetCtx) {
      return null;
    }

    sheetCtx.imageSmoothingEnabled = false;
    if (typeof sheetCtx.clearRect === 'function') {
      sheetCtx.clearRect(0, 0, sheetWidth, sheetHeight);
    }

    const palette = new PaletteManager();
    for (let row = 0; row < this.PALETTE_MODES.length; row++) {
      const mode = this.PALETTE_MODES[row];
      palette.setMode(mode);
      const sy = row * TILE_SIZE;

      for (let col = 0; col < this.TILE_TYPES.length; col++) {
        const type = this.TILE_TYPES[col];
        const sx = col * TILE_SIZE;
        this.renderTileProcedural(sheetCtx, type, sx, sy, palette);
      }
    }

    if (!canvasFactory) {
      this.spriteSheet = canvas;
    }
    return canvas;
  }

  /**
   * キャッシュ済みスプライトシートを破棄（テスト用または再生成用）
   */
  public static invalidateSpriteSheet(): void {
    this.spriteSheet = null;
  }

  /**
   * 32x32 高精細ピクセルアート タイル描画ルーチン
   * スプライトシートが利用可能な場合は高速な ctx.drawImage (Blit) で切り出し描画し、
   * 軽量モックCanvas等の未対応環境ではプロシージャル描画に自動フォールバックします。
   */
  public static drawTile(
    ctx: CanvasRenderingContext2D,
    type: TileType,
    screenX: number,
    screenY: number,
    palette: PaletteManager
  ): void {
    if (typeof ctx.drawImage === 'function') {
      const sheet = this.getOrCreateSpriteSheet();
      if (sheet) {
        const colIndex = this.TILE_INDEX_MAP[type];
        const mode = palette.getMode();
        const rowIndex = this.PALETTE_ROW_MAP[mode] ?? 0;
        if (colIndex !== undefined) {
          ctx.drawImage(
            sheet,
            colIndex * TILE_SIZE,
            rowIndex * TILE_SIZE,
            TILE_SIZE,
            TILE_SIZE,
            screenX,
            screenY,
            TILE_SIZE,
            TILE_SIZE
          );
          return;
        }
      }
    }

    this.renderTileProcedural(ctx, type, screenX, screenY, palette);
  }

  /**
   * タイルのプロシージャル描画（スプライトシート焼き付け元およびフォールバック用）
   */
  public static renderTileProcedural(
    ctx: CanvasRenderingContext2D,
    type: TileType,
    screenX: number,
    screenY: number,
    palette: PaletteManager
  ): void {
    const sz = TILE_SIZE; // 32

    // 床の下地
    ctx.fillStyle = palette.fieldBackgroundColor;
    ctx.fillRect(screenX, screenY, sz, sz);

    switch (type) {
      case 'EMPTY': {
        // 石畳フロア（目立たない上品なグリッドとドットテクスチャ）
        ctx.fillStyle = palette.wallInnerColor;
        // 四隅の目地
        ctx.fillRect(screenX, screenY, 1, 1);
        ctx.fillRect(screenX + sz - 1, screenY, 1, 1);
        // 中央の微細な石のテクスチャ
        ctx.fillRect(screenX + 10, screenY + 12, 2, 2);
        ctx.fillRect(screenX + 22, screenY + 20, 2, 2);
        break;
      }

      case 'WALL_STATIC': {
        // 固定外壁: 重厚な二重石積みブロック（立体的なハイライト＆シャドウ）
        // ベース枠
        ctx.fillStyle = palette.wallColor;
        ctx.fillRect(screenX, screenY, sz, sz);

        // 内側シャドウ
        ctx.fillStyle = '#05070a';
        ctx.fillRect(screenX + 3, screenY + 3, sz - 6, sz - 6);

        // 石ブロックの表面
        ctx.fillStyle = palette.wallColor;
        ctx.fillRect(screenX + 6, screenY + 6, sz - 12, sz - 12);

        // 上部・左のハイライト（控えめな石材ハイライト）
        ctx.fillStyle = '#4a8e5e';
        ctx.fillRect(screenX + 2, screenY + 2, sz - 4, 2);
        ctx.fillRect(screenX + 2, screenY + 2, 2, sz - 4);

        // 中央の紋様
        ctx.fillStyle = palette.wallInnerColor;
        ctx.fillRect(screenX + 11, screenY + 11, sz - 22, sz - 22);
        break;
      }

      case 'BLOCK': {
        // 可動ブロック（岩）: クロスレリーフの入った立体ブロック
        ctx.fillStyle = palette.wallColor;
        ctx.fillRect(screenX + 2, screenY + 2, sz - 4, sz - 4);

        // 外周ハイライト（控えめな石材ハイライト）
        ctx.fillStyle = '#4a8e5e';
        ctx.fillRect(screenX + 2, screenY + 2, sz - 4, 2);
        ctx.fillRect(screenX + 2, screenY + 2, 2, sz - 4);

        // 外周シャドウ
        ctx.fillStyle = '#000000';
        ctx.fillRect(screenX + 2, screenY + sz - 4, sz - 4, 2);
        ctx.fillRect(screenX + sz - 4, screenY + 2, 2, sz - 4);

        // 内側
        ctx.fillStyle = palette.wallInnerColor;
        ctx.fillRect(screenX + 5, screenY + 5, sz - 10, sz - 10);

        // クロス装飾
        ctx.fillStyle = palette.wallColor;
        ctx.fillRect(screenX + 14, screenY + 5, 4, sz - 10);
        ctx.fillRect(screenX + 5, screenY + 14, sz - 10, 4);

        // 中央の突起
        ctx.fillStyle = '#4a8e5e';
        ctx.fillRect(screenX + 13, screenY + 13, 6, 6);
        ctx.fillStyle = '#000000';
        ctx.fillRect(screenX + 15, screenY + 15, 2, 2);
        break;
      }

      case 'HOME': {
        // 我が家: 赤い屋根瓦 + 煙突 + 窓 + レンガ壁 + 木製ドア
        // 煙突 (右奥)
        ctx.fillStyle = '#555555';
        ctx.fillRect(screenX + 22, screenY + 3, 5, 8);
        ctx.fillStyle = '#888888';
        ctx.fillRect(screenX + 21, screenY + 2, 7, 2);

        // 赤い大屋根（三角）
        ctx.fillStyle = PALETTE.RED;
        for (let row = 0; row < 12; row++) {
          const w = 4 + row * 2;
          const left = 16 - Math.floor(w / 2);
          ctx.fillRect(screenX + left, screenY + 4 + row, w, 1);
        }
        // 屋根のハイライト
        ctx.fillStyle = '#ff7777';
        for (let row = 0; row < 12; row++) {
          const w = 4 + row * 2;
          const left = 16 - Math.floor(w / 2);
          ctx.fillRect(screenX + left, screenY + 4 + row, 2, 1);
        }

        // 白いレンガ壁
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(screenX + 5, screenY + 16, 22, 14);

        // レンガの影ライン
        ctx.fillStyle = '#bbbbbb';
        ctx.fillRect(screenX + 5, screenY + 20, 22, 1);
        ctx.fillRect(screenX + 5, screenY + 25, 22, 1);

        // 窓 (左側・水色)
        ctx.fillStyle = PALETTE.CYAN;
        ctx.fillRect(screenX + 8, screenY + 19, 5, 5);
        ctx.fillStyle = '#000000';
        ctx.fillRect(screenX + 10, screenY + 19, 1, 5);
        ctx.fillRect(screenX + 8, screenY + 21, 5, 1);

        // 木製ドア (右寄り・黄色/木目)
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(screenX + 18, screenY + 19, 7, 11);
        ctx.fillStyle = '#885500';
        ctx.fillRect(screenX + 19, screenY + 20, 5, 9);
        // ドアノブ
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(screenX + 22, screenY + 24, 2, 2);
        break;
      }

      case 'GRAVE': {
        // 墓: 苔むした墓石 + 刻まれた十字架 + 盛り土
        // 土台 (盛り土)
        ctx.fillStyle = '#334422';
        ctx.fillRect(screenX + 4, screenY + 24, 24, 6);

        // 墓石本体 (シアン/石色)
        ctx.fillStyle = PALETTE.CYAN;
        ctx.fillRect(screenX + 7, screenY + 9, 18, 17);
        // 丸みのある頭部
        ctx.fillRect(screenX + 10, screenY + 6, 12, 3);
        ctx.fillRect(screenX + 12, screenY + 4, 8, 2);

        // ハイライト (左上)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(screenX + 8, screenY + 9, 2, 16);
        ctx.fillRect(screenX + 10, screenY + 6, 2, 3);

        // 墓石の影 (右下)
        ctx.fillStyle = '#005577';
        ctx.fillRect(screenX + 23, screenY + 9, 2, 17);

        // 刻印された黒い十字架
        ctx.fillStyle = PALETTE.BLACK;
        ctx.fillRect(screenX + 14, screenY + 9, 4, 11);
        ctx.fillRect(screenX + 11, screenY + 12, 10, 3);
        break;
      }

      case 'CHEST': {
        // 宝箱: 金色の帯 + 木目板 + 鍵穴
        // 影
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(screenX + 4, screenY + 26, 24, 4);

        // 箱本体 (ゴールド外枠)
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(screenX + 4, screenY + 8, 24, 18);

        // 木目パネル
        ctx.fillStyle = '#884400';
        ctx.fillRect(screenX + 6, screenY + 10, 20, 14);

        // 中央の金属バンド
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(screenX + 14, screenY + 8, 4, 18);
        ctx.fillRect(screenX + 4, screenY + 16, 24, 2); // 蓋の合わせ目

        // 鍵穴金具 (白と黒)
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(screenX + 14, screenY + 14, 4, 6);
        ctx.fillStyle = PALETTE.BLACK;
        ctx.fillRect(screenX + 15, screenY + 15, 2, 4);
        break;
      }

      case 'SWORD': {
        // 剣: 抜かれた剣（刃、鍔、柄、ハイライト）
        if (typeof ctx.save === 'function') ctx.save();
        // 刃先
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(screenX + 14, screenY + 4, 4, 16);
        ctx.fillStyle = PALETTE.CYAN;
        ctx.fillRect(screenX + 16, screenY + 4, 2, 16);
        // 切っ先
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(screenX + 15, screenY + 2, 2, 2);

        // 鍔（金色）
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(screenX + 10, screenY + 20, 12, 3);

        // 柄（赤）
        ctx.fillStyle = PALETTE.RED;
        ctx.fillRect(screenX + 14, screenY + 23, 4, 5);

        // ポメル（柄頭・金）
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(screenX + 13, screenY + 28, 6, 2);
        if (typeof ctx.restore === 'function') ctx.restore();
        break;
      }

      case 'COIN': {
        // 金貨: 立体的なコイン
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(screenX + 8, screenY + 6, 16, 20);
        ctx.fillRect(screenX + 6, screenY + 8, 20, 16);

        // 内部の窪み
        ctx.fillStyle = '#b8860b';
        ctx.fillRect(screenX + 10, screenY + 10, 12, 12);

        // 星マーク (白)
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(screenX + 14, screenY + 12, 4, 8);
        ctx.fillRect(screenX + 12, screenY + 14, 8, 4);
        break;
      }

      case 'POTION': {
        // 魔法の壺 (フラスコ): 薬液、ガラス反射、コルク栓
        // コルク栓
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(screenX + 13, screenY + 5, 6, 4);

        // ボトルネック
        ctx.fillStyle = PALETTE.CYAN;
        ctx.fillRect(screenX + 14, screenY + 9, 4, 4);

        // 胴体 (丸型)
        ctx.fillStyle = PALETTE.MAGENTA;
        ctx.fillRect(screenX + 8, screenY + 13, 16, 14);
        ctx.fillRect(screenX + 10, screenY + 27, 12, 2);

        // 輝き (白)
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(screenX + 10, screenY + 15, 3, 4);
        break;
      }

      case 'POWER_STONE': {
        // パワーストーン: 多面体の真紅の宝石
        ctx.fillStyle = PALETTE.RED;
        ctx.fillRect(screenX + 12, screenY + 6, 8, 20);
        ctx.fillRect(screenX + 8, screenY + 10, 16, 12);

        // ハイライト面 (白/ピンク)
        ctx.fillStyle = '#ff9999';
        ctx.fillRect(screenX + 12, screenY + 8, 4, 4);
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(screenX + 13, screenY + 9, 2, 2);

        // シャドウ面 (暗赤)
        ctx.fillStyle = '#660000';
        ctx.fillRect(screenX + 16, screenY + 16, 6, 6);
        break;
      }

      case 'CROSS': {
        // 十字架: 輝く白と金の聖十字
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(screenX + 13, screenY + 4, 6, 24);
        ctx.fillRect(screenX + 6, screenY + 10, 20, 6);

        // 縁取りと装飾
        ctx.fillStyle = PALETTE.CYAN;
        ctx.fillRect(screenX + 14, screenY + 5, 4, 22);
        ctx.fillRect(screenX + 7, screenY + 11, 18, 4);
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(screenX + 14, screenY + 11, 4, 4);
        break;
      }

      case 'KEY': {
        // 鍵: 豪華な金の鍵
        ctx.fillStyle = PALETTE.YELLOW;
        // 持ち手リング
        ctx.fillRect(screenX + 9, screenY + 6, 14, 10);
        ctx.fillStyle = palette.fieldBackgroundColor;
        ctx.fillRect(screenX + 13, screenY + 9, 6, 4);

        // 軸
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(screenX + 14, screenY + 16, 4, 12);
        // 歯
        ctx.fillRect(screenX + 18, screenY + 21, 4, 3);
        ctx.fillRect(screenX + 18, screenY + 25, 5, 3);

        // 光沢
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(screenX + 10, screenY + 7, 3, 2);
        break;
      }

      case 'RING': {
        // 指輪: 黄金のリング + 輝く巨大宝石
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(screenX + 8, screenY + 12, 16, 16);
        ctx.fillStyle = palette.fieldBackgroundColor;
        ctx.fillRect(screenX + 12, screenY + 16, 8, 8);

        // 宝石台座
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(screenX + 12, screenY + 8, 8, 5);

        // 大粒の青/シアンの宝石
        ctx.fillStyle = PALETTE.CYAN;
        ctx.fillRect(screenX + 13, screenY + 6, 6, 6);
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(screenX + 14, screenY + 7, 2, 2);
        break;
      }

      case 'DEATH': {
        // 死神: 暗黒のローブ + 浮かび上がる髑髏
        ctx.fillStyle = PALETTE.MAGENTA;
        ctx.fillRect(screenX + 7, screenY + 6, 18, 22);
        ctx.fillRect(screenX + 5, screenY + 12, 22, 16);

        // 頭蓋骨
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(screenX + 11, screenY + 10, 10, 8);

        // 赤い眼
        ctx.fillStyle = PALETTE.RED;
        ctx.fillRect(screenX + 12, screenY + 12, 2, 2);
        ctx.fillRect(screenX + 18, screenY + 12, 2, 2);
        break;
      }

      case 'CROWN': {
        // 王冠: 豪華な金の王冠 + 宝石
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(screenX + 6, screenY + 18, 20, 8);

        // 3つの尖塔
        ctx.fillRect(screenX + 6, screenY + 10, 4, 8);
        ctx.fillRect(screenX + 14, screenY + 8, 4, 10);
        ctx.fillRect(screenX + 22, screenY + 10, 4, 8);

        // 宝石 (中央ルビー、両脇サファイア)
        ctx.fillStyle = PALETTE.RED;
        ctx.fillRect(screenX + 14, screenY + 12, 4, 4);
        ctx.fillStyle = PALETTE.CYAN;
        ctx.fillRect(screenX + 7, screenY + 20, 3, 3);
        ctx.fillRect(screenX + 22, screenY + 20, 3, 3);
        break;
      }

      case 'CHEST_DRAGON': {
        // ドラゴンの宝箱: 真紅と黒の漆塗り宝箱
        ctx.fillStyle = PALETTE.RED;
        ctx.fillRect(screenX + 4, screenY + 8, 24, 18);
        ctx.fillStyle = '#440000';
        ctx.fillRect(screenX + 6, screenY + 10, 20, 14);

        // ドラゴンエンブレム (金)
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(screenX + 12, screenY + 13, 8, 8);
        ctx.fillStyle = PALETTE.BLACK;
        ctx.fillRect(screenX + 14, screenY + 15, 4, 4);
        break;
      }

      case 'WARP': {
        // ワープゾーン: 魔法陣ポータル
        ctx.fillStyle = PALETTE.CYAN;
        ctx.fillRect(screenX + 4, screenY + 4, 24, 24);
        ctx.fillStyle = PALETTE.BLUE;
        ctx.fillRect(screenX + 8, screenY + 8, 16, 16);
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(screenX + 12, screenY + 12, 8, 8);

        // 四隅の魔道クリスタル
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(screenX + 2, screenY + 2, 4, 4);
        ctx.fillRect(screenX + 26, screenY + 2, 4, 4);
        ctx.fillRect(screenX + 2, screenY + 26, 4, 4);
        ctx.fillRect(screenX + 26, screenY + 26, 4, 4);
        break;
      }

      default:
        break;
    }
  }

  /**
   * 32x32 勇者（プレイヤー）の高精細ピクセルアート描画
   * 携帯アイテム（RING / CROSS / POWER_STONE / KEY / CROWN）の視覚化および被弾点滅対応
   * FLY魔法発動時は「鳥（Bird）」の羽ばたきスプライトへと変身
   */
  public static drawPlayer(
    ctx: CanvasRenderingContext2D,
    screenX: number,
    screenY: number,
    dir: Direction,
    hasSword: boolean,
    holdItem: HoldItemType = 'NONE',
    isHurt: boolean = false,
    isFlying: boolean = false,
    animFrame: number = 0
  ): void {
    if (isFlying) {
      this.drawFlyingBird(ctx, screenX, screenY, dir, animFrame, holdItem, isHurt);
      return;
    }

    ctx.save();

    // 被弾フリッカー時は赤または白色でフラッシュ
    if (isHurt) {
      ctx.fillStyle = '#ff2222';
      ctx.fillRect(screenX + 4, screenY + 4, 24, 24);
    }

    // 1. 胴体 (青の鎧 + ハイライト)
    ctx.fillStyle = PALETTE.BLUE;
    ctx.fillRect(screenX + 10, screenY + 12, 12, 12);
    ctx.fillStyle = '#4488ff';
    ctx.fillRect(screenX + 11, screenY + 13, 4, 10);

    // 2. マント (背後・赤)
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(screenX + 8, screenY + 14, 3, 11);
    ctx.fillRect(screenX + 21, screenY + 14, 3, 11);

    // 3. 頭部・兜 (ナイトヘルメット)
    ctx.fillStyle = PALETTE.WHITE;
    ctx.fillRect(screenX + 10, screenY + 5, 12, 8); // 顔・素地

    // ヘルメット本体 (金色・黄色)
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(screenX + 8, screenY + 3, 16, 4);
    ctx.fillRect(screenX + 8, screenY + 7, 4, 4);
    ctx.fillRect(screenX + 20, screenY + 7, 4, 4);

    // ヘルメットの羽根飾り
    ctx.fillStyle = PALETTE.CYAN;
    ctx.fillRect(screenX + 14, screenY + 1, 4, 3);

    // 4. 足・ブーツ
    ctx.fillStyle = '#223355';
    ctx.fillRect(screenX + 10, screenY + 24, 4, 7);
    ctx.fillRect(screenX + 18, screenY + 24, 4, 7);

    // 5. 向きに応じた目・バイザーの表現
    ctx.fillStyle = PALETTE.BLACK;
    if (dir === 'UP') {
      // 後ろ姿: ヘルメットの後頭部
      ctx.fillStyle = PALETTE.YELLOW;
      ctx.fillRect(screenX + 10, screenY + 5, 12, 7);
    } else if (dir === 'LEFT' || dir === 'UP_LEFT' || dir === 'DOWN_LEFT') {
      ctx.fillRect(screenX + 11, screenY + 7, 3, 3); // 左目
    } else if (dir === 'RIGHT' || dir === 'UP_RIGHT' || dir === 'DOWN_RIGHT') {
      ctx.fillRect(screenX + 18, screenY + 7, 3, 3); // 右目
    } else {
      // 正面 (DOWN)
      ctx.fillRect(screenX + 12, screenY + 7, 2, 3);
      ctx.fillRect(screenX + 18, screenY + 7, 2, 3);
    }

    // 6. 剣の表示
    if (hasSword) {
      ctx.fillStyle = PALETTE.WHITE;
      if (dir === 'LEFT' || dir === 'UP_LEFT' || dir === 'DOWN_LEFT') {
        // 左手に構え
        ctx.fillRect(screenX + 3, screenY + 8, 3, 16);
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(screenX + 2, screenY + 16, 5, 3);
      } else {
        // 右手に構え
        ctx.fillRect(screenX + 25, screenY + 8, 3, 16);
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(screenX + 24, screenY + 16, 5, 3);
      }
    }

    // 7. 携帯アイテム（RING / CROSS / POWER_STONE / KEY / CROWN）の視覚化！
    this.drawHoldItemOverlay(ctx, screenX, screenY, holdItem, dir);

    ctx.restore();
  }

  /**
   * FLY魔法発動中の「鳥（Bird）」の飛行・羽ばたきピクセルアート描画（原作DS1リスペクト）
   */
  public static drawFlyingBird(
    ctx: CanvasRenderingContext2D,
    screenX: number,
    screenY: number,
    dir: Direction,
    animFrame: number,
    holdItem: HoldItemType = 'NONE',
    isHurt: boolean = false
  ): void {
    ctx.save();

    // 1. 浮遊感を出す足元の影（楕円シャドウ）
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(screenX + 16, screenY + 28, 9, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. 上下にふわふわ浮遊するボビング（2ピクセル周期）
    const bobY = Math.round(Math.sin((animFrame / 15) * Math.PI) * 2);
    const by = screenY + bobY;

    // 被弾フリッカー
    if (isHurt) {
      ctx.fillStyle = '#ff2222';
      ctx.fillRect(screenX + 4, by + 4, 24, 24);
    }

    // 3. 羽ばたきアニメーションのフラグ（約0.25秒で羽の上下が切り替わる）
    const wingUp = (Math.floor(animFrame / 12) % 2) === 0;

    // 4. 鳥の胴体（白 + 影）
    ctx.fillStyle = PALETTE.WHITE;
    ctx.fillRect(screenX + 11, by + 10, 10, 10);
    // 胴体下部の影
    ctx.fillStyle = '#c0d0e0';
    ctx.fillRect(screenX + 12, by + 18, 8, 3);

    // 5. 尾羽（後方）
    ctx.fillStyle = PALETTE.CYAN;
    if (dir === 'RIGHT' || dir === 'UP_RIGHT' || dir === 'DOWN_RIGHT') {
      ctx.fillRect(screenX + 8, by + 14, 4, 4);
    } else if (dir === 'LEFT' || dir === 'UP_LEFT' || dir === 'DOWN_LEFT') {
      ctx.fillRect(screenX + 20, by + 14, 4, 4);
    } else {
      // 縦向き時は下部に尾羽
      ctx.fillRect(screenX + 14, by + 19, 4, 4);
    }

    // 6. 翼の羽ばたき（白＋水色アクセント）
    ctx.fillStyle = PALETTE.WHITE;
    if (wingUp) {
      // 翼が上がっている状態（V字に展開）
      // 左翼
      ctx.fillRect(screenX + 5, by + 3, 7, 8);
      ctx.fillRect(screenX + 2, by + 1, 5, 6);
      // 右翼
      ctx.fillRect(screenX + 20, by + 3, 7, 8);
      ctx.fillRect(screenX + 25, by + 1, 5, 6);
      // 翼先ハイライト
      ctx.fillStyle = PALETTE.CYAN;
      ctx.fillRect(screenX + 2, by + 1, 3, 3);
      ctx.fillRect(screenX + 27, by + 1, 3, 3);
    } else {
      // 翼が下がっている状態（水平〜下向きに展開）
      // 左翼
      ctx.fillRect(screenX + 4, by + 12, 8, 6);
      ctx.fillRect(screenX + 1, by + 15, 5, 5);
      // 右翼
      ctx.fillRect(screenX + 20, by + 12, 8, 6);
      ctx.fillRect(screenX + 26, by + 15, 5, 5);
      // 翼先ハイライト
      ctx.fillStyle = PALETTE.CYAN;
      ctx.fillRect(screenX + 1, by + 17, 3, 3);
      ctx.fillRect(screenX + 28, by + 17, 3, 3);
    }

    // 7. 頭部・クチバシ・目
    ctx.fillStyle = PALETTE.WHITE;
    if (dir === 'LEFT' || dir === 'UP_LEFT' || dir === 'DOWN_LEFT') {
      // 左向き
      ctx.fillRect(screenX + 8, by + 7, 7, 7); // 頭
      ctx.fillStyle = PALETTE.YELLOW;
      ctx.fillRect(screenX + 4, by + 9, 5, 3);  // クチバシ
      ctx.fillStyle = PALETTE.BLACK;
      ctx.fillRect(screenX + 10, by + 8, 2, 2); // 目
    } else if (dir === 'RIGHT' || dir === 'UP_RIGHT' || dir === 'DOWN_RIGHT') {
      // 右向き
      ctx.fillRect(screenX + 17, by + 7, 7, 7); // 頭
      ctx.fillStyle = PALETTE.YELLOW;
      ctx.fillRect(screenX + 23, by + 9, 5, 3);  // クチバシ
      ctx.fillStyle = PALETTE.BLACK;
      ctx.fillRect(screenX + 20, by + 8, 2, 2); // 目
    } else if (dir === 'UP') {
      // 後ろ姿
      ctx.fillRect(screenX + 12, by + 6, 8, 7);
      ctx.fillStyle = PALETTE.YELLOW;
      ctx.fillRect(screenX + 14, by + 4, 4, 3); // 上向きクチバシ先端
    } else {
      // 正面（DOWN）
      ctx.fillRect(screenX + 12, by + 7, 8, 7); // 顔
      ctx.fillStyle = PALETTE.YELLOW;
      ctx.fillRect(screenX + 14, by + 12, 4, 3); // クチバシ
      ctx.fillStyle = PALETTE.BLACK;
      ctx.fillRect(screenX + 13, by + 9, 2, 2);  // 左目
      ctx.fillRect(screenX + 17, by + 9, 2, 2);  // 右目
    }

    // 8. 携帯アイテムのオーバーレイ
    this.drawHoldItemOverlay(ctx, screenX, by, holdItem, dir);

    ctx.restore();
  }

  /**
   * 携帯アイテムのプレイヤーオーバーレイ描画
   */
  private static drawHoldItemOverlay(
    ctx: CanvasRenderingContext2D,
    screenX: number,
    screenY: number,
    item: HoldItemType,
    _dir: Direction
  ): void {
    if (item === 'NONE') return;

    // アイテム表示位置（左肩または頭上）
    const iconX = screenX + 1;
    const iconY = screenY + 1;

    switch (item) {
      case 'RING': {
        // 💍 黄金の指輪 + キラリスパーク
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(iconX + 1, iconY + 3, 8, 8);
        ctx.fillStyle = '#000000';
        ctx.fillRect(iconX + 3, iconY + 5, 4, 4);

        // 宝石 (シアン)
        ctx.fillStyle = PALETTE.CYAN;
        ctx.fillRect(iconX + 3, iconY + 1, 4, 3);
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(iconX + 4, iconY + 2, 2, 2);

        // キラリ輝く星
        ctx.fillStyle = '#ffff55';
        ctx.fillRect(iconX + 8, iconY, 2, 2);
        break;
      }

      case 'CROSS': {
        // ✝️ 神聖な光の十字架 + 神聖オーラ
        // オーラ
        ctx.fillStyle = 'rgba(0, 255, 255, 0.4)';
        ctx.fillRect(iconX, iconY, 10, 12);

        // 白い十字
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(iconX + 3, iconY + 1, 4, 10);
        ctx.fillRect(iconX + 1, iconY + 3, 8, 3);
        break;
      }

      case 'POWER_STONE': {
        // 💎 真紅のクリスタルストーン
        ctx.fillStyle = PALETTE.RED;
        ctx.fillRect(iconX + 3, iconY + 1, 4, 10);
        ctx.fillRect(iconX + 1, iconY + 3, 8, 6);

        // 輝き
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(iconX + 3, iconY + 3, 2, 2);
        break;
      }

      case 'KEY': {
        // 🔑 黄金の鍵
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(iconX + 2, iconY + 1, 6, 5);
        ctx.fillStyle = '#000000';
        ctx.fillRect(iconX + 4, iconY + 2, 2, 2);
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(iconX + 4, iconY + 6, 2, 6);
        ctx.fillRect(iconX + 6, iconY + 9, 2, 2);
        break;
      }

      default:
        break;
    }
  }

  /**
   * 32x32 全32種モンスター描画（レトロ・プロシージャルピクセルアート再現）
   */
  public static drawEnemy(
    ctx: CanvasRenderingContext2D,
    enemy: EnemyInstance,
    screenX: number,
    screenY: number,
    isFlickering: boolean = false
  ): void {
    MonsterGraphics.drawMonster(ctx, enemy, screenX, screenY, isFlickering);
  }

  /**
   * 32x32 ゴースト（おばけ）描画（運搬中アイテムのミニ表示対応）
   */
  public static drawGhost(
    ctx: CanvasRenderingContext2D,
    ghost: Ghost,
    screenX: number,
    screenY: number
  ): void {
    ctx.save();
    // 半透明水色の浮遊オーラ
    ctx.fillStyle = 'rgba(0, 255, 255, 0.25)';
    ctx.beginPath();
    ctx.arc(screenX + 16, screenY + 16, 14, 0, Math.PI * 2);
    ctx.fill();

    // おばけ本体
    ctx.fillStyle = PALETTE.WHITE;
    ctx.beginPath();
    ctx.arc(screenX + 16, screenY + 12, 10, Math.PI, 0, false);
    ctx.lineTo(screenX + 26, screenY + 26);
    ctx.lineTo(screenX + 20, screenY + 22);
    ctx.lineTo(screenX + 16, screenY + 26);
    ctx.lineTo(screenX + 12, screenY + 22);
    ctx.lineTo(screenX + 6, screenY + 26);
    ctx.closePath();
    ctx.fill();

    // 目 (黒)
    ctx.fillStyle = PALETTE.BLACK;
    ctx.fillRect(screenX + 12, screenY + 12, 2, 4);
    ctx.fillRect(screenX + 18, screenY + 12, 2, 4);

    // 運搬アイテムがある場合のミニアイコン描画
    if (ghost.carriedItem) {
      this.drawGhostCarriedItem(ctx, screenX + 18, screenY + 2, ghost.carriedItem);
    }

    ctx.restore();
  }

  /**
   * ゴーストが運搬しているアイテムのミニアイコン描画 (10x10)
   */
  private static drawGhostCarriedItem(
    ctx: CanvasRenderingContext2D,
    ix: number,
    iy: number,
    item: TileType
  ): void {
    // 背景小バッジ
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(ix - 1, iy - 1, 12, 12);

    switch (item) {
      case 'SWORD':
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(ix + 4, iy + 1, 2, 7);
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(ix + 2, iy + 6, 6, 2);
        break;
      case 'KEY':
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(ix + 3, iy + 1, 4, 3);
        ctx.fillRect(ix + 4, iy + 4, 2, 5);
        ctx.fillRect(ix + 6, iy + 7, 2, 2);
        break;
      case 'RING':
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(ix + 2, iy + 3, 6, 6);
        ctx.fillStyle = '#000000';
        ctx.fillRect(ix + 4, iy + 5, 2, 2);
        ctx.fillStyle = PALETTE.CYAN;
        ctx.fillRect(ix + 4, iy + 1, 2, 2);
        break;
      case 'CROSS':
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(ix + 4, iy + 1, 2, 8);
        ctx.fillRect(ix + 2, iy + 3, 6, 2);
        break;
      case 'POWER_STONE':
        ctx.fillStyle = PALETTE.RED;
        ctx.fillRect(ix + 3, iy + 1, 4, 8);
        ctx.fillRect(ix + 1, iy + 3, 8, 4);
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(ix + 3, iy + 3, 2, 2);
        break;
      case 'POTION':
        ctx.fillStyle = PALETTE.BLUE;
        ctx.fillRect(ix + 2, iy + 3, 6, 6);
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(ix + 4, iy + 1, 2, 2);
        break;
      case 'COIN':
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(ix + 2, iy + 2, 6, 6);
        ctx.fillStyle = '#aa8800';
        ctx.fillRect(ix + 4, iy + 4, 2, 2);
        break;
      case 'CROWN':
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(ix + 1, iy + 2, 8, 6);
        ctx.fillStyle = PALETTE.RED;
        ctx.fillRect(ix + 3, iy + 4, 4, 2);
        break;
      default:
        ctx.fillStyle = PALETTE.CYAN;
        ctx.fillRect(ix + 2, iy + 2, 6, 6);
        break;
    }
  }

  /**
   * 32x32 3首ドラゴンの部位描画
   */
  public static drawDragonPart(
    ctx: CanvasRenderingContext2D,
    part: DragonPart,
    screenX: number,
    screenY: number,
    isFlickering: boolean = false
  ): void {
    const sz = TILE_SIZE; // 32

    ctx.save();

    if (isFlickering) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(screenX + 2, screenY + 2, sz - 4, sz - 4);
      ctx.restore();
      return;
    }

    if (part.type === 'BODY') {
      // 巨大な赤い竜胴体（鱗・蛇腹）
      ctx.fillStyle = PALETTE.RED;
      ctx.fillRect(screenX + 2, screenY + 2, sz - 4, sz - 4);
      ctx.fillStyle = '#770000';
      ctx.fillRect(screenX + 5, screenY + 5, sz - 10, sz - 10);

      // 黄色い蛇腹
      ctx.fillStyle = PALETTE.YELLOW;
      ctx.fillRect(screenX + 8, screenY + 8, 16, 3);
      ctx.fillRect(screenX + 8, screenY + 14, 16, 3);
      ctx.fillRect(screenX + 8, screenY + 20, 16, 3);
    } else if (part.type === 'TAIL') {
      // 鋭い尻尾
      ctx.fillStyle = PALETTE.RED;
      ctx.fillRect(screenX + 10, screenY + 4, 12, 20);
      ctx.fillStyle = PALETTE.YELLOW;
      ctx.fillRect(screenX + 12, screenY + 22, 8, 6);
      ctx.fillRect(screenX + 14, screenY + 28, 4, 3);
    } else {
      // 3首
      if (part.isAlive) {
        // 赤い竜頭
        ctx.fillStyle = PALETTE.RED;
        ctx.fillRect(screenX + 3, screenY + 3, sz - 6, sz - 6);

        // 角 (金)
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(screenX + 6, screenY + 1, 4, 5);
        ctx.fillRect(screenX + 22, screenY + 1, 4, 5);

        // 瞳 (金＋黒瞳孔)
        ctx.fillStyle = PALETTE.YELLOW;
        ctx.fillRect(screenX + 8, screenY + 10, 5, 5);
        ctx.fillRect(screenX + 19, screenY + 10, 5, 5);
        ctx.fillStyle = PALETTE.BLACK;
        ctx.fillRect(screenX + 10, screenY + 12, 2, 2);
        ctx.fillRect(screenX + 20, screenY + 12, 2, 2);

        // 鋭い牙 (白)
        ctx.fillStyle = PALETTE.WHITE;
        ctx.fillRect(screenX + 9, screenY + 21, 3, 4);
        ctx.fillRect(screenX + 20, screenY + 21, 3, 4);
      } else {
        // 討伐後の首（骨・グレー）
        ctx.fillStyle = PALETTE.GRAY;
        ctx.fillRect(screenX + 5, screenY + 8, sz - 10, sz - 16);
        ctx.fillStyle = PALETTE.BLACK;
        ctx.fillRect(screenX + 9, screenY + 12, 4, 4);
        ctx.fillRect(screenX + 19, screenY + 12, 4, 4);
      }
    }

    ctx.restore();
  }

  /**
   * 32x32 火炎弾描画
   */
  public static drawFireball(
    ctx: CanvasRenderingContext2D,
    _fb: Fireball,
    screenX: number,
    screenY: number
  ): void {
    ctx.save();
    // 外炎
    ctx.fillStyle = PALETTE.RED;
    ctx.beginPath();
    ctx.arc(screenX + 16, screenY + 16, 12, 0, Math.PI * 2);
    ctx.fill();

    // 内炎
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.beginPath();
    ctx.arc(screenX + 16, screenY + 16, 8, 0, Math.PI * 2);
    ctx.fill();

    // 芯
    ctx.fillStyle = PALETTE.WHITE;
    ctx.fillRect(screenX + 14, screenY + 14, 4, 4);
    ctx.restore();
  }

  /**
   * 32x32 背後追従する死神（骸骨/DEATH）の描画
   */
  public static drawDeathFollower(
    ctx: CanvasRenderingContext2D,
    screenX: number,
    screenY: number,
    frame: number = 0
  ): void {
    ctx.save();

    // フワフワと妖しく浮遊する上下オフセット
    const floatY = Math.sin((frame * Math.PI) / 15) * 2;
    const dy = screenY + floatY;

    // 1. 紫の呪いオーラ
    ctx.fillStyle = 'rgba(150, 0, 200, 0.35)';
    ctx.beginPath();
    ctx.arc(screenX + 16, dy + 16, 15, 0, Math.PI * 2);
    ctx.fill();

    // 2. 暗黒のフード付きローブ (マゼンタ/暗紫)
    ctx.fillStyle = PALETTE.MAGENTA;
    ctx.fillRect(screenX + 7, dy + 6, 18, 22);
    ctx.fillRect(screenX + 5, dy + 12, 22, 16);

    // 3. 骸骨・髑髏の顔 (白)
    ctx.fillStyle = PALETTE.WHITE;
    ctx.fillRect(screenX + 10, dy + 9, 12, 9);
    ctx.fillRect(screenX + 12, dy + 18, 8, 3); // 顎

    // 4. 赤く妖しく輝く眼 (赤)
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(screenX + 12, dy + 12, 3, 3);
    ctx.fillRect(screenX + 17, dy + 12, 3, 3);

    // 5. 髑髏の鼻・歯の影 (黒)
    ctx.fillStyle = PALETTE.BLACK;
    ctx.fillRect(screenX + 15, dy + 15, 2, 2); // 鼻
    ctx.fillRect(screenX + 13, dy + 18, 2, 2); // 歯
    ctx.fillRect(screenX + 17, dy + 18, 2, 2); // 歯

    ctx.restore();
  }
}
