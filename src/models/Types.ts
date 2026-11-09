export type Direction = 
  | 'UP' 
  | 'DOWN' 
  | 'LEFT' 
  | 'RIGHT' 
  | 'UP_LEFT' 
  | 'UP_RIGHT' 
  | 'DOWN_LEFT' 
  | 'DOWN_RIGHT';

export interface Position {
  x: number;
  y: number;
}

export type TileType =
  | 'EMPTY'        // 通行可能マス（床）
  | 'WALL_STATIC'  // 外壁（破壊・移動不可）
  | 'BLOCK'        // 岩・障害物（指輪で押せる / BREAKで壊せる）
  | 'GRAVE'        // 墓（モンスター出現場所）
  | 'HOME'         // 我が家
  | 'CHEST'        // 宝箱（鍵で開封）
  | 'CHEST_DRAGON' // ドラゴンの宝箱
  | 'WARP'         // ワープゾーン
  | 'CROSS'        // 地面の十字架
  | 'KEY'          // 地面の鍵
  | 'RING'         // 地面の指輪
  | 'SWORD'        // 剣
  | 'COIN'         // コイン
  | 'POTION'       // 魔法の壺
  | 'POWER_STONE'  // 落ちているパワーストーン
  | 'DEATH'        // 地面に残った死神
  | 'CROWN';       // 王冠 (ドラゴンの宝箱から出現)

export type HoldItemType = 'NONE' | 'POWER_STONE' | 'CROSS' | 'KEY' | 'RING' | 'CROWN';

export type MagicType = 
  | 'JUMP' 
  | 'RETURN' 
  | 'MAP' 
  | 'BREAK' 
  | 'KICK' 
  | 'FREEZE' 
  | 'FLASH' 
  | 'FLY' 
  | 'SAVE';

export type PaletteMode = 'NORMAL' | 'PINCH' | 'DARK';

export type ThreatLevel =
  | 'ONE_SHOT'   // 青: 一撃で倒して、貰わない (1ターンキル)
  | 'SAFE'       // 緑: 入り、貰わない (数発以内で安全に撃破)
  | 'STALEMATE'  // 黄: 入らず貰わない (膠着) または 入り貰う (即死しないHPトレード)
  | 'DANGER'     // 赤: 入らず、ダメージ貰う (危険・特殊能力被害あり)
  | 'LETHAL';    // 黒: 入らず、相手から即死 (1撃死)

export type AttackThreat = 'ONE_SHOT' | 'EFFECTIVE' | 'INEFFECTIVE';
export type DefenseThreat = 'NO_DAMAGE' | 'TAKES_DAMAGE' | 'LETHAL';

export interface ThreatEvaluationDetails {
  attackThreat: AttackThreat;
  defenseThreat: DefenseThreat;
  isRiskyOneShot: boolean;   // ONE_SHOT かつ TAKES_DAMAGE
  isLethalOneShot: boolean;  // ONE_SHOT かつ LETHAL（一撃だが一撃・ガラスの剣）
  turnsToKill: number;
  damageToEnemy: number;
  damageToPlayer: number;
  hasDrain: boolean;
  overallThreat: ThreatLevel; // 既存互換
}

export interface ThreatTargetStats {
  hp: number;
  atk: number;
  def: number;
  drainAtk?: number;
  drainExp?: number;
  stealPotion?: boolean;
}

export type GameState = 'TITLE' | 'PLAYING' | 'GAMEOVER' | 'STAGECLEAR';

export type DragonPartType = 'BODY' | 'LEFT_HEAD' | 'CENTER_HEAD' | 'RIGHT_HEAD' | 'TAIL';

export interface Fireball {
  id: string;
  pos: Position;
  dir: Direction;
  damage: number;
  isAlive: boolean;
}

export interface TargetEnemyInfo {
  name: string;
  displayName: string;
  typeId?: number;
  symbol: string;
  color: string;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  frozenTimer?: number;
  isPermanentlyFrozen?: boolean;
  drainAtk?: number;
  drainExp?: number;
  stealPotion?: boolean;
  isDragon?: boolean;
  threatLevel?: ThreatLevel;
  threatDetails?: ThreatEvaluationDetails;
}

export interface CombatResult {
  damageToEnemy: number;
  damageToPlayer: number;
  enemyKilled: boolean;
}

export type DeathCauseType =
  | 'MONSTER_ATTACK'     // 敵AI手番での攻撃
  | 'MONSTER_COUNTER'    // プレイヤー体当たり時の敵反撃
  | 'DRAGON_HEAD'        // ドラゴンの首への攻撃時の反撃
  | 'FIREBALL'           // ドラゴンの火炎弾直撃
  | 'GIVE_UP'            // 自発的リタイア
  | 'GIVE_UP_UNSOLVABLE' // 物理的詰み検知によるボット早期ギブアップ
  | 'UNKNOWN';

