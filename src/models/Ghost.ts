import { PALETTE } from '../config/Constants.js';
import { Position, TileType } from './Types.js';
import { SeedRandom } from '../core/SeedRandom.js';

export interface GhostOptions {
  id?: string;
  pos: Position;
  moveIntervalMs?: number;
  vx?: number;
  vy?: number;
  carrySteps?: number;
  targetCarrySteps?: number;
  cruiseSteps?: number;
  targetCruiseSteps?: number;
  rng?: SeedRandom;
}

export interface GhostSaveData {
  id: string;
  pos: Position;
  carriedItem: TileType | null;
  moveTimer: number;
  moveIntervalMs: number;
  vx: number;
  vy: number;
  carrySteps?: number;
  targetCarrySteps?: number;
  cruiseSteps?: number;
  targetCruiseSteps?: number;
}

export class Ghost {
  public readonly id: string;
  public pos: Position;
  public carriedItem: TileType | null;
  public moveTimer: number;
  public readonly moveIntervalMs: number;
  public vx: number;
  public vy: number;
  public carrySteps: number;
  public targetCarrySteps: number;
  public cruiseSteps: number;
  public targetCruiseSteps: number;
  public readonly symbol: string = 'GH';
  public readonly color: string = PALETTE.CYAN;

  constructor(opts: GhostOptions) {
    this.id = opts.id ?? `ghost_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.pos = { ...opts.pos };
    this.carriedItem = null;
    this.moveTimer = 0;
    this.moveIntervalMs = opts.moveIntervalMs ?? 90; // 約90msで1歩滑空（高速巡回）
    this.carrySteps = opts.carrySteps ?? 0;
    this.targetCarrySteps = opts.targetCarrySteps ?? 0;
    this.cruiseSteps = opts.cruiseSteps ?? 0;
    this.targetCruiseSteps = opts.targetCruiseSteps ?? 0;

    // 速度ベクトル（初期値: 斜め4方向滑空）
    if (opts.vx !== undefined && opts.vy !== undefined) {
      this.vx = opts.vx;
      this.vy = opts.vy;
    } else {
      const dirs = [
        { vx: 1, vy: 1 },
        { vx: -1, vy: 1 },
        { vx: 1, vy: -1 },
        { vx: -1, vy: -1 },
      ];
      const picked = opts.rng ? opts.rng.choice(dirs) : dirs[Math.floor(Math.random() * dirs.length)];
      this.vx = picked.vx;
      this.vy = picked.vy;
    }
  }

  public serialize(): GhostSaveData {
    return {
      id: this.id,
      pos: { ...this.pos },
      carriedItem: this.carriedItem,
      moveTimer: this.moveTimer,
      moveIntervalMs: this.moveIntervalMs,
      vx: this.vx,
      vy: this.vy,
      carrySteps: this.carrySteps,
      targetCarrySteps: this.targetCarrySteps,
      cruiseSteps: this.cruiseSteps,
      targetCruiseSteps: this.targetCruiseSteps,
    };
  }

  public static fromJSON(data: GhostSaveData): Ghost {
    const ghost = new Ghost({
      id: data.id,
      pos: { ...data.pos },
      moveIntervalMs: data.moveIntervalMs,
      vx: data.vx ?? 1,
      vy: data.vy ?? 1,
      carrySteps: data.carrySteps ?? 0,
      targetCarrySteps: data.targetCarrySteps ?? 0,
      cruiseSteps: data.cruiseSteps ?? 0,
      targetCruiseSteps: data.targetCruiseSteps ?? 0,
    });
    ghost.carriedItem = data.carriedItem;
    ghost.moveTimer = data.moveTimer;
    return ghost;
  }
}
