import { TURN_TIME_LIMIT_MS } from '../config/Constants.js';

export type TurnCallback = () => void;

export class TurnManager {
  private elapsedMs: number = 0;
  private readonly turnLimitMs: number;
  private onTurnTimeout?: TurnCallback;

  constructor(turnLimitMs: number = TURN_TIME_LIMIT_MS) {
    this.turnLimitMs = turnLimitMs;
  }

  public setOnTurnTimeout(cb: TurnCallback): void {
    this.onTurnTimeout = cb;
  }

  public update(deltaMs: number): void {
    this.elapsedMs += deltaMs;
    if (this.elapsedMs >= this.turnLimitMs) {
      this.reset();
      if (this.onTurnTimeout) {
        this.onTurnTimeout();
      }
    }
  }

  public reset(): void {
    this.elapsedMs = 0;
  }

  /**
   * 0.0 〜 1.0 のゲージ割合
   */
  public get ratio(): number {
    return Math.min(1.0, this.elapsedMs / this.turnLimitMs);
  }
}