export interface DeathInfo {
  cause: DeathCauseType;
  message: string;
  damage: number;
  enemyName?: string;
  enemyDisplayName?: string;
  enemyTypeId?: number;
  enemyColor?: string;
  dragonPartType?: DragonPartType;
  turn?: number;
}

export interface DamageSource {
  cause: DeathCauseType;
  damage?: number;
  enemyName?: string;
  enemyDisplayName?: string;
  enemyTypeId?: number;
  enemyColor?: string;
  dragonPartType?: DragonPartType;
}

export type MapDifficulty = 'EASY' | 'NORMAL' | 'HARD';

export type PlayPacingMode = 'BLITZ' | 'STANDARD' | 'MARATHON';

export type DungeonArchetype =
  | 'BALANCED'      // 通常バランス型
  | 'SANCTUARY'     // 聖域: 十字架多数 (4〜8本)、ゴースト多数、結界陣地防衛戦術が鍵
  | 'WARP_NEXUS'    // ワープ迷宮: 12〜16ペアのワープが密集する移動＆障害物パズル
  | 'ARMORY';       // 武器庫: 複数の剣 (3〜5本) が散在し予備キープや床置き誘導が可能

export type DungeonTopology =
  | 'STANDARD_ROOMS'
  | 'PILLAR_GRID'
  | 'NARROW_MAZE'
  | 'SPIRAL_LABYRINTH'
  | 'FORTRESS_ARENA'
  | 'MULTI_SECTOR'
  | 'CLASSIC_FIXED';

export type ExpCurveMode = 'CLASSIC_LINEAR' | 'DAMPED_POWER' | 'PHASE_CAPPED';

export type RuleMode = 'CLASSIC' | 'EXPONENTIAL';
export type CoinScalingMode = 'LINEAR' | 'EXPONENTIAL';

export interface ItemCapRule {
  initial: number;
  maxCap: number;
}

export interface DungeonTuningParams {
  // 1. スポーン＆家湧き制御 (課題1対策)
  spawnConfig?: {
    maxFieldEnemiesByPhase?: [number, number, number, number]; // 首0, 1, 2, 3本時の通常墓湧き上限
    homeSpawnReserveByPhase?: [number, number, number, number]; // 首0, 1, 2, 3本時の家湧き専用別枠スロット
    evictDistantEnemyOnHomeSpawn?: boolean; // 上限到達時に遠方の非交戦敵を消してでも家から湧かせるか
  };

  // 2. 成長・戦闘カーブ制御 (課題2対策)
  progressionConfig?: {
    ruleMode?: RuleMode;                // ルールモード: CLASSIC (完全オリジナル加算) vs EXPONENTIAL (現行指数インフレ)
    coinScalingMode?: CoinScalingMode;  // コイン効果モード: LINEAR (HP+10) vs EXPONENTIAL (EXP加算&割合HP)
    expCurveMode?: ExpCurveMode;
    expDampingExponent?: number;        // DAMPED_POWER時の指数 (例: 0.75)
    expScaleFactor?: number;            // DAMPED_POWER / 全体EXP獲得倍率補正 (デフォルト: 1.0)
    expPhaseCaps?: [number, number, number, number]; // PHASE_CAPPED時の首0,1,2,3本ごとの単体獲得上限または実効キャップ
    expDefenseMitigationRatio?: number; // EXPが被ダメ軽減に寄与する倍率 (デフォルト: 1.0)
    powerStoneGrowthRate?: number;      // パワーストーン複利成長率 (デフォルト: 0.36)
    powerStoneFlatBonus?: number;       // パワーストーン固定加算値 (デフォルト: 2000)
    dragonDefRatio?: number;            // ドラゴン首DEF倍率 (デフォルト: 1.0)
    enemyAtkRatio?: number;             // 一般モンスターATK倍率 (デフォルト: 1.0)
  };

  // 3. 非消耗アイテム上限＆ゴースト制御 (課題3対策)
  resourceCapConfig?: {
    cross?: ItemCapRule;
    ring?: ItemCapRule;
    key?: ItemCapRule;
    sword?: ItemCapRule;
    chestCount?: number;
    graveCount?: number;
    ghostCount?: number;
    ghostMoveIntervalMs?: number;
  };
}

/** 全項目がデフォルトまたはプリセットで解決済みの確定パラメータ型 */
export interface ResolvedDungeonTuningParams {
  spawnConfig: Required<NonNullable<DungeonTuningParams['spawnConfig']>>;
  progressionConfig: Required<NonNullable<DungeonTuningParams['progressionConfig']>>;
  resourceCapConfig: Required<NonNullable<DungeonTuningParams['resourceCapConfig']>>;
}

