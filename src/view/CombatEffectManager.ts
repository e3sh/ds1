import { TILE_SIZE, PLAYER_SCREEN_TILE_X, PLAYER_SCREEN_TILE_Y } from '../config/Constants.js';
import { Position } from '../models/Types.js';
import { WorldMap } from '../models/WorldMap.js';
import { TileGraphics } from './TileGraphics.js';
import { PaletteManager } from './PaletteManager.js';

export interface KickSlideAnimation {
  path: Position[];
  stepDurationMs: number;
  elapsedMs: number;
  finalPos: Position;
  hitEnemyPos?: Position;
  crushed?: boolean;
  hitTriggered?: boolean;
}

export interface CombatEffect {
  id: string;
  type: 'PLAYER_ATTACK' | 'ENEMY_COUNTER' | 'ENEMY_KILL' | 'DAMAGE_POPUP';
  worldPos?: Position;
  screenPixelX?: number;
  screenPixelY?: number;
  durationMs: number;
  elapsedMs: number;
  damageValue?: number;
  isGuard?: boolean;
}

export class CombatEffectManager {
  private effects: CombatEffect[] = [];
  private nextId: number = 0;

  // プレイヤー被弾フリッカータイマー (ms)
  public playerHurtTimer: number = 0;

  // 敵ごとのフラッシュ・フリッカータイマー (敵ID -> 残りms)
  public enemyFlickerMap: Map<string, number> = new Map();

  // KICK魔法の岩スライドアニメーション
  private kickSlide: KickSlideAnimation | null = null;

  /**
   * KICK魔法の岩スライドアニメーションを登録
   * @param path 開始地点から最終到達地点までのマスの配列
   * @param hitEnemyPos 命中した敵の座標
   * @param crushed その場で岩が砕けたかどうか
   */
  public triggerKickSlide(path: Position[], hitEnemyPos?: Position, crushed?: boolean): void {
    if (!path || path.length === 0) return;

    // 1マスも動けず砕けた場合
    if (crushed || path.length <= 1) {
      this.effects.push({
        id: `kick_crush_${this.nextId++}`,
        type: 'ENEMY_KILL',
        worldPos: { ...path[0] },
        durationMs: 250,
        elapsedMs: 0,
      });
      this.kickSlide = null;
      return;
    }

    // 1マス以上移動する場合
    const totalSteps = path.length - 1;
    // 爽快感を維持しつつ、最大所要時間を約600ms以内に抑える (通常40ms/マス)
    const stepDurationMs = totalSteps > 15 ? Math.max(20, Math.floor(600 / totalSteps)) : 40;

    this.kickSlide = {
      path: path.map(p => ({ ...p })),
      stepDurationMs,
      elapsedMs: 0,
      finalPos: { ...path[path.length - 1] },
      hitEnemyPos: hitEnemyPos ? { ...hitEnemyPos } : undefined,
      crushed: false,
      hitTriggered: false,
    };
  }

  /**
   * 現在進行中のKICKスライドアニメーションを取得（テスト・デバッグ用）
   */
  public getKickSlide(): KickSlideAnimation | null {
    return this.kickSlide;
  }

  /**
   * 指定座標がKICKアニメーション再生中の最終着地マスであり、一時的に隠すべきか判定
   */
  public isTileHiddenByKickAnimation(pos: Position): boolean {
    if (!this.kickSlide) return false;
    return this.kickSlide.finalPos.x === pos.x && this.kickSlide.finalPos.y === pos.y;
  }

  /**
   * プレイヤー攻撃時のエフェクト登録（敵へのスラッシュ・フラッシュ・与ダメポップアップ）
   */
  public triggerPlayerAttack(targetPos: Position, enemyId?: string, damage?: number, killed: boolean = false): void {
    const idBase = `pa_${this.nextId++}`;

    // 敵のフリッカー（白フラッシュ・点滅: 150ms）
    if (enemyId) {
      this.enemyFlickerMap.set(enemyId, 160);
    }

    // 斬撃スラッシュエフェクト (140ms)
    this.effects.push({
      id: `${idBase}_slash`,
      type: 'PLAYER_ATTACK',
      worldPos: { ...targetPos },
      durationMs: 140,
      elapsedMs: 0,
    });

    // 与ダメージポップアップ (600ms)
    if (damage !== undefined && damage > 0) {
      this.effects.push({
        id: `${idBase}_num`,
        type: 'DAMAGE_POPUP',
        worldPos: { ...targetPos },
        durationMs: 650,
        elapsedMs: 0,
        damageValue: damage,
      });
    }

    // 撃破スパーク (250ms)
    if (killed) {
      this.effects.push({
        id: `${idBase}_kill`,
        type: 'ENEMY_KILL',
        worldPos: { ...targetPos },
        durationMs: 250,
        elapsedMs: 0,
      });
    }
  }

