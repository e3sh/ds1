import { DamageSource, DeathInfo, Direction, HoldItemType, Position, DungeonTuningParams } from './Types.js';

export interface PlayerInitOptions {
  x?: number;
  y?: number;
  hp?: number;
  strength?: number;
  experience?: number;
  progressionConfig?: DungeonTuningParams['progressionConfig'];
}

export interface PlayerSaveData {
  pos: Position;
  dir: Direction;
  hp: number;
  maxHp: number;
  strength: number;
  experience: number;
  gold: number;
  magic: number;
  crowns: number;
  totalKills: number;
  hasSword: boolean;
  holdItem: HoldItemType;
  isFlying: boolean;
  flyTimer: number;
  hasDeath: boolean;
  deathFollowerPos: Position | null;
  canDiagonal: boolean;
  isStageCleared: boolean;
  stepCountSinceStone: number;
}

export interface HomeEventResult {
  hpRestored: number;
  prevHp: number;
  newHp: number;
  goldConverted: number;
  goldBonusHp: number;
  goldExpGained: number;
  powerStoneConverted: boolean;
  strGained: number;
  crownConverted: boolean;
  deathPurified: boolean;
  stageCleared: boolean;
}

export class Player {
  public static readonly MAX_STR = 655350;
  public static readonly MAX_EXPERIENCE = 655350;
  public static readonly MAX_HP = 655350;

  public pos: Position;
  public dir: Direction;

  // ステータス値
  public hp: number;
  public maxHp: number;
  public strength: number;
  public experience: number;
  public gold: number;
  public magic: number;
  public crowns: number;
  public totalKills: number;

  // 状態フラグ
  public hasSword: boolean;
  public holdItem: HoldItemType;
  public isFlying: boolean;
  public flyTimer: number;
  public hasDeath: boolean;
  public deathFollowerPos: Position | null; // プレイヤーの背後を追従する死神（骸骨）の座標
  public canDiagonal: boolean;
  public isStageCleared: boolean;
  public deathInfo: DeathInfo | null = null;

  // 8歩周期カウンター
  public stepCountSinceStone: number;

  // ゲームルール/進行チューニング設定のキャッシュ
  public activeProgressionConfig?: DungeonTuningParams['progressionConfig'];

  constructor(opts?: PlayerInitOptions) {
    this.pos = { x: opts?.x ?? 8, y: opts?.y ?? 8 };
    this.dir = 'DOWN';

    this.hp = opts?.hp ?? 1000;
    this.experience = opts?.experience ?? 1000;
    this.maxHp = this.experience;
    this.strength = opts?.strength ?? 10;
    this.gold = 0;
    this.magic = 0;
    this.crowns = 0;
    this.totalKills = 0;

    this.hasSword = false;
    this.holdItem = 'NONE';
    this.isFlying = false;
    this.flyTimer = 0;
    this.hasDeath = false;
    this.deathFollowerPos = null;
    this.canDiagonal = false;
    this.isStageCleared = false;
    this.deathInfo = null;

    this.stepCountSinceStone = 0;
    this.activeProgressionConfig = opts?.progressionConfig;
  }

  public reset(opts?: PlayerInitOptions): void {
    this.pos = { x: opts?.x ?? 8, y: opts?.y ?? 8 };
    this.dir = 'DOWN';
    this.hp = opts?.hp ?? 1000;
    this.experience = opts?.experience ?? 1000;
    this.maxHp = this.experience;
    this.strength = opts?.strength ?? 10;
    this.gold = 0;
    this.magic = 0;
    this.crowns = 0;
    this.totalKills = 0;

    this.hasSword = false;
    this.holdItem = 'NONE';
    this.isFlying = false;
    this.flyTimer = 0;
    this.hasDeath = false;
    this.deathFollowerPos = null;
    this.canDiagonal = false;
    this.isStageCleared = false;
    this.deathInfo = null;
    this.stepCountSinceStone = 0;
    if (opts?.progressionConfig !== undefined) {
      this.activeProgressionConfig = opts.progressionConfig;
    }
  }

  public takeDamage(dmg: number, source?: DamageSource, currentTurn?: number): void {
    if (this.holdItem === 'CROSS') return; // 十字架所持中は無敵
    this.hp = Math.max(0, this.hp - dmg);
    if (this.hp <= 0 && !this.deathInfo) {
      this.recordDeath(dmg, source, currentTurn);
    }
  }

