import { Direction, Position } from '../models/Types.js';
import { GameEngine } from '../core/GameEngine.js';
import { Player } from '../models/Player.js';
import { WorldMap } from '../models/WorldMap.js';
import { EnemyInstance } from '../models/Enemy.js';
import { Dragon } from '../models/Dragon.js';
import { Ghost } from '../models/Ghost.js';
import { MagicSystem } from '../systems/MagicSystem.js';
import { MovementSystem } from '../systems/MovementSystem.js';
import { ThreatEvaluator } from '../systems/ThreatEvaluator.js';
import { MapProfiler } from '../systems/generator/MapProfiler.js';

import {
  AutoPlayBotOptions,
  BehaviorResult,
  BotAction,
  BotPhase,
  BotSkillProfile,
  DynamicBotParameters,
} from './BotTypes.js';
import { TacticalContext } from './TacticalContext.js';
import { AdaptiveNavigator } from './AdaptiveNavigator.js';
import { EightStepController } from './EightStepController.js';
import { BootstrapBehavior } from './behaviors/BootstrapBehavior.js';
import { GraveSealBehavior } from './behaviors/GraveSealBehavior.js';
import { ResourceFarmBehavior, SwapState } from './behaviors/ResourceFarmBehavior.js';
import { RelocateBehavior } from './behaviors/RelocateBehavior.js';
import { CombatBehavior } from './behaviors/CombatBehavior.js';
import { DragonSlayBehavior } from './behaviors/DragonSlayBehavior.js';
import { EscapeBehavior } from './behaviors/EscapeBehavior.js';
import { SpatialKnowledge } from './perception/SpatialKnowledge.js';
import { SituationalPerception } from './perception/SituationalPerception.js';
import { EpisodicMemory } from './perception/EpisodicMemory.js';
import { TacticalSnapshot } from './perception/TacticalSnapshot.js';
import { StrategicPlanner } from './strategy/StrategicPlanner.js';
import { TacticalExecutor } from './tactics/TacticalExecutor.js';

export * from './BotTypes.js';
export { TacticalContext } from './TacticalContext.js';
export { AdaptiveNavigator } from './AdaptiveNavigator.js';

