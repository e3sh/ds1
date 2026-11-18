import { GameEngine } from '../core/GameEngine.js';
import { Player } from '../models/Player.js';
import { WorldMap } from '../models/WorldMap.js';
import {
  CommanderTransitionSummary,
  DeathCauseType,
  DeathStallKind,
  GiveUpCategory,
} from '../models/Types.js';
import { Dragon } from '../models/Dragon.js';
import { Ghost } from '../models/Ghost.js';
import { MagicSystem } from '../systems/MagicSystem.js';
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
import { StrategicCommander } from './strategy/command/StrategicCommander.js';
import { DEFAULT_COMMANDER_CONFIG } from './strategy/command/CommanderTypes.js';
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
  private lastGiveUpMeta: {
    cause: DeathCauseType;
    category: GiveUpCategory;
    stallKind?: DeathStallKind;
  } | null = null;

  // テレメトリ
  public currentTargetDesc: string = '初期化中';
  public lastDecidedActionDesc: string = '待機';

  // PST 3層アーキテクチャユニット + 上位指揮官
  public readonly commander: StrategicCommander;
  public readonly strategicPlanner: StrategicPlanner;
  public readonly tacticalExecutor: TacticalExecutor;
  public readonly episodicMemory: EpisodicMemory;
  public spatialKnowledge?: SpatialKnowledge;
  public readonly opts: AutoPlayBotOptions;

  constructor(opts: AutoPlayBotOptions = {}) {
    this.opts = opts;
    this.profile = opts.profile ?? 'STANDARD';
    this.episodicMemory = new EpisodicMemory();
    this.nav = new AdaptiveNavigator(this.episodicMemory);
    this.eightStepController = new EightStepController(this.nav);
    this.commander = new StrategicCommander();
    this.strategicPlanner = new StrategicPlanner();
    this.tacticalExecutor = new TacticalExecutor(this.nav, this.eightStepController);
  }

  public setPhase(newPhase: BotPhase): void {
    if (this.currentPhase !== newPhase) {
      this.currentPhase = newPhase;
      this.turnsInPhase = 0;
      this.eightStepController.clearEightStepState();
    }
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
      case 'GIVE_UP': {
        this.isGivenUp = true;
        const diag = this.getDiagnosticSnapshot();
        const cause = this.lastGiveUpMeta?.cause ?? 'GIVE_UP_UNSOLVABLE';
        engine.handleGameOver({
          cause,
          message: `${this.currentTargetDesc || '💀 詰み検知: 進行経路が存在しないためギブアップ'} | ${this.buildBoardSummaryForGiveUp(engine)}`,
          damage: 0,
          turn: engine.getTotalTurns(),
          giveUpCategory: this.lastGiveUpMeta?.category ?? 'OTHER',
          stallKind: this.lastGiveUpMeta?.stallKind,
          finalMissionId: diag.finalMissionId,
          finalMissionName: diag.finalMissionName,
          commanderLevel: diag.commanderLevel,
          commanderTransitions: diag.commanderTransitions,
        });
        break;
      }
    }

    // 戦闘死などで GAMEOVER になった場合も Bot 診断メタデータを補完
    const afterPlayer = engine.getPlayer();
    if (afterPlayer.deathInfo && !afterPlayer.deathInfo.finalMissionId) {
      const diag = this.getDiagnosticSnapshot();
      afterPlayer.deathInfo.finalMissionId = diag.finalMissionId;
      afterPlayer.deathInfo.finalMissionName = diag.finalMissionName;
      afterPlayer.deathInfo.commanderLevel = diag.commanderLevel;
      afterPlayer.deathInfo.commanderTransitions = diag.commanderTransitions;
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
      case 'EXPLORE_FRONTIER':
      case 'STRATEGIC_BREAK':
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
      strategyTuning: this.opts.strategyTuning,
      parameterOverrides: this.opts.parameterOverrides,
      enableGiveUp: this.opts.enableGiveUp,
    });
    MagicSystem.updatePassiveSkills(player);

    // BREAK 解禁検知
    if (!this.unlockedBreakNotified && player.experience >= 4000) {
      this.unlockedBreakNotified = true;
      this.episodicMemory.clearAllUnreachableTargets();
    }

    // ナビゲータのタイマー更新
    this.nav.updateTurn();

    // 1. 【認知・知識ユニット (Perception & Knowledge)】
    if (!this.spatialKnowledge) {
      this.spatialKnowledge = new SpatialKnowledge(map, map.tacticalMetadata);
    }
    this.spatialKnowledge.update(map);

    const milestones = SituationalPerception.evaluateMilestones(player, this.params, dragon);
    const threats = SituationalPerception.evaluateThreats(player, map, enemies, dragon, this.params);
    const confinement = SituationalPerception.evaluateConfinement(player, map, enemies);
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

    // 台帳の更新と進捗窓の構築
    const dragonTotalHeadHp = dragon ? dragon.heads.reduce((s, h) => s + (h.isAlive ? h.hp : 0), 0) : 0;
    const dragonDefeatedHeads = dragon ? dragon.defeatedHeadsCount : 0;
    this.episodicMemory.recordTurn({
      turn: this.totalTurns,
      pos: player.pos,
      hp: player.hp,
      maxHp: player.maxHp,
      strength: player.strength,
      experience: player.experience,
      magic: player.magic,
      gold: player.gold,
      holdItem: player.holdItem,
      hasSword: player.hasSword,
      remainingChests: situation.items.totalActualChests,
      dragonTotalHeadHp,
      dragonDefeatedHeads,
      crownsDelivered: player.crowns,
      homePos: map.realHomePos,
    });
    const windowSize = this.params.commander?.windowSize ?? DEFAULT_COMMANDER_CONFIG.windowSize;
    const progress = this.episodicMemory.buildProgressWindow(this.totalTurns, map, windowSize);

    const snapshot: TacticalSnapshot = {
      spatial: this.spatialKnowledge,
      milestones,
      threats,
      confinement,
      progress,
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

    // 2. 【監察・判断・指示：上位指揮官 & 戦略ユニット (Commander & Strategic Planner)】
    const orders = this.commander.review(snapshot, this.strategicPlanner.getMissionReport(), engine);
    const directive = this.strategicPlanner.planTurn(snapshot, engine, orders);
    this.syncPhaseFromMission(this.strategicPlanner.activeMission?.id, dragon);
    const missionName = this.strategicPlanner.activeMission?.name ?? '作戦なし';

    if (directive.type === 'GIVE_UP') {
      this.isGivenUp = true;
      this.currentTargetDesc = directive.reason;
      this.lastGiveUpMeta = this.resolveGiveUpMeta(directive.giveUpMeta);
      return { type: 'GIVE_UP' };
    }

    // 3. 【行動：戦術実行ユニット (Tactical Execution)】
    const execResult = this.tacticalExecutor.execute(directive, snapshot, engine);
    this.currentTargetDesc = `[${missionName}] ${execResult.description}`;

    // 戦術実行結果（成功・経路遮断・膠着）を戦略層へフィードバック
    this.strategicPlanner.recordExecutionResult(directive, execResult, snapshot);

    if (execResult.action.type === 'GIVE_UP') {
      this.isGivenUp = true;
      this.lastGiveUpMeta = this.resolveGiveUpMeta(directive.giveUpMeta);
      return { type: 'GIVE_UP' };
    }

    return execResult.action;
  }

  public getTelemetryStatus(player: Player, _map?: WorldMap, turn?: number): string {
    const t = turn ?? this.totalTurns;
    return `T:${t} [${this.currentPhase}] HP:${player.hp}/${player.maxHp} STR:${player.strength} MP:${player.magic} | ${this.currentTargetDesc}`;
  }

  public getDiagnosticSnapshot(maxTransitions: number = 6): {
    finalMissionId: string;
    finalMissionName: string;
    commanderLevel: string;
    commanderTransitions: CommanderTransitionSummary[];
  } {
    const active = this.strategicPlanner.activeMission;
    const lastHist = this.strategicPlanner.missionHistory.at(-1);
    const finalMissionId = active?.id ?? lastHist?.missionId ?? 'NONE';
    const finalMissionName = active?.name ?? finalMissionId;
    const commanderTransitions: CommanderTransitionSummary[] = this.commander.verdicts
      .slice(-maxTransitions)
      .map(v => ({
        turn: v.turn,
        from: v.from,
        to: v.to,
        stallKind: v.stallKind,
        reason: v.reason,
      }));
    return {
      finalMissionId,
      finalMissionName,
      commanderLevel: this.commander.level,
      commanderTransitions,
    };
  }

  private resolveGiveUpMeta(meta?: {
    category: 'PHYSICAL_TRAP' | 'AI_STALL';
    stallKind: DeathStallKind;
  }): { cause: DeathCauseType; category: GiveUpCategory; stallKind?: DeathStallKind } {
    if (meta) {
      let cause: DeathCauseType = 'GIVE_UP_UNSOLVABLE';
      switch (meta.stallKind) {
        case 'SWORD_TRAPPED':
          cause = 'GIVE_UP_SWORD_TRAPPED';
          break;
        case 'CONFINED':
          cause = 'GIVE_UP_CONFINED';
          break;
        case 'CHURN':
          cause = 'GIVE_UP_STALL_CHURN';
          break;
        case 'LOOP':
          cause = 'GIVE_UP_STALL_LOOP';
          break;
        case 'FRUITLESS':
          cause = 'GIVE_UP_STALL_FRUITLESS';
          break;
      }
      return { cause, category: meta.category, stallKind: meta.stallKind };
    }
    return { cause: 'GIVE_UP_UNSOLVABLE', category: 'OTHER' };
  }

  private buildBoardSummaryForGiveUp(engine: GameEngine): string {
    const p = engine.getPlayer();
    const map = engine.getMap ? engine.getMap() : (engine as any).getWorldMap();
    const livingEnemies = engine.getEnemies().filter(e => e.isAlive).length;
    let chests = 0;
    let potions = 0;
    let stones = 0;
    let keys = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.getObject(x, y) === 'CHEST') chests++;
        const item = map.getItem(x, y);
        if (item === 'POTION') potions++;
        else if (item === 'POWER_STONE') stones++;
        else if (item === 'KEY') keys++;
      }
    }
    return `盤面[STR:${p.strength}, EXP:${p.experience}, MP:${p.magic}, hold:${p.holdItem}, 宝箱:${chests}, 鍵:${keys}, 石:${stones}, 壺:${potions}, 生存敵:${livingEnemies}]`;
  }
}

export const AdaptiveAutoPlayBot = AutoPlayBot;
export type AdaptiveAutoPlayBot = AutoPlayBot;