  /**
   * 敵反撃時のエフェクト登録（プレイヤーの赤被弾フリッカー・被ダメポップアップ）
   */
  public triggerEnemyCounter(playerPos: Position, damage: number): void {
    const idBase = `ec_${this.nextId++}`;

    // プレイヤー被弾フリッカー（160ms）
    this.playerHurtTimer = 160;

    // 反撃インパクトエフェクト
    this.effects.push({
      id: `${idBase}_impact`,
      type: 'ENEMY_COUNTER',
      worldPos: { ...playerPos },
      durationMs: 150,
      elapsedMs: 0,
    });

    // 被ダメージ数値またはガードのポップアップ (650ms)
    this.effects.push({
      id: `${idBase}_num`,
      type: 'DAMAGE_POPUP',
      worldPos: { ...playerPos },
      durationMs: 650,
      elapsedMs: 0,
      damageValue: damage,
      isGuard: damage === 0,
    });
  }

  /**
   * 毎フレームの更新処理
   */
  public update(deltaMs: number): void {
    if (this.playerHurtTimer > 0) {
      this.playerHurtTimer = Math.max(0, this.playerHurtTimer - deltaMs);
    }

    for (const [enemyId, timer] of this.enemyFlickerMap.entries()) {
      const nextTimer = timer - deltaMs;
      if (nextTimer <= 0) {
        this.enemyFlickerMap.delete(enemyId);
      } else {
        this.enemyFlickerMap.set(enemyId, nextTimer);
      }
    }

    // KICKスライドアニメーションの進行
    if (this.kickSlide) {
      this.kickSlide.elapsedMs += deltaMs;
      const totalSteps = this.kickSlide.path.length - 1;
      const totalDuration = totalSteps * this.kickSlide.stepDurationMs;
      const currIdx = Math.min(
        this.kickSlide.path.length - 1,
        Math.floor(this.kickSlide.elapsedMs / this.kickSlide.stepDurationMs)
      );

      // 敵命中地点に到達した場合に撃破エフェクトを発生
      if (
        this.kickSlide.hitEnemyPos &&
        !this.kickSlide.hitTriggered &&
        currIdx >= this.kickSlide.path.length - 1
      ) {
        this.effects.push({
          id: `kick_hit_${this.nextId++}`,
          type: 'ENEMY_KILL',
          worldPos: { ...this.kickSlide.hitEnemyPos },
          durationMs: 250,
          elapsedMs: 0,
        });
        this.kickSlide.hitTriggered = true;
      }

      // アニメーション完了
      if (this.kickSlide.elapsedMs >= totalDuration) {
        this.kickSlide = null;
      }
    }

    // 各エフェクトの寿命進行
    for (const effect of this.effects) {
      effect.elapsedMs += deltaMs;
    }

    // 期限切れエフェクトの除去
    this.effects = this.effects.filter((e) => e.elapsedMs < e.durationMs);
  }

  /**
   * 敵が現在ヒットフラッシュ（点滅）中かどうか判定
   */
  public isEnemyFlickering(enemyId: string): boolean {
    const timer = this.enemyFlickerMap.get(enemyId);
    if (!timer || timer <= 0) return false;
    // 30msごとに点滅（反転）
    return Math.floor(timer / 35) % 2 === 0;
  }

  /**
   * プレイヤーが被弾点滅中かどうか判定
   */
  public isPlayerHurtFlickering(): boolean {
    if (this.playerHurtTimer <= 0) return false;
    return Math.floor(this.playerHurtTimer / 35) % 2 === 0;
  }

