import { Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';

export interface CycleSignature {
  /** 検出された最小周期 (2..24) */
  period: number;
  /** 直近で連続して繰り返した周回数 */
  repetitions: number;
  /** 1周分に含まれる座標列 */
  tiles: Position[];
}

/**
 * MovementLedger (移動履歴・訪問熱量・周期検知の単一記録台帳)
 *
 * 従来 AdaptiveNavigator と EpisodicMemory に重複していた位置履歴・ヒートマップ・
 * 往復/周回検知を一元化し、認知層の SSOT として提供する。
 */
export class MovementLedger {
  public static readonly MAX_HISTORY_LEN = 96;
  public static readonly HEAT_ADD = 10.0;
  public static readonly HEAT_DECAY = 0.85;

  private recentPositions: Position[] = [];
  private heatMap: Map<string, number> = new Map();
  private firstVisitedTurn: Map<string, number> = new Map();
  private lastVisitedTurn: Map<string, number> = new Map();
  private newTileTurns: number[] = [];
  public turnsSinceNewTile: number = 0;

  private toKey(pos: Position): string {
    return `${pos.x},${pos.y}`;
  }

  /**
   * 1ターン分の座標を記録し、ヒートマップ減衰と新規マス判定を行う
   * @returns 今ターンが初訪問マスだった場合 true
   */
  public recordPosition(pos: Position, turn: number): boolean {
    this.recentPositions.push({ ...pos });
    if (this.recentPositions.length > MovementLedger.MAX_HISTORY_LEN) {
      this.recentPositions.shift();
    }

    // ヒートマップ減衰と現在地への加算（局所反発・障害物周回検知用）
    for (const [key, heat] of this.heatMap.entries()) {
      const decayed = heat * MovementLedger.HEAT_DECAY;
      if (decayed < 0.2) {
        this.heatMap.delete(key);
      } else {
        this.heatMap.set(key, decayed);
      }
    }
    const curKey = this.toKey(pos);
    this.heatMap.set(curKey, (this.heatMap.get(curKey) ?? 0) + MovementLedger.HEAT_ADD);

    this.lastVisitedTurn.set(curKey, turn);

    if (this.firstVisitedTurn.has(curKey)) {
      this.turnsSinceNewTile++;
      return false;
    } else {
      this.firstVisitedTurn.set(curKey, turn);
      this.newTileTurns.push(turn);
      this.turnsSinceNewTile = 0;
      return true;
    }
  }

  /**
   * 位置履歴のみクリア（RETURN / JUMP 等のテレポート時）
   * ※visitedEver（firstVisitedTurn）はマップ踏破実績のため保持する
   */
  public clearPositionHistory(): void {
    this.recentPositions = [];
    this.heatMap.clear();
  }

  public getRecentPositions(limit?: number): readonly Position[] {
    if (limit === undefined || limit >= this.recentPositions.length) {
      return this.recentPositions;
    }
    return this.recentPositions.slice(-limit);
  }

  public getHeat(pos: Position): number {
    return this.heatMap.get(this.toKey(pos)) ?? 0;
  }

  public getNeighborhoodHeat(pos: Position, map: WorldMap, radius: number = 1): number {
    let total = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const p = map.wrapPosition({ x: pos.x + dx, y: pos.y + dy });
        total += this.getHeat(p);
      }
    }
    return total;
  }

  public getLastVisitedTurn(pos: Position): number | undefined {
    return this.lastVisitedTurn.get(this.toKey(pos));
  }

  public hasVisitedEver(pos: Position): boolean {
    return this.firstVisitedTurn.has(this.toKey(pos));
  }

  /**
   * 指定ターン以降に初訪問した新規マスの数を返す
   */
  public countNewTilesSince(sinceTurn: number): number {
    let count = 0;
    for (let i = this.newTileTurns.length - 1; i >= 0; i--) {
      if (this.newTileTurns[i] >= sinceTurn) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /**
   * 直近 windowSize ターン内のユニーク座標数
   */
  public countUniqueTilesInWindow(windowSize: number): number {
    const slice = this.getRecentPositions(windowSize);
    const set = new Set<string>();
    for (const p of slice) {
      set.add(this.toKey(p));
    }
    return set.size;
  }

  /**
   * 窓の開始位置からの最大トーラス変位（広がり）を計算
   */
  public getDisplacementInWindow(windowSize: number, map: WorldMap): number {
    const slice = this.getRecentPositions(windowSize);
    if (slice.length <= 1) return 0;
    const origin = slice[0];
    let maxDist = 0;
    for (let i = 1; i < slice.length; i++) {
      const d = map.getTorusDistance(origin, slice[i]).chebyshev;
      if (d > maxDist) maxDist = d;
    }
    return maxDist;
  }

  /**
   * 直近 maxLookback 手から、ちょうど繰り返している最小周期 p (2 <= p <= 24) を検出する。
   * 完全静止（1マスに留まり続ける）は周期として誤認しないよう、1周内に2座標以上あることを条件とする。
   */
  public detectCycle(maxLookback: number = 48): CycleSignature | null {
    const len = this.recentPositions.length;
    const usableLen = Math.min(len, maxLookback);
    if (usableLen < 4) return null;

    const maxPeriod = Math.min(24, Math.floor(usableLen / 2));

    for (let p = 2; p <= maxPeriod; p++) {
      let matches = true;
      const uniqueInCycle = new Set<string>();

      for (let i = 0; i < p; i++) {
        const a = this.recentPositions[len - 1 - i];
        const b = this.recentPositions[len - 1 - i - p];
        if (a.x !== b.x || a.y !== b.y) {
          matches = false;
          break;
        }
        uniqueInCycle.add(this.toKey(a));
      }

      if (!matches || uniqueInCycle.size < 2) {
        continue;
      }

      // 何周連続で一致しているかカウント
      let repetitions = 2;
      while ((repetitions + 1) * p <= usableLen) {
        let nextMatch = true;
        for (let i = 0; i < p; i++) {
          const a = this.recentPositions[len - 1 - i];
          const b = this.recentPositions[len - 1 - i - repetitions * p];
          if (a.x !== b.x || a.y !== b.y) {
            nextMatch = false;
            break;
          }
        }
        if (!nextMatch) break;
        repetitions++;
      }

      return {
        period: p,
        repetitions,
        tiles: this.recentPositions.slice(len - p),
      };
    }

    return null;
  }
}
