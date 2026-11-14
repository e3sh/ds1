import { Direction } from '../models/Types.js';

export type BotSkillProfile = 'NOVICE' | 'STANDARD' | 'EXPERT';

export type BotPhase =
  | 'BOOTSTRAP'        // 初期装備（剣・鍵・指輪）確保
  | 'GRAVE_SEAL'       // 墓封鎖（メタデータ出口優先封鎖・岩押し・氷像・十字架）
  | 'RESOURCE_FARM'    // 8歩周期宝箱開錠・パワーストーン奉納・コイン換金・MP備蓄
  | 'RELOCATE_HOME'    // 前線基地化: ドラゴン要塞外縁への我が家移転戦術
  | 'DRAGON_SLAY'      // ドラゴン要塞進軍＆安全マス首討伐
  | 'CROWN_ESCAPE';    // 王冠4個運搬・脱出

export type BotAction =
  | { type: 'MOVE'; dir: Direction }
  | { type: 'SPACE' }
  | { type: 'MAGIC'; magic: string }
  | { type: 'WAIT' }
  | { type: 'GIVE_UP' };

export type GraveSealPolicy = 'AUTO' | 'NONE' | 'NEAR_HOME' | 'ALL';
export type GraveSealTiming = 'EARLY' | 'PRE_DRAGON' | 'IMMEDIATE';

export interface BotStrategyTuning {
  graveSealPolicy?: GraveSealPolicy;
  graveSealTiming?: GraveSealTiming;
  nearHomeRadius?: number;
  maxTargetMagic?: number;
  graveSealEarlyStr?: number;
  enableHomeRelocation?: boolean;
  homeRelocateTargetDistMin?: number;
  homeRelocateTargetDistMax?: number;
  targetDefenseExp?: number;
}

/** マップ幾何サイズから導出される正規化距離スケール */
export interface TacticalScale {
  readonly width: number;
  readonly height: number;
  readonly maxToroidalDist: number; // (W + H) / 2
  readonly immediateRadius: number; // 至近距離 (約 0.05 * Lmax)
  readonly nearRadius: number;      // 近傍半径 (約 0.15 * Lmax)
  readonly midRadius: number;       // 中距離半径 (約 0.35 * Lmax)
  readonly farRadius: number;       // 遠征限界 (約 0.70 * Lmax)
}

/** トポロジー・成長設定・進行状況に応じて動的算出される戦術パラメータ */
export interface DynamicBotParameters {
  // 戦闘・ステータス目標
  targetStr: number;
  targetDefenseExp: number;
  graveSealEarlyStr: number;
  maxTargetMagic: number;
  minDragonMagic: number;

  // 安全・リスク許容度
  emergencyHpRatio: number;          // これを下回ると緊急帰還・回復優先 (0.35〜0.6)
  dangerHpRatio: number;             // 被ダメ危険ライン (0.25〜0.4)
  magicReserveThreshold: number;     // 温存すべき最小MP (0〜2)

  // 索敵・探索半径（幾何スケール連動）
  huntDistance: number;
  potionSearchDist: number;
  keySearchDist: number;
  stoneSearchDist: number;
  coinSearchDist: number;

  // ナビゲーション・BFSコスト特性
  allowBreakAsRoad: boolean;
  breakCostMultiplier: number;
  warpAvoidanceCost: number;
  maxBfsSteps: number;

  // 戦術ポリシー
  enableHomeRelocation: boolean;
  homeRelocateDistMin: number;
  homeRelocateDistMax: number;
  graveSealPolicy: GraveSealPolicy;
  enableGiveUp?: boolean;
}

export interface AutoPlayBotOptions {
  profile?: BotSkillProfile;
  maxTurnsLimit?: number;
  parameterOverrides?: Partial<DynamicBotParameters>;
  strategyTuning?: BotStrategyTuning;
  enableGiveUp?: boolean;
}

export type AdaptiveBotOptions = AutoPlayBotOptions;