  /**
   * Canvasへのエフェクト描画
   */
  public render(
    ctx: CanvasRenderingContext2D,
    playerWorldPos: Position,
    map?: WorldMap,
    palette?: PaletteManager
  ): void {
    for (const effect of this.effects) {
      if (!effect.worldPos) continue;

      // ワールド座標からスクリーンピクセル座標を算出（トーラス最短差分対応）
      let dx = effect.worldPos.x - playerWorldPos.x;
      let dy = effect.worldPos.y - playerWorldPos.y;
      if (map) {
        const delta = map.getTorusDelta(playerWorldPos, effect.worldPos);
        dx = delta.dx;
        dy = delta.dy;
      }

      const sx = (dx + PLAYER_SCREEN_TILE_X) * TILE_SIZE;
      const sy = (dy + PLAYER_SCREEN_TILE_Y) * TILE_SIZE;

      // 画面外ならスキップ
      if (sx < -TILE_SIZE || sx > 15 * TILE_SIZE || sy < -TILE_SIZE || sy > 11 * TILE_SIZE) {
        continue;
      }

      const progress = effect.elapsedMs / effect.durationMs; // 0.0 〜 1.0

      switch (effect.type) {
        case 'PLAYER_ATTACK': {
          // 斬撃スラッシュスパーク（白・黄色の鮮烈なクロス閃光）
          this.drawSlashSpark(ctx, sx, sy, progress);
          break;
        }

        case 'ENEMY_COUNTER': {
          // 敵反撃インパクト（赤・オレンジの被弾火花）
          this.drawCounterImpact(ctx, sx, sy, progress);
          break;
        }

        case 'ENEMY_KILL': {
          // 撃破エフェクト（四散するドット破片）
          this.drawKillExplosion(ctx, sx, sy, progress);
          break;
        }

        case 'DAMAGE_POPUP': {
          // 上方にフワッと浮き上がるダメージ数値
          this.drawDamagePopup(ctx, sx, sy, effect, progress);
          break;
        }
      }
    }

    // KICK スライドアニメーションの岩タイル描画
    if (this.kickSlide) {
      const idx = Math.min(
        this.kickSlide.path.length - 1,
        Math.floor(this.kickSlide.elapsedMs / this.kickSlide.stepDurationMs)
      );
      const currPos = this.kickSlide.path[idx];

      let dx = currPos.x - playerWorldPos.x;
      let dy = currPos.y - playerWorldPos.y;
      if (map) {
        const delta = map.getTorusDelta(playerWorldPos, currPos);
        dx = delta.dx;
        dy = delta.dy;
      }

      const sx = (dx + PLAYER_SCREEN_TILE_X) * TILE_SIZE;
      const sy = (dy + PLAYER_SCREEN_TILE_Y) * TILE_SIZE;

      if (sx >= -TILE_SIZE && sx <= 15 * TILE_SIZE && sy >= -TILE_SIZE && sy <= 11 * TILE_SIZE) {
        if (palette) {
          TileGraphics.drawTile(ctx, 'BLOCK', sx, sy, palette);
        } else {
          ctx.fillStyle = '#b0b0b0';
          ctx.fillRect(sx + 2, sy + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        }
        this.drawKickDust(ctx, sx, sy, idx, this.kickSlide.path);
      }
    }
  }

  /**
   * 斬撃スラッシュの描画
   */
  private drawSlashSpark(ctx: CanvasRenderingContext2D, sx: number, sy: number, progress: number): void {
    ctx.save();
    const midX = sx + TILE_SIZE / 2;
    const midY = sy + TILE_SIZE / 2;
    const len = (TILE_SIZE * 0.7) * (0.5 + progress * 0.5);

    // 鋭い白と黄色のクロススラッシュライン
    ctx.strokeStyle = progress < 0.5 ? '#ffffff' : '#ffff00';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(midX - len * 0.7, midY - len * 0.7);
    ctx.lineTo(midX + len * 0.7, midY + len * 0.7);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(midX + len * 0.5, midY - len * 0.5);
    ctx.lineTo(midX - len * 0.5, midY + len * 0.5);
    ctx.stroke();

    // 中心のスパーク光
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(midX - 3, midY - 3, 6, 6);
    ctx.restore();
  }

  /**
   * 被弾インパクトの描画
   */
  private drawCounterImpact(ctx: CanvasRenderingContext2D, sx: number, sy: number, progress: number): void {
    ctx.save();
    const midX = sx + TILE_SIZE / 2;
    const midY = sy + TILE_SIZE / 2;
    const r = (TILE_SIZE * 0.5) * (1 - progress * 0.3);

    // 赤い衝撃波リング
    ctx.strokeStyle = '#ff0055';
    ctx.lineWidth = 2;
    ctx.strokeRect(midX - r, midY - r, r * 2, r * 2);

    // 飛び散る赤い火花
    ctx.fillStyle = '#ff3300';
    const offset = progress * 10;
    ctx.fillRect(midX + offset, midY - offset, 3, 3);
    ctx.fillRect(midX - offset, midY + offset, 3, 3);
    ctx.fillRect(midX - offset, midY - offset, 3, 3);
    ctx.fillRect(midX + offset, midY + offset, 3, 3);
    ctx.restore();
  }

  /**
   * 撃破時の四散スパーク
   */
  private drawKillExplosion(ctx: CanvasRenderingContext2D, sx: number, sy: number, progress: number): void {
    ctx.save();
    const midX = sx + TILE_SIZE / 2;
    const midY = sy + TILE_SIZE / 2;
    const dist = progress * 16;

    // 8方向に飛び散るドット
    ctx.fillStyle = progress < 0.5 ? '#ffff00' : '#ff5500';
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const px = midX + Math.cos(angle) * dist;
      const py = midY + Math.sin(angle) * dist;
      ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
    }
    ctx.restore();
  }

