import { GameEngine } from '../core/GameEngine.js';
import { Player } from '../models/Player.js';
import { WorldMap } from '../models/WorldMap.js';
import { Dragon } from '../models/Dragon.js';
import { Ghost } from '../models/Ghost.js';
import { MagicSystem } from '../systems/MagicSystem.js';
import { MovementSystem } from '../systems/MovementSystem.js';
import { MapProfiler } from '../systems/generator/MapProfiler.js';

import {
  AutoPlayBotOptions,
  BotAction,
  BotPhase,
  BotSkillProfile,
  DynamicBotParameters,
} from './BotTypes.js';
import { TacticalContext } from './TacticalContext.js';
import { AdaptiveNavigator } from './AdaptiveNavigator.js';
import { EightStepController } from './EightStepController.js';
import { SpatialKnowledge } from './perception/SpatialKnowledge.js';
import { SituationalPerception } from './perception/SituationalPerception.js';
import { MapSituationEvaluator } from './perception/MapSituationEvaluator.js';
import { EpisodicMemory } from './perception/EpisodicMemory.js';
import { TacticalSnapshot } from './perception/TacticalSnapshot.js';
import { StrategicPlanner } from './strategy/StrategicPlanner.js';
import { TacticalExecutor } from './tactics/TacticalExecutor.js';

export * from './BotTypes.js';
export { TacticalContext } from './TacticalContext.js';
export { AdaptiveNavigator } from './AdaptiveNavigator.js';

/**
 * AutoPlayBot (PST 3層アーキテクチャ自律エージェント)
 *
 * Perception (認知) - Strategy (戦略) - Tactics (戦術) の3層分離により、
 * 最新の階層テーマブロックマップ生成およびダンジョンチューニングに適応して動作する。
 */
export class AutoPlayBot {
  public readonly profile: BotSkillProfile;
  public currentPhase: BotPhase = 'BOOTSTRAP';
  public turnsInPhase: number = 0;
  public totalTurns: number = 0;

  public readonly nav: AdaptiveNavigator;
  public readonly eightStepController: EightStepController;
  public context?: TacticalContext;
  public params?: DynamicBotParameters;

  private unlockedBreakNotified: boolean = false;
  public isGivenUp: boolean = false;

  // テレメトリ
  public currentTargetDesc: string = '初期化中';
  public lastDecidedActionDesc: string = '待機';

  // PST 3層アーキテクチャユニット
  public readonly strategicPlanner: StrategicPlanner;
  public readonly tacticalExecutor: TacticalExecutor;
  public readonly episodicMemory: EpisodicMemory;
  public spatialKnowledge?: SpatialKnowledge;
  public readonly opts: AutoPlayBotOptions;

  constructor(opts: AutoPlayBotOptions = {}) {
    this.opts = opts;
    this.profile = opts.profile ?? 'STANDARD';
    this.nav = new AdaptiveNavigator();
    this.eightStepController = new EightStepController(this.nav);
    this.strategicPlanner = new StrategicPlanner();
    this.tacticalExecutor = new TacticalExecutor(this.nav, this.eightStepController);
    this.episodicMemory = new EpisodicMemory();
  }

  public setPhase(newPhase: BotPhase): void {
    if (this.currentPhase !== newPhase) {
      this.currentPhase = newPhase;
      this.turnsInPhase = 0;
      this.eightStepController.clearEightStepState();
      this.nav.clearUnreachableTargets();
    }
  }

  /**
   * 移動先が BLOCK の場合に BREAK / KICK 魔法詠唱へ解決・変換する共通ヘルパー
   */
  public resolveMoveOrBreak(action: BotAction, player: Player, map: WorldMap): BotAction {
    if (action.type !== 'MOVE') {
      return action;
    }

    const dir = action.dir;
    const nextPos = map.wrapPosition(MovementSystem.getNextPosition(player.pos, dir));
    const obj = map.getObject(nextPos);

    if (obj === 'BLOCK') {
      if (MagicSystem.canCast(player, 'BREAK').allowed) {
        player.dir = dir;
        this.nav.clearUnreachableTargets();
        return { type: 'MAGIC', magic: 'BREAK' };
      }
      if (MagicSystem.canCast(player, 'KICK').allowed) {
        player.dir = dir;
        this.nav.clearUnreachableTargets();
        return { type: 'MAGIC', magic: 'KICK' };
      }
    }

    return action;
  }

