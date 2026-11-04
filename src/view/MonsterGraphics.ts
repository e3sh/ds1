import { PALETTE, TILE_SIZE } from '../config/Constants.js';
import { ENEMY_CONFIG_TABLE } from '../config/EnemyTable.js';
import { EnemyInstance } from '../models/Enemy.js';

/**
 * 全32種モンスター レトロ・プロシージャルドット絵グラフィック描画クラス
 * 8ビットPC時代（PC-8801 / MSX）の4色タイルアート表現をモチーフに、
 * 初回起動時にオフスクリーンCanvas（スプライトシート: 通常行＋FREEZE凍結行）へ一括描画し、
 * ゲームループ中は高速な `ctx.drawImage` 矩形切り出し（Blit）で描画します。
 * 将来的な個別アニメーションフレームや向き差分の行拡張にも対応可能な構造です。
 */
export class MonsterGraphics {
  private static spriteSheet: HTMLCanvasElement | null = null;
  private static readonly MONSTER_COUNT = 32;
  public static readonly ROW_NORMAL = 0;
  public static readonly ROW_FROZEN = 1;
  private static readonly SHEET_ROWS = 2;

  /**
   * オフスクリーンスプライトシート（1024x64: 32種 × [通常段, 凍結段]）を生成・取得
   */
  public static getOrCreateSpriteSheet(
    canvasFactory?: (width: number, height: number) => HTMLCanvasElement | null
  ): HTMLCanvasElement | null {
    if (this.spriteSheet && !canvasFactory) {
      return this.spriteSheet;
    }

    const sheetWidth = this.MONSTER_COUNT * TILE_SIZE; // 1024px
    const sheetHeight = this.SHEET_ROWS * TILE_SIZE;   // 64px

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

    // 全32種モンスターの「通常状態（Row 0）」と「FREEZE凍結状態（Row 1）」を一括焼き付け
    for (const cfg of ENEMY_CONFIG_TABLE) {
      const colIndex = cfg.id - 1;
      const sx = colIndex * TILE_SIZE;

      // Row 0: 通常状態
      this.renderMonsterProcedural(sheetCtx, cfg.id, sx, this.ROW_NORMAL * TILE_SIZE, cfg.color, false);

      // Row 1: FREEZE凍結状態（白■背景塗りつぶし＋白系モンスター黒反転）
      this.renderMonsterProcedural(sheetCtx, cfg.id, sx, this.ROW_FROZEN * TILE_SIZE, cfg.color, true);
    }

    if (!canvasFactory) {
      this.spriteSheet = canvas;
    }
    return canvas;
  }

  /**
   * キャッシュ済みスプライトシートを破棄（再生成が必要な場合やテスト用）
   */
  public static invalidateSpriteSheet(): void {
    this.spriteSheet = null;
  }

  public static drawMonster(
    ctx: CanvasRenderingContext2D,
    enemy: EnemyInstance,
    screenX: number,
    screenY: number,
    isFlickering: boolean = false
  ): void {
    const sz = TILE_SIZE; // 32
    const isFrozen = enemy.isFrozen ?? (enemy.frozenTimer ?? 0) > 0;

    ctx.save();

    // 被弾フラッシュ（通常時は白フラッシュ、FREEZE白背景時はシアン反転フラッシュ）
    if (isFlickering) {
      ctx.fillStyle = isFrozen ? PALETTE.CYAN : '#ffffff';
      ctx.fillRect(screenX + 2, screenY + 2, sz - 4, sz - 4);
      ctx.restore();
      return;
    }

    const typeId = enemy.typeId ?? (typeof (enemy as any).id === 'number' ? (enemy as any).id : 0);
    this.drawMonsterById(ctx, typeId, screenX, screenY, enemy.color, isFrozen);

    ctx.restore();
  }

