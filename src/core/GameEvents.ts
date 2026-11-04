import { Direction, DragonPartType, GameState, Position, TileType, DeathInfo } from '../models/Types.js';
import { Player, HomeEventResult } from '../models/Player.js';
import { EnemyInstance } from '../models/Enemy.js';
import { DragonPart } from '../models/Dragon.js';

export interface PlayerAttackEvent {
  attacker: Player;
  target: EnemyInstance | DragonPart;
  damage: number;
  killed: boolean;
  expGained: number;
}

export interface EnemyAttackEvent {
  enemy: EnemyInstance;
  damage: number;
  mitigatedByExp: number;
  killed: boolean;
  specialEffects?: string[];
}

export interface GraveSpawnEvent {
  pos: Position;
  enemyTypeId: number;
  success: boolean;
  blockedByCap: boolean;
}

export interface HomeSpawnEvent {
  pos: Position;
  headsKilled: number;
  success: boolean;
  blockedByCap: boolean;
  usedReserveSlot: boolean;
  evictedDistantEnemy: boolean;
}

export interface ChestOpenEvent {
  pos: Position;
  stepMod8: number;
  itemSpawned: TileType;
  cappedFallbackFrom?: TileType;
}

export interface GhostActionEvent {
  type: 'PICKUP' | 'DROP' | 'STEAL_FROM_PLAYER';
  item: TileType;
  pos: Position;
  ghostId?: string;
}

export interface PlayerMoveEvent {
  from: Position;
  to: Position;
  dir: Direction;
  pushedObject?: TileType;
}

export interface HomeReturnEvent {
  result: HomeEventResult;
  turn: number;
  playerStr: number;
  playerExp: number;
}

export interface DragonHeadKilledEvent {
  headType: DragonPartType;
  remainingHeads: number;
  turn: number;
}

export interface GameStateChangeEvent {
  prev: GameState;
  current: GameState;
  turn: number;
  deathInfo?: DeathInfo;
}

export interface MagicCastEvent {
  magicName: string;
  cost: number;
  success: boolean;
  details?: Record<string, unknown>;
}

export type GameEventMap = {
  'combat:playerAttack': PlayerAttackEvent;
  'combat:enemyAttack': EnemyAttackEvent;
  'spawn:grave': GraveSpawnEvent;
  'spawn:home': HomeSpawnEvent;
  'chest:open': ChestOpenEvent;
  'ghost:action': GhostActionEvent;
  'player:move': PlayerMoveEvent;
  'player:homeReturn': HomeReturnEvent;
  'dragon:headKilled': DragonHeadKilledEvent;
  'game:stateChange': GameStateChangeEvent;
  'magic:cast': MagicCastEvent;
};

export type GameEventName = keyof GameEventMap;
export type GameEventListener<K extends GameEventName> = (payload: GameEventMap[K]) => void;
export type WildcardGameEventListener = (event: GameEventName, payload: GameEventMap[GameEventName]) => void;
