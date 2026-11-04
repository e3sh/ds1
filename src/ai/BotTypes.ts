import { Direction } from '../models/Types.js';

export type BotSkillProfile = 'NOVICE' | 'STANDARD' | 'EXPERT';

export type GraveSealPolicy = 'AUTO' | 'NONE' | 'NEAR_HOME' | 'ALL';
export type GraveSealTiming = 'EARLY' | 'PRE_DRAGON' | 'IMMEDIATE';

export interface BotStrategyTuning {
  graveSealPolicy?: GraveSealPolicy;
  graveSealTiming?: GraveSealTiming;
  nearHomeRadius?: number;        // 我が家周辺と見なすマンハッタン距離 (デフォルト 12)
  maxTargetMagic?: number;        // 目標MPストック数 (デフォルト 5)
  graveSealEarlyStr?: number;     // EARLY時のSTR閾値 (デフォルト 30,000)
  enableHomeRelocation?: boolean; // 我が家前線基地移転戦術の有効化 (デフォルト true)
  homeRelocateTargetDistMin?: number; // 目標チェビシェフ距離最小 (デフォルト 5)
  homeRelocateTargetDistMax?: number; // 目標チェビシェフ距離最大 (デフォルト 8)
  targetDefenseExp?: number;      // 決戦前の目標EXP（防御力・最大HP、ノコノコATK 415,000耐性、デフォルト 350,000）
}

export interface MapAssessment {
  totalGraves: number;
  openGraves: number;
  nearHomeGraves: number;
  totalChests: number;
  totalPotions: number;
  totalCrosses: number;
  totalBlocks: number;
  recommendedPolicy: GraveSealPolicy;
}

export type BotPhase =
  | 'BOOTSTRAP'      // フェーズ1: 剣・鍵・指輪の初期確保
  | 'GRAVE_SEAL'     // フェーズ2: 8方向墓封鎖（指輪ブロック押し・FREEZE氷像バリケード・十字架）
  | 'POWER_RUSH'     // フェーズ3: 8歩宝箱開錠＆パワーストーン奉納＆RETURN帰還
  | 'FARMING'        // 互換性エイリアス（POWER_RUSHと同義）
  | 'GRAVE_CONTROL'  // 互換性エイリアス（GRAVE_SEALと同義）
  | 'RELOCATE_HOME'  // 前線基地化: ドラゴン要塞外縁への我が家移転戦術
  | 'DRAGON_SLAY'    // フェーズ4: ドラゴン要塞進軍＆安全マス首討伐
  | 'CROWN_ESCAPE';  // フェーズ5: 魔法封印下での王冠4個運搬・脱出

export type BotAction =
  | { type: 'MOVE'; dir: Direction }
  | { type: 'SPACE' }
  | { type: 'MAGIC'; magic: string }
  | { type: 'WAIT' };

export interface AutoPlayBotOptions {
  profile?: BotSkillProfile;
  maxTurnsLimit?: number;
  strategyTuning?: BotStrategyTuning;
}