  /**
   * 1ステップ進行
   */
  public step(engine: GameEngine): BotAction {
    const player = engine.getPlayer();
    const map = engine.getMap ? engine.getMap() : (engine as any).getWorldMap();
    const prevPos = { ...player.pos };

    this.totalTurns++;
    this.turnsInPhase++;

    const action = this.decideAction(engine);
    this.lastDecidedActionDesc = this.formatAction(action);

    switch (action.type) {
      case 'MOVE':
        engine.executeTurn(action.dir);
        break;
      case 'SPACE':
        engine.executeTurn(null);
        break;
      case 'MAGIC':
        engine.castMagic(action.magic);
        break;
      case 'WAIT':
        engine.executeTurn(null, true);
        break;
      case 'GIVE_UP':
        this.isGivenUp = true;
        engine.handleGameOver({
          cause: 'GIVE_UP_UNSOLVABLE',
          message: this.currentTargetDesc || '💀 詰み検知: 進行経路が存在しないためギブアップ',
          damage: 0,
          turn: engine.getTotalTurns(),
        });
        break;
    }

    const newPos = engine.getPlayer().pos;
    if (prevPos.x !== newPos.x || prevPos.y !== newPos.y) {
      const dist = map.getTorusDistance(prevPos, newPos);
      if (dist.chebyshev > 1) {
        this.nav.recordWarpEvent(prevPos, newPos);
      }
    }

    return action;
  }

  public handleStuckRescue(): void {
    this.nav.triggerRescue(4);
    this.currentTargetDesc = '⚠️ スタック救出: 連続安全徘徊';
  }

  public formatAction(action: BotAction): string {
    switch (action.type) {
      case 'MOVE': return `移動 [${action.dir}]`;
      case 'SPACE': return 'アクション [SPACE]';
      case 'MAGIC': return `魔法 [${action.magic}]`;
      case 'WAIT': return '待機';
      case 'GIVE_UP': return 'ギブアップ [GIVE_UP]';
    }
  }

  public getTutorialMessage(): string {
    switch (this.currentPhase) {
      case 'BOOTSTRAP': return '💡【初期探索】まずは身を守る「剣」と、宝箱を開ける「鍵」を確保します。';
      case 'GRAVE_SEAL': return '💡【墓封鎖】モンスターが湧き出る墓を出口からブロックや十字架で封鎖します。';
      case 'RESOURCE_FARM': return '💡【資源育成】8歩周期でパワーストーンを出現させ、我が家に奉納してSTRを強化します。';
      case 'RELOCATE_HOME': return '💡【前線基地化】RINGで我が家をドラゴン要塞の近くへ移動し、安全拠点を構築します。';
      case 'DRAGON_SLAY': return '💡【決戦】ドラゴンの首のブレス射線を避け、安全な斜め位置から首を攻撃します！';
      case 'CROWN_ESCAPE': return '💡【王冠脱出】ドラゴンの全首を撃破！出現した4つの王冠を我が家へ運搬します。';
    }
  }

  /**
   * PSTモデル（Perception - Strategy - Tactics 3層分離）のアクティブミッションから表示・コンテキスト用フェーズを同期する
   */
  private syncPhaseFromMission(missionId: string | undefined, dragon?: Dragon): void {
    if (dragon && (dragon.isAllHeadsDefeated || dragon.heads.every(h => !h.isAlive))) {
      this.setPhase('CROWN_ESCAPE');
      return;
    }
    switch (missionId) {
      case 'BOOTSTRAP_SWORD':
        this.setPhase('BOOTSTRAP');
        break;
      case 'SEAL_GRAVE':
        this.setPhase('GRAVE_SEAL');
        break;
      case 'RELOCATE_HOME':
        this.setPhase('RELOCATE_HOME');
        break;
      case 'SLAY_DRAGON':
        this.setPhase('DRAGON_SLAY');
        break;
      case 'CROWN_ESCAPE':
        this.setPhase('CROWN_ESCAPE');
        break;
      case 'HARVEST_POWER_STONE':
      case 'CLEAR_TREASURE_ZONE':
      case 'EARLY_BREAK_UNLOCK':
      case 'CASH_IN_GOLD':
      case 'PREPARE_DRAGON_ASSAULT':
      case 'EXPLORE_WANDER':
      default:
        this.setPhase('RESOURCE_FARM');
        break;
    }
  }

