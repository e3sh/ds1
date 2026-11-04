import { Position, DungeonTuningParams } from './Types.js';
import { getEnemyConfigById } from '../config/EnemyTable.js';

export interface EnemyInstanceOptions {
  id?: string;
  typeId: number;
  pos: Position;
  hp?: number;
  atk?: number;
  def?: number;
}

export interface EnemySaveData {
  id: string;
  typeId: number;
  pos: Position;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  baseDef: number;
  frozenTimer: number;
  isPermanentlyFrozen?: boolean;
  isAlive: boolean;
  moveInterval: number;
  moveCounter: number;
}

export class EnemyInstance {
  public readonly id: string;
  public readonly typeId: number;
  public readonly name: string;
  public readonly displayName: string;
  public readonly symbol: string;
  public readonly color: string;

  public pos: Position;
  public hp: number;
  public maxHp: number;
  public atk: number;
  public def: number;
  public readonly baseDef: number;

  public readonly drainAtk: number;
  public readonly drainExp: number;
  public readonly stealPotion: boolean;

  public frozenTimer: number;
  public isPermanentlyFrozen: boolean;
  public isAlive: boolean;

  // 移動頻度 (下位敵は2ターンに1回、上位敵は毎ターン)
  public moveInterval: number;
  public moveCounter: number;

  constructor(opts: EnemyInstanceOptions) {
    const config = getEnemyConfigById(opts.typeId);

    this.id = opts.id ?? `enemy_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.typeId = config.id;
    this.name = config.name;
    this.displayName = config.displayName;
    this.symbol = config.symbol;
    this.color = config.color;

    this.pos = { ...opts.pos };
    this.baseDef = opts.def ?? config.def;
    this.hp = opts.hp ?? config.hp;
    this.maxHp = this.hp;
    this.atk = opts.atk ?? config.atk;
    this.def = this.baseDef;

    this.drainAtk = config.drainAtk ?? 0;
    this.drainExp = config.drainExp ?? 0;
    this.stealPotion = config.stealPotion ?? false;

    this.frozenTimer = 0;
    this.isPermanentlyFrozen = false;
    this.isAlive = true;

    // ID 1〜16 は2ターンに1回、17〜32 は毎ターン
    this.moveInterval = config.id <= 16 ? 2 : 1;
    this.moveCounter = 0;
  }

  /**
   * 敵が凍結・停止中（FREEZEによる永続凍結、またはFLASHによる一時停止）かどうか
   */
  public get isFrozen(): boolean {
    return this.isPermanentlyFrozen || this.frozenTimer > 0;
  }

  /**
   * 基本撃破時獲得経験値
   * floor(baseDef / 2) + 50
   */
  public get expReward(): number {
    return this.getExpReward();
  }

  /**
   * パラメータ連動の撃破時獲得経験値算出
   * - CLASSIC_LINEAR: floor(baseDef / 2) + 50
   * - DAMPED_POWER: 高DEF帯のべき乗減衰カーブ
   * - PHASE_CAPPED: 首討伐数に応じた段階的キャップ適用
   */
  public getExpReward(
    progressionConfig?: DungeonTuningParams['progressionConfig'],
    defeatedHeadsCount: number = 0
  ): number {
    const mode = progressionConfig?.expCurveMode ?? 'CLASSIC_LINEAR';
    const scale = progressionConfig?.expScaleFactor ?? 1.0;

    if (mode === 'CLASSIC_LINEAR') {
      const base = Math.floor(this.baseDef / 2) + 50;
      return Math.floor(base * scale);
    }

    const exponent = progressionConfig?.expDampingExponent ?? 0.75;
    let baseReward: number;
    if (this.baseDef <= 10000) {
      baseReward = Math.floor(this.baseDef / 2) + 50;
    } else {
      baseReward = Math.floor(Math.pow(this.baseDef, exponent) * 5.0) + 50;
    }

    const scaledReward = Math.floor(baseReward * scale);

    if (mode === 'PHASE_CAPPED') {
      const caps = progressionConfig?.expPhaseCaps ?? [15000, 35000, 70000, 150000];
      const heads = Math.min(3, Math.max(0, defeatedHeadsCount));
      const cap = caps[heads];
      return Math.min(cap, scaledReward);
    }

    return scaledReward;
  }


  public takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.isAlive = false;
    }
  }

  public serialize(): EnemySaveData {
    return {
      id: this.id,
      typeId: this.typeId,
      pos: { ...this.pos },
      hp: this.hp,
      maxHp: this.maxHp,
      atk: this.atk,
      def: this.def,
      baseDef: this.baseDef,
      frozenTimer: this.frozenTimer,
      isPermanentlyFrozen: this.isPermanentlyFrozen,
      isAlive: this.isAlive,
      moveInterval: this.moveInterval,
      moveCounter: this.moveCounter,
    };
  }

  public static fromJSON(data: EnemySaveData): EnemyInstance {
    const enemy = new EnemyInstance({
      id: data.id,
      typeId: data.typeId,
      pos: { ...data.pos },
      hp: data.hp,
      atk: data.atk,
      def: data.baseDef,
    });
    enemy.maxHp = data.maxHp;
    enemy.def = data.def;
    enemy.frozenTimer = data.frozenTimer;
    enemy.isPermanentlyFrozen = data.isPermanentlyFrozen ?? false;
    enemy.isAlive = data.isAlive;
    enemy.moveInterval = data.moveInterval;
    enemy.moveCounter = data.moveCounter;
    return enemy;
  }
}
