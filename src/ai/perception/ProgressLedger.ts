import { Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { CycleSignature, MovementLedger } from './MovementLedger.js';

export type GainKind =
  | 'STR_UP'
  | 'EXP_UP'
  | 'MP_UP'
  | 'GOLD_PICKUP'
  | 'GOLD_CASHED'
  | 'CHEST_OPENED'
  | 'KEY_ACQUIRED'
  | 'STONE_ACQUIRED'
  | 'RING_ACQUIRED'
  | 'SWORD_ACQUIRED'
  | 'HEAD_DAMAGED'
  | 'HEAD_DEFEATED'
  | 'CROWN_PICKED'
  | 'CROWN_DELIVERED'
  | 'HOME_RELOCATED'
  | 'NEW_TILE';

export interface GainEvent {
  turn: number;
  kind: GainKind;
}

export interface TurnSample {
  turn: number;
  pos: Position;
  hp: number;
  maxHp: number;
  strength: number;
  experience: number;
  magic: number;
  gold: number;
  holdItem: string;
  hasSword: boolean;
  remainingChests: number;
  dragonTotalHeadHp: number;
  dragonDefeatedHeads: number;
  crownsDelivered: number;
  homePos: Position;
}

export interface ProgressWindow {
  /** 監査窓の長さ（既定 48） */
  windowSize: number;
  /** 窓内のユニーク座標数 */
  uniqueTilesInWindow: number;
  /** 窓内で初めて訪れたマスの数 */
  newTilesInWindow: number;
  /** 新規未踏マスを踏んでからの経過ターン */
  turnsSinceNewTile: number;
  /** 最後に実質的な戦果があってからの経過ターン */
  turnsSinceSubstantiveGain: number;
  /** 直近の実質的戦果 */
  lastSubstantiveGain: GainEvent | null;
  /** 窓内の位置の広がり（窓の開始位置からの最大トーラス距離） */
  displacement: number;
  /** ちょうど繰り返している周回（なければ null） */
  cycle: CycleSignature | null;
  /** 指定ターン以降の実質的な戦果（ミッション側の進捗判定に使う） */
  substantiveGainsSince(turn: number): readonly GainEvent[];
  /** 指定ターン以降に初めて訪れたマスの数 */
  newTilesSince(turn: number): number;
}

/**
 * ProgressLedger (戦果台帳)
 *
 * 毎ターンの客観状態（TurnSample）の差分から実質的な戦果（GainEvent）を記録し、
 * 上位指揮官および各ミッションが参照する ProgressWindow を生成する。
 * HPの自然回復や、アイテムスワップによる同種アイテム再取得など擬似的な変化は戦果として数えない。
 */
export class ProgressLedger {
  private prevSample: TurnSample | null = null;
  private substantiveGains: GainEvent[] = [];
  private lastSubstantiveGainTurn: number = 0;

  // スワップ（一時置き→再取得）を戦果として誤認しないための抑制状態
  private lastAcquiredItemTurn: Map<string, number> = new Map();
  private lastChestOpenedTurn: number = -1;
  private lastCrownDeliveredTurn: number = -1;

  public recordTurn(sample: TurnSample, isNewTile: boolean): void {
    if (!this.prevSample) {
      this.prevSample = { ...sample, pos: { ...sample.pos }, homePos: { ...sample.homePos } };
      this.lastSubstantiveGainTurn = sample.turn;
      return;
    }

    const prev = this.prevSample;
    const gains: GainKind[] = [];

    if (sample.strength > prev.strength) gains.push('STR_UP');
    if (sample.experience > prev.experience) {
      if (sample.gold < prev.gold) {
        gains.push('GOLD_CASHED');
      } else {
        gains.push('EXP_UP');
      }
    }
    if (sample.magic > prev.magic) gains.push('MP_UP');
    if (sample.gold > prev.gold) gains.push('GOLD_PICKUP');
    if (sample.remainingChests < prev.remainingChests) {
      gains.push('CHEST_OPENED');
      this.lastChestOpenedTurn = sample.turn;
    }

    if (!prev.hasSword && sample.hasSword) {
      gains.push('SWORD_ACQUIRED');
    }

    if (sample.holdItem !== prev.holdItem) {
      if (sample.holdItem === 'POWER_STONE') {
        gains.push('STONE_ACQUIRED');
      } else if (sample.holdItem === 'RING') {
        gains.push('RING_ACQUIRED');
      } else if (sample.holdItem === 'KEY') {
        // 直近16T以内に鍵を取得し、その間に宝箱を開けていない場合はスワップ再取得とみなし戦果に数えない
        const lastKeyTurn = this.lastAcquiredItemTurn.get('KEY') ?? -999;
        if (sample.turn - lastKeyTurn > 16 || this.lastChestOpenedTurn > lastKeyTurn) {
          gains.push('KEY_ACQUIRED');
          this.lastAcquiredItemTurn.set('KEY', sample.turn);
        }
      } else if (sample.holdItem === 'CROWN') {
        const lastCrownTurn = this.lastAcquiredItemTurn.get('CROWN') ?? -999;
        if (sample.turn - lastCrownTurn > 16 || this.lastCrownDeliveredTurn > lastCrownTurn) {
          gains.push('CROWN_PICKED');
          this.lastAcquiredItemTurn.set('CROWN', sample.turn);
        }
      }
    }

    if (sample.dragonTotalHeadHp < prev.dragonTotalHeadHp) gains.push('HEAD_DAMAGED');
    if (sample.dragonDefeatedHeads > prev.dragonDefeatedHeads) gains.push('HEAD_DEFEATED');
    if (sample.crownsDelivered > prev.crownsDelivered) {
      gains.push('CROWN_DELIVERED');
      this.lastCrownDeliveredTurn = sample.turn;
    }
    if (sample.homePos.x !== prev.homePos.x || sample.homePos.y !== prev.homePos.y) {
      gains.push('HOME_RELOCATED');
    }

    for (const kind of gains) {
      this.substantiveGains.push({ turn: sample.turn, kind });
      this.lastSubstantiveGainTurn = sample.turn;
    }

    // メモリ肥大防止（直近256件のみ保持）
    if (this.substantiveGains.length > 256) {
      this.substantiveGains.splice(0, this.substantiveGains.length - 256);
    }

    // isNewTile は ProgressWindow 側で MovementLedger 経由で集計する
    void isNewTile;

    this.prevSample = { ...sample, pos: { ...sample.pos }, homePos: { ...sample.homePos } };
  }

  public buildWindow(
    currentTurn: number,
    movement: MovementLedger,
    map: WorldMap,
    windowSize: number = 48
  ): ProgressWindow {
    const sinceTurn = Math.max(0, currentTurn - windowSize + 1);
    const gains = this.substantiveGains;
    const lastSubstantiveGain = gains.length > 0 ? gains[gains.length - 1] : null;

    return {
      windowSize,
      uniqueTilesInWindow: movement.countUniqueTilesInWindow(windowSize),
      newTilesInWindow: movement.countNewTilesSince(sinceTurn),
      turnsSinceNewTile: movement.turnsSinceNewTile,
      turnsSinceSubstantiveGain: Math.max(0, currentTurn - this.lastSubstantiveGainTurn),
      lastSubstantiveGain,
      displacement: movement.getDisplacementInWindow(windowSize, map),
      cycle: movement.detectCycle(windowSize),
      substantiveGainsSince: (turn: number) => gains.filter(g => g.turn >= turn),
      newTilesSince: (turn: number) => movement.countNewTilesSince(turn),
    };
  }
}
