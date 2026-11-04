import {
  MAP_VIEW_HEIGHT,
  MAP_VIEW_WIDTH,
  PLAYER_SCREEN_TILE_X,
  PLAYER_SCREEN_TILE_Y,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  TILE_SIZE,
  VIEW_TILES_X,
  VIEW_TILES_Y,
} from '../config/Constants.js';
import { Player } from '../models/Player.js';
import { WorldMap } from '../models/WorldMap.js';
import { EnemyInstance } from '../models/Enemy.js';
import { Ghost } from '../models/Ghost.js';
import { Dragon } from '../models/Dragon.js';
import { MagicType, Position, ThreatEvaluationDetails, ThreatLevel } from '../models/Types.js';
import { PaletteManager } from './PaletteManager.js';
import { TileGraphics } from './TileGraphics.js';
import { MonsterGraphics } from './MonsterGraphics.js';
import { CombatEffectManager } from './CombatEffectManager.js';
import { ThreatEvaluator } from '../systems/ThreatEvaluator.js';

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private palette: PaletteManager;
  private blinkFrame: number = 0;
  private tacticalMarkerEnabled: boolean = true;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context could not be acquired.');
    }
    this.ctx = ctx;
    this.palette = new PaletteManager();

    // アンチエイリアス無効化（ドット絵をくっきり表示）
    this.ctx.imageSmoothingEnabled = false;

    // 初回起動時に全32種モンスターおよびマップタイルのオフスクリーンスプライトシートを一括生成
    MonsterGraphics.getOrCreateSpriteSheet();
    TileGraphics.getOrCreateSpriteSheet();
  }

  public getPalette(): PaletteManager {
    return this.palette;
  }

  public setTacticalMarker(enabled: boolean): void {
    this.tacticalMarkerEnabled = enabled;
  }

  public isTacticalMarkerEnabled(): boolean {
    return this.tacticalMarkerEnabled;
  }

  public render(
    player: Player,
    map: WorldMap,
    _indicatorRatio: number,
    enemies: EnemyInstance[] = [],
    ghosts: Ghost[] = [],
    dragon?: Dragon,
    _selectedMagic?: MagicType,
    showMiniMap: boolean = false,
    combatEffects?: CombatEffectManager,
    tacticalMarkerEnabled?: boolean
  ): void {
    if (tacticalMarkerEnabled !== undefined) {
      this.tacticalMarkerEnabled = tacticalMarkerEnabled;
    }
    this.blinkFrame = (this.blinkFrame + 1) % 60;

    // パレット状態の自動更新（全首撃破時はDARK、HP<500ピンチ時はPINCH）
    const allHeadsDefeated = dragon ? dragon.isAllHeadsDefeated : false;
    this.palette.updateByPlayerHP(player.hp, allHeadsDefeated);

    // 画面クリア（純マップ 480x352 全面）
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 1. タイルマップの描画 (プレイヤー中心カメラ: 15x11タイル)
    for (let sy = 0; sy < VIEW_TILES_Y; sy++) {
      for (let sx = 0; sx < VIEW_TILES_X; sx++) {
        const worldX = player.pos.x + (sx - PLAYER_SCREEN_TILE_X);
        const worldY = player.pos.y + (sy - PLAYER_SCREEN_TILE_Y);

        const screenPixelX = sx * TILE_SIZE;
        const screenPixelY = sy * TILE_SIZE;

        const wrappedPos = map.wrapPosition({ x: worldX, y: worldY });
        let tileType = map.getTile(wrappedPos);
        if (tileType === 'BLOCK' && combatEffects?.isTileHiddenByKickAnimation(wrappedPos)) {
          tileType = map.getBaseTile(wrappedPos);
        }
        TileGraphics.drawTile(this.ctx, tileType, screenPixelX, screenPixelY, this.palette);
      }
    }

    // トーラス最短差分を用いたスクリーン座標変換ヘルパー
    const getScreenTilePos = (pos: Position) => {
      const { dx, dy } = map.getTorusDelta(player.pos, pos);
      return {
        sx: dx + PLAYER_SCREEN_TILE_X,
        sy: dy + PLAYER_SCREEN_TILE_Y,
      };
    };

    // 2. ドラゴン部位の描画
    if (dragon) {
      // 生存している首の足元タクティカルマーカー描画（マーカーON時）
      if (this.tacticalMarkerEnabled) {
        for (const head of dragon.heads) {
          if (!head.isAlive) continue;
          const { sx, sy } = getScreenTilePos(head.pos);
          if (sx >= 0 && sx < VIEW_TILES_X && sy >= 0 && sy < VIEW_TILES_Y) {
            const threatDetails = ThreatEvaluator.evaluateThreatDetails(player, head);
            this.drawTacticalMarker(sx * TILE_SIZE, sy * TILE_SIZE, threatDetails);
          }
        }
      }

      const parts = [dragon.body, ...dragon.heads, dragon.tail];
      for (const part of parts) {
        const { sx, sy } = getScreenTilePos(part.pos);
        if (sx >= 0 && sx < VIEW_TILES_X && sy >= 0 && sy < VIEW_TILES_Y) {
          const isFlickering = combatEffects ? combatEffects.isEnemyFlickering(part.type) : false;
          TileGraphics.drawDragonPart(this.ctx, part, sx * TILE_SIZE, sy * TILE_SIZE, isFlickering);
        }
      }

      // 火炎弾の描画
      for (const fb of dragon.fireballs) {
        if (!fb.isAlive) continue;
        const { sx, sy } = getScreenTilePos(fb.pos);
        if (sx >= 0 && sx < VIEW_TILES_X && sy >= 0 && sy < VIEW_TILES_Y) {
          TileGraphics.drawFireball(this.ctx, fb, sx * TILE_SIZE, sy * TILE_SIZE);
        }
      }
    }

    // 3. モンスターの描画 (画面内かつ生存している敵、呼吸ボビング＆足元シャドウ、被弾フラッシュ対応)
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    for (const enemy of enemies) {
      if (!enemy.isAlive) continue;
      const { sx, sy } = getScreenTilePos(enemy.pos);

      if (sx >= 0 && sx < VIEW_TILES_X && sy >= 0 && sy < VIEW_TILES_Y) {
        const isFlickering = combatEffects ? combatEffects.isEnemyFlickering(enemy.id) : false;
        const isFrozen = enemy.isFrozen;
        const px = sx * TILE_SIZE;
        const py = sy * TILE_SIZE;

        // 3-1. 地面の接地シャドウ / タクティカルマーカー描画
        if (this.tacticalMarkerEnabled) {
          const threatDetails = ThreatEvaluator.evaluateThreatDetails(player, enemy);
          this.drawTacticalMarker(px, py, threatDetails);
        } else if (!isFrozen) {
          this.drawEnemyShadow(px, py);
        }

        // 3-2. 生き物らしさを出すピクセルパーフェクトな上下呼吸ボビング (FREEZE凍結時は完全停止)
        const phase = (enemy.pos.x * 37 + enemy.pos.y * 17) % 100;
        const bobbingY = isFrozen ? 0 : Math.round(Math.sin((now / 180) + phase) * 1.5);

        // 3-3. モンスター本体描画（凍結時は白■背景＋静止描画）
        TileGraphics.drawEnemy(this.ctx, enemy, px, py + bobbingY, isFlickering);
      }
    }

    // 4. ゴースト（おばけ）の描画
    for (const ghost of ghosts) {
      const { sx, sy } = getScreenTilePos(ghost.pos);

      if (sx >= 0 && sx < VIEW_TILES_X && sy >= 0 && sy < VIEW_TILES_Y) {
        TileGraphics.drawGhost(this.ctx, ghost, sx * TILE_SIZE, sy * TILE_SIZE);
      }
    }

    // 4-B. 背後を追従する死神（骸骨/DEATH）の描画（十字架を持つまで背後に追従）
    if (player.hasDeath && player.deathFollowerPos) {
      const { sx, sy } = getScreenTilePos(player.deathFollowerPos);
      if (sx >= 0 && sx < VIEW_TILES_X && sy >= 0 && sy < VIEW_TILES_Y) {
        TileGraphics.drawDeathFollower(this.ctx, sx * TILE_SIZE, sy * TILE_SIZE, this.blinkFrame);
      }
    }

    // 5. プレイヤーの描画（画面中央固定: 携帯アイテム可視化・被弾点滅対応・FLY鳥変身対応）
    const playerScreenX = PLAYER_SCREEN_TILE_X * TILE_SIZE;
    const playerScreenY = PLAYER_SCREEN_TILE_Y * TILE_SIZE;
    const isPlayerHurt = combatEffects ? combatEffects.isPlayerHurtFlickering() : false;
    TileGraphics.drawPlayer(
      this.ctx,
      playerScreenX,
      playerScreenY,
      player.dir,
      player.hasSword,
      player.holdItem,
      isPlayerHurt,
      player.isFlying,
      this.blinkFrame
    );

    // 5-B. FLY魔法発動中の頭上インジケーター（残りターン数および終了間際フリッカー警告）
    if (player.isFlying) {
      const isEndingWarning = player.flyTimer <= 3;
      const showWarning = !isEndingWarning || Math.floor(this.blinkFrame / 8) % 2 === 0;

      if (showWarning) {
        this.ctx.save();
        const text = `FLY ${player.flyTimer}`;
        this.ctx.font = 'bold 11px monospace';
        const textWidth = this.ctx.measureText(text).width;
        const badgeX = playerScreenX + (TILE_SIZE - textWidth) / 2 - 4;
        const badgeY = playerScreenY - 14;

        // 背景バッジ
        this.ctx.fillStyle = isEndingWarning ? 'rgba(180, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0.75)';
        this.ctx.fillRect(badgeX, badgeY, textWidth + 8, 14);

        // 枠線
        this.ctx.strokeStyle = isEndingWarning ? '#ff4444' : '#00ffff';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(badgeX, badgeY, textWidth + 8, 14);

        // テキスト
        this.ctx.fillStyle = isEndingWarning ? '#ffff00' : '#ffffff';
        this.ctx.fillText(text, badgeX + 4, badgeY + 11);
        this.ctx.restore();
      }
    }

    // 6. バトルエフェクト（斬撃スラッシュ、被弾スパーク、ダメージ数値ポップアップ、KICKスライド）の重畳描画
    if (combatEffects) {
      combatEffects.render(this.ctx, player.pos, map, this.palette);
    }

    // 7. ミニマップ表示（MAP魔法時）
    if (showMiniMap) {
      this.drawMiniMap(map, player, dragon);
    }

    // ステータス数値やインジケーター表示は右側DOM UI層へ完全一任（Canvas内HUD描画は純化廃止）
  }

  /**
   * 全体マップ透視描画（480x352画面中央に配置）
   * 家: 白, 墓: 黄, ワープ: 水色, 宝箱: 青, 現在地: 白点滅
   */
  private drawMiniMap(map: WorldMap, player: Player, dragon?: Dragon): void {
    const scale = 3.5; // 1マス = 3.5px
    const mapW = Math.floor(map.width * scale);  // 224px
    const mapH = Math.floor(map.height * scale); // 224px
    const startX = Math.floor((MAP_VIEW_WIDTH - mapW) / 2);
    const startY = Math.floor((MAP_VIEW_HEIGHT - mapH) / 2);

    // 背景枠 (シャドウ + 外枠)
    this.ctx.fillStyle = 'rgba(5, 8, 14, 0.92)';
    this.ctx.fillRect(startX - 8, startY - 8, mapW + 16, mapH + 16);
    this.ctx.strokeStyle = '#00ffaa';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(startX - 8, startY - 8, mapW + 16, mapH + 16);

    // タイトル表示
    this.ctx.fillStyle = '#00ffaa';
    this.ctx.font = 'bold 10px monospace';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('- DUNGEON MAP (DS1ish) -', MAP_VIEW_WIDTH / 2, startY - 12);

    // マップタイル走査
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.getTile({ x, y });
        const base = map.getBaseTile({ x, y });
        const px = startX + Math.floor(x * scale);
        const py = startY + Math.floor(y * scale);
        const sz = Math.ceil(scale);

        if (tile === 'HOME' || (map.homePos.x === x && map.homePos.y === y)) {
          this.ctx.fillStyle = '#ffffff'; // 家 = 白
          this.ctx.fillRect(px, py, sz, sz);
        } else if (tile === 'GRAVE' || base === 'GRAVE') {
          this.ctx.fillStyle = '#ffff00'; // 墓 = 黄
          this.ctx.fillRect(px, py, sz, sz);
        } else if (tile === 'WARP') {
          this.ctx.fillStyle = '#00ffff'; // ワープ = 水色
          this.ctx.fillRect(px, py, sz, sz);
        } else if (tile === 'CHEST' || tile === 'CHEST_DRAGON') {
          this.ctx.fillStyle = '#3388ff'; // 宝箱 = 青
          this.ctx.fillRect(px, py, sz, sz);
        } else if (tile === 'BLOCK' || tile === 'WALL_STATIC') {
          this.ctx.fillStyle = '#222833'; // 壁 = 暗灰色
          this.ctx.fillRect(px, py, sz, sz);
        }
      }
    }

    // ドラゴン位置 (赤)
    if (dragon) {
      this.ctx.fillStyle = '#ff0044';
      const dpx = startX + Math.floor(dragon.centerPos.x * scale) - 3;
      const dpy = startY + Math.floor(dragon.centerPos.y * scale) - 3;
      this.ctx.fillRect(dpx, dpy, Math.floor(scale * 2.5), Math.floor(scale * 2.5));
    }

    // プレイヤー現在地 (白点滅)
    if (Math.floor(this.blinkFrame / 15) % 2 === 0) {
      this.ctx.fillStyle = '#ffffff';
      const ppx = startX + Math.floor(player.pos.x * scale) - 2;
      const ppy = startY + Math.floor(player.pos.y * scale) - 2;
      this.ctx.fillRect(ppx, ppy, 6, 6);
    }
  }

  /**
   * モンスターの足元接地シャドウ描画（地面の上に立っている立体感と安定感）
   */
  private drawEnemyShadow(px: number, py: number): void {
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    this.ctx.beginPath();
    // 32x32 タイルの底面中央 (x: 16, y: 28) に横長楕円
    this.ctx.ellipse(px + 16, py + 28, 9, 3, 0, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  /**
   * 攻防2軸・二重マーカー（Tactical Threat Dual Marker）の描画
   *
   * 1. 外枠リング（攻撃視点: 倒しやすさ）
   *    - ONE_SHOT (#00eeff): シアンの輝くリング
   *    - SAFE (#00dd66)    : エメラルドグリーンのリング
   *    - STALEMATE (#ffcc00): アンバーイエローのリング
   *    - DANGER (#ff2244)  : クリムゾンレッドのリング
   *    - LETHAL (#ff1133)  : 漆黒＋赤枠の警告リング
   *
   * 2. 中心コア／警告エフェクト（防御視点: 被弾・即死リスク）
   *    - NO_DAMAGE   : クリアなリング（ONE_SHOT時は安全な白発光ドット）
   *    - TAKES_DAMAGE: 内側に黄色／アンバーの警告コア（被弾・能力吸収注意）
   *    - LETHAL      : 内側に赤黒く明滅・脈動する死神コア（「一撃だが一撃」ガラスの剣リスクを直感警告）
   */
  private drawTacticalMarker(
    px: number,
    py: number,
    threatOrDetails: ThreatLevel | ThreatEvaluationDetails
  ): void {
    let threat: ThreatLevel;
    let defenseThreat: 'NO_DAMAGE' | 'TAKES_DAMAGE' | 'LETHAL';

    if (typeof threatOrDetails === 'string') {
      threat = threatOrDetails;
      defenseThreat = threat === 'LETHAL' ? 'LETHAL' : 'NO_DAMAGE';
    } else {
      threat = threatOrDetails.overallThreat;
      defenseThreat = threatOrDetails.defenseThreat;
    }

    const cx = px + 16;
    const cy = py + 28;
    const rx = 10;
    const ry = 4;

    this.ctx.save();

    // 1. 下敷きの接地黒シャドウ（立体感を担保）
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    this.ctx.fill();

    // 2. 外枠リングカラーの決定（攻撃視点 / overallThreat）
    let fillColor = 'rgba(0, 238, 255, 0.28)';
    let strokeColor = '#00eeff';
    let lineWidth = 1.5;

    switch (threat) {
      case 'ONE_SHOT':
        fillColor = 'rgba(0, 238, 255, 0.32)';
        strokeColor = '#00eeff';
        lineWidth = 1.6;
        break;
      case 'SAFE':
        fillColor = 'rgba(0, 221, 102, 0.28)';
        strokeColor = '#00dd66';
        lineWidth = 1.5;
        break;
      case 'STALEMATE':
        fillColor = 'rgba(255, 204, 0, 0.25)';
        strokeColor = '#ffcc00';
        lineWidth = 1.5;
        break;
      case 'DANGER':
        fillColor = 'rgba(255, 34, 68, 0.32)';
        strokeColor = '#ff2244';
        lineWidth = 1.6;
        break;
      case 'LETHAL': {
        const isBlink = Math.floor(this.blinkFrame / 15) % 2 === 0;
        fillColor = 'rgba(12, 12, 12, 0.9)';
        strokeColor = isBlink ? '#ff1133' : '#880011';
        lineWidth = 2.0;
        break;
      }
    }

    // 3. マーカー内部の半透明グロー
    this.ctx.fillStyle = fillColor;
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    this.ctx.fill();

    // 4. マーカー外周リング（攻撃視点）
    this.ctx.strokeStyle = strokeColor;
    this.ctx.lineWidth = lineWidth;
    this.ctx.stroke();

    // 5. 中心コア／警告エフェクト（防御視点: 被弾リスク）
    if (defenseThreat === 'LETHAL') {
      // 即死リスク（LETHAL）: 赤黒く明滅・脈動する死神コア
      // ※「一撃だが一撃（isLethalOneShot）」の場合、外枠空色＋中赤黒脈動コアで先制即死危険を可視化
      const pulse = 0.5 + 0.5 * Math.sin(this.blinkFrame * 0.2);
      const isFastBlink = Math.floor(this.blinkFrame / 8) % 2 === 0;

      // 内側の赤黒グラデーション / グロー
      this.ctx.fillStyle = isFastBlink ? 'rgba(255, 20, 40, 0.85)' : 'rgba(120, 0, 20, 0.75)';
      this.ctx.beginPath();
      this.ctx.ellipse(cx, cy, 5.5 + pulse * 1.5, 2.2 + pulse * 0.8, 0, 0, Math.PI * 2);
      this.ctx.fill();

      // 中心の漆黒コア
      this.ctx.fillStyle = '#110000';
      this.ctx.beginPath();
      this.ctx.ellipse(cx, cy, 3, 1.2, 0, 0, Math.PI * 2);
      this.ctx.fill();

      // 赤い警告死神アイ
      this.ctx.fillStyle = '#ff1133';
      this.ctx.fillRect(cx - 1, cy - 1, 2, 2);

      // 外枠LETHAL時の左右ガードドット
      if (threat === 'LETHAL') {
        this.ctx.fillRect(cx - rx + 1, cy - 1, 2, 2);
        this.ctx.fillRect(cx + rx - 3, cy - 1, 2, 2);
      }
    } else if (defenseThreat === 'TAKES_DAMAGE') {
      // 被弾リスクあり（TAKES_DAMAGE）: 内側に黄色／アンバーの警告コア
      this.ctx.fillStyle = 'rgba(255, 170, 0, 0.75)';
      this.ctx.beginPath();
      this.ctx.ellipse(cx, cy, 4.5, 1.8, 0, 0, Math.PI * 2);
      this.ctx.fill();

      // 警告アンバードット
      this.ctx.fillStyle = '#ffee44';
      this.ctx.fillRect(cx - 1, cy - 1, 2, 2);
    } else {
      // 貰わない（NO_DAMAGE）
      if (threat === 'ONE_SHOT') {
        // 安全な一撃撃破を示す純白コア
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(cx - 1, cy - 1, 2, 2);
      }
    }

    this.ctx.restore();
  }
}
