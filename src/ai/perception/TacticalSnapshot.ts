import { Position } from '../../models/Types.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { WorldMap } from '../../models/WorldMap.js';
import { DynamicBotParameters } from '../BotTypes.js';
import { SpatialKnowledge } from './SpatialKnowledge.js';
import { GrowthMilestones, ThreatDistribution, StagnationState } from './SituationalPerception.js';
import { EpisodicMemory } from './EpisodicMemory.js';
import type { MapSituationSummary } from './MapSituationEvaluator.js';

export interface TacticalDragonHead {
  type: string;
  pos: Position;
  hp: number;
  def: number;
  isAlive: boolean;
  attackSpots: Position[];
}

/**
 * 認知ユニットが毎ターン生成する、世界の客観的事実のスナップショット。
 * 戦略ユニット（Strategic Planner）はこれのみを参照して意思決定を行う。
 */
export interface TacticalSnapshot {
  /** 空間トポロジー、ゾーン、開削点、墓パズルの構造化知識 */
  spatial: SpatialKnowledge;
  /** プレイヤーの成長マイルストーン進捗 */
  milestones: GrowthMilestones;
  /** 脅威・危険度分布 */
  threats: ThreatDistribution;
  /** ヒートマップ・局所停滞・拘束状況 */
  stagnation: StagnationState;
  /** プレイヤーの客観的状態 */
  player: {
    pos: Position;
    hp: number;
    maxHp: number;
    strength: number;
    experience: number;
    magic: number;
    gold: number;
    holdItem: string;
    hasSword: boolean;
    isFlying: boolean;
    canDiagonal: boolean;
    hasDeath: boolean;
    stepCountSinceStone: number;
  };
  /** ドラゴンの客観的状態 */
  dragon?: {
    center: Position;
    livingHeadsCount: number;
    defeatedHeadsCount: number;
    isAllHeadsDefeated: boolean;
    livingHeadPositions: Position[];
    heads: TacticalDragonHead[];
  };
  /** 生存敵リスト */
  livingEnemies: EnemyInstance[];
  /** エピソード記憶（到達不能、スタック、訪問履歴） */
  memory: EpisodicMemory;
  /** 動的戦術パラメータ（目標STR, 目標EXP等） */
  params: DynamicBotParameters;
  /** ワールドマップへの参照 */
  map: WorldMap;
  /** 総経過ターン */
  totalTurns: number;
  /** 認知層による毎ターンのマップ状況一括要約 */
  situation?: MapSituationSummary;
}