  public recordDeath(dmg: number, source?: DamageSource, currentTurn?: number): void {
    const cause = source?.cause ?? 'UNKNOWN';
    let message = '力尽き、ダンジョンの闇に呑まれた…';

    if (cause === 'MONSTER_ATTACK') {
      const name = source?.enemyDisplayName ?? source?.enemyName ?? 'モンスター';
      message = `${name} の痛烈な一撃（${dmg} ダメージ）により力尽きた…`;
    } else if (cause === 'MONSTER_COUNTER') {
      const name = source?.enemyDisplayName ?? source?.enemyName ?? 'モンスター';
      message = `${name} の反撃（${dmg} ダメージ）により力尽きた…`;
    } else if (cause === 'DRAGON_HEAD') {
      message = `ドラゴンの首の激しい反撃（${dmg} ダメージ）により粉砕された…`;
    } else if (cause === 'FIREBALL') {
      message = `ドラゴンの灼熱の火炎弾（${dmg} ダメージ）に焼き尽くされた…`;
    } else if (cause === 'GIVE_UP') {
      message = '過酷な迷宮の前に自ら探索を断念した（GIVE UP）…';
    } else if (cause === 'GIVE_UP_UNSOLVABLE') {
      message = '💀 詰み検知: 剣への到達経路が存在しないためギブアップ';
    }

    this.deathInfo = {
      cause,
      message,
      damage: dmg,
      enemyName: source?.enemyName,
      enemyDisplayName: source?.enemyDisplayName,
      enemyTypeId: source?.enemyTypeId,
      enemyColor: source?.enemyColor,
      dragonPartType: source?.dragonPartType,
      turn: currentTurn,
    };
  }

  /**
   * 経験値を加算（上限 655,350）
   */
  public addExperience(amount: number): number {
    const prev = this.experience;
    this.experience = Math.min(Player.MAX_EXPERIENCE, Math.max(0, this.experience + amount));
    if (this.maxHp < this.experience) {
      this.maxHp = Math.min(Player.MAX_HP, this.experience);
    }
    return this.experience - prev;
  }

  /**
   * パワーストーン1個奉納時のSTR上昇量を算出
   * - クラシック加算モード (ruleMode === 'CLASSIC' または rate === 0): 常に固定 flatBonus (+2,500)
   * - 指数インフレモード (ruleMode === 'EXPONENTIAL'):
   *   - 1個目 (現在STR < 1,000): +1,000 (序盤初期ブースト)
   *   - 2個目以降 (現在STR >= 1,000): floor(現在STR * rate) + flat (上限 655,350)
   *     デフォルト: rate=0.36, flat=2000
   */
  public static calculatePowerStoneGain(
    currentStrength: number,
    progressionConfig?: DungeonTuningParams['progressionConfig']
  ): number {
    const MAX_STR = Player.MAX_STR;
    if (currentStrength >= MAX_STR) return 0;

    const isClassic = progressionConfig?.ruleMode === 'CLASSIC' || (progressionConfig?.powerStoneGrowthRate === 0);
    if (isClassic) {
      const flat = progressionConfig?.powerStoneFlatBonus ?? 2500;
      return Math.min(flat, MAX_STR - currentStrength);
    }

    const rate = progressionConfig?.powerStoneGrowthRate ?? 0.36;
    const flat = progressionConfig?.powerStoneFlatBonus ?? 2000;
    const rawGain =
      currentStrength < 1000
        ? 1000
        : Math.floor(currentStrength * rate) + flat;
    return Math.min(rawGain, MAX_STR - currentStrength);
  }