/**
 * AutoPlayBot (旧名: AdaptiveAutoPlayBot)
 *
 * 最新の階層テーマブロックマップ生成およびダンジョンチューニングに完全適合した、
 * 状況適応型自律エージェント。
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

  // 内部状態
  private swapState: SwapState = {
    itemToPickupPos: null,
    tempDroppedKeyPos: null,
    swapTurns: 0,
  };
  private lockedRelocateAnchor: Position | null = null;
  private relocationDone: boolean = false;
  private graveSealDone: boolean = false;
  private totalGraveSealTurns: number = 0;
  public defenseReady: boolean = false;
  private defensePrepTurns: number = 0;
  private unlockedBreakNotified: boolean = false;
  public isGivenUp: boolean = false;

  // ターゲットロック・ヒステリシス
  public lockedItemPos: Position | null = null;
  public lockedItemType: string | null = null;
  public lockedChestPos: Position | null = null;

  // テレメトリ
  public currentTargetDesc: string = '初期化中';
  public lastDecidedActionDesc: string = '待機';

  // PST 3層アーキテクチャユニット (PST版)
  public readonly botVersion: 'behavior' | 'pst';
  public readonly strategicPlanner: StrategicPlanner;
  public readonly tacticalExecutor: TacticalExecutor;
  public readonly episodicMemory: EpisodicMemory;
  public spatialKnowledge?: SpatialKnowledge;

  constructor(opts: AutoPlayBotOptions = {}) {
    this.profile = opts.profile ?? 'STANDARD';
    this.nav = new AdaptiveNavigator();
    this.eightStepController = new EightStepController(this.nav);
    const rawVersion = opts.botVersion ?? 'pst';
    this.botVersion = (rawVersion === 'v1' || rawVersion === 'behavior') ? 'behavior' : 'pst';
    this.strategicPlanner = new StrategicPlanner(this.nav);
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
   * メイン意思決定ルーチン
   */
  public decideAction(engine: GameEngine): BotAction {
    if (this.botVersion === 'pst') {
      return this.decideActionV2(engine);
    }
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

    this.params = this.context.resolveParameters(this.currentPhase, player, dragon, enemies, {
      totalTurns: this.totalTurns,
      defensePrepTurns: this.defensePrepTurns,
    });
    MagicSystem.updatePassiveSkills(player);

    // BREAK 解禁検知: 経験値4,000到達時にブラックリストを一括クリア
    if (!this.unlockedBreakNotified && player.experience >= 4000) {
      this.unlockedBreakNotified = true;
      this.nav.clearUnreachableTargets();
    }

    // 1. ナビゲータのターン更新（訪問履歴、ピンポン・スタック検知）
    this.nav.updateTurn(player.pos);

    // 1-B. 序盤の剣回収前ハマり（物理的詰み）検知 -> GiveUP
    if (!player.hasSword && this.currentPhase === 'BOOTSTRAP') {
      if (this.nav.detectEarlySwordTrap(player, map, enemies, this.params, dragon)) {
        this.isGivenUp = true;
        this.currentTargetDesc = '💀 詰み検知: 剣への到達経路が存在しないためギブアップ';
        return { type: 'GIVE_UP' };
      }
    }

    // 1-C. 序盤 RESOURCE_FARM 資源遮断・攻撃力不足ハマり（物理的詰み）検知 -> GiveUP
    if (player.hasSword && this.currentPhase === 'RESOURCE_FARM') {
      if (this.nav.detectEarlyResourceFarmTrap(player, map, enemies, this.params, dragon)) {
        this.isGivenUp = true;
        this.currentTargetDesc = '💀 詰み検知: 序盤の攻撃力不足・進行遮断によりギブアップ';
        return { type: 'GIVE_UP' };
      }
    }

    // 1-D. 袋小路・敵封鎖による完全拘束・孤立ハマり（物理的詰み）検知 -> 脱出魔法詠唱 or GiveUP
    if (this.nav.detectIncarcerationTrap(player, map, enemies)) {
      if (MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying) {
        this.currentTargetDesc = '🌀 袋小路拘束打開: RETURN詠唱で脱出';
        this.nav.clearPositionHistory();
        return { type: 'MAGIC', magic: 'RETURN' };
      }
      if (MagicSystem.canCast(player, 'JUMP').allowed) {
        this.currentTargetDesc = '🌀 袋小路拘束打開: JUMP詠唱で脱出';
        this.nav.clearPositionHistory();
        return { type: 'MAGIC', magic: 'JUMP' };
      }
      if (engine.isAutoPlayVerifyActive && engine.isAutoPlayVerifyActive()) {
        this.nav.clearPositionHistory();
        return this.nav.wanderSafe(player, map, enemies, dragon);
      }
      this.isGivenUp = true;
      this.currentTargetDesc = '💀 詰み検知: 袋小路・敵封鎖により脱出不能のためギブアップ';
      return { type: 'GIVE_UP' };
    }

    let decidedAction: BotAction | null = null;

    const isAdjacentToDragonHead = dragon?.heads.some(h => {
      if (!h.isAlive) return false;
      const dx = Math.abs(player.pos.x - h.pos.x);
      const dy = Math.abs(player.pos.y - h.pos.y);
      return (dx === 1 || dx === map.width - 1) && (dy === 1 || dy === map.height - 1);
    }) ?? false;

    // 鍵を持って宝箱の近くにいる場合、8歩周期チェーン実行中、鍵一時置きスワップ中、または足元に有益アイテムがある場合はピンポンレスキューや周回打開を抑止
    const isSwappingItem = this.swapState.itemToPickupPos !== null || this.swapState.tempDroppedKeyPos !== null;
    const hasFloorItemToPickup = map.getItem(player.pos) !== 'NONE' && (
      map.getItem(player.pos) === 'POWER_STONE' ||
      map.getItem(player.pos) === 'POTION' ||
      map.getItem(player.pos) === 'COIN' ||
      map.getItem(player.pos) === 'KEY'
    );
    const isNearChestWithKey = isSwappingItem || hasFloorItemToPickup || (player.holdItem === 'KEY' && (
      map.getObject(player.pos) === 'CHEST' ||
      this.eightStepController.eightStepTargetChestPos !== null ||
      (this.lockedChestPos !== null && map.getTorusDistance(player.pos, this.lockedChestPos).manhattan <= 2)
    ));

    // 2. スタック救出・安全徘徊モード
    if (this.nav.forceWanderTurns > 0 && !isAdjacentToDragonHead && !isNearChestWithKey) {
      this.currentTargetDesc = `⚠️ 安全離脱徘徊中 [残り ${this.nav.forceWanderTurns}T]`;
      decidedAction = this.nav.wanderSafe(player, map, enemies, dragon);
    } else if ((this.nav.pingPongCount >= 2 || this.nav.oscillationCount >= 3) && !isAdjacentToDragonHead && !isNearChestWithKey) {
      // ピンポン往復検知時: ロック対象をブラックリスト登録して即解除し、再ロックによるループを遮断
      if (this.lockedItemPos) {
        this.nav.markTargetUnreachable(this.lockedItemPos, 20);
        this.lockedItemPos = null;
        this.lockedItemType = null;
      }
      if (this.lockedChestPos) {
        this.nav.markTargetUnreachable(this.lockedChestPos, 20);
        this.lockedChestPos = null;
      }
      this.eightStepController.clearEightStepState();

      // 狭い通路・迷路環境では脱出に歩数を要するため徘徊ターン数を延長 (8〜10T)
      let wallCount = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const p = map.wrapPosition({ x: player.pos.x + dx, y: player.pos.y + dy });
          if (map.getBaseTile(p) === 'WALL_STATIC' || map.getObject(p) === 'BLOCK') wallCount++;
        }
      }
      const isNarrowMaze = wallCount >= 3 || (this.context?.metrics?.mazeIndex ?? 0) > 0.4;
      const rescueTurns = isNarrowMaze ? 10 : 5;

      this.nav.triggerRescue(rescueTurns);
      this.currentTargetDesc = `⚠️ ピンポン往復検知: 安全徘徊へ緊急移行 [${rescueTurns}T]`;
      decidedAction = this.nav.wanderSafe(player, map, enemies, dragon);
    } else {
      // 3. フェーズ自動遷移
      this.updatePhase(player, dragon, map, enemies);

      // 4. 緊急危機介入 (HPピンチ / 死神憑依)
      const emergencyAction = this.checkEmergency(player, map, enemies, dragon);
      if (emergencyAction) {
        decidedAction = emergencyAction;
      } else {
        // 4-B. 訪問ヒートマップによる障害物周回ループ（カルーセル膠着）の能動打開
        // 王冠脱出・ドラゴン討伐・アイテムスワップ・開錠直後回収中は各専用Behaviorを最優先する
        const circlingResult = (this.currentPhase !== 'CROWN_ESCAPE' && this.currentPhase !== 'DRAGON_SLAY' && !isNearChestWithKey)
          ? CombatBehavior.tryBreakCirclingLoop(player, map, enemies, dragon, this.nav, this.params)
          : null;
        const breakthroughResult = (!circlingResult && this.currentPhase !== 'CROWN_ESCAPE' && this.currentPhase !== 'DRAGON_SLAY' && !isNearChestWithKey)
          ? CombatBehavior.tryBreakthroughCombat(player, map, enemies, dragon, this.nav, this.params)
          : null;

        if (circlingResult) {
          this.currentTargetDesc = circlingResult.description;
          decidedAction = circlingResult.action;
        } else if (breakthroughResult) {
          this.currentTargetDesc = breakthroughResult.description;
          decidedAction = breakthroughResult.action;
        } else {
          // 5. 各フェーズの主戦略行動 (Behavior Execution)
          let behaviorResult: BehaviorResult | null = null;

        switch (this.currentPhase) {
          case 'BOOTSTRAP':
            behaviorResult = BootstrapBehavior.execute(player, map, enemies, dragon, this.nav, this.context, this.params, this);
            break;

          case 'GRAVE_SEAL':
            this.totalGraveSealTurns++;
            if (this.turnsInPhase >= 40 || this.totalGraveSealTurns >= 60) {
              this.graveSealDone = true;
              behaviorResult = ResourceFarmBehavior.execute(
                player, map, enemies, dragon, this.nav, this.context, this.params, this.swapState, this
              );
            } else {
              behaviorResult = GraveSealBehavior.execute(player, map, enemies, dragon, this.nav, this.context, this.params);
              if (!behaviorResult) {
                this.graveSealDone = true;
                behaviorResult = ResourceFarmBehavior.execute(
                  player, map, enemies, dragon, this.nav, this.context, this.params, this.swapState, this
                );
              }
            }
            break;

          case 'RESOURCE_FARM':
            behaviorResult = ResourceFarmBehavior.execute(
              player, map, enemies, dragon, this.nav, this.context, this.params, this.swapState, this
            );
            break;

          case 'RELOCATE_HOME':
            if (!this.lockedRelocateAnchor) {
              this.lockedRelocateAnchor = RelocateBehavior.findAnchor(
                map, dragon, enemies, player, this.context, this.params
              );
            }
            behaviorResult = RelocateBehavior.execute(
              player, map, enemies, dragon, this.nav, this.context, this.params, this.lockedRelocateAnchor
            );
            if (!behaviorResult) {
              this.relocationDone = true;
              this.lockedRelocateAnchor = null;
            }
            break;

          case 'DRAGON_SLAY':
            behaviorResult = DragonSlayBehavior.execute(
              player, map, enemies, dragon, this.nav, this.context, this.params
            );
            break;

          case 'CROWN_ESCAPE':
            behaviorResult = EscapeBehavior.execute(
              player, map, enemies, dragon, ghosts, this.nav, this.context, this.params
            );
            break;
        }

        if (behaviorResult) {
          this.currentTargetDesc = behaviorResult.description;
          decidedAction = behaviorResult.action;
        } else {
          // 6. 戦闘・露払い・スナイプ (通常行動で見つからない場合)
          const combatResult = CombatBehavior.execute(player, map, enemies, dragon, this.nav, this.context, this.params);
          if (combatResult) {
            this.currentTargetDesc = combatResult.description;
            decidedAction = combatResult.action;
          } else {
            // 7. デフォルト: 安全徘徊
            this.currentTargetDesc = '🧭 安全徘徊探索中';
            decidedAction = this.nav.wanderSafe(player, map, enemies, dragon);
          }
        }
      }
    }
  }

  return this.resolveMoveOrBreak(decidedAction, player, map);
  }

  /**
   * 移動先が BLOCK の場合に BREAK 魔法詠唱へ解決・変換する共通ヘルパー
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

  /**
   * フェーズ遷移判定
   */
  private updatePhase(player: Player, dragon: Dragon, map: WorldMap, enemies: EnemyInstance[]): void {
    if (!this.params) return;

    // 1. 全首撃破済みなら王冠脱出フェーズ
    if (dragon && (dragon.isAllHeadsDefeated || dragon.heads.every(h => !h.isAlive))) {
      this.setPhase('CROWN_ESCAPE');
      return;
    }

    const livingHeads = dragon ? dragon.heads.filter(h => h.isAlive) : [];
    const defeatedCount = dragon ? dragon.defeatedHeadsCount : 0;
    const canDamageDragon = player.hasSword && player.strength >= this.params.targetStr;
    const hasDiagonal = player.experience >= 12000 || player.canDiagonal;

    // 2. ドラゴン決戦準備完了判定
    const isTimeoutBypass = this.defensePrepTurns > 60 || this.totalTurns > 1800;
    if (canDamageDragon && (hasDiagonal || this.profile === 'NOVICE')) {
      if (this.currentPhase === 'RESOURCE_FARM') {
        this.defensePrepTurns++;
      }

      // マップ上に未開封宝箱や鍵・コイン・ポーションが残っているか確認（枯渇時は早期移行）
      const hasRemainingFarmResources = this.hasRemainingDefenseFarmResources(map, player);
      const hasPendingGoldToCashIn =
        player.gold > 0 && player.experience < this.params.targetDefenseExp;


      // 床にポーションが残っている間は player.magic >= maxTargetMagic を待つ
      let potionCount = 0;
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const p = { x, y };
          if (map.getItem(p) === 'POTION' && !this.nav.isTargetUnreachable(p)) {
            potionCount++;
          }
        }
      }
      const hasRemainingPotion = potionCount > 0 && player.magic < this.params.maxTargetMagic;

      const hasEnoughMagic = isTimeoutBypass || (
        hasRemainingPotion
          ? player.magic >= this.params.maxTargetMagic
          : (player.magic >= this.params.minDragonMagic || this.defensePrepTurns > 45)
      );
      const hasEnoughHp = player.hp >= player.maxHp * 0.70 || player.hp >= 30000;

      const hasMinDefense =
        (!hasPendingGoldToCashIn && player.experience >= this.params.targetDefenseExp) ||
        isTimeoutBypass ||
        (!hasRemainingFarmResources && !hasPendingGoldToCashIn && this.defensePrepTurns > 15);

      if (hasEnoughMagic && hasEnoughHp && hasMinDefense) {
        this.defenseReady = true;
      }
    }

    // RELOCATE_HOME 長期化防止: 80ターン以上経過時はアボートして決戦へ
    if (this.currentPhase === 'RELOCATE_HOME' && this.turnsInPhase >= 80) {
      this.relocationDone = true;
    }

    // 2-A. 前線基地移転 (RELOCATE_HOME)
    const distHomeToDragon = map.getTorusDistance(map.realHomePos, map.dragonCenter ?? { x: 32, y: 32 }).chebyshev;
    const canStartRelocation = this.params.enableHomeRelocation &&
                               !this.relocationDone &&
                               distHomeToDragon >= this.params.homeRelocateDistMin &&
                               defeatedCount === 0 &&
                               player.experience >= 4000;

    if (canDamageDragon && (this.defenseReady || player.holdItem === 'RING') && canStartRelocation) {
      this.setPhase('RELOCATE_HOME');
      return;
    }

    // 2-B. ドラゴン討伐 (DRAGON_SLAY)
    if (canDamageDragon && (hasDiagonal || this.profile === 'NOVICE') && this.defenseReady && livingHeads.length > 0) {
      this.setPhase('DRAGON_SLAY');
      return;
    }

    // 3. 序盤墓封鎖 (GRAVE_SEAL)
    const canEarlyGraveSeal = !this.graveSealDone &&
                              this.params.graveSealPolicy !== 'NONE' &&
                              player.hasSword &&
                              player.strength >= this.params.graveSealEarlyStr &&
                              defeatedCount === 0;

    if (canEarlyGraveSeal) {
      const openSpots = GraveSealBehavior.getTargetSealSpots(map, enemies, this.context!, this.params);
      if (openSpots.length > 0) {
        this.setPhase('GRAVE_SEAL');
        return;
      } else {
        this.graveSealDone = true;
      }
    }

    // 4. 資源育成 (RESOURCE_FARM)
    if (player.hasSword) {
      this.setPhase('RESOURCE_FARM');
      return;
    }

    // 5. 初期ブートストラップ (BOOTSTRAP)
    this.setPhase('BOOTSTRAP');
  }

  /**
   * MPリザーブ保護判定:
   * BREAK習得後 (EXP >= 4000) はコスト0の壁掘り維持のため MP=1 を死守する。
   * MP > 1 なら常に消費許可。MP === 1 の時は、王冠脱出時や逃げ場のない即死危機時のみ許可。
   */
  public canSpendMagicReserve(
    player: Player,
    options?: { isLethalEmergency?: boolean; hasEvadeRoute?: boolean }
  ): boolean {
    if (player.magic > 1) return true;
    if (player.magic <= 0) return false;

    // BREAK未習得 (EXP < 4000) であればリザーブする BREAK がないので使用可
    if (player.experience < 4000) return true;

    // 王冠脱出フェーズなら全力を尽くすため許可
    if (this.currentPhase === 'CROWN_ESCAPE') return true;

    // 即死級の緊急事態かつ逃げ場がない場合のみ許可
    if (options?.isLethalEmergency && !options?.hasEvadeRoute) {
      return true;
    }

    return false;
  }

  /**
   * 緊急危機介入 (即死敵隣接、HPピンチ、死神憑依など)
   */
  private checkEmergency(player: Player, map: WorldMap, enemies: EnemyInstance[], dragon: Dragon): BotAction | null {
    if (!this.params) return null;

    const curPos = player.pos;
    const isPinch = player.hp < player.maxHp * this.params.emergencyHpRatio;

    // 1. 直角隣接の敵を検出
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const adjacentEnemies = cardDirs
      .map(d => {
        const np = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
        const e = enemies.find(enemy => enemy.isAlive && enemy.pos.x === np.x && enemy.pos.y === np.y);
        return e ? { enemy: e, dir: d } : null;
      })
      .filter((x): x is { enemy: EnemyInstance; dir: Direction } => x !== null);

    const lethalDefenseAdjacent = adjacentEnemies.filter(
      ({ enemy }) =>
        !enemy.isPermanentlyFrozen &&
        enemy.frozenTimer <= 0 &&
        ThreatEvaluator.evaluateThreatDetails(player, enemy).defenseThreat === 'LETHAL'
    );

    const hasLethalAdjacent = lethalDefenseAdjacent.length > 0;

    // 2. 直角隣接の即死級敵が1体のみで、かつ一撃撃破（ONE_SHOT）可能な場合は即座に殴り倒して無力化
    if (
      lethalDefenseAdjacent.length === 1 &&
      player.holdItem !== 'CROSS' &&
      ThreatEvaluator.evaluateThreatDetails(player, lethalDefenseAdjacent[0].enemy).attackThreat === 'ONE_SHOT'
    ) {
      this.currentTargetDesc = `⚔️ 緊急迎撃: 即死級敵を一撃排除 (${lethalDefenseAdjacent[0].enemy.name})`;
      return { type: 'MOVE', dir: lethalDefenseAdjacent[0].dir };
    }

    // 3. 王冠所持中に即死敵が隣接: ドロップするとその場で殴られて即死するため、まず安全マスへの緊急退避を最優先
    if (player.holdItem === 'CROWN' && hasLethalAdjacent) {
      const evadeDir = this.nav.findEvadeDirection(curPos, map, enemies, player, dragon);
      if (evadeDir) {
        this.currentTargetDesc = '👑 王冠運搬中緊急退避';
        return { type: 'MOVE', dir: evadeDir };
      }
      if (player.magic > 0 && !player.hasDeath && map.getItem(curPos) === 'NONE') {
        this.currentTargetDesc = '👑 魔法自衛のため王冠一時ドロップ';
        return { type: 'SPACE' };
      }
    }

    // 4. 直角隣接に未凍結・未スタンの即死敵（LETHAL）がいる場合の迎撃・退避
    if (hasLethalAdjacent) {
      const evadeDir = this.nav.findEvadeDirection(curPos, map, enemies, player, dragon);
      const canSpendReserve = !player.hasDeath && this.canSpendMagicReserve(player, {
        isLethalEmergency: true,
        hasEvadeRoute: !!evadeDir,
      });
      

      // 4-A. FREEZE 詠唱で周囲8方向の敵を永久凍結無力化（KICKより確実性が高いため最優先）
      if (canSpendReserve && MagicSystem.canCast(player, 'FREEZE').allowed) {
        const unfrozenLethal = lethalDefenseAdjacent[0];
        if (unfrozenLethal) {
          this.currentTargetDesc = `🚨 緊急無力化: FREEZE詠唱 (${unfrozenLethal.enemy.name})`;
          return { type: 'MAGIC', magic: 'FREEZE' };
        }
      }

      // 4-B. FLASH 詠唱で足止め（未凍結・未スタンの敵が存在する場合のみ）
      const hasAnyActiveEnemy = enemies.some(e => e.isAlive && !e.isPermanentlyFrozen && e.frozenTimer <= 0);
      if (canSpendReserve && hasAnyActiveEnemy && MagicSystem.canCast(player, 'FLASH').allowed) {
        this.currentTargetDesc = '🚨 緊急足止め: FLASH詠唱';
        return { type: 'MAGIC', magic: 'FLASH' };
      }

      // 4-C. 岩があれば KICK スナイプで反撃
      if (canSpendReserve) {
        const kickAction = CombatBehavior.tryKickSnipe(player, map, enemies, dragon);
        if (kickAction) {
          this.currentTargetDesc = kickAction.description;
          return kickAction.action;
        }
      }

      // 4-D. 安全な空床へ回避移動
      if (evadeDir) {
        this.currentTargetDesc = '🚨 緊急退避: 安全マスへ回避移動';
        return { type: 'MOVE', dir: evadeDir };
      }
    }

    // 5. HPピンチ時の帰還・退避（王冠運搬中はEscapeBehaviorの専用帰還・自衛ロジックに委譲）
    // 死神憑依（hasDeath）はパワーストーン納品時の我が家帰還で自動解除されるため、HPピンチでない限り単独帰還しない
    if (isPinch && player.holdItem !== 'CROWN') {
      const homeDist = map.getTorusDistance(curPos, map.realHomePos).manhattan;
      const canCastReturn = MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying;
      const canSpendReserve = this.canSpendMagicReserve(player);
      const dirToHome = this.nav.findPath(curPos, map.realHomePos, map, player, enemies, this.params, { dragon });

      // RETURNで我が家へ瞬時帰還:
      // MPが潤沢(MP>=2)、または徒歩ルートが完全に塞がれている(!dirToHome)、またはHP極限危機(<=20%)時は即座にRETURN
      const isExtremeDanger = player.hp <= player.maxHp * 0.20 || !dirToHome;
      if (canCastReturn && homeDist > 2 && (canSpendReserve || isExtremeDanger)) {
        this.currentTargetDesc = '🚨 緊急退避: RETURN全回復帰還';
        return { type: 'MAGIC', magic: 'RETURN' };
      }

      // 徒歩で我が家へ
      if (dirToHome) {
        this.currentTargetDesc = '🚨 緊急退避: 我が家へ避難移動';
        return { type: 'MOVE', dir: dirToHome };
      }

      // 我が家への道が塞がれている場合、安全マスへ退避
      const evadeDir = this.nav.findEvadeDirection(curPos, map, enemies, player, dragon);
      if (evadeDir) {
        this.currentTargetDesc = '🚨 緊急退避: 回避移動';
        return { type: 'MOVE', dir: evadeDir };
      }
    }

    return null;
  }

  private hasRemainingDefenseFarmResources(map: WorldMap, player: Player): boolean {
    let chestCount = 0;
    let keyCount = player.holdItem === 'KEY' ? 1 : 0;
    let coinCount = 0;
    let potionCount = 0;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (this.nav.isTargetUnreachable(p)) continue;
        const obj = map.getObject(p);
        const item = map.getItem(p);
        if (obj === 'CHEST') chestCount++;
        if (item === 'KEY') keyCount++;
        if (item === 'COIN') coinCount++;
        if (item === 'POTION') potionCount++;
      }
    }

    const maxTargetMagic = this.params?.maxTargetMagic ?? 14;
    const hasPotion = potionCount > 0 && player.magic < maxTargetMagic;

    return coinCount > 0 || (chestCount > 0 && keyCount > 0) || hasPotion;
  }

  public findNearestCross(from: Position, map: WorldMap): Position | null {
    let nearest: Position | null = null;
    let minDist = Infinity;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (map.getItem(p) === 'CROSS' || map.getObject(p) === 'CROSS') {
          const d = map.getTorusDistance(from, p).manhattan;
          if (d < minDist) {
            minDist = d;
            nearest = p;
          }
        }
      }
    }
    return nearest;
  }

  public handleStuckRescue(): void {
    this.nav.triggerRescue(4);
    this.swapState.itemToPickupPos = null;
    this.swapState.tempDroppedKeyPos = null;
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
   * PSTモデル（Perception - Strategy - Tactics 3層分離）による新意思決定ルーチン (v2)
   */
  public decideActionV2(engine: GameEngine): BotAction {
    const player = engine.getPlayer();
    const map = engine.getMap ? engine.getMap() : (engine as any).getWorldMap();
    const enemies = engine.getEnemies().filter(e => e.isAlive);
    const dragon = engine.getDragon();
    const tuning = typeof engine.getActiveTuningParams === 'function' ? engine.getActiveTuningParams() : undefined;

    // 0. コンテキストと動的パラメータの更新
    if (!this.context || (map as any) !== (this as any)._lastMapRef) {
      const metrics = MapProfiler.measureGeometricMetrics(map);
      this.context = new TacticalContext(map, { tuning, profile: this.profile, metrics });
      (this as any)._lastMapRef = map;
    }

    this.updatePhase(player, dragon, map, enemies);

    this.params = this.context.resolveParameters(this.currentPhase, player, dragon, enemies, {
      totalTurns: this.totalTurns,
      defensePrepTurns: this.defensePrepTurns,
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

    // 序盤の剣回収前ハマり（物理的詰み）検知
    if (!player.hasSword) {
      if (this.nav.detectEarlySwordTrap(player, map, enemies, this.params, dragon)) {
        this.isGivenUp = true;
        this.currentTargetDesc = '💀 詰み検知: 剣への到達経路が存在しないためギブアップ';
        return { type: 'GIVE_UP' };
      }
    }

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
      this.nav
    );

    const snapshot: TacticalSnapshot = {
      spatial: this.spatialKnowledge,
      milestones,
      threats,
      stagnation,
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
    const missionName = this.strategicPlanner.activeMission?.name ?? '作戦なし';

    if (directive.type === 'GIVE_UP') {
      this.isGivenUp = true;
      this.currentTargetDesc = directive.reason;
      return { type: 'GIVE_UP' };
    }

    // 3. 【行動：戦術実行ユニット (Tactical Execution)】
    const execResult = this.tacticalExecutor.execute(directive, snapshot, engine);
    this.currentTargetDesc = `[${missionName}] ${execResult.description}`;

    // 要件2: 戦術実行結果（成功・経路遮断・膠着）を戦略層へフィードバック
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

