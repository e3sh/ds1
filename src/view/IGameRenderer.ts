import { Player } from '../models/Player.js';
import { WorldMap } from '../models/WorldMap.js';
import { EnemyInstance } from '../models/Enemy.js';
import { Ghost } from '../models/Ghost.js';
import { Dragon } from '../models/Dragon.js';
import { MagicType } from '../models/Types.js';
import { PaletteManager } from './PaletteManager.js';
import type { CombatEffectManager } from './CombatEffectManager.js';

export type RendererMode = 'classic' | 'smooth';

export interface CameraTransform {
  centerX: number;
  centerY: number;
  zoom: number;
}

export interface CameraState extends CameraTransform {
  panOffsetX: number;
  panOffsetY: number;
  targetZoom: number;
}

export interface RendererUpdateOptions {
  autoPlaySpeed?: number;
  isSpectatorMode?: boolean;
}

export interface IGameRenderer {
  getMode(): RendererMode;

  render(
    player: Player,
    map: WorldMap,
    indicatorRatio: number,
    enemies?: EnemyInstance[],
    ghosts?: Ghost[],
    dragon?: Dragon,
    selectedMagic?: MagicType,
    showMiniMap?: boolean,
    combatEffects?: CombatEffectManager,
    tacticalMarkerEnabled?: boolean
  ): void;

  update?(deltaMs: number, options?: RendererUpdateOptions): void;
  resetInterpolation?(): void;

  getPalette(): PaletteManager;
  setTacticalMarker(enabled: boolean): void;
  isTacticalMarkerEnabled(): boolean;

  setCameraZoom?(zoom: number): void;
  getCameraZoom?(): number;
  resetCamera?(): void;
  destroy?(): void;
}