  /**
   * typeIdとカラーからモンスターを描画（スプライトシートが利用可能な場合は drawImage で高速切り出し）
   */
  public static drawMonsterById(
    ctx: CanvasRenderingContext2D,
    typeId: number,
    screenX: number,
    screenY: number,
    color: string = PALETTE.WHITE,
    isFrozen: boolean = false
  ): void {
    if (typeId >= 1 && typeId <= this.MONSTER_COUNT && typeof ctx.drawImage === 'function') {
      const defaultColor = ENEMY_CONFIG_TABLE[typeId - 1]?.color;
      // 標準パレットカラーの場合は事前生成スプライトシートから1回の drawImage で切り出し
      if (!defaultColor || defaultColor.toLowerCase() === color.toLowerCase()) {
        const sheet = this.getOrCreateSpriteSheet();
        if (sheet) {
          const srcX = (typeId - 1) * TILE_SIZE;
          const srcY = (isFrozen ? this.ROW_FROZEN : this.ROW_NORMAL) * TILE_SIZE;
          ctx.drawImage(
            sheet,
            srcX,
            srcY,
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

    // スプライトシート未対応環境（軽量モックCanvas等）やカスタムカラー指定時は直接プロシージャル描画
    this.renderMonsterProcedural(ctx, typeId, screenX, screenY, color, isFrozen);
  }

  /**
   * 単一モンスターのプロシージャルドット絵描画（スプライトシート焼き付け元＆フォールバック用）
   */
  public static renderMonsterProcedural(
    ctx: CanvasRenderingContext2D,
    typeId: number,
    screenX: number,
    screenY: number,
    color: string = PALETTE.WHITE,
    isFrozen: boolean = false
  ): void {
    let drawColor = color;
    if (isFrozen) {
      // 原作再現: FREEZE/FLASH凍結状態は背景を白の■で塗りつぶす
      ctx.fillStyle = PALETTE.WHITE;
      ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
      // 白系モンスター（スケルトン、レンジ、ラビット等）が白背景に同化しないよう黒に反転
      if (color.toLowerCase() === PALETTE.WHITE.toLowerCase()) {
        drawColor = PALETTE.BLACK;
      }
    }

    // 各モンスター固有のドット絵描画ルーチンへディスパッチ (typeId: 1〜32)
    switch (typeId) {
      case 1:  this.drawSkeleton(ctx, screenX, screenY, drawColor); break;
      case 2:  this.drawSaulus(ctx, screenX, screenY, drawColor); break;
      case 3:  this.drawCondor(ctx, screenX, screenY, drawColor); break;
      case 4:  this.drawBug(ctx, screenX, screenY, drawColor); break;
      case 5:  this.drawMonstir(ctx, screenX, screenY, drawColor); break;
      case 6:  this.drawFoot(ctx, screenX, screenY, drawColor); break;
      case 7:  this.drawEyes(ctx, screenX, screenY, drawColor); break;
      case 8:  this.drawTamori(ctx, screenX, screenY, drawColor); break;
      case 9:  this.drawDora(ctx, screenX, screenY, drawColor); break;
      case 10: this.drawRich(ctx, screenX, screenY, drawColor); break;
      case 11: this.drawVampire(ctx, screenX, screenY, drawColor); break;
      case 12: this.drawNiko(ctx, screenX, screenY, drawColor); break;
      case 13: this.drawKnight(ctx, screenX, screenY, drawColor); break;
      case 14: this.drawPen(ctx, screenX, screenY, drawColor); break;
      case 15: this.drawRenge(ctx, screenX, screenY, drawColor); break;
      case 16: this.drawFlanc(ctx, screenX, screenY, drawColor); break;
      case 17: this.drawCangaru(ctx, screenX, screenY, drawColor); break;
      case 18: this.drawSauhead(ctx, screenX, screenY, drawColor); break;
      case 19: this.drawGrassman(ctx, screenX, screenY, drawColor); break;
      case 20: this.drawGoblin(ctx, screenX, screenY, drawColor); break;
      case 21: this.drawCrownload(ctx, screenX, screenY, drawColor); break;
      case 22: this.drawTin(ctx, screenX, screenY, drawColor); break;
      case 23: this.drawOgre(ctx, screenX, screenY, drawColor); break;
      case 24: this.drawSnake(ctx, screenX, screenY, drawColor); break;
      case 25: this.drawDeye(ctx, screenX, screenY, drawColor); break;
      case 26: this.drawBook(ctx, screenX, screenY, drawColor); break;
      case 27: this.drawNokonoko(ctx, screenX, screenY, drawColor); break;
      case 28: this.drawCyclops(ctx, screenX, screenY, drawColor); break;
      case 29: this.drawBeast(ctx, screenX, screenY, drawColor); break;
      case 30: this.drawRobo(ctx, screenX, screenY, drawColor); break;
      case 31: this.drawRabbit(ctx, screenX, screenY, drawColor); break;
      case 32: this.drawDoppel(ctx, screenX, screenY, drawColor); break;
      default:
        // フォールバック描画
        ctx.fillStyle = drawColor;
        ctx.fillRect(screenX + 8, screenY + 8, 16, 16);
        break;
    }
  }

  // --- 1. スケルトン (Skeleton) ---
  private static drawSkeleton(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    const holeColor = col.toLowerCase() === PALETTE.BLACK.toLowerCase() ? PALETTE.WHITE : '#000000';
    ctx.fillStyle = col; // 通常:白 / 凍結時:黒
    // 頭蓋骨
    ctx.fillRect(sx + 10, sy + 3, 12, 10);
    // 顎
    ctx.fillRect(sx + 12, sy + 13, 8, 3);
    // 眼窩（抜き色）
    ctx.fillStyle = holeColor;
    ctx.fillRect(sx + 12, sy + 6, 3, 3);
    ctx.fillRect(sx + 17, sy + 6, 3, 3);
    // 鼻腔
    ctx.fillRect(sx + 15, sy + 10, 2, 2);
    // 歯
    ctx.fillRect(sx + 14, sy + 14, 1, 2);
    ctx.fillRect(sx + 17, sy + 14, 1, 2);

    // 頸椎 & 肋骨
    ctx.fillStyle = col;
    ctx.fillRect(sx + 15, sy + 16, 2, 8); // 背骨
    ctx.fillRect(sx + 10, sy + 17, 12, 2); // 肋骨1
    ctx.fillRect(sx + 11, sy + 20, 10, 2); // 肋骨2
    ctx.fillRect(sx + 12, sy + 23, 8, 2);  // 肋骨3
    // 腕
    ctx.fillRect(sx + 7, sy + 18, 2, 6);
    ctx.fillRect(sx + 6, sy + 23, 2, 5);
    ctx.fillRect(sx + 23, sy + 18, 2, 6);
    ctx.fillRect(sx + 24, sy + 23, 2, 5);
    // 骨盤 & 脚
    ctx.fillRect(sx + 13, sy + 25, 6, 2);
    ctx.fillRect(sx + 12, sy + 27, 2, 4);
    ctx.fillRect(sx + 18, sy + 27, 2, 4);
  }

  // --- 2. サウルス (Saulus) ---
  private static drawSaulus(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // シアン
    // 頭部
    ctx.fillRect(sx + 7, sy + 4, 14, 8);
    ctx.fillRect(sx + 5, sy + 6, 5, 5); // 突き出た鼻先
    // 目
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 13, sy + 6, 3, 3);
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 14, sy + 7, 2, 2);
    // 牙
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 7, sy + 11, 2, 2);
    ctx.fillRect(sx + 11, sy + 11, 2, 2);

    // 胴体
    ctx.fillStyle = col;
    ctx.fillRect(sx + 10, sy + 12, 13, 11);
    // 背中のトゲ
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 17, sy + 2, 2, 3);
    ctx.fillRect(sx + 21, sy + 5, 2, 3);
    ctx.fillRect(sx + 23, sy + 10, 2, 3);
    // 短い前足
    ctx.fillStyle = col;
    ctx.fillRect(sx + 7, sy + 15, 4, 2);
    // 太い後脚
    ctx.fillRect(sx + 11, sy + 23, 4, 6);
    ctx.fillRect(sx + 18, sy + 23, 4, 6);
    // 足の爪
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 9, sy + 28, 3, 2);
    ctx.fillRect(sx + 16, sy + 28, 3, 2);
    // 太い尻尾
    ctx.fillStyle = col;
    ctx.fillRect(sx + 22, sy + 17, 5, 4);
    ctx.fillRect(sx + 26, sy + 15, 4, 3);
  }

  // --- 3. コンドル (Condor) ---
  private static drawCondor(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // シアン
    // 頭部 & 鋭いくちばし
    ctx.fillRect(sx + 13, sy + 4, 6, 6);
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 10, sy + 6, 4, 3); // くちばし
    // 目
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 14, sy + 5, 2, 2);

    // 左右に大きく広げた翼
    ctx.fillStyle = col;
    // 左翼
    ctx.fillRect(sx + 3, sy + 8, 10, 5);
    ctx.fillRect(sx + 1, sy + 12, 8, 4);
    ctx.fillRect(sx + 2, sy + 16, 5, 5);
    // 右翼
    ctx.fillRect(sx + 19, sy + 8, 10, 5);
    ctx.fillRect(sx + 23, sy + 12, 8, 4);
    ctx.fillRect(sx + 25, sy + 16, 5, 5);

    // 胴体
    ctx.fillRect(sx + 13, sy + 10, 6, 12);
    // 尾羽
    ctx.fillRect(sx + 12, sy + 22, 8, 5);
    // 鋭い脚爪
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 11, sy + 26, 3, 4);
    ctx.fillRect(sx + 18, sy + 26, 3, 4);
  }

  // --- 4. バグ (Bug) ---
  private static drawBug(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 緑
    // 2本の触角
    ctx.fillRect(sx + 10, sy + 2, 2, 5);
    ctx.fillRect(sx + 8, sy + 1, 3, 2);
    ctx.fillRect(sx + 20, sy + 2, 2, 5);
    ctx.fillRect(sx + 21, sy + 1, 3, 2);

    // 頭部
    ctx.fillRect(sx + 11, sy + 6, 10, 5);
    // 赤い複眼
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 9, sy + 7, 3, 3);
    ctx.fillRect(sx + 20, sy + 7, 3, 3);

    // 甲殻の胴体
    ctx.fillStyle = col;
    ctx.fillRect(sx + 8, sy + 11, 16, 13);
    // 背中の分割線 (甲虫の羽)
    ctx.fillStyle = '#003300';
    ctx.fillRect(sx + 15, sy + 12, 2, 11);
    ctx.fillRect(sx + 9, sy + 16, 14, 2);

    // 左右の脚（各3本）
    ctx.fillStyle = col;
    // 左脚
    ctx.fillRect(sx + 4, sy + 11, 5, 2);
    ctx.fillRect(sx + 3, sy + 16, 6, 2);
    ctx.fillRect(sx + 4, sy + 21, 5, 3);
    // 右脚
    ctx.fillRect(sx + 23, sy + 11, 5, 2);
    ctx.fillRect(sx + 23, sy + 16, 6, 2);
    ctx.fillRect(sx + 23, sy + 21, 5, 3);
  }

  // --- 5. モンスティル (Monstir) ---
  private static drawMonstir(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 緑
    // 奇怪な頭部
    ctx.fillRect(sx + 8, sy + 4, 16, 12);
    // 牙と大きな口
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 10, sy + 10, 12, 5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 11, sy + 10, 2, 3); // 上牙
    ctx.fillRect(sx + 15, sy + 10, 2, 3);
    ctx.fillRect(sx + 19, sy + 10, 2, 3);
    ctx.fillRect(sx + 13, sy + 12, 2, 3); // 下牙
    ctx.fillRect(sx + 17, sy + 12, 2, 3);

    // 壺を盗む伸びる鉤爪（手）
    ctx.fillStyle = col;
    ctx.fillRect(sx + 2, sy + 12, 7, 3);
    ctx.fillRect(sx + 2, sy + 8, 3, 5);
    ctx.fillRect(sx + 23, sy + 14, 7, 3);
    ctx.fillRect(sx + 27, sy + 12, 3, 5);

    // 胴体 & 短い足
    ctx.fillRect(sx + 9, sy + 16, 14, 9);
    ctx.fillRect(sx + 8, sy + 25, 5, 4);
    ctx.fillRect(sx + 19, sy + 25, 5, 4);
  }

  // --- 6. フット (Foot) ---
  private static drawFoot(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 緑
    // 太い足首（上部からまっすぐ降りる）
    ctx.fillRect(sx + 14, sy + 3, 10, 14);

    // 踵（かかと）
    ctx.fillRect(sx + 19, sy + 16, 7, 9);

    // 甲（足の甲）
    ctx.fillRect(sx + 8, sy + 17, 14, 8);

    // つま先・足指（左に向かって突き出ている）
    ctx.fillRect(sx + 3, sy + 21, 8, 6);
    // 指の爪ハイライト
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 3, sy + 24, 2, 2);
    ctx.fillRect(sx + 6, sy + 24, 2, 2);

    // 足首の腱・ハイライト
    ctx.fillStyle = '#aaffaa';
    ctx.fillRect(sx + 15, sy + 5, 2, 10);
    // 底面シャドウ
    ctx.fillStyle = '#004400';
    ctx.fillRect(sx + 4, sy + 27, 21, 2);
  }

  // --- 7. アイズ (Eyes) ---
  private static drawEyes(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 黄
    // メインの球体ボディ
    ctx.fillRect(sx + 7, sy + 7, 18, 16);
    ctx.fillRect(sx + 9, sy + 5, 14, 20);

    // 巨大な中央の目
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 11, sy + 9, 10, 8);
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 14, sy + 11, 4, 4);
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 15, sy + 12, 2, 2);

    // 周囲の小さな目玉（4個）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 8, sy + 6, 3, 3);
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 9, sy + 7, 1, 1);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 21, sy + 7, 3, 3);
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 22, sy + 8, 1, 1);

    // 下部の触手
    ctx.fillStyle = col;
    ctx.fillRect(sx + 8, sy + 24, 3, 5);
    ctx.fillRect(sx + 14, sy + 25, 4, 5);
    ctx.fillRect(sx + 21, sy + 24, 3, 5);
  }

  // --- 8. タモリ (Tamori) ---
  private static drawTamori(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    // 髪型（オールバック黒髪）
    ctx.fillStyle = '#222222';
    ctx.fillRect(sx + 9, sy + 3, 14, 6);
    ctx.fillRect(sx + 7, sy + 6, 18, 3);

    // 肌色（顔）
    ctx.fillStyle = col; // 黄
    ctx.fillRect(sx + 8, sy + 8, 16, 9);

    // トレードマークのサングラス（真っ黒で角ばったフレーム）
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 9, sy + 10, 6, 4);
    ctx.fillRect(sx + 17, sy + 10, 6, 4);
    ctx.fillRect(sx + 15, sy + 11, 2, 2); // ブリッジ
    // レンズの白反射光
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 10, sy + 10, 2, 1);
    ctx.fillRect(sx + 18, sy + 10, 2, 1);

    // 口（にやりとした笑顔）
    ctx.fillStyle = '#883300';
    ctx.fillRect(sx + 12, sy + 15, 8, 2);

    // スーツの襟 & 胴体
    ctx.fillStyle = '#ffffff'; // 白シャツ
    ctx.fillRect(sx + 13, sy + 17, 6, 5);
    ctx.fillStyle = '#333333'; // 黒ジャケット
    ctx.fillRect(sx + 7, sy + 18, 6, 8);
    ctx.fillRect(sx + 19, sy + 18, 6, 8);
    // ネクタイ
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 15, sy + 18, 2, 5);
    // 脚
    ctx.fillStyle = '#222222';
    ctx.fillRect(sx + 10, sy + 26, 4, 5);
    ctx.fillRect(sx + 18, sy + 26, 4, 5);
  }

  // --- 9. ドラ (Dora) ---
  private static drawDora(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 赤
    // 丸い頭部
    ctx.fillRect(sx + 8, sy + 4, 16, 14);
    ctx.fillRect(sx + 6, sy + 6, 20, 10);

    // 白い顔（お腹と共通の丸）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 9, sy + 9, 14, 8);

    // 白い大きな目
    ctx.fillRect(sx + 11, sy + 5, 5, 5);
    ctx.fillRect(sx + 16, sy + 5, 5, 5);
    // 黒目
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 13, sy + 7, 2, 2);
    ctx.fillRect(sx + 17, sy + 7, 2, 2);
    // 赤い鼻
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 15, sy + 9, 2, 2);

    // 首輪 & 鈴
    ctx.fillStyle = '#880000';
    ctx.fillRect(sx + 8, sy + 18, 16, 2);
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 14, sy + 18, 4, 3); // 黄色い鈴

    // 胴体 & 丸い手
    ctx.fillStyle = col;
    ctx.fillRect(sx + 9, sy + 20, 14, 8);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 6, sy + 20, 3, 3);  // 左手（丸）
    ctx.fillRect(sx + 23, sy + 20, 3, 3); // 右手（丸）
    // 足
    ctx.fillRect(sx + 9, sy + 28, 6, 2);
    ctx.fillRect(sx + 17, sy + 28, 6, 2);
  }

  // --- 10. リッチ (Rich) ---
  private static drawRich(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    // フード付きローブ（黄/金）
    ctx.fillStyle = col;
    ctx.fillRect(sx + 9, sy + 3, 14, 10);
    // 闇の顔の隙間
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 11, sy + 6, 10, 6);
    // 不気味に光る赤い眼光
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 13, sy + 8, 2, 2);
    ctx.fillRect(sx + 17, sy + 8, 2, 2);

    // ローブ胴体
    ctx.fillStyle = col;
    ctx.fillRect(sx + 8, sy + 13, 16, 14);
    ctx.fillRect(sx + 7, sy + 24, 18, 4);

    // 骸骨の右手と魔道杖
    ctx.fillStyle = '#ffffff'; // 骨の手
    ctx.fillRect(sx + 6, sy + 15, 3, 3);
    // 杖（右手に持っている）
    ctx.fillStyle = '#884400';
    ctx.fillRect(sx + 4, sy + 6, 2, 22);
    // 杖の頭の宝玉（妖しく輝くマゼンタ）
    ctx.fillStyle = PALETTE.MAGENTA;
    ctx.fillRect(sx + 2, sy + 4, 6, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 4, sy + 5, 2, 2);
  }

  // --- 11. ヴァンパイア (Vampire) ---
  private static drawVampire(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    // 尖った耳 & 髪
    ctx.fillStyle = '#220022';
    ctx.fillRect(sx + 10, sy + 3, 12, 5);
    ctx.fillRect(sx + 8, sy + 2, 3, 4);
    ctx.fillRect(sx + 21, sy + 2, 3, 4);

    // 白い青白い顔
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 10, sy + 7, 12, 7);
    // 赤い目
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 12, sy + 9, 2, 2);
    ctx.fillRect(sx + 18, sy + 9, 2, 2);
    // 牙
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 13, sy + 13, 1, 2);
    ctx.fillRect(sx + 18, sy + 13, 1, 2);

    // マゼンタのマント（大きく翼のように広げている）
    ctx.fillStyle = col;
    ctx.fillRect(sx + 4, sy + 12, 6, 14);
    ctx.fillRect(sx + 2, sy + 14, 3, 10);
    ctx.fillRect(sx + 22, sy + 12, 6, 14);
    ctx.fillRect(sx + 27, sy + 14, 3, 10);

    // 黒いタキシード胴体
    ctx.fillStyle = '#111111';
    ctx.fillRect(sx + 11, sy + 14, 10, 10);
    // 赤いクラバット（タイ）
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 14, sy + 14, 4, 4);
    // 足
    ctx.fillStyle = '#111111';
    ctx.fillRect(sx + 12, sy + 25, 3, 5);
    ctx.fillRect(sx + 17, sy + 25, 3, 5);
  }

  // --- 12. ニコ (Niko) ---
  private static drawNiko(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // マゼンタ
    // 巨大な真ん丸フェイス
    ctx.fillRect(sx + 8, sy + 4, 16, 22);
    ctx.fillRect(sx + 5, sy + 7, 22, 16);
    ctx.fillRect(sx + 4, sy + 9, 24, 12);

    // 黒い丸目
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 9, sy + 10, 4, 5);
    ctx.fillRect(sx + 19, sy + 10, 4, 5);

    // 大きなスマイルの口（三日月形）
    ctx.fillRect(sx + 8, sy + 18, 2, 2);
    ctx.fillRect(sx + 22, sy + 18, 2, 2);
    ctx.fillRect(sx + 9, sy + 20, 3, 2);
    ctx.fillRect(sx + 20, sy + 20, 3, 2);
    ctx.fillRect(sx + 11, sy + 22, 10, 2);

    // 白いハイライト
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 7, sy + 6, 4, 3);
  }

  // --- 13. ナイト (Knight) ---
  private static drawKnight(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // シアン
    // 西洋兜（スリットバイザー）
    ctx.fillRect(sx + 11, sy + 4, 10, 9);
    ctx.fillStyle = '#000000'; // バイザーの隙間
    ctx.fillRect(sx + 12, sy + 8, 8, 2);
    // 兜のトサカ飾り
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 14, sy + 1, 4, 4);

    // 甲冑ボディ & 肩当て
    ctx.fillStyle = col;
    ctx.fillRect(sx + 10, sy + 13, 12, 10);
    ctx.fillRect(sx + 7, sy + 13, 4, 4);  // 左肩
    ctx.fillRect(sx + 21, sy + 13, 4, 4); // 右肩

    // 剣（右手に直立）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 24, sy + 5, 2, 16);
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 22, sy + 17, 6, 2); // 鍔

    // 盾（左手に装備）
    ctx.fillStyle = PALETTE.BLUE;
    ctx.fillRect(sx + 5, sy + 15, 6, 9);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 7, sy + 16, 2, 7); // 盾の十字紋章
    ctx.fillRect(sx + 6, sy + 18, 4, 2);

    // 足（鉄甲靴）
    ctx.fillStyle = col;
    ctx.fillRect(sx + 11, sy + 24, 4, 6);
    ctx.fillRect(sx + 17, sy + 24, 4, 6);
  }

  // --- 14. ペン (Pen) ---
  private static drawPen(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // シアン（ペンギンの背中・頭）
    ctx.fillRect(sx + 10, sy + 4, 12, 12);
    ctx.fillRect(sx + 8, sy + 11, 16, 14);

    // お腹（真っ白）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 11, sy + 12, 10, 12);

    // 目
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 12, sy + 7, 2, 2);
    ctx.fillRect(sx + 18, sy + 7, 2, 2);

    // 黄色いくちばし
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 14, sy + 9, 4, 3);

    // 短い翼（フリッパー）
    ctx.fillStyle = col;
    ctx.fillRect(sx + 5, sy + 14, 4, 8);
    ctx.fillRect(sx + 23, sy + 14, 4, 8);

    // 黄色い足
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 9, sy + 26, 5, 3);
    ctx.fillRect(sx + 18, sy + 26, 5, 3);
  }

  // --- 15. レンジ (Renge) ---
  private static drawRenge(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 白
    // 角ばったブロック/スプーン形状の本体
    ctx.fillRect(sx + 6, sy + 8, 20, 16);

    // 内側の凹み構造
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(sx + 9, sy + 11, 14, 10);
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 11, sy + 13, 10, 6);

    // 操作パネル / メカニカルな目盛り
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 21, sy + 10, 2, 3);
    ctx.fillStyle = PALETTE.GREEN;
    ctx.fillRect(sx + 21, sy + 14, 2, 3);

    // 持ち手 / レバー
    ctx.fillStyle = col;
    ctx.fillRect(sx + 13, sy + 3, 6, 5);
    ctx.fillStyle = '#888888';
    ctx.fillRect(sx + 14, sy + 4, 4, 2);

    // 底部の脚
    ctx.fillStyle = '#888888';
    ctx.fillRect(sx + 8, sy + 25, 4, 4);
    ctx.fillRect(sx + 20, sy + 25, 4, 4);
  }

  // --- 16. フラン (Flanc) ---
  private static drawFlanc(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 緑
    // 四角い頭（平らな額）
    ctx.fillRect(sx + 9, sy + 4, 14, 12);
    // 黒髪
    ctx.fillStyle = '#111111';
    ctx.fillRect(sx + 9, sy + 3, 14, 4);
    ctx.fillRect(sx + 9, sy + 6, 2, 2);
    ctx.fillRect(sx + 14, sy + 6, 2, 2);
    ctx.fillRect(sx + 19, sy + 6, 2, 2);

    // 首の金属ボルト
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(sx + 6, sy + 12, 3, 3);
    ctx.fillRect(sx + 23, sy + 12, 3, 3);

    // 虚ろな目 & 傷跡
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 11, sy + 8, 3, 2);
    ctx.fillRect(sx + 17, sy + 8, 3, 2);
    // 額の縫い目
    ctx.fillStyle = '#440000';
    ctx.fillRect(sx + 14, sy + 5, 4, 1);
    ctx.fillRect(sx + 15, sy + 4, 1, 3);

    // ボロい上着 & 巨体
    ctx.fillStyle = '#332211';
    ctx.fillRect(sx + 7, sy + 16, 18, 10);
    // 太い腕
    ctx.fillStyle = col;
    ctx.fillRect(sx + 5, sy + 17, 3, 8);
    ctx.fillRect(sx + 24, sy + 17, 3, 8);
    // 太い脚
    ctx.fillStyle = '#222222';
    ctx.fillRect(sx + 10, sy + 26, 4, 5);
    ctx.fillRect(sx + 18, sy + 26, 4, 5);
  }

  // --- 17. カンガルー (Cangaru) ---
  private static drawCangaru(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 黄
    // 長い耳（2本）
    ctx.fillRect(sx + 10, sy + 2, 3, 6);
    ctx.fillRect(sx + 15, sy + 1, 3, 7);

    // 頭部 & 突き出た鼻
    ctx.fillRect(sx + 9, sy + 7, 10, 6);
    ctx.fillRect(sx + 7, sy + 8, 3, 3); // 鼻
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 6, sy + 8, 2, 2); // 鼻先
    ctx.fillRect(sx + 12, sy + 8, 2, 2); // 目

    // 胴体 & 育児嚢（お腹の袋）
    ctx.fillStyle = col;
    ctx.fillRect(sx + 10, sy + 13, 11, 10);
    ctx.fillStyle = '#ddaa00';
    ctx.fillRect(sx + 9, sy + 16, 5, 6);

    // ボクシングのような短い前足
    ctx.fillStyle = PALETTE.RED; // 赤いグローブ風
    ctx.fillRect(sx + 6, sy + 14, 4, 3);
    ctx.fillRect(sx + 6, sy + 17, 3, 3);

    // 太い跳躍後脚
    ctx.fillStyle = col;
    ctx.fillRect(sx + 11, sy + 22, 6, 6);
    ctx.fillRect(sx + 8, sy + 27, 8, 3);

    // 太い支え尻尾
    ctx.fillRect(sx + 20, sy + 18, 5, 5);
    ctx.fillRect(sx + 24, sy + 22, 5, 4);
    ctx.fillRect(sx + 27, sy + 25, 3, 3);
  }

  // --- 18. サウヘッド (Sauhead) ---
  private static drawSauhead(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 赤
    // 巨大な恐竜の頭部（画面の大部分を占める凶悪な顎）
    ctx.fillRect(sx + 6, sy + 4, 20, 12);
    ctx.fillRect(sx + 3, sy + 8, 7, 8); // 突き出た上顎

    // 狂気を感じる黄色い目
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 16, sy + 6, 4, 4);
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 17, sy + 7, 2, 3);

    // 大きく開いた口
    ctx.fillStyle = '#440000';
    ctx.fillRect(sx + 4, sy + 14, 18, 5);

    // 鋭く並ぶ白い牙
    ctx.fillStyle = '#ffffff';
    // 上牙
    ctx.fillRect(sx + 5, sy + 13, 2, 3);
    ctx.fillRect(sx + 9, sy + 13, 2, 3);
    ctx.fillRect(sx + 13, sy + 13, 2, 3);
    ctx.fillRect(sx + 17, sy + 13, 2, 3);
    // 下顎
    ctx.fillStyle = col;
    ctx.fillRect(sx + 5, sy + 19, 18, 6);
    // 下牙
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 7, sy + 18, 2, 3);
    ctx.fillRect(sx + 11, sy + 18, 2, 3);
    ctx.fillRect(sx + 15, sy + 18, 2, 3);

    // 首筋
    ctx.fillStyle = '#880000';
    ctx.fillRect(sx + 17, sy + 24, 8, 5);
  }

  // --- 19. グラスマン (Grassman) ---
  private static drawGrassman(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 緑
    // 全身を覆うモサモサの葉・草のシルエット
    ctx.fillRect(sx + 7, sy + 4, 18, 22);
    ctx.fillRect(sx + 5, sy + 8, 22, 14);

    // 草の毛先突起（ギザギザ）
    ctx.fillRect(sx + 4, sy + 5, 3, 3);
    ctx.fillRect(sx + 14, sy + 1, 4, 4);
    ctx.fillRect(sx + 24, sy + 5, 3, 3);
    ctx.fillRect(sx + 3, sy + 15, 3, 4);
    ctx.fillRect(sx + 26, sy + 15, 3, 4);

    // 草の陰影テクスチャ
    ctx.fillStyle = '#005500';
    ctx.fillRect(sx + 8, sy + 10, 4, 4);
    ctx.fillRect(sx + 19, sy + 12, 4, 4);
    ctx.fillRect(sx + 13, sy + 18, 5, 4);

    // 茂みの中から光る黄色い双眸
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 10, sy + 9, 3, 3);
    ctx.fillRect(sx + 18, sy + 9, 3, 3);
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 11, sy + 10, 1, 1);
    ctx.fillRect(sx + 19, sy + 10, 1, 1);

    // 草の足
    ctx.fillStyle = col;
    ctx.fillRect(sx + 8, sy + 25, 5, 5);
    ctx.fillRect(sx + 18, sy + 25, 5, 5);
  }

  // --- 20. ゴブリン (Goblin) ---
  private static drawGoblin(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 緑
    // 尖った長い耳
    ctx.fillRect(sx + 5, sy + 5, 4, 3);
    ctx.fillRect(sx + 3, sy + 4, 3, 2);
    ctx.fillRect(sx + 22, sy + 5, 4, 3);
    ctx.fillRect(sx + 25, sy + 4, 3, 2);

    // 頭部
    ctx.fillRect(sx + 9, sy + 5, 13, 10);
    // 邪悪な赤い目
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 11, sy + 8, 2, 2);
    ctx.fillRect(sx + 17, sy + 8, 2, 2);
    // 突き出た下牙
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 12, sy + 12, 2, 2);
    ctx.fillRect(sx + 16, sy + 12, 2, 2);

    // 革の鎧 & 胴体
    ctx.fillStyle = '#664422';
    ctx.fillRect(sx + 9, sy + 15, 12, 8);
    // 棍棒（右手に掲げている）
    ctx.fillStyle = '#885522';
    ctx.fillRect(sx + 22, sy + 9, 4, 12);
    ctx.fillRect(sx + 21, sy + 7, 6, 4); // 棍棒の先端コブ

    // 短い脚
    ctx.fillStyle = col;
    ctx.fillRect(sx + 10, sy + 23, 4, 6);
    ctx.fillRect(sx + 16, sy + 23, 4, 6);
  }

  // --- 21. クラウンロード (Crownload) ---
  private static drawCrownload(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    // 黄金の王冠（3つの突起と宝石）
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 9, sy + 2, 14, 6);
    ctx.fillStyle = '#000000'; // 王冠の谷間
    ctx.fillRect(sx + 12, sy + 2, 2, 3);
    ctx.fillRect(sx + 17, sy + 2, 2, 3);
    // 王冠のルビー
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 15, sy + 5, 2, 2);

    // 顔
    ctx.fillStyle = col; // 黄
    ctx.fillRect(sx + 10, sy + 8, 12, 8);
    ctx.fillStyle = '#000000'; // 目
    ctx.fillRect(sx + 12, sy + 10, 2, 2);
    ctx.fillRect(sx + 17, sy + 10, 2, 2);
    // 髭
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 11, sy + 14, 10, 3);

    // 豪華な王族マント（赤と白毛皮）
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 7, sy + 16, 18, 11);
    ctx.fillStyle = '#ffffff'; // 襟元の白ミンク
    ctx.fillRect(sx + 9, sy + 16, 14, 3);
    ctx.fillRect(sx + 14, sy + 19, 4, 8);

    // 黄金の笏（しゃく）
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 5, sy + 14, 2, 12);
    ctx.fillRect(sx + 4, sy + 12, 4, 3);

    // 脚
    ctx.fillStyle = '#331111';
    ctx.fillRect(sx + 11, sy + 27, 3, 3);
    ctx.fillRect(sx + 17, sy + 27, 3, 3);
  }

  // --- 22. ティン (Tin) ---
  private static drawTin(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // シアン（ブリキ色）
    // 煙突のような頭部アンテナ/漏斗
    ctx.fillRect(sx + 15, sy + 2, 2, 5);
    ctx.fillRect(sx + 13, sy + 2, 6, 2);

    // 角ばったブリキ頭
    ctx.fillRect(sx + 9, sy + 7, 14, 10);
    // 丸いリベット目
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 11, sy + 10, 3, 3);
    ctx.fillRect(sx + 17, sy + 10, 3, 3);
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 12, sy + 11, 1, 1);
    ctx.fillRect(sx + 18, sy + 11, 1, 1);
    // ブリキの継ぎ目口
    ctx.fillStyle = '#003344';
    ctx.fillRect(sx + 12, sy + 14, 7, 1);

    // 円筒形のドラム胴体
    ctx.fillStyle = col;
    ctx.fillRect(sx + 8, sy + 17, 16, 9);
    // 胴体のリベット鋲
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 10, sy + 19, 2, 2);
    ctx.fillRect(sx + 20, sy + 19, 2, 2);
    ctx.fillRect(sx + 15, sy + 22, 2, 2);

    // じゃばらの腕
    ctx.fillStyle = col;
    ctx.fillRect(sx + 5, sy + 18, 3, 6);
    ctx.fillRect(sx + 24, sy + 18, 3, 6);

    // 円筒の脚
    ctx.fillRect(sx + 10, sy + 26, 4, 5);
    ctx.fillRect(sx + 18, sy + 26, 4, 5);
  }

  // --- 23. オーガ (Ogre) ---
  private static drawOgre(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 赤
    // 2本の角
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 8, sy + 2, 3, 5);
    ctx.fillRect(sx + 21, sy + 2, 3, 5);

    // 筋骨隆々の頭部
    ctx.fillStyle = col;
    ctx.fillRect(sx + 9, sy + 6, 14, 10);
    // 怒り狂う黄色い目
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 11, sy + 9, 3, 2);
    ctx.fillRect(sx + 18, sy + 9, 3, 2);
    // 鋭い牙
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 12, sy + 13, 2, 3);
    ctx.fillRect(sx + 17, sy + 13, 2, 3);

    // 巨大な逆三角形の筋肉胴体
    ctx.fillStyle = col;
    ctx.fillRect(sx + 6, sy + 16, 20, 7);
    ctx.fillRect(sx + 8, sy + 22, 16, 3);

    // 虎皮の腰布
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 9, sy + 23, 14, 4);
    ctx.fillStyle = '#000000'; // 虎柄縞模様
    ctx.fillRect(sx + 11, sy + 24, 2, 2);
    ctx.fillRect(sx + 16, sy + 24, 2, 2);

    // 丸太のような腕
    ctx.fillStyle = col;
    ctx.fillRect(sx + 3, sy + 16, 4, 9);
    ctx.fillRect(sx + 25, sy + 16, 4, 9);

    // 太い足
    ctx.fillRect(sx + 9, sy + 26, 5, 5);
    ctx.fillRect(sx + 18, sy + 26, 5, 5);
  }

  // --- 24. スネーク (Snake) ---
  private static drawSnake(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 緑
    // 鎌首をもたげた蛇の頭
    ctx.fillRect(sx + 14, sy + 4, 12, 7);
    ctx.fillRect(sx + 23, sy + 6, 4, 4); // 突き出た鼻

    // 蛇の縦長スリット目
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 19, sy + 5, 3, 3);
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 20, sy + 5, 1, 3);

    // チロチロ出る赤い二股の舌
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 27, sy + 8, 3, 1);
    ctx.fillRect(sx + 29, sy + 7, 2, 1);
    ctx.fillRect(sx + 29, sy + 9, 2, 1);

    // くねる首
    ctx.fillStyle = col;
    ctx.fillRect(sx + 13, sy + 10, 6, 8);

    // とぐろを巻く太い胴体（ループ状）
    ctx.fillRect(sx + 6, sy + 16, 19, 6);
    ctx.fillRect(sx + 4, sy + 20, 24, 7);
    ctx.fillRect(sx + 5, sy + 26, 21, 3);

    // 蛇の腹側の黄色い蛇腹
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 14, sy + 11, 2, 6);
    ctx.fillRect(sx + 8, sy + 22, 16, 2);

    // 尾の先端
    ctx.fillStyle = col;
    ctx.fillRect(sx + 24, sy + 17, 4, 4);
  }

  // --- 25. ディアイ (Deye) ---
  private static drawDeye(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 黄（外皮/まぶた）
    // 巨大な横長の邪眼まぶた
    ctx.fillRect(sx + 4, sy + 8, 24, 16);
    ctx.fillRect(sx + 7, sy + 5, 18, 22);

    // 白目
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 6, sy + 10, 20, 12);

    // 血走った血管
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 7, sy + 11, 4, 1);
    ctx.fillRect(sx + 21, sy + 18, 4, 1);
    ctx.fillRect(sx + 8, sy + 19, 3, 1);

    // 邪悪な瞳孔（黒＋中央に赤）
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 12, sy + 11, 8, 10);
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 14, sy + 13, 4, 6);
    ctx.fillStyle = '#ffffff'; // ハイライト
    ctx.fillRect(sx + 14, sy + 13, 2, 2);

    // まぶた周囲の触手/トゲ
    ctx.fillStyle = col;
    ctx.fillRect(sx + 2, sy + 14, 3, 4);
    ctx.fillRect(sx + 27, sy + 14, 3, 4);
    ctx.fillRect(sx + 14, sy + 2, 4, 4);
    ctx.fillRect(sx + 14, sy + 26, 4, 4);
  }

  // --- 26. ブック (Book) ---
  private static drawBook(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    // 開かれた革表紙（マゼンタ）
    ctx.fillStyle = col;
    ctx.fillRect(sx + 4, sy + 6, 24, 19);

    // 羊皮紙ページ（左右に開く）
    ctx.fillStyle = '#fffcee';
    ctx.fillRect(sx + 5, sy + 7, 10, 16);
    ctx.fillRect(sx + 17, sy + 7, 10, 16);

    // 本の背表紙中央ライン
    ctx.fillStyle = '#330033';
    ctx.fillRect(sx + 15, sy + 6, 2, 19);

    // 魔導書の呪文文字ライン（古代文字ルーン）
    ctx.fillStyle = '#665544';
    // 左ページ
    ctx.fillRect(sx + 7, sy + 10, 6, 1);
    ctx.fillRect(sx + 7, sy + 13, 6, 1);
    ctx.fillRect(sx + 7, sy + 16, 5, 1);
    ctx.fillRect(sx + 7, sy + 19, 6, 1);
    // 右ページ（魔法陣シンボル）
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 20, sy + 10, 4, 4);
    ctx.fillStyle = '#665544';
    ctx.fillRect(sx + 19, sy + 16, 6, 1);
    ctx.fillRect(sx + 19, sy + 19, 5, 1);

    // 空中に浮かぶ魔力オーラ粒子
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 8, sy + 3, 2, 2);
    ctx.fillRect(sx + 22, sy + 3, 2, 2);
  }

  // --- 27. ノコノコ (Nokonoko) ---
  private static drawNokonoko(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 緑（甲羅）
    // 丸みを帯びた亀の甲羅
    ctx.fillRect(sx + 8, sy + 8, 16, 15);
    ctx.fillRect(sx + 10, sy + 6, 12, 19);

    // 甲羅のフチ（白）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 7, sy + 20, 18, 3);

    // 甲羅の六角形模様（黄色）
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 13, sy + 10, 6, 5);
    ctx.fillRect(sx + 10, sy + 15, 5, 4);
    ctx.fillRect(sx + 17, sy + 15, 5, 4);

    // 首と頭（左側からひょっこり出ている）
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 4, sy + 8, 6, 6);
    // 目
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 5, sy + 9, 2, 2);

    // 手足（4本）
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 8, sy + 22, 4, 5);
    ctx.fillRect(sx + 19, sy + 22, 4, 5);
  }

  // --- 28. サイクロプス (Cyclops) ---
  private static drawCyclops(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 赤（巨人の筋肉肌）
    // 頭部
    ctx.fillRect(sx + 8, sy + 5, 16, 11);

    // 頭頂の単角
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 15, sy + 1, 3, 5);

    // 中央の大きな単眼（サイクロプス）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 12, sy + 8, 8, 6);
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 14, sy + 9, 4, 4);
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 15, sy + 10, 2, 2);

    // 凶暴な口
    ctx.fillStyle = '#440000';
    ctx.fillRect(sx + 12, sy + 14, 8, 2);

    // 巨体の胴体
    ctx.fillStyle = col;
    ctx.fillRect(sx + 7, sy + 16, 18, 9);
    // 肩と腕
    ctx.fillRect(sx + 4, sy + 17, 4, 8);
    ctx.fillRect(sx + 24, sy + 17, 4, 8);

    // 脚
    ctx.fillRect(sx + 9, sy + 25, 5, 6);
    ctx.fillRect(sx + 18, sy + 25, 5, 6);
  }

  // --- 29. ビースト (Beast) ---
  private static drawBeast(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 赤
    // 狼/野獣の頭部
    ctx.fillRect(sx + 6, sy + 6, 12, 10);
    // 尖った耳
    ctx.fillRect(sx + 12, sy + 2, 3, 5);
    ctx.fillRect(sx + 16, sy + 3, 3, 4);

    // 突き出た鼻先
    ctx.fillRect(sx + 3, sy + 9, 4, 5);
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 2, sy + 9, 2, 2); // 鼻

    // ギラつく黄色い目
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 8, sy + 8, 3, 2);

    // 鋭い牙
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 5, sy + 13, 2, 2);

    // 野獣の四足胴体
    ctx.fillStyle = col;
    ctx.fillRect(sx + 10, sy + 12, 16, 10);
    // 背中のたてがみ
    ctx.fillStyle = '#880000';
    ctx.fillRect(sx + 13, sy + 9, 10, 3);

    // 前脚・後脚
    ctx.fillStyle = col;
    ctx.fillRect(sx + 8, sy + 21, 4, 8);
    ctx.fillRect(sx + 21, sy + 21, 4, 8);
    // 爪
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 6, sy + 27, 3, 2);
    ctx.fillRect(sx + 19, sy + 27, 3, 2);

    // 尻尾
    ctx.fillRect(sx + 25, sy + 13, 4, 4);
    ctx.fillRect(sx + 28, sy + 10, 3, 4);
  }

  // --- 30. ロボ (Robo) ---
  private static drawRobo(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // シアン
    // アンテナ
    ctx.fillRect(sx + 15, sy + 2, 2, 4);
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 14, sy + 1, 4, 2); // アンテナ球

    // 角ばったロボット頭
    ctx.fillStyle = col;
    ctx.fillRect(sx + 9, sy + 6, 14, 9);
    // デジタルバイザーアイ（横長に光る黄色）
    ctx.fillStyle = PALETTE.YELLOW;
    ctx.fillRect(sx + 11, sy + 9, 10, 3);
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + 13, sy + 10, 2, 1);
    ctx.fillRect(sx + 17, sy + 10, 2, 1);

    // スクエア胴体
    ctx.fillStyle = col;
    ctx.fillRect(sx + 8, sy + 16, 16, 9);
    // 胸のメーター/コア
    ctx.fillStyle = PALETTE.GREEN;
    ctx.fillRect(sx + 12, sy + 18, 8, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 14, sy + 19, 4, 2);

    // ロボットアーム（直角ハンド）
    ctx.fillStyle = col;
    ctx.fillRect(sx + 5, sy + 17, 3, 7);
    ctx.fillRect(sx + 24, sy + 17, 3, 7);

    // キャタピラ/ローラー足
    ctx.fillStyle = '#334455';
    ctx.fillRect(sx + 8, sy + 25, 16, 5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 10, sy + 27, 3, 2);
    ctx.fillRect(sx + 15, sy + 27, 3, 2);
    ctx.fillRect(sx + 20, sy + 27, 3, 2);
  }

  // --- 31. ラビット (Rabbit) ---
  private static drawRabbit(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    ctx.fillStyle = col; // 白
    // 長いウサギの耳（2本）
    ctx.fillRect(sx + 9, sy + 1, 4, 10);
    ctx.fillRect(sx + 18, sy + 1, 4, 10);
    // 耳の内側のピンク（赤淡色）
    ctx.fillStyle = '#ffaaaa';
    ctx.fillRect(sx + 10, sy + 3, 2, 7);
    ctx.fillRect(sx + 19, sy + 3, 2, 7);

    // 丸い顔
    ctx.fillStyle = col;
    ctx.fillRect(sx + 8, sy + 9, 16, 10);

    // 赤いウサギの目
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 10, sy + 12, 3, 3);
    ctx.fillRect(sx + 18, sy + 12, 3, 3);

    // ピンクの鼻
    ctx.fillStyle = '#ff8888';
    ctx.fillRect(sx + 15, sy + 14, 2, 2);

    // 胴体 & 丸い手
    ctx.fillStyle = col;
    ctx.fillRect(sx + 9, sy + 18, 14, 8);
    ctx.fillRect(sx + 12, sy + 19, 3, 4); // 前足
    ctx.fillRect(sx + 17, sy + 19, 3, 4);

    // 丸い後脚 & 尻尾
    ctx.fillRect(sx + 8, sy + 25, 6, 4);
    ctx.fillRect(sx + 18, sy + 25, 6, 4);
    ctx.fillRect(sx + 22, sy + 20, 4, 4); // ふわふわの尻尾
  }

  // --- 32. ドッペル (Doppel) ---
  private static drawDoppel(ctx: CanvasRenderingContext2D, sx: number, sy: number, col: string): void {
    // 主人公の影（マゼンタの不気味なシルエット）
    ctx.fillStyle = col; // マゼンタ
    // 兜/髪
    ctx.fillRect(sx + 11, sy + 4, 10, 7);

    // 影の顔（闇の中に赤く鋭く光る眼光）
    ctx.fillStyle = '#220022';
    ctx.fillRect(sx + 12, sy + 8, 8, 4);
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 14, sy + 9, 2, 2);
    ctx.fillRect(sx + 17, sy + 9, 2, 2);

    // 主人公と同じ鎧・胴体（マゼンタ）
    ctx.fillStyle = col;
    ctx.fillRect(sx + 10, sy + 12, 12, 9);
    // 鎧の飾り
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 12, sy + 14, 8, 2);

    // ドッペルの魔剣（赤く禍々しい刃）
    ctx.fillStyle = PALETTE.RED;
    ctx.fillRect(sx + 23, sy + 5, 2, 14);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 21, sy + 15, 6, 2); // 鍔

    // 盾（黒紫の影の盾）
    ctx.fillStyle = '#330033';
    ctx.fillRect(sx + 5, sy + 13, 5, 9);
    ctx.fillStyle = col;
    ctx.fillRect(sx + 6, sy + 15, 3, 5);

    // 脚
    ctx.fillStyle = col;
    ctx.fillRect(sx + 11, sy + 22, 4, 7);
    ctx.fillRect(sx + 17, sy + 22, 4, 7);
  }
}
