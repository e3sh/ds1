export type UpdateCallback = (deltaMs: number) => void;
export type RenderCallback = () => void;

export class GameLoop {
  private isRunning: boolean = false;
  private lastTime: number = 0;
  private onUpdate: UpdateCallback;
  private onRender: RenderCallback;
  private animationFrameId: number | null = null;

  constructor(onUpdate: UpdateCallback, onRender: RenderCallback) {
    this.onUpdate = onUpdate;
    this.onRender = onRender;
    this.loop = this.loop.bind(this);
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (typeof requestAnimationFrame !== 'undefined') {
      this.animationFrameId = requestAnimationFrame(this.loop);
    }
  }

  public stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private loop(currentTime: number): void {
    if (!this.isRunning) return;

    const deltaMs = Math.min(100, currentTime - this.lastTime); // 極端なコマ飛び防止
    this.lastTime = currentTime;

    this.onUpdate(deltaMs);
    this.onRender();

    if (typeof requestAnimationFrame !== 'undefined') {
      this.animationFrameId = requestAnimationFrame(this.loop);
    }
  }
}
