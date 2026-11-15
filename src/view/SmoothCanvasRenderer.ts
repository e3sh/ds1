import {
  MAP_VIEW_HEIGHT,
  MAP_VIEW_WIDTH,
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
import {
  CameraState,
  CameraTransform,
  IGameRenderer,
  RendererMode,
  RendererUpdateOptions,
} from './IGameRenderer.js';

interface EntityVisualTrack {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  currentX: number;
  currentY: number;
  elapsedMs: number;
  durationMs: number;
}

const BASE_MOVE_DURATION_MS = 120;
const MIN_ZOOM = 0.22;
const MAX_ZOOM = 1.0;
const SPECTATOR_DEFAULT_ZOOM = 0.55;
const SIMPLE_MARKER_ZOOM_THRESHOLD = 0.65;
const OVERVIEW_ZOOM_THRESHOLD = 0.35;

export class SmoothCanvasRenderer implements IGameRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private palette: PaletteManager;
  private blinkFrame: number = 0;
  private tacticalMarkerEnabled: boolean = true;

  private tracks: Map<string, EntityVisualTrack> = new Map();
  private forceSnapNextRender: boolean = true;
  private autoPlaySpeed: number = 1;
  private wasSpectatorMode: boolean = false;

  private camera: CameraState = {
    centerX: 8,
    centerY: 8,
    zoom: 1.0,
    targetZoom: 1.0,
    panOffsetX: 0,
    panOffsetY: 0,
  };

  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private dragBasePanX: number = 0;
  private dragBasePanY: number = 0;

  private boundOnWheel?: (e: WheelEvent) => void;
  private boundOnMouseDown?: (e: MouseEvent) => void;
  private boundOnMouseMove?: (e: MouseEvent) => void;
  private boundOnMouseUp?: () => void;
  private boundOnDblClick?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context could not be acquired.');
    }
    this.canvas = canvas;
    this.ctx = ctx;
    this.palette = new PaletteManager();
    this.ctx.imageSmoothingEnabled = false;

    MonsterGraphics.getOrCreateSpriteSheet();
    TileGraphics.getOrCreateSpriteSheet();

    this.bindCanvasEvents();
  }

  public getMode(): RendererMode {
    return 'smooth';
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

  public setCameraZoom(zoom: number): void {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    this.camera.targetZoom = clamped;
    this.camera.zoom = clamped;
  }

  public getCameraZoom(): number {
    return this.camera.zoom;
  }

  public resetCamera(): void {
    this.camera.targetZoom = 1.0;
    this.camera.zoom = 1.0;
    this.camera.panOffsetX = 0;
    this.camera.panOffsetY = 0;
  }

  public resetInterpolation(): void {
    this.forceSnapNextRender = true;
    this.tracks.clear();
    this.camera.panOffsetX = 0;
    this.camera.panOffsetY = 0;
  }

  public getCameraTransform(): CameraTransform {
    return {
      centerX: this.camera.centerX,
      centerY: this.camera.centerY,
      zoom: this.camera.zoom,
    };
  }

  public update(deltaMs: number, options?: RendererUpdateOptions): void {
    if (options?.autoPlaySpeed !== undefined && options.autoPlaySpeed > 0) {
      this.autoPlaySpeed = options.autoPlaySpeed;
    } else if (!options?.isSpectatorMode) {
      this.autoPlaySpeed = 1;
    }

    const isSpectator = Boolean(options?.isSpectatorMode);
    if (isSpectator && !this.wasSpectatorMode) {
      this.camera.targetZoom = SPECTATOR_DEFAULT_ZOOM;
    } else if (!isSpectator && this.wasSpectatorMode) {
      this.camera.targetZoom = 1.0;
      this.camera.panOffsetX = 0;
      this.camera.panOffsetY = 0;
    }
    this.wasSpectatorMode = isSpectator;

    // ズームの滑らかな補間
    const zoomDiff = this.camera.targetZoom - this.camera.zoom;
    if (Math.abs(zoomDiff) > 0.001) {
      this.camera.zoom += zoomDiff * Math.min(1, deltaMs * 0.015);
    } else {
      this.camera.zoom = this.camera.targetZoom;
    }

    // 各エンティティの座標補間ステップ
    for (const track of this.tracks.values()) {
      if (track.elapsedMs < track.durationMs) {
        track.elapsedMs = Math.min(track.durationMs, track.elapsedMs + deltaMs);
        const t = track.durationMs > 0 ? track.elapsedMs / track.durationMs : 1;
        const ease = 1 - Math.pow(1 - t, 3);
        track.currentX = track.startX + (track.targetX - track.startX) * ease;
        track.currentY = track.startY + (track.targetY - track.startY) * ease;
      } else {
        track.currentX = track.targetX;
        track.currentY = track.targetY;
      }
    }
  }

  public destroy(): void {
    if (typeof this.canvas.removeEventListener === 'function') {
      if (this.boundOnWheel) this.canvas.removeEventListener('wheel', this.boundOnWheel);
      if (this.boundOnMouseDown) this.canvas.removeEventListener('mousedown', this.boundOnMouseDown);
      if (this.boundOnDblClick) this.canvas.removeEventListener('dblclick', this.boundOnDblClick);
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      if (this.boundOnMouseMove) window.removeEventListener('mousemove', this.boundOnMouseMove);
      if (this.boundOnMouseUp) window.removeEventListener('mouseup', this.boundOnMouseUp);
    }
  }

  private bindCanvasEvents(): void {
    if (typeof this.canvas.addEventListener !== 'function') return;

    this.boundOnWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      this.camera.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.camera.targetZoom * factor));
    };

    this.boundOnMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragBasePanX = this.camera.panOffsetX;
      this.dragBasePanY = this.camera.panOffsetY;
    };

    this.boundOnMouseMove = (e: MouseEvent) => {
      if (!this.isDragging) return;
      const dxPx = e.clientX - this.dragStartX;
      const dyPx = e.clientY - this.dragStartY;
      const pxPerTile = TILE_SIZE * this.camera.zoom;
      this.camera.panOffsetX = this.dragBasePanX - dxPx / pxPerTile;
      this.camera.panOffsetY = this.dragBasePanY - dyPx / pxPerTile;
    };

    this.boundOnMouseUp = () => {
      this.isDragging = false;
    };

    this.boundOnDblClick = () => {
      this.camera.panOffsetX = 0;
      this.camera.panOffsetY = 0;
      this.camera.targetZoom = this.wasSpectatorMode ? SPECTATOR_DEFAULT_ZOOM : 1.0;
    };

    this.canvas.addEventListener('wheel', this.boundOnWheel, { passive: false });
    this.canvas.addEventListener('mousedown', this.boundOnMouseDown);
    this.canvas.addEventListener('dblclick', this.boundOnDblClick);

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('mousemove', this.boundOnMouseMove);
      window.addEventListener('mouseup', this.boundOnMouseUp);
    }
  }

  private getEffectiveDurationMs(): number {
    return Math.max(16, Math.round(BASE_MOVE_DURATION_MS / Math.max(1, this.autoPlaySpeed)));
  }

  private wrapCoord(value: number, size: number): number {
    return ((value % size) + size) % size;
  }

  private syncTrack(
    key: string,
    pos: Position,
    map: WorldMap,
    durationMs: number,
    forceSnap: boolean
  ): { x: number; y: number; snapped: boolean } {
    const existing = this.tracks.get(key);
    if (!existing || forceSnap) {
      this.tracks.set(key, {
        startX: pos.x,
        startY: pos.y,
        targetX: pos.x,
        targetY: pos.y,
        currentX: pos.x,
        currentY: pos.y,
        elapsedMs: durationMs,
        durationMs,
      });
      return { x: pos.x, y: pos.y, snapped: true };
    }

    if (pos.x !== existing.targetX || pos.y !== existing.targetY) {
      const targetDelta = map.getTorusDelta({ x: existing.targetX, y: existing.targetY }, pos);
      // 2マス以上の移動（WARP, JUMP, RETURN 等）は補間スキップして即座スナップ
      if (Math.abs(targetDelta.dx) >= 2 || Math.abs(targetDelta.dy) >= 2) {
        existing.startX = pos.x;
        existing.startY = pos.y;
        existing.targetX = pos.x;
        existing.targetY = pos.y;
        existing.currentX = pos.x;
        existing.currentY = pos.y;
        existing.elapsedMs = durationMs;
        existing.durationMs = durationMs;
        return { x: pos.x, y: pos.y, snapped: true };
      }

      // トーラス境界跨ぎ（例: 63 -> 0）でも逆走しないよう、target基準でstartを逆算する
      const curWrappedX = this.wrapCoord(existing.currentX, map.width);
      const curWrappedY = this.wrapCoord(existing.currentY, map.height);
      const curToNew = map.getTorusDelta({ x: curWrappedX, y: curWrappedY }, pos);

      existing.startX = pos.x - curToNew.dx;
      existing.startY = pos.y - curToNew.dy;
      existing.targetX = pos.x;
      existing.targetY = pos.y;
      existing.currentX = existing.startX;
      existing.currentY = existing.startY;
      existing.elapsedMs = 0;
      existing.durationMs = durationMs;
    }

    return {
      x: this.wrapCoord(existing.currentX, map.width),
      y: this.wrapCoord(existing.currentY, map.height),
      snapped: false,
    };
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

    const allHeadsDefeated = dragon ? dragon.isAllHeadsDefeated : false;
    this.palette.updateByPlayerHP(player.hp, allHeadsDefeated);

    const forceSnap = this.forceSnapNextRender;
    this.forceSnapNextRender = false;
    const durationMs = this.getEffectiveDurationMs();

    // 1. 各エンティティの補間座標を同期
    const activeKeys = new Set<string>();
    const playerVisual = this.syncTrack('player', player.pos, map, durationMs, forceSnap);
    activeKeys.add('player');

    if (playerVisual.snapped) {
      this.camera.panOffsetX = 0;
      this.camera.panOffsetY = 0;
    }

    this.camera.centerX = this.wrapCoord(playerVisual.x + this.camera.panOffsetX, map.width);
    this.camera.centerY = this.wrapCoord(playerVisual.y + this.camera.panOffsetY, map.height);

    // 画面クリア
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    const zoom = this.camera.zoom;

    // 強ズームアウト時は全体俯瞰ミニマップ表示へ切り替え
    if (zoom < OVERVIEW_ZOOM_THRESHOLD) {
      this.drawOverviewMap(map, player, enemies, ghosts, dragon);
      if (combatEffects) {
        combatEffects.render(this.ctx, player.pos, map, this.palette, this.getCameraTransform());
      }
      if (showMiniMap) {
        this.drawMiniMap(map, player, dragon);
      }
      this.drawZoomBadge(zoom);
      return;
    }

    const useSimpleMarkers = zoom < SIMPLE_MARKER_ZOOM_THRESHOLD;
    const tileScreenSize = TILE_SIZE * zoom;

    // カメラ座標をデバイスピクセル整数にスナップ（サブピクセル滲み・タイル境界ズレ防止）
    const camCenterX = Math.round(this.camera.centerX * tileScreenSize) / tileScreenSize;
    const camCenterY = Math.round(this.camera.centerY * tileScreenSize) / tileScreenSize;

    // 2. タイルマップ描画（上下左右 1マス以上のマージンを確保し、隣接タイル境界を整数ピクセルで連結して隙間を完全防止）
    this.ctx.imageSmoothingEnabled = false;
    const halfTilesX = Math.ceil(SCREEN_WIDTH / (2 * tileScreenSize)) + 1;
    const halfTilesY = Math.ceil(SCREEN_HEIGHT / (2 * tileScreenSize)) + 1;
    const baseTileX = Math.floor(camCenterX);
    const baseTileY = Math.floor(camCenterY);

    for (let dy = -halfTilesY; dy <= halfTilesY; dy++) {
      const worldY = baseTileY + dy;
      const sy0 = Math.round(SCREEN_HEIGHT / 2 + (worldY - camCenterY - 0.5) * tileScreenSize);
      const sy1 = Math.round(SCREEN_HEIGHT / 2 + (worldY + 1 - camCenterY - 0.5) * tileScreenSize);
      const destH = sy1 - sy0;
      if (destH <= 0) continue;

      for (let dx = -halfTilesX; dx <= halfTilesX; dx++) {
        const worldX = baseTileX + dx;
        const sx0 = Math.round(SCREEN_WIDTH / 2 + (worldX - camCenterX - 0.5) * tileScreenSize);
        const sx1 = Math.round(SCREEN_WIDTH / 2 + (worldX + 1 - camCenterX - 0.5) * tileScreenSize);
        const destW = sx1 - sx0;
        if (destW <= 0) continue;

        const wrappedPos = map.wrapPosition({ x: worldX, y: worldY });
        let tileType = map.getTile(wrappedPos);
        if (tileType === 'BLOCK' && combatEffects?.isTileHiddenByKickAnimation(wrappedPos)) {
          tileType = map.getBaseTile(wrappedPos);
        }

        TileGraphics.drawTile(this.ctx, tileType, sx0, sy0, this.palette, destW, destH);
      }
    }

    // カメラ空間へ変換（エンティティ・マーカー描画用）
    this.ctx.save();
    this.ctx.translate(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2);
    this.ctx.scale(zoom, zoom);
    this.ctx.imageSmoothingEnabled = false;

    const worldToPixel = (pos: { x: number; y: number }) => {
      const { dx, dy } = map.getTorusDelta({ x: camCenterX, y: camCenterY }, pos);
      return {
        px: (dx - 0.5) * TILE_SIZE,
        py: (dy - 0.5) * TILE_SIZE,
      };
    };

    const visibleLimitX = halfTilesX * TILE_SIZE + TILE_SIZE;
    const visibleLimitY = halfTilesY * TILE_SIZE + TILE_SIZE;
    const isVisiblePixel = (px: number, py: number) =>
      px >= -visibleLimitX && px <= visibleLimitX && py >= -visibleLimitY && py <= visibleLimitY;

    // 3. ドラゴン部位・火炎弾の描画
    if (dragon) {
      if (this.tacticalMarkerEnabled) {
        for (let i = 0; i < dragon.heads.length; i++) {
          const head = dragon.heads[i];
          if (!head.isAlive) continue;
          const key = `dragon_head_${i}`;
          activeKeys.add(key);
          const headVisual = this.syncTrack(key, head.pos, map, durationMs, forceSnap);
          const { px, py } = worldToPixel(headVisual);
          if (isVisiblePixel(px, py)) {
            const threatDetails = ThreatEvaluator.evaluateThreatDetails(player, head);
            if (useSimpleMarkers) {
              this.drawSimpleMarker(px, py, threatDetails.overallThreat);
            } else {
              this.drawTacticalMarker(px, py, threatDetails);
            }
          }
        }
      }

      const dragonParts = [
        { key: 'dragon_body', part: dragon.body },
        ...dragon.heads.map((h, i) => ({ key: `dragon_head_${i}`, part: h })),
        { key: 'dragon_tail', part: dragon.tail },
      ];
      for (const { key, part } of dragonParts) {
        activeKeys.add(key);
        const visual = this.syncTrack(key, part.pos, map, durationMs, forceSnap);
        const { px, py } = worldToPixel(visual);
        if (isVisiblePixel(px, py)) {
          const isFlickering = combatEffects ? combatEffects.isEnemyFlickering(part.type) : false;
          TileGraphics.drawDragonPart(this.ctx, part, px, py, isFlickering);
        }
      }

      for (let i = 0; i < dragon.fireballs.length; i++) {
        const fb = dragon.fireballs[i];
        if (!fb.isAlive) continue;
        const key = `fireball_${i}`;
        activeKeys.add(key);
        const visual = this.syncTrack(key, fb.pos, map, durationMs, forceSnap);
        const { px, py } = worldToPixel(visual);
        if (isVisiblePixel(px, py)) {
          TileGraphics.drawFireball(this.ctx, fb, px, py);
        }
      }
    }

    // 4. モンスターの描画
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    for (const enemy of enemies) {
      if (!enemy.isAlive) continue;
      const key = `enemy_${enemy.id}`;
      activeKeys.add(key);
      const visual = this.syncTrack(key, enemy.pos, map, durationMs, forceSnap);
      const { px, py } = worldToPixel(visual);

      if (isVisiblePixel(px, py)) {
        const isFlickering = combatEffects ? combatEffects.isEnemyFlickering(enemy.id) : false;
        const isFrozen = enemy.isFrozen;

        if (this.tacticalMarkerEnabled) {
          const threatDetails = ThreatEvaluator.evaluateThreatDetails(player, enemy);
          if (useSimpleMarkers) {
            this.drawSimpleMarker(px, py, threatDetails.overallThreat);
          } else {
            this.drawTacticalMarker(px, py, threatDetails);
          }
        } else if (!isFrozen && !useSimpleMarkers) {
          this.drawEnemyShadow(px, py);
        }

        const phase = (enemy.pos.x * 37 + enemy.pos.y * 17) % 100;
        const bobbingY = isFrozen ? 0 : Math.round(Math.sin(now / 180 + phase) * 1.5);
        TileGraphics.drawEnemy(this.ctx, enemy, px, py + bobbingY, isFlickering);
      }
    }

    // 5. ゴーストの描画
    for (const ghost of ghosts) {
      const key = `ghost_${ghost.id}`;
      activeKeys.add(key);
      const visual = this.syncTrack(key, ghost.pos, map, durationMs, forceSnap);
      const { px, py } = worldToPixel(visual);
      if (isVisiblePixel(px, py)) {
        TileGraphics.drawGhost(this.ctx, ghost, px, py);
      }
    }

    // 6. 死神フォロワーの描画
    if (player.hasDeath && player.deathFollowerPos) {
      const key = 'death_follower';
      activeKeys.add(key);
      const visual = this.syncTrack(key, player.deathFollowerPos, map, durationMs, forceSnap);
      const { px, py } = worldToPixel(visual);
      if (isVisiblePixel(px, py)) {
        TileGraphics.drawDeathFollower(this.ctx, px, py, this.blinkFrame);
      }
    }

    // 7. プレイヤーの描画
    const { px: playerPx, py: playerPy } = worldToPixel(playerVisual);
    const isPlayerHurt = combatEffects ? combatEffects.isPlayerHurtFlickering() : false;
    TileGraphics.drawPlayer(
      this.ctx,
      playerPx,
      playerPy,
      player.dir,
      player.hasSword,
      player.holdItem,
      isPlayerHurt,
      player.isFlying,
      this.blinkFrame
    );

    // FLY インジケーター
    if (player.isFlying) {
      const isEndingWarning = player.flyTimer <= 3;
      const showWarning = !isEndingWarning || Math.floor(this.blinkFrame / 8) % 2 === 0;
      if (showWarning) {
        this.ctx.save();
        const text = `FLY ${player.flyTimer}`;
        this.ctx.font = 'bold 11px monospace';
        const textWidth = this.ctx.measureText(text).width;
        const badgeX = playerPx + (TILE_SIZE - textWidth) / 2 - 4;
        const badgeY = playerPy - 14;
        this.ctx.fillStyle = isEndingWarning ? 'rgba(180, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0.75)';
        this.ctx.fillRect(badgeX, badgeY, textWidth + 8, 14);
        this.ctx.strokeStyle = isEndingWarning ? '#ff4444' : '#00ffff';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(badgeX, badgeY, textWidth + 8, 14);
        this.ctx.fillStyle = isEndingWarning ? '#ffff00' : '#ffffff';
        this.ctx.fillText(text, badgeX + 4, badgeY + 11);
        this.ctx.restore();
      }
    }

    this.ctx.restore();

    // 不要になったトラックを解放
    for (const key of this.tracks.keys()) {
      if (!activeKeys.has(key)) {
        this.tracks.delete(key);
      }
    }

    // 8. バトルエフェクトのカメラ追従描画
    if (combatEffects) {
      combatEffects.render(this.ctx, player.pos, map, this.palette, this.getCameraTransform());
    }

    // 9. ミニマップ（MAP魔法時）
    if (showMiniMap) {
      this.drawMiniMap(map, player, dragon);
    }

    // 10. ズーム倍率バッジ（1.0x 以外またはパン中）
    if (Math.abs(zoom - 1.0) > 0.02 || Math.abs(this.camera.panOffsetX) > 0.1 || Math.abs(this.camera.panOffsetY) > 0.1) {
      this.drawZoomBadge(zoom);
    }
  }

  private drawZoomBadge(zoom: number): void {
    this.ctx.save();
    const label = zoom < OVERVIEW_ZOOM_THRESHOLD
      ? `OVERVIEW ${zoom.toFixed(2)}x`
      : `ZOOM ${zoom.toFixed(2)}x`;
    this.ctx.font = 'bold 10px monospace';
    const w = this.ctx.measureText(label).width + 10;
    this.ctx.fillStyle = 'rgba(8, 12, 20, 0.8)';
    this.ctx.fillRect(6, 6, w, 16);
    this.ctx.strokeStyle = '#00e5ff';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(6, 6, w, 16);
    this.ctx.fillStyle = '#00e5ff';
    this.ctx.fillText(label, 11, 17);
    this.ctx.restore();
  }

  /**
   * 強ズームアウト時（全体俯瞰モード）: 脅威度別ドット等のマーカー中心の全体ミニマップ表示
   */
  private drawOverviewMap(
    map: WorldMap,
    player: Player,
    enemies: EnemyInstance[],
    ghosts: Ghost[],
    dragon?: Dragon
  ): void {
    const scale = Math.min((SCREEN_WIDTH - 24) / map.width, (SCREEN_HEIGHT - 32) / map.height);
    const mapW = Math.floor(map.width * scale);
    const mapH = Math.floor(map.height * scale);
    const startX = Math.floor((SCREEN_WIDTH - mapW) / 2);
    const startY = Math.floor((SCREEN_HEIGHT - mapH) / 2) + 4;

    this.ctx.fillStyle = '#060910';
    this.ctx.fillRect(startX - 4, startY - 4, mapW + 8, mapH + 8);
    this.ctx.strokeStyle = '#1f3b5c';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(startX - 4, startY - 4, mapW + 8, mapH + 8);

    const cellSz = Math.max(2, Math.ceil(scale));

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.getTile({ x, y });
        const base = map.getBaseTile({ x, y });
        const px = startX + Math.floor(x * scale);
        const py = startY + Math.floor(y * scale);

        if (tile === 'HOME' || (map.homePos.x === x && map.homePos.y === y)) {
          this.ctx.fillStyle = '#ffffff';
          this.ctx.fillRect(px, py, cellSz, cellSz);
        } else if (tile === 'GRAVE' || base === 'GRAVE') {
          this.ctx.fillStyle = '#dddd00';
          this.ctx.fillRect(px, py, cellSz, cellSz);
        } else if (tile === 'WARP' || base === 'WARP') {
          this.ctx.fillStyle = '#00dddd';
          this.ctx.fillRect(px, py, cellSz, cellSz);
        } else if (tile === 'CHEST' || tile === 'CHEST_DRAGON') {
          this.ctx.fillStyle = '#3388ff';
          this.ctx.fillRect(px, py, cellSz, cellSz);
        } else if (tile === 'BLOCK' || tile === 'WALL_STATIC') {
          this.ctx.fillStyle = '#252d3d';
          this.ctx.fillRect(px, py, cellSz, cellSz);
        }
      }
    }

    // 敵を脅威度別ドットで描画
    for (const enemy of enemies) {
      if (!enemy.isAlive) continue;
      const threat = ThreatEvaluator.evaluateThreatDetails(player, enemy).overallThreat;
      this.ctx.fillStyle = this.getThreatColor(threat);
      const ex = startX + Math.floor(enemy.pos.x * scale);
      const ey = startY + Math.floor(enemy.pos.y * scale);
      this.ctx.fillRect(ex, ey, Math.max(3, cellSz), Math.max(3, cellSz));
    }

    // ゴースト
    this.ctx.fillStyle = '#cc66ff';
    for (const ghost of ghosts) {
      const gx = startX + Math.floor(ghost.pos.x * scale);
      const gy = startY + Math.floor(ghost.pos.y * scale);
      this.ctx.fillRect(gx, gy, Math.max(3, cellSz), Math.max(3, cellSz));
    }

    // ドラゴン
    if (dragon) {
      this.ctx.fillStyle = '#ff0044';
      const dpx = startX + Math.floor(dragon.centerPos.x * scale) - 2;
      const dpy = startY + Math.floor(dragon.centerPos.y * scale) - 2;
      this.ctx.fillRect(dpx, dpy, Math.max(6, Math.floor(scale * 2)), Math.max(6, Math.floor(scale * 2)));
    }

    // プレイヤー（点滅白＋通常カメラ範囲枠）
    const ppx = startX + Math.floor(player.pos.x * scale);
    const ppy = startY + Math.floor(player.pos.y * scale);
    if (Math.floor(this.blinkFrame / 10) % 2 === 0) {
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(ppx - 1, ppy - 1, Math.max(4, cellSz + 2), Math.max(4, cellSz + 2));
    }

    // 通常15x11ビューの目安枠
    this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(
      startX + (player.pos.x - VIEW_TILES_X / 2) * scale,
      startY + (player.pos.y - VIEW_TILES_Y / 2) * scale,
      VIEW_TILES_X * scale,
      VIEW_TILES_Y * scale
    );
  }

  private getThreatColor(threat: ThreatLevel): string {
    switch (threat) {
      case 'ONE_SHOT':
        return '#00eeff';
      case 'SAFE':
        return '#00dd66';
      case 'STALEMATE':
        return '#ffcc00';
      case 'DANGER':
        return '#ff2244';
      case 'LETHAL':
        return Math.floor(this.blinkFrame / 10) % 2 === 0 ? '#ff1133' : '#ff88ff';
    }
  }

  /**
   * 中距離ズームアウト時の軽量マーカー
   */
  private drawSimpleMarker(px: number, py: number, threat: ThreatLevel): void {
    this.ctx.save();
    this.ctx.strokeStyle = this.getThreatColor(threat);
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.ellipse(px + 16, py + 28, 10, 4, 0, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawEnemyShadow(px: number, py: number): void {
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    this.ctx.beginPath();
    this.ctx.ellipse(px + 16, py + 28, 9, 3, 0, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

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
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    this.ctx.fill();

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

    this.ctx.fillStyle = fillColor;
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = strokeColor;
    this.ctx.lineWidth = lineWidth;
    this.ctx.stroke();

    if (defenseThreat === 'LETHAL') {
      const pulse = 0.5 + 0.5 * Math.sin(this.blinkFrame * 0.2);
      const isFastBlink = Math.floor(this.blinkFrame / 8) % 2 === 0;

      this.ctx.fillStyle = isFastBlink ? 'rgba(255, 20, 40, 0.85)' : 'rgba(120, 0, 20, 0.75)';
      this.ctx.beginPath();
      this.ctx.ellipse(cx, cy, 5.5 + pulse * 1.5, 2.2 + pulse * 0.8, 0, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.fillStyle = '#110000';
      this.ctx.beginPath();
      this.ctx.ellipse(cx, cy, 3, 1.2, 0, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.fillStyle = '#ff1133';
      this.ctx.fillRect(cx - 1, cy - 1, 2, 2);

      if (threat === 'LETHAL') {
        this.ctx.fillRect(cx - rx + 1, cy - 1, 2, 2);
        this.ctx.fillRect(cx + rx - 3, cy - 1, 2, 2);
      }
    } else if (defenseThreat === 'TAKES_DAMAGE') {
      this.ctx.fillStyle = 'rgba(255, 170, 0, 0.75)';
      this.ctx.beginPath();
      this.ctx.ellipse(cx, cy, 4.5, 1.8, 0, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.fillStyle = '#ffee44';
      this.ctx.fillRect(cx - 1, cy - 1, 2, 2);
    } else if (threat === 'ONE_SHOT') {
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(cx - 1, cy - 1, 2, 2);
    }

    this.ctx.restore();
  }

  private drawMiniMap(map: WorldMap, player: Player, dragon?: Dragon): void {
    const scale = 3.5;
    const mapW = Math.floor(map.width * scale);
    const mapH = Math.floor(map.height * scale);
    const startX = Math.floor((MAP_VIEW_WIDTH - mapW) / 2);
    const startY = Math.floor((MAP_VIEW_HEIGHT - mapH) / 2);

    this.ctx.fillStyle = 'rgba(5, 8, 14, 0.92)';
    this.ctx.fillRect(startX - 8, startY - 8, mapW + 16, mapH + 16);
    this.ctx.strokeStyle = '#00ffaa';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(startX - 8, startY - 8, mapW + 16, mapH + 16);

    this.ctx.fillStyle = '#00ffaa';
    this.ctx.font = 'bold 10px monospace';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('- DUNGEON MAP (DS1ish) -', MAP_VIEW_WIDTH / 2, startY - 12);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.getTile({ x, y });
        const base = map.getBaseTile({ x, y });
        const px = startX + Math.floor(x * scale);
        const py = startY + Math.floor(y * scale);
        const sz = Math.ceil(scale);

        if (tile === 'HOME' || (map.homePos.x === x && map.homePos.y === y)) {
          this.ctx.fillStyle = '#ffffff';
          this.ctx.fillRect(px, py, sz, sz);
        } else if (tile === 'GRAVE' || base === 'GRAVE') {
          this.ctx.fillStyle = '#ffff00';
          this.ctx.fillRect(px, py, sz, sz);
        } else if (tile === 'WARP') {
          this.ctx.fillStyle = '#00ffff';
          this.ctx.fillRect(px, py, sz, sz);
        } else if (tile === 'CHEST' || tile === 'CHEST_DRAGON') {
          this.ctx.fillStyle = '#3388ff';
          this.ctx.fillRect(px, py, sz, sz);
        } else if (tile === 'BLOCK' || tile === 'WALL_STATIC') {
          this.ctx.fillStyle = '#222833';
          this.ctx.fillRect(px, py, sz, sz);
        }
      }
    }

    if (dragon) {
      this.ctx.fillStyle = '#ff0044';
      const dpx = startX + Math.floor(dragon.centerPos.x * scale) - 3;
      const dpy = startY + Math.floor(dragon.centerPos.y * scale) - 3;
      this.ctx.fillRect(dpx, dpy, Math.floor(scale * 2.5), Math.floor(scale * 2.5));
    }

    if (Math.floor(this.blinkFrame / 15) % 2 === 0) {
      this.ctx.fillStyle = '#ffffff';
      const ppx = startX + Math.floor(player.pos.x * scale) - 2;
      const ppy = startY + Math.floor(player.pos.y * scale) - 2;
      this.ctx.fillRect(ppx, ppy, 6, 6);
    }
  }
}