  /**
   * メイン意思決定ルーチン (PSTモデル: Perception - Strategy - Tactics 3層分離)
   */
  public decideAction(engine: GameEngine): BotAction {
    const player = engine.getPlayer();
    const map = engine.getMap ? engine.getMap() : (engine as any).getWorldMap();
    const enemies = engine.getEnemies().filter(e => e.isAlive);
    const dragon = engine.getDragon();
    const ghosts: Ghost[] = engine.getGhosts ? engine.getGhosts() : [];
    const tuning = typeof engine.getActiveTuningParams === 'function' ? engine.getActiveTuningParams() : undefined;

    // 0. コンテキストと動的パラメータの更新
    if (!this.context || (map as any) !== (this as any)._lastMapRef) {
      const metrics = MapProfiler.measureGeometricMetrics(map);
      this.context = new TacticalContext(map, { tuning, profile: this.profile, metrics });
      (this as any)._lastMapRef = map;
    }

    if (dragon && (dragon.isAllHeadsDefeated || dragon.heads.every(h => !h.isAlive))) {
      this.setPhase('CROWN_ESCAPE');
    }

    this.params = this.context.resolveParameters(this.currentPhase, player, dragon, enemies, {
      totalTurns: this.totalTurns,
      enableGiveUp: this.opts.enableGiveUp,
    });
    MagicSystem.updatePassiveSkills(player);

    // BREAK 解禁検知
    if (!this.unlockedBreakNotified && player.experience >= 4000) {
      this.unlockedBreakNotified = true;
      this.nav.clearUnreachableTargets();
      this.episodicMemory.clearAllUnreachableTargets();
    }

    // ナビゲータおよびエピソード記憶のターン更新
    this.nav.updateTurn(player.pos);
    this.episodicMemory.recordStep(player.pos, this.totalTurns);

    // 1. 【認知・知識ユニット (Perception & Knowledge)】
    if (!this.spatialKnowledge) {
      this.spatialKnowledge = new SpatialKnowledge(map, map.tacticalMetadata);
    }
    this.spatialKnowledge.update(map);

    const milestones = SituationalPerception.evaluateMilestones(player, this.params, dragon);
    const threats = SituationalPerception.evaluateThreats(player, map, enemies, dragon, this.params);
    const stagnation = SituationalPerception.evaluateStagnation(
      player,
      map,
      enemies,
      this.nav,
      dragon,
      this.params
    );
    const situation = MapSituationEvaluator.evaluate(
      player,
      map,
      enemies,
      dragon,
      ghosts,
      this.nav,
      this.episodicMemory,
      this.params,
      this.totalTurns,
      undefined,
      this.spatialKnowledge
    );

    const snapshot: TacticalSnapshot = {
      spatial: this.spatialKnowledge,
      milestones,
      threats,
      stagnation,
      situation,
      player: {
        pos: { ...player.pos },
        hp: player.hp,
        maxHp: player.maxHp,
        strength: player.strength,
        experience: player.experience,
        magic: player.magic,
        gold: player.gold,
        holdItem: player.holdItem,
        hasSword: player.hasSword,
        isFlying: player.isFlying,
        canDiagonal: milestones.canDiagonal,
        hasDeath: player.hasDeath,
        stepCountSinceStone: player.stepCountSinceStone,
      },
      dragon: dragon ? {
        center: dragon.centerPos,
        livingHeadsCount: dragon.heads.filter(h => h.isAlive).length,
        defeatedHeadsCount: dragon.defeatedHeadsCount,
        isAllHeadsDefeated: dragon.isAllHeadsDefeated,
        livingHeadPositions: dragon.heads.filter(h => h.isAlive).map(h => ({ ...h.pos })),
        heads: dragon.heads.map(h => ({
          type: h.type,
          pos: { ...h.pos },
          hp: h.hp,
          def: h.def,
          isAlive: h.isAlive,
          attackSpots: this.spatialKnowledge!.calculateHeadAttackSpots(h, dragon, map),
        })),
      } : undefined,
      livingEnemies: enemies,
      memory: this.episodicMemory,
      params: this.params,
      map,
      totalTurns: this.totalTurns,
    };

    // 2. 【判断・指示：戦略ユニット (Strategic Planner)】
    const directive = this.strategicPlanner.planTurn(snapshot, engine);
    this.syncPhaseFromMission(this.strategicPlanner.activeMission?.id, dragon);
    const missionName = this.strategicPlanner.activeMission?.name ?? '作戦なし';

    if (directive.type === 'GIVE_UP') {
      this.isGivenUp = true;
      this.currentTargetDesc = directive.reason;
      return { type: 'GIVE_UP' };
    }

    // 3. 【行動：戦術実行ユニット (Tactical Execution)】
    const execResult = this.tacticalExecutor.execute(directive, snapshot, engine);
    this.currentTargetDesc = `[${missionName}] ${execResult.description}`;

    // 戦術実行結果（成功・経路遮断・膠着）を戦略層へフィードバック
    this.strategicPlanner.recordExecutionResult(directive, execResult, snapshot);

    if (execResult.action.type === 'GIVE_UP') {
      this.isGivenUp = true;
      return { type: 'GIVE_UP' };
    }

    return this.resolveMoveOrBreak(execResult.action, player, map);
  }

  public getTelemetryStatus(player: Player, _map?: WorldMap, turn?: number): string {
    const t = turn ?? this.totalTurns;
    return `T:${t} [${this.currentPhase}] HP:${player.hp}/${player.maxHp} STR:${player.strength} MP:${player.magic} | ${this.currentTargetDesc}`;
  }
}

export const AdaptiveAutoPlayBot = AutoPlayBot;
export type AdaptiveAutoPlayBot = AutoPlayBot;