  public healAtHome(progressionConfig?: DungeonTuningParams['progressionConfig']): HomeEventResult {
    const config = progressionConfig ?? this.activeProgressionConfig;
    if (progressionConfig) {
      this.activeProgressionConfig = progressionConfig;
    }

    const prevHp = this.hp;
    const goldConverted = this.gold;
    const powerStoneConverted = this.holdItem === 'POWER_STONE';
    const crownConverted = this.holdItem === 'CROWN';
    const deathPurified = this.hasDeath;

    // 王冠（CROWN）を手持ちにして帰還した場合、我が家に奉納
    if (crownConverted) {
      this.crowns = Math.min(4, this.crowns + 1);
      this.holdItem = 'NONE';
    }

    // 王冠4個を奉納完了でステージクリア
    if (this.crowns >= 4) {
      this.isStageCleared = true;
    }

    // コイン（GOLD）奉納による非戦闘EXP加算 & オーバーヒール
    let goldExpGained = 0;
    let goldBonusHp = 0;
    if (goldConverted > 0) {
      const isExponentialMode = config?.coinScalingMode === 'EXPONENTIAL' ||
        (config?.ruleMode === 'EXPONENTIAL') ||
        (!config?.ruleMode && (config?.expCurveMode === 'DAMPED_POWER' || config?.expCurveMode === 'PHASE_CAPPED'));
      if (isExponentialMode) {
        // 指数モード: 1枚につき固定300 EXP + 現在EXPの2%スケーリング
        const rawExp = goldConverted * 300 + Math.floor(this.experience * 0.02 * goldConverted);
        goldExpGained = this.addExperience(rawExp);
        // オーバーヒールHP: 1枚につき固定100 HP + 新EXPの5%スケーリング
        goldBonusHp = goldConverted * 100 + Math.floor(this.experience * 0.05 * goldConverted);
      } else {
        // クラシック仕様 (CLASSIC_LINEAR または ruleMode === 'CLASSIC'): 1枚につきHP+10
        goldExpGained = 0;
        goldBonusHp = goldConverted * 10;
      }
    }

    // 我が家に帰還時の回復: EXPが基本、GOLDによる一時上乗せ（上限 655,350）
    this.maxHp = Math.min(Player.MAX_HP, this.experience + goldBonusHp);
    this.hp = this.maxHp;
    this.gold = 0;
    this.deathInfo = null;

    let strGained = 0;
    // パワーストーンを持っていればインフレ成長曲線に基づきSTR上昇
    if (powerStoneConverted) {
      strGained = Player.calculatePowerStoneGain(this.strength, config);
      this.strength += strGained;
      this.holdItem = 'NONE';
    }

    // 死神を離脱・成仏
    if (deathPurified) {
      this.hasDeath = false;
      this.deathFollowerPos = null;
    }

    return {
      hpRestored: Math.max(0, this.hp - prevHp),
      prevHp,
      newHp: this.hp,
      goldConverted,
      goldBonusHp,
      goldExpGained,
      powerStoneConverted,
      strGained,
      crownConverted,
      deathPurified,
      stageCleared: this.isStageCleared,
    };
  }

  /**
   * 被ダメージ軽減に寄与する実効防御力（EXP × mitigationRatio）
   */
  public getEffectiveDefense(mitigationRatio: number = 1.0): number {
    return Math.floor(this.experience * mitigationRatio);
  }

  public get effectiveAttack(): number {
    return this.hasSword ? this.strength : 10;
  }

  public serialize(): PlayerSaveData {
    return {
      pos: { ...this.pos },
      dir: this.dir,
      hp: this.hp,
      maxHp: this.maxHp,
      strength: this.strength,
      experience: this.experience,
      gold: this.gold,
      magic: this.magic,
      crowns: this.crowns,
      totalKills: this.totalKills,
      hasSword: this.hasSword,
      holdItem: this.holdItem,
      isFlying: this.isFlying,
      flyTimer: this.flyTimer,
      hasDeath: this.hasDeath,
      deathFollowerPos: this.deathFollowerPos ? { ...this.deathFollowerPos } : null,
      canDiagonal: this.canDiagonal,
      isStageCleared: this.isStageCleared,
      stepCountSinceStone: this.stepCountSinceStone,
    };
  }

  public deserialize(data: PlayerSaveData): void {
    this.pos = { ...data.pos };
    this.dir = data.dir;
    this.hp = data.hp;
    this.maxHp = data.maxHp;
    this.strength = data.strength;
    this.experience = data.experience;
    this.gold = data.gold;
    this.magic = data.magic;
    this.crowns = data.crowns;
    this.totalKills = data.totalKills ?? 0;
    this.hasSword = data.hasSword;
    this.holdItem = data.holdItem;
    this.isFlying = data.isFlying;
    this.flyTimer = data.flyTimer;
    this.hasDeath = data.hasDeath;
    this.deathFollowerPos = data.deathFollowerPos ? { ...data.deathFollowerPos } : null;
    this.canDiagonal = data.canDiagonal;
    this.isStageCleared = data.isStageCleared;
    this.stepCountSinceStone = data.stepCountSinceStone ?? 0;
  }
}
