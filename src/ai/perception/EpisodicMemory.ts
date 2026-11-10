import { Position } from '../../models/Types.js';

export interface UnreachableTarget {
  pos: Position;
  expireTurn: number;
}

/**
 * EpisodicMemory (エピソード記憶)
 *
 * 過去の移動履歴、訪問頻度、一時的に到達不能と判定された座標のブラックリスト、
 * および膠着・ピンポン発生箇所の記憶を管理する。
 */
export class EpisodicMemory {
  private unreachableTargets: Map<string, number> = new Map();
  private unreachableZones: Map<string, number> = new Map();
  private positionHistory: Position[] = [];
  private readonly maxHistorySize: number = 30;
  private visitCounts: Map<string, number> = new Map();
  public pingPongCount: number = 0;
  public oscillationCount: number = 0;

  private toKey(pos: Position): string {
    return `${pos.x},${pos.y}`;
  }

  /**
   * 毎ターンの移動記録更新
   */
  public recordStep(pos: Position, currentTurn: number): void {
    const key = this.toKey(pos);
    this.visitCounts.set(key, (this.visitCounts.get(key) ?? 0) + 1);

    this.positionHistory.push({ ...pos });
    if (this.positionHistory.length > this.maxHistorySize) {
      this.positionHistory.shift();
    }

    // 期限切れブラックリストのパージ
    for (const [k, expireTurn] of this.unreachableTargets.entries()) {
      if (currentTurn >= expireTurn) {
        this.unreachableTargets.delete(k);
      }
    }
    for (const [z, expireTurn] of this.unreachableZones.entries()) {
      if (currentTurn >= expireTurn) {
        this.unreachableZones.delete(z);
      }
    }

    this.detectPingPong();
  }

  /**
   * ターゲットを一時的に到達不能として登録
   */
  public markTargetUnreachable(pos: Position, durationTurns: number, currentTurn: number): void {
    const key = this.toKey(pos);
    this.unreachableTargets.set(key, currentTurn + durationTurns);
  }

  /**
   * ターゲットが現在到達不能（ブラックリスト内）か判定
   */
  public isTargetUnreachable(pos: Position, currentTurn: number): boolean {
    const key = this.toKey(pos);
    const expireTurn = this.unreachableTargets.get(key);
    if (expireTurn === undefined) return false;
    if (currentTurn >= expireTurn) {
      this.unreachableTargets.delete(key);
      return false;
    }
    return true;
  }

  /**
   * 指定座標の到達不能マークを解除
   */
  public clearUnreachableTarget(pos: Position): void {
    this.unreachableTargets.delete(this.toKey(pos));
  }

  /**
   * ゾーンを一時的に攻略不能（クールダウン）として登録
   */
  public markZoneUnreachable(zoneId: string, durationTurns: number, currentTurn: number): void {
    this.unreachableZones.set(zoneId, currentTurn + durationTurns);
  }

  /**
   * ゾーンが現在攻略不能クールダウン中か判定
   */
  public isZoneUnreachable(zoneId: string, currentTurn: number): boolean {
    const expireTurn = this.unreachableZones.get(zoneId);
    if (expireTurn === undefined) return false;
    if (currentTurn >= expireTurn) {
      this.unreachableZones.delete(zoneId);
      return false;
    }
    return true;
  }

  /**
   * 到達不能ブラックリストを一括クリア (例: BREAK習得時など)
   */
  public clearAllUnreachableTargets(): void {
    this.unreachableTargets.clear();
  }

  /**
   * 2マス間往復 (Ping-Pong) および 3〜4マス周回 (Oscillation) の検知
   */
  private detectPingPong(): void {
    const len = this.positionHistory.length;
    if (len < 4) return;

    const p0 = this.positionHistory[len - 1];
    const p1 = this.positionHistory[len - 2];
    const p2 = this.positionHistory[len - 3];
    const p3 = this.positionHistory[len - 4];

    // A -> B -> A -> B (2マス往復)
    if (p0.x === p2.x && p0.y === p2.y && p1.x === p3.x && p1.y === p3.y) {
      this.pingPongCount++;
    } else {
      if (this.pingPongCount > 0) {
        this.pingPongCount = Math.max(0, this.pingPongCount - 1);
      }
    }

    // A -> B -> C -> A (3マス周回)
    if (len >= 6) {
      const p4 = this.positionHistory[len - 5];
      const p5 = this.positionHistory[len - 6];
      if (p0.x === p3.x && p0.y === p3.y && p1.x === p4.x && p1.y === p4.y && p2.x === p5.x && p2.y === p5.y) {
        this.oscillationCount++;
      } else {
        if (this.oscillationCount > 0) {
          this.oscillationCount = Math.max(0, this.oscillationCount - 1);
        }
      }
    }
  }

  public getVisitCount(pos: Position): number {
    return this.visitCounts.get(this.toKey(pos)) ?? 0;
  }

  public resetPingPong(): void {
    this.pingPongCount = 0;
    this.oscillationCount = 0;
  }

  public clearPositionHistory(): void {
    this.positionHistory = [];
    this.pingPongCount = 0;
    this.oscillationCount = 0;
  }
}