  /**
   * ダメージ数値のポップアップ
   */
  private drawDamagePopup(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    effect: CombatEffect,
    progress: number
  ): void {
    ctx.save();
    const midX = sx + TILE_SIZE / 2;
    // 時間経過で上方に14px上昇
    const midY = sy - 4 - progress * 14;

    const alpha = 1.0 - progress * 0.8;
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    if (effect.isGuard) {
      // ガード時 (シアン)
      ctx.fillStyle = '#000000';
      ctx.fillText('GUARD!', midX + 1, midY + 1);
      ctx.fillStyle = '#00ffff';
      ctx.fillText('GUARD!', midX, midY);
    } else if (effect.damageValue !== undefined) {
      const text = `-${effect.damageValue}`;
      const color = effect.type === 'DAMAGE_POPUP' && effect.id.startsWith('ec_') ? '#ff4444' : '#ffea00';

      // 縁取り
      ctx.fillStyle = '#000000';
      ctx.fillText(text, midX + 1, midY + 1);
      ctx.fillText(text, midX - 1, midY - 1);
      ctx.fillStyle = color;
      ctx.fillText(text, midX, midY);
    }

    ctx.restore();
  }

  /**
   * KICK滑走時の土煙・残像エフェクト描画
   */
  private drawKickDust(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    idx: number,
    path: Position[]
  ): void {
    if (idx === 0) return; // 最初のマスでは土煙なし
    ctx.save();
    const prevPos = path[idx - 1];
    const currPos = path[idx];
    const dx = currPos.x - prevPos.x;
    const dy = currPos.y - prevPos.y;

    // 進行方向の反対側に土煙パーティクルを描画
    ctx.fillStyle = '#dcd6b2'; // 砂土色
    const midX = sx + TILE_SIZE / 2;
    const midY = sy + TILE_SIZE / 2;

    const backX = midX - Math.sign(dx) * (TILE_SIZE * 0.45);
    const backY = midY - Math.sign(dy) * (TILE_SIZE * 0.45);

    // 小さな土煙スパーク（3〜4個のドット）
    ctx.fillRect(backX - 2, backY - 2, 4, 4);
    ctx.fillRect(backX - 5 + (idx % 3) * 3, backY + 3, 3, 3);
    ctx.fillRect(backX + 3, backY - 4 + (idx % 2) * 2, 3, 3);

    // スリップ残像（半透明な輪郭）
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 1, sy + 1, TILE_SIZE - 2, TILE_SIZE - 2);

    ctx.restore();
  }

  /**
   * エフェクトの全クリア
   */
  public clear(): void {
    this.effects = [];
    this.playerHurtTimer = 0;
    this.enemyFlickerMap.clear();
    this.kickSlide = null;
  }
}
