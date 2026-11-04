import { MagicType } from '../models/Types.js';

export interface MagicDefinition {
  type: MagicType;
  name: string;
  requiredExp: number;
  cost: number;
  description: string;
}

/** 斜め移動（特技）の習得必要経験値 */
export const DIAGONAL_REQUIRED_EXP = 12000;

/** 魔法習得テーブル（EXPERIENCE順） */
export const MAGIC_TABLE: MagicDefinition[] = [
  {
    type: 'JUMP',
    name: 'JUMP',
    requiredExp: 1000,
    cost: 1,
    description: '徘徊中のゴーストの場所へワープする',
  },
  {
    type: 'RETURN',
    name: 'RETURN',
    requiredExp: 2000,
    cost: 1,
    description: '我が家へ瞬時にテレポートする',
  },
  {
    type: 'MAP',
    name: 'MAP',
    requiredExp: 3000,
    cost: 1,
    description: '縮小マップを表示する',
  },
  {
    type: 'BREAK',
    name: 'BREAK',
    requiredExp: 4000,
    cost: 0, // 実質消費0（使用直後に即時回復）
    description: '目の前のブロックを破壊する',
  },
  {
    type: 'KICK',
    name: 'KICK',
    requiredExp: 5000,
    cost: 0, // モンスターに命中した時のみ1消費
    description: '目の前の岩を蹴り飛ばし敵を即死させる',
  },
  {
    type: 'FREEZE',
    name: 'FREEZE',
    requiredExp: 6000,
    cost: 1,
    description: '周囲のモンスターを一定時間凍結する',
  },
  {
    type: 'FLASH',
    name: 'FLASH',
    requiredExp: 8000,
    cost: 1,
    description: '画面内の全モンスターを行動不能にする',
  },
  {
    type: 'FLY',
    name: 'FLY',
    requiredExp: 10000,
    cost: 1,
    description: '鳥に変身して壁や敵をすり抜ける',
  },
  {
    type: 'SAVE',
    name: 'SAVE',
    requiredExp: 15000,
    cost: 1,
    description: 'ゲームの状態を保存する',
  },
];
