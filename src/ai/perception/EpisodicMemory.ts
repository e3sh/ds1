import { Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { MovementLedger } from './MovementLedger.js';
import { ProgressLedger, ProgressWindow, TurnSample } from './ProgressLedger.js';

export interface UnreachableTarget {
  pos: Position;
  expireTurn: number;
}

/**
 * EpisodicMemory (エピソード記憶)
 *
 * 移動履歴・訪問熱量（MovementLedger）、戦果履歴（ProgressLedger）、
 * および一時的に到達不能と判定された座標・ゾーンのブラックリストを管理する。
 */
export class EpisodicMemory {
  private unreachableTargets: Map<string, number> = new Map();
  private unreachableZones: Map<string, number> = new Map();

  public readonly movement: MovementLedger = new MovementLedger();
  public readonly progress: ProgressLedger = new ProgressLedger();

  private toKey(pos: Position): string {
    return `${pos.x},${pos.y}`;
  }

  /**
   * 毎ターンの状態・移動記録を一括更新する
   */
  public recordTurn(sample: TurnSample): void {
    const isNewTile = this.movement.recordPosition(sample.pos, sample.turn);
    this.progress.recordTurn(sample, isNewTile);
    this.purgeExpiredBlacklists(sample.turn);
  }

  /**
   * 座標のみの記録（テストや互換用途）
   */
  public recordStep(pos: Position, currentTurn: number): void {
    this.movement.recordPosition(pos, currentTurn);
    this.purgeExpiredBlacklists(currentTurn);
  }

  private purgeExpiredBlacklists(currentTurn: number): void {
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
  }

  public buildProgressWindow(currentTurn: number, map: WorldMap, windowSize: number = 48): ProgressWindow {
    return this.progress.buildWindow(currentTurn, this.movement, map, windowSize);
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

  public clearPositionHistory(): void {
    this.movement.clearPositionHistory();
  }
}
