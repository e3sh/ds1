import { Direction, Position, TileType } from '../models/Types.js';
import { GameEngine } from '../core/GameEngine.js';
import { Player } from '../models/Player.js';
import { WorldMap } from '../models/WorldMap.js';
import { EnemyInstance } from '../models/Enemy.js';
import { Dragon } from '../models/Dragon.js';
import { Ghost } from '../models/Ghost.js';
import { ThreatEvaluator } from '../systems/ThreatEvaluator.js';
import { MagicSystem } from '../systems/MagicSystem.js';
import { MovementSystem } from '../systems/MovementSystem.js';

import {
  BotSkillProfile,
  GraveSealPolicy,
  BotStrategyTuning,
  MapAssessment,
  BotPhase,
  BotAction,
  AutoPlayBotOptions,
} from './BotTypes.js';
import { BotNavigator } from './BotNavigator.js';
import { EightStepController } from './EightStepController.js';
import { GraveSealTactics } from './tactics/GraveSealTactics.js';
import { HomeRelocationTactics } from './tactics/HomeRelocationTactics.js';

export * from './BotTypes.js';

/**
 * 自律探索・定量バランス評価用フェーズ駆動型AIボット (AutoPlayBot)
 * プレイヤースキル水準に応じたヒューリスティック判断により、
 * 序盤ブートストラップから王冠4個脱出までのゲーム全行程をヘッドレス実行する。
 */
export class AutoPlayBot {
  public readonly profile: BotSkillProfile;
  public readonly tuning: Required<BotStrategyTuning>;
  public currentPhase: BotPhase = 'BOOTSTRAP';
  public turnsInPhase: number = 0;

  // サブモジュール (DOM/Browser のグローバル navigator との混同を防ぐため botNav と命名)
  public readonly botNav: BotNavigator;
  public readonly eightStepController: EightStepController;
  public readonly graveSealTactics: GraveSealTactics;
  public readonly homeRelocationTactics: HomeRelocationTactics;

  // マップ評価キャッシュ
  public mapAssessment: MapAssessment | null = null;
  private lastAssessedMapRef: WorldMap | null = null;

  // アイテム持ち替え制御 (Hands-Free Rule)
  private itemToPickupPos: Position | null = null;
  private tempDroppedKeyPos: Position | null = null;

  // 目標ロック＆ヒステリシス制御
  private lockedChestPos: Position | null = null;
  private lockedChestTurns: number = 0;

  private lockedItemPos: Position | null = null;
  private lockedItemType?: TileType;
  private lockedItemTurns: number = 0;

  private readonly MAX_TARGET_LOCK_TURNS: number = 20;
  private readonly TARGET_HYSTERESIS_BONUS: number = 3;

  // アイテム持ち替え経過ターンカウンタ（無限バイパス防止）
  private itemSwapTurns: number = 0;
  private readonly MAX_ITEM_SWAP_TURNS: number = 10;

  // 決戦前防御力・MP育成完了フラグ（フェーズ振動防止）
  public defenseReady: boolean = false;
  private defensePrepTurns: number = 0;

  constructor(opts: AutoPlayBotOptions = {}) {
    this.profile = opts.profile ?? 'STANDARD';
    this.tuning = {
      graveSealPolicy: opts.strategyTuning?.graveSealPolicy ?? 'AUTO',
      graveSealTiming: opts.strategyTuning?.graveSealTiming ?? 'EARLY',
      nearHomeRadius: opts.strategyTuning?.nearHomeRadius ?? 12,
      maxTargetMagic: opts.strategyTuning?.maxTargetMagic ?? 5,
      graveSealEarlyStr: opts.strategyTuning?.graveSealEarlyStr ?? 30000,
      enableHomeRelocation: opts.strategyTuning?.enableHomeRelocation ?? true,
      homeRelocateTargetDistMin: opts.strategyTuning?.homeRelocateTargetDistMin ?? 5,
      homeRelocateTargetDistMax: opts.strategyTuning?.homeRelocateTargetDistMax ?? 8,
      targetDefenseExp: opts.strategyTuning?.targetDefenseExp ?? 350000,
    };

    this.botNav = new BotNavigator();
    this.eightStepController = new EightStepController(this.botNav);
    this.graveSealTactics = new GraveSealTactics(this.botNav);
    this.homeRelocationTactics = new HomeRelocationTactics(this.botNav);
  }

  // ==========================================================================
  // プロパティ委譲 (後方互換性アクセサ)
  // ==========================================================================

  public get eightStepTargetChestPos(): Position | null {
    return this.eightStepController.eightStepTargetChestPos;
  }
  public set eightStepTargetChestPos(val: Position | null) {
    this.eightStepController.eightStepTargetChestPos = val;
  }

  public get eightStepOriginPos(): Position | null {
    return this.eightStepController.eightStepOriginPos;
  }
  public set eightStepOriginPos(val: Position | null) {
    this.eightStepController.eightStepOriginPos = val;
  }

  public get eightStepPivotPos(): Position | null {
    return this.eightStepController.eightStepPivotPos;
  }
  public set eightStepPivotPos(val: Position | null) {
    this.eightStepController.eightStepPivotPos = val;
  }

  public get eightStepWaitPos(): Position | null {
    return this.eightStepController.eightStepWaitPos;
  }
  public set eightStepWaitPos(val: Position | null) {
    this.eightStepController.eightStepWaitPos = val;
  }

  public get eightStepPathToPivot(): Position[] {
    return this.eightStepController.eightStepPathToPivot;
  }
  public set eightStepPathToPivot(val: Position[]) {
    this.eightStepController.eightStepPathToPivot = val;
  }

  public get homeRelocationDone(): boolean {
    return this.homeRelocationTactics.homeRelocationDone;
  }
  public set homeRelocationDone(val: boolean) {
    this.homeRelocationTactics.homeRelocationDone = val;
  }

  public get homeRelocationAborted(): boolean {
    return this.homeRelocationTactics.homeRelocationAborted;
  }
  public set homeRelocationAborted(val: boolean) {
    this.homeRelocationTactics.homeRelocationAborted = val;
  }

  public get totalHomeRelocateTurns(): number {
    return this.homeRelocationTactics.totalHomeRelocateTurns;
  }
  public set totalHomeRelocateTurns(val: number) {
    this.homeRelocationTactics.totalHomeRelocateTurns = val;
  }

  public get lockedRelocateAnchor(): Position | null {
    return this.homeRelocationTactics.lockedRelocateAnchor;
  }
  public set lockedRelocateAnchor(val: Position | null) {
    this.homeRelocationTactics.lockedRelocateAnchor = val;
  }

  public get graveSealAborted(): boolean {
    return this.graveSealTactics.graveSealAborted;
  }
  public set graveSealAborted(val: boolean) {
    this.graveSealTactics.graveSealAborted = val;
  }

  public get totalGraveSealTurns(): number {
    return this.graveSealTactics.totalGraveSealTurns;
  }
  public set totalGraveSealTurns(val: number) {
    this.graveSealTactics.totalGraveSealTurns = val;
  }

  public get oscillationCount(): number {
    return this.botNav.oscillationCount;
  }
  public set oscillationCount(val: number) {
    this.botNav.oscillationCount = val;
  }

  public get recentPositions(): Position[] {
    return this.botNav.recentPositions;
  }
  public set recentPositions(val: Position[]) {
    this.botNav.recentPositions = val;
  }

  public get recentEvadedTile(): Position | null {
    return this.botNav.recentEvadedTile;
  }
  public set recentEvadedTile(val: Position | null) {
    this.botNav.recentEvadedTile = val;
  }

  public get recentEvadedTurns(): number {
    return this.botNav.recentEvadedTurns;
  }
  public set recentEvadedTurns(val: number) {
    this.botNav.recentEvadedTurns = val;
  }

  public recordWarpEvent(fromPos: Position, toPos: Position): void {
    this.botNav.recordWarpEvent(fromPos, toPos);
  }

  public isWarpTaboo(pos: Position): boolean {
    return this.botNav.isWarpTaboo(pos);
  }

  public wanderSafe(player: Player, map: WorldMap, enemies?: EnemyInstance[], dragon?: Dragon, turnsInPhase?: number): BotAction {
    return this.botNav.wanderSafe(player, map, enemies ?? [], dragon, turnsInPhase ?? this.turnsInPhase);
  }

  // ==========================================================================
  // フェーズ遷移・ターゲットロック・マップ評価
  // ==========================================================================

  public setPhase(newPhase: BotPhase): void {
    if (this.currentPhase !== newPhase) {
      this.currentPhase = newPhase;
      this.turnsInPhase = 0;
      this.eightStepController.clearEightStepState();
      this.botNav.clearUnreachableTargets();
      this.clearTargetLock();
    }
  }

  public clearTargetLock(): void {
    this.clearChestLock();
    this.clearItemLock();
  }

  public clearChestLock(): void {
    this.lockedChestPos = null;
    this.lockedChestTurns = 0;
  }

  public clearItemLock(): void {
    this.lockedItemPos = null;
    this.lockedItemType = undefined;
    this.lockedItemTurns = 0;
  }

  public setLockedChest(pos: Position): void {
    if (!this.lockedChestPos || this.lockedChestPos.x !== pos.x || this.lockedChestPos.y !== pos.y) {
      this.lockedChestPos = { ...pos };
      this.lockedChestTurns = 0;
    }
  }

  public setLockedItem(pos: Position, itemType: TileType): void {
    if (
      !this.lockedItemPos ||
      this.lockedItemPos.x !== pos.x ||
      this.lockedItemPos.y !== pos.y ||
      this.lockedItemType !== itemType
    ) {
      this.lockedItemPos = { ...pos };
      this.lockedItemType = itemType;
      this.lockedItemTurns = 0;
    }
  }

  private updateTargetLock(map: WorldMap, player: Player): void {
    if (this.lockedChestPos) {
      this.lockedChestTurns++;
      const isStillChest = map.getObject(this.lockedChestPos) === 'CHEST';
      const isReached = player.pos.x === this.lockedChestPos.x && player.pos.y === this.lockedChestPos.y;
      if (!isStillChest || isReached || this.lockedChestTurns > this.MAX_TARGET_LOCK_TURNS) {
        this.clearChestLock();
      }
    }

    if (this.lockedItemPos && this.lockedItemType) {
      this.lockedItemTurns++;
      const isStillItem = map.getItem(this.lockedItemPos) === this.lockedItemType;
      const isReached = player.pos.x === this.lockedItemPos.x && player.pos.y === this.lockedItemPos.y;
      if (!isStillItem || isReached || this.lockedItemTurns > this.MAX_TARGET_LOCK_TURNS) {
        this.clearItemLock();
      }
    }
  }

  public assessMap(map: WorldMap, _player?: Player): MapAssessment {
    if (this.mapAssessment && this.lastAssessedMapRef === map) {
      return this.mapAssessment;
    }

    let totalGraves = 0;
    let openGraves = 0;
    let nearHomeGraves = 0;
    let totalChests = 0;
    let totalPotions = 0;
    let totalCrosses = 0;
    let totalBlocks = 0;

    const home = map.realHomePos;
    const radius = this.tuning.nearHomeRadius;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        const base = map.getBaseTile(p);
        const obj = map.getObject(p);
        const item = map.getItem(p);

        if (base === 'GRAVE') {
          totalGraves++;
          const openSpots = this.graveSealTactics.getOpenGraveSpots(p, map, []);
          if (openSpots.length > 0) {
            openGraves++;
            const dist = map.getTorusDistance(home, p).manhattan;
            if (dist <= radius) {
              nearHomeGraves++;
            }
          }
        }

        if (obj === 'CHEST') totalChests++;
        if (obj === 'BLOCK') totalBlocks++;
        if (item === 'POTION') totalPotions++;
        if (item === 'CROSS') totalCrosses++;
      }
    }

    let recommendedPolicy: GraveSealPolicy = 'NEAR_HOME';
    if (totalGraves <= 6 && totalCrosses >= 2) {
      recommendedPolicy = 'ALL';
    } else if (nearHomeGraves === 0) {
      recommendedPolicy = 'NONE';
    } else {
      recommendedPolicy = 'NEAR_HOME';
    }

    this.mapAssessment = {
      totalGraves,
      openGraves,
      nearHomeGraves,
      totalChests,
      totalPotions,
      totalCrosses,
      totalBlocks,
      recommendedPolicy,
    };
    this.lastAssessedMapRef = map;

    return this.mapAssessment;
  }

  // ==========================================================================
  // メイン意思決定ループ (decideAction / step)
  // ==========================================================================

  public decideAction(engine: GameEngine): BotAction {
    const player = engine.getPlayer();
    const map = engine.getMap ? engine.getMap() : (engine as any).getWorldMap();
    const enemies = engine.getEnemies().filter(e => e.isAlive);
    const dragon = engine.getDragon();
    const ghosts = engine.getGhosts ? engine.getGhosts() : [];

    MagicSystem.updatePassiveSkills(player);

    this.botNav.updateWarpTaboos();
    this.botNav.updateUnreachableTargets();
    this.updateTargetLock(map, player);

    // 0. 強制徘徊脱出フラグが立っている場合
    if (this.botNav.forceWanderNextTurn) {
      this.botNav.forceWanderNextTurn = false;
      this.itemToPickupPos = null;
      this.tempDroppedKeyPos = null;
      this.eightStepController.clearEightStepState();
      this.clearTargetLock();
      return this.botNav.wanderSafe(player, map, enemies, dragon, this.turnsInPhase);
    }

    // 1. フェーズ自動遷移の判定
    this.updatePhase(player, dragon, map, enemies);

    // 2. 緊急行動（HPピンチ、死神憑依、パワーストーン帰還）
    const emergencyAction = this.checkEmergency(player, map, enemies, dragon);
    if (emergencyAction) return emergencyAction;

    // 3. 振動（ピンポン往復・周回ループ）検知と強制脱出
    // ※アイテム持ち替え作業中または8歩周期調整中は正常な往復なので誤判定防止
    const isHandlingItemSwap = this.itemToPickupPos !== null || this.tempDroppedKeyPos !== null || this.eightStepController.eightStepTargetChestPos !== null;
    const rLen = this.botNav.recentPositions.length;
    if (rLen >= 3 && !isHandlingItemSwap) {
      let isStuckOrLooping = false;
      for (let lookback = 2; lookback <= Math.min(5, rLen); lookback++) {
        const prev = this.botNav.recentPositions[rLen - lookback];
        if (prev && prev.x === player.pos.x && prev.y === player.pos.y) {
          isStuckOrLooping = true;
          break;
        }
      }
      if (isStuckOrLooping) {
        this.botNav.oscillationCount++;
      } else {
        this.botNav.oscillationCount = Math.max(0, this.botNav.oscillationCount - 1);
      }
    }

    if (this.botNav.oscillationCount >= 3) {
      this.tempDroppedKeyPos = null;
      this.itemToPickupPos = null;
      this.botNav.oscillationCount = 0;
      return this.botNav.wanderSafe(player, map, enemies, dragon, this.turnsInPhase);
    }

    // 4. アイテム持ち替え経過ターン監視
    if (this.itemToPickupPos !== null) {
      this.itemSwapTurns++;
      if (this.itemSwapTurns >= this.MAX_ITEM_SWAP_TURNS) {
        this.itemToPickupPos = null;
        this.tempDroppedKeyPos = null;
        this.itemSwapTurns = 0;
        this.clearTargetLock();
        return this.botNav.wanderSafe(player, map, enemies, dragon, this.turnsInPhase);
      }
    } else {
      this.itemSwapTurns = 0;
    }

    // 5. 各フェーズの主戦略行動
    switch (this.currentPhase) {
      case 'BOOTSTRAP':
        return this.actBootstrap(player, map, enemies, dragon);
      case 'GRAVE_SEAL':
      case 'GRAVE_CONTROL':
        return this.actGraveSeal(player, map, enemies, dragon);
      case 'POWER_RUSH':
      case 'FARMING':
        return this.actPowerRush(player, map, enemies, dragon);
      case 'RELOCATE_HOME':
        return this.actRelocateHome(player, map, dragon, enemies);
      case 'DRAGON_SLAY':
        return this.actDragonSlay(player, map, dragon, enemies);
      case 'CROWN_ESCAPE':
        return this.actCrownEscape(player, map, enemies, dragon, ghosts);
      default:
        return { type: 'WAIT' };
    }
  }

  public step(engine: GameEngine): BotAction {
    const player = engine.getPlayer();
    const map = engine.getMap ? engine.getMap() : (engine as any).getWorldMap();
    const prevPos = { ...player.pos };

    // 訪問履歴更新
    this.botNav.recordPosition(player.pos);
    this.turnsInPhase++;

    const action = this.decideAction(engine);

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
        if (player.holdItem !== 'NONE') {
          engine.executeTurn(player.dir);
        } else {
          engine.executeTurn(null);
        }
        break;
    }

    const newPos = engine.getPlayer().pos;
    if (prevPos.x !== newPos.x || prevPos.y !== newPos.y) {
      const dist = map.getTorusDistance(prevPos, newPos);
      if (dist.chebyshev > 1) {
        this.botNav.recordWarpEvent(prevPos, newPos);
      }
    }

    return action;
  }

  public handleStuckRescue(): void {
    this.botNav.forceWanderNextTurn = true;
    this.itemToPickupPos = null;
    this.tempDroppedKeyPos = null;
    this.eightStepController.clearEightStepState();
    this.clearTargetLock();
    this.botNav.clearPositionHistory();
  }

  // ==========================================================================
  // フェーズ判定
  // ==========================================================================

  private updatePhase(player: Player, dragon: Dragon, map: WorldMap, enemies?: EnemyInstance[]): void {
    if (!this.mapAssessment) {
      this.assessMap(map, player);
    }
    const effectivePolicy: GraveSealPolicy = this.tuning.graveSealPolicy === 'AUTO'
      ? (this.mapAssessment?.recommendedPolicy ?? 'NEAR_HOME')
      : this.tuning.graveSealPolicy;

    // 1. 全首撃破済みなら王冠脱出フェーズ (CROWN_ESCAPE)
    if (dragon && (dragon.isAllHeadsDefeated || dragon.heads.every(h => !h.isAlive))) {
      this.setPhase('CROWN_ESCAPE');
      return;
    }

    // 2. ドラゴン討伐条件達成状況の計算:
    // 剣所持 ＋ STR >= 350,000 ＋ (EXP >= 12,000 または斜め移動解禁) ＋ 最低MP備蓄
    const livingHeads = dragon ? dragon.heads.filter(h => h.isAlive) : [];
    const maxHeadDef = livingHeads.length > 0 ? Math.max(...livingHeads.map(h => h.def)) : 0;
    const targetStr = Math.max(350000, maxHeadDef > 0 ? maxHeadDef + 1000 : 350000);
    const canDamageDragon = player.hasSword && player.strength >= targetStr;
    const hasDiagonal = player.experience >= 12000 || player.canDiagonal;
    const targetDefense = this.tuning.targetDefenseExp ?? 350000;

    if (canDamageDragon && (hasDiagonal || this.profile === 'NOVICE')) {
      if (this.currentPhase === 'POWER_RUSH') {
        this.defensePrepTurns++;
      }
      const hasNearbyHuntableEnemy = enemies && enemies.some(
        e => e.isAlive && !e.isPermanentlyFrozen &&
             ThreatEvaluator.evaluateThreat(player, e) === 'ONE_SHOT' &&
             map.getTorusDistance(player.pos, e.pos).manhattan <= 35
      );
      const minDragonMagic = Math.min(3, this.tuning.maxTargetMagic);
      const hasEnoughMagic = player.magic >= minDragonMagic || (player.magic >= 1 && (this.defensePrepTurns > 40 || player.experience >= targetDefense)) || this.defensePrepTurns > 60;
      const hasMinDefense = player.experience >= targetDefense || !hasNearbyHuntableEnemy || this.defensePrepTurns > 60;

      if ((hasMinDefense && hasEnoughMagic) || this.currentPhase === 'RELOCATE_HOME' || this.currentPhase === 'DRAGON_SLAY') {
        this.defenseReady = true;
      }
    }

    const defeatedCount = dragon ? dragon.defeatedHeadsCount : 0;

    // 2-A. STR・EXP達成済みだが 防御力(EXP)またはMP（壺）が不足している場合
    if (canDamageDragon && (hasDiagonal || this.profile === 'NOVICE') && !this.defenseReady && livingHeads.length > 0 && defeatedCount === 0) {
      this.setPhase('POWER_RUSH');
      return;
    }

    // 2-B. ドラゴン討伐準備完了時 (canDamageDragon & hasDiagonal & hasEnoughMagic)
    if (canDamageDragon && (hasDiagonal || this.profile === 'NOVICE') && livingHeads.length > 0) {
      if (effectivePolicy !== 'NONE' && !this.graveSealTactics.graveSealAborted && this.graveSealTactics.totalGraveSealTurns < 60 && enemies && defeatedCount === 0) {
        const preGraves = this.graveSealTactics.getTargetOpenGraves(map, enemies, effectivePolicy, this.tuning, this.mapAssessment);
        if (preGraves.length > 0 && this.graveSealTactics.hasAvailableSealTools(map, player, enemies, dragon, { tuning: this.tuning, mapAssessment: this.mapAssessment })) {
          this.setPhase('GRAVE_SEAL');
          return;
        }
      }

      // 2-C. 我が家前線基地移転戦術 (RELOCATE_HOME)
      const hasBreak = player.experience >= 4000 || MagicSystem.canCast(player, 'BREAK').allowed;
      const distHomeToDragon = map.getTorusDistance(map.realHomePos, map.dragonCenter).chebyshev;
      const isCurrentlyRelocating = this.currentPhase === 'RELOCATE_HOME' && !this.homeRelocationTactics.homeRelocationDone && !this.homeRelocationTactics.homeRelocationAborted;
      const canStartRelocation = distHomeToDragon >= 10 && !this.homeRelocationTactics.homeRelocationDone && !this.homeRelocationTactics.homeRelocationAborted;

      if (this.homeRelocationTactics.totalHomeRelocateTurns >= 80 && !this.homeRelocationTactics.homeRelocationDone) {
        this.homeRelocationTactics.homeRelocationAborted = true;
      }

      if (
        this.tuning.enableHomeRelocation &&
        this.profile !== 'NOVICE' &&
        (isCurrentlyRelocating || canStartRelocation) &&
        !this.homeRelocationTactics.homeRelocationDone &&
        !this.homeRelocationTactics.homeRelocationAborted &&
        this.homeRelocationTactics.totalHomeRelocateTurns < 80 &&
        defeatedCount === 0 &&
        hasBreak
      ) {
        const hasRing = player.holdItem === 'RING' || this.botNav.findNearestItem(player.pos, 'RING', map, enemies, player) !== null || this.botNav.findAnyItemOnMap('RING', map) !== null;
        if (hasRing) {
          this.setPhase('RELOCATE_HOME');
          return;
        }
      }

      this.setPhase('DRAGON_SLAY');
      return;
    }

    // 3. 序盤墓封鎖 (GRAVE_SEAL) の判定
    const canDoEarlyGraveSeal =
      effectivePolicy !== 'NONE' &&
      this.tuning.graveSealTiming === 'EARLY' &&
      !this.graveSealTactics.graveSealAborted &&
      this.graveSealTactics.totalGraveSealTurns < 60 &&
      player.hasSword &&
      player.strength >= this.tuning.graveSealEarlyStr &&
      defeatedCount === 0;

    if (canDoEarlyGraveSeal && enemies) {
      const openGraves = this.graveSealTactics.getTargetOpenGraves(map, enemies, effectivePolicy, this.tuning, this.mapAssessment);
      if (openGraves.length > 0 && this.graveSealTactics.hasAvailableSealTools(map, player, enemies, dragon, { tuning: this.tuning, mapAssessment: this.mapAssessment })) {
        this.setPhase('GRAVE_SEAL');
        return;
      }
    }

    // 4. パワーストーン回収・宝箱開錠フェーズ (POWER_RUSH)
    if (player.hasSword) {
      this.setPhase('POWER_RUSH');
      return;
    }

    // 5. 剣未所持の場合は初期確保 (BOOTSTRAP)
    this.setPhase('BOOTSTRAP');
  }

  // ==========================================================================
  // 緊急回避 & BREAK掘削移動
  // ==========================================================================

  private checkEmergency(player: Player, map: WorldMap, enemies: EnemyInstance[], dragon: Dragon): BotAction | null {
    const isPinch = player.hp < player.maxHp * 0.45;
    const hasPowerStone = player.holdItem === 'POWER_STONE';
    const hasDeath = player.hasDeath;

    const adjacentEnemies = this.botNav.getAdjacentEnemies(player.pos, enemies, map);
    const hasLethalAdjacent = adjacentEnemies.some(
      ({ enemy }) => ThreatEvaluator.evaluateThreat(player, enemy) === 'LETHAL'
    );

    const nearestCross = hasDeath ? this.graveSealTactics.findNearestAnyCross(player.pos, map) : null;
    const homeDist = map.getTorusDistance(player.pos, map.realHomePos).manhattan;
    const crossDist = nearestCross ? map.getTorusDistance(player.pos, nearestCross).manhattan : Infinity;

    const shouldPurifyDeath = hasDeath && (
      player.magic > 0 ||
      (nearestCross !== null && (crossDist <= 12 || crossDist < homeDist)) ||
      (isPinch || hasPowerStone)
    );

    if (hasLethalAdjacent || isPinch) {
      this.itemToPickupPos = null;
    }

    if (hasLethalAdjacent || isPinch || hasPowerStone) {
      if (player.holdItem === 'CROWN' && hasLethalAdjacent && player.magic > 0 && !player.hasDeath && map.getItem(player.pos) === 'NONE') {
        const canCastOffensive = player.experience >= 3000;
        if (canCastOffensive) {
          return { type: 'SPACE' };
        }
      }

      // 振動状態（進退ループ中: oscillationCount >= 2）で、近傍に未凍結の敵がいる場合、
      // RETURN で逃げ戻るのではなく FREEZE / FLASH で敵を無力化して活路を開く！
      if (this.botNav.oscillationCount >= 2 && !player.hasDeath && !hasPowerStone) {
        if (MagicSystem.canCast(player, 'FREEZE').allowed) {
          const adjTarget = adjacentEnemies.find(
            ({ enemy }) => !enemy.isPermanentlyFrozen
          );
          if (adjTarget) {
            return { type: 'MAGIC', magic: 'FREEZE' };
          }
        }
        if (MagicSystem.canCast(player, 'FLASH').allowed) {
          return { type: 'MAGIC', magic: 'FLASH' };
        }
      }

      const isEscapePhase = dragon.isAllHeadsDefeated || this.currentPhase === 'CROWN_ESCAPE';
      if (!isEscapePhase || hasPowerStone || (player.holdItem === 'NONE' && isPinch && player.magic >= 2)) {
        if (MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying) {
          return { type: 'MAGIC', magic: 'RETURN' };
        }
      }

      if (hasLethalAdjacent && !player.hasDeath) {
        if (MagicSystem.canCast(player, 'FREEZE').allowed) {
          const adjLethal = adjacentEnemies.find(
            ({ enemy }) => ThreatEvaluator.evaluateThreat(player, enemy) === 'LETHAL' && !enemy.isPermanentlyFrozen
          );
          if (adjLethal) {
            return { type: 'MAGIC', magic: 'FREEZE' };
          }
        }
        if (MagicSystem.canCast(player, 'FLASH').allowed) {
          return { type: 'MAGIC', magic: 'FLASH' };
        }
      }

      if (player.hasDeath && nearestCross && crossDist <= 5) {
        const dirCross = this.botNav.findPath(player.pos, nearestCross, map, player, enemies, player.canDiagonal, dragon);
        if (dirCross) return this.handleMoveOrBreak(dirCross, player, map);
      }

      if (isEscapePhase && player.holdItem !== 'CROWN') {
        return null;
      }

      const homePos = map.realHomePos;
      // RING所持中は我が家に入れず家を押してしまうため、我が家近傍の安全な床でRINGを手放して手ぶらで帰還全回復する
      if (player.holdItem === 'RING') {
        const distToHome = map.getTorusDistance(player.pos, homePos).chebyshev;
        if (distToHome <= 2) {
          if (map.getItem(player.pos) === 'NONE' && map.getBaseTile(player.pos) !== 'HOME') {
            return { type: 'SPACE' };
          }
          const safeDir = this.botNav.findAdjacentSafeEmptyFloor(player.pos, map, enemies, dragon, player);
          if (safeDir) return { type: 'MOVE', dir: safeDir };
        }
      }

      const dirToHome = this.botNav.findPath(player.pos, homePos, map, player, enemies, player.canDiagonal, dragon);
      if (dirToHome) {
        return this.handleMoveOrBreak(dirToHome, player, map);
      }

      if (nearestCross) {
        const dirCross = this.botNav.findPath(player.pos, nearestCross, map, player, enemies, player.canDiagonal, dragon);
        if (dirCross) return this.handleMoveOrBreak(dirCross, player, map);
      }
    }

    if (shouldPurifyDeath) {
      if (nearestCross && (crossDist <= 15 || crossDist < homeDist)) {
        const dirCross = this.botNav.findPath(player.pos, nearestCross, map, player, enemies, player.canDiagonal, dragon);
        if (dirCross) return this.handleMoveOrBreak(dirCross, player, map);
      }

      if (player.magic > 0) {
        const dirToHome = this.botNav.findPath(player.pos, map.realHomePos, map, player, enemies, player.canDiagonal, dragon);
        if (dirToHome) return this.handleMoveOrBreak(dirToHome, player, map);
      }
    }

    return null;
  }

  public handleMoveOrBreak(dir: Direction, player: Player, map: WorldMap): BotAction {
    const nextPos = map.wrapPosition(MovementSystem.getNextPosition(player.pos, dir));
    if (map.getObject(nextPos) === 'BLOCK') {
      if (MagicSystem.canCast(player, 'BREAK').allowed) {
        player.dir = dir;
        this.botNav.clearUnreachableTargets();
        return { type: 'MAGIC', magic: 'BREAK' };
      }
    }
    return { type: 'MOVE', dir };
  }

  private findAdjacentDropTile(
    pos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon?: Dragon,
    player?: Player
  ): Direction | null {
    const safeDir = this.botNav.findAdjacentSafeEmptyFloor(pos, map, enemies, dragon, player);
    if (safeDir) return safeDir;

    const dirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    for (const dir of dirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(pos, dir));
      if (map.getBaseTile(nextPos) === 'WALL_STATIC') continue;
      if (map.getBaseTile(nextPos) === 'WARP') continue;
      if (map.getBaseTile(nextPos) === 'GRAVE') continue;
      if (map.getObject(nextPos) !== 'NONE') continue;
      if (map.getItem(nextPos) !== 'NONE') continue;
      if (dragon && dragon.getPartAt(nextPos)) continue;
      const enemy = enemies.find(e => e.isAlive && e.pos.x === nextPos.x && e.pos.y === nextPos.y);
      if (enemy) continue;
      return dir;
    }
    return null;
  }

  // ==========================================================================
  // 各フェーズ行動
  // ==========================================================================

  private actBootstrap(player: Player, map: WorldMap, enemies: EnemyInstance[], dragon: Dragon): BotAction {
    const curPos = player.pos;
    const currentItem = map.getItem(curPos);

    if (currentItem === 'SWORD' && !player.hasSword) {
      return { type: 'SPACE' };
    }

    if (player.hasSword && currentItem === 'KEY' && player.holdItem === 'NONE') {
      return { type: 'SPACE' };
    }

    if (player.holdItem === 'NONE' && (currentItem === 'POTION' || currentItem === 'COIN')) {
      return { type: 'SPACE' };
    }

    if (!player.hasSword) {
      const swordCandidates = this.botNav.findNearestItemCandidates(player.pos, 'SWORD', map, enemies, player, 5, {
        lockedItemPos: this.lockedItemPos,
        lockedItemType: this.lockedItemType,
        hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
      });
      for (const swordPos of swordCandidates) {
        const dir = this.botNav.findPath(player.pos, swordPos, map, player, enemies, false, dragon);
        if (dir) {
          this.setLockedItem(swordPos, 'SWORD');
          return this.handleMoveOrBreak(dir, player, map);
        }
      }
      this.clearItemLock();
    }

    if (player.hasSword && player.holdItem === 'NONE') {
      if (player.magic < this.tuning.maxTargetMagic) {
        const potionCandidates = this.botNav.findNearestItemCandidates(player.pos, 'POTION', map, enemies, player, 5, {
          lockedItemPos: this.lockedItemPos,
          lockedItemType: this.lockedItemType,
          hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
        });
        for (const potionPos of potionCandidates) {
          const pDist = map.getTorusDistance(player.pos, potionPos).manhattan;
          if (pDist <= 15) {
            const dir = this.botNav.findPath(player.pos, potionPos, map, player, enemies, false, dragon);
            if (dir) {
              this.setLockedItem(potionPos, 'POTION');
              return this.handleMoveOrBreak(dir, player, map);
            }
          }
        }
        this.clearItemLock();
      }

      const keyCandidates = this.botNav.findNearestItemCandidates(player.pos, 'KEY', map, enemies, player, 5, {
        lockedItemPos: this.lockedItemPos,
        lockedItemType: this.lockedItemType,
        hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
      });
      for (const keyPos of keyCandidates) {
        const dir = this.botNav.findPath(player.pos, keyPos, map, player, enemies, false, dragon);
        if (dir) {
          this.setLockedItem(keyPos, 'KEY');
          return this.handleMoveOrBreak(dir, player, map);
        }
      }
      this.clearItemLock();
    }

    return this.botNav.wanderSafe(player, map, enemies, dragon, this.turnsInPhase);
  }

  private actGraveSeal(player: Player, map: WorldMap, enemies: EnemyInstance[], dragon: Dragon): BotAction {
    return this.graveSealTactics.actGraveSeal(player, map, enemies, dragon, {
      tuning: this.tuning,
      profile: this.profile,
      turnsInPhase: this.turnsInPhase,
      mapAssessment: this.mapAssessment,
      setPhase: (p) => this.setPhase(p),
      actPowerRush: (pl, m, e, d) => this.actPowerRush(pl, m, e, d),
      handleMoveOrBreak: (dir, pl, m) => this.handleMoveOrBreak(dir, pl, m),
    });
  }

  public actGraveControl(player: Player, map: WorldMap, enemies: EnemyInstance[], dragon: Dragon): BotAction {
    return this.actGraveSeal(player, map, enemies, dragon);
  }

  private actPowerRush(player: Player, map: WorldMap, enemies: EnemyInstance[], dragon: Dragon): BotAction {
    const curPos = player.pos;
    const floorItem = map.getItem(curPos);
    const floorObj = map.getObject(curPos);

    // 0. 手持ちが宝箱開錠・育成に不要な道具（RING や CROSS）の場合、安全な空床で手放す
    if (player.holdItem !== 'NONE' && player.holdItem !== 'KEY' && player.holdItem !== 'POWER_STONE') {
      const isCurSafe = this.botNav.isSafeEmptyFloor(curPos, map, enemies, dragon, player);
      if (isCurSafe) {
        return { type: 'SPACE' };
      }
      const safeDir = this.botNav.findAdjacentSafeEmptyFloor(curPos, map, enemies, dragon, player) ??
                      this.botNav.findNearestSafeEmptyFloor(curPos, map, player, enemies, dragon);
      if (safeDir) {
        return { type: 'MOVE', dir: safeDir };
      }
    }

    // 1. パワーストーン所持中なら我が家へ最速帰還＆奉納！
    if (player.holdItem === 'POWER_STONE') {
      this.eightStepController.clearEightStepState();
      if (MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying) {
        return { type: 'MAGIC', magic: 'RETURN' };
      }
      const dirToHome = this.botNav.findPath(curPos, map.realHomePos, map, player, enemies, player.canDiagonal, dragon);
      if (dirToHome) return this.handleMoveOrBreak(dirToHome, player, map);
      return this.botNav.wanderSafe(player, map, enemies, dragon, this.turnsInPhase);
    }

    // 1-B. 8歩周期宝箱開錠モード中なら歩数調整＆確定開錠を最優先！
    if (this.eightStepController.eightStepTargetChestPos !== null) {
      const eightStepAction = this.eightStepController.handleEightStepCycle(player, map, enemies, dragon);
      if (eightStepAction) return eightStepAction;
    }

    // 2. 宝箱開錠後のアイテム持ち替え制御 (Hands-Free Rule)
    const isValuableItem = floorItem === 'POWER_STONE' || (floorItem === 'POTION' && player.magic < this.tuning.maxTargetMagic);

    if (isValuableItem && player.holdItem === 'KEY') {
      if (floorItem === 'POWER_STONE' && player.stepCountSinceStone === 0) {
        const target = this.eightStepController.findNearbyChestForEightStepCycle(curPos, map, enemies, dragon, player);
        if (target) {
          this.eightStepController.eightStepTargetChestPos = target.chestPos;
          this.eightStepController.eightStepOriginPos = { ...curPos };
          this.eightStepController.eightStepPivotPos = target.pivotPos;
          this.eightStepController.eightStepWaitPos = target.waitPos;
          this.eightStepController.eightStepPathToPivot = target.pathToPivot;
          const firstStep = target.pathToPivot[0] ?? target.pivotPos;
          const dir = this.botNav.getAdjacentDirection(curPos, firstStep, map);
          if (dir) return { type: 'MOVE', dir };
        }
      }

      this.eightStepController.clearEightStepState();
      this.itemToPickupPos = { ...curPos };
      const stepDir = this.findAdjacentDropTile(curPos, map, enemies, dragon, player);
      if (stepDir) {
        return { type: 'MOVE', dir: stepDir };
      }
    }

    if (this.itemToPickupPos !== null && player.holdItem === 'KEY') {
      const canDropHere = map.getItem(curPos) === 'NONE' && map.getObject(curPos) === 'NONE' &&
                          map.getBaseTile(curPos) !== 'WALL_STATIC' && map.getBaseTile(curPos) !== 'WARP';
      if (canDropHere) {
        this.tempDroppedKeyPos = { ...curPos };
        return { type: 'SPACE' };
      } else {
        const stepDir = this.findAdjacentDropTile(curPos, map, enemies, dragon, player);
        if (stepDir) {
          return { type: 'MOVE', dir: stepDir };
        }
      }
    }

    if (player.holdItem === 'NONE' && this.itemToPickupPos !== null) {
      if (curPos.x === this.itemToPickupPos.x && curPos.y === this.itemToPickupPos.y) {
        if (floorItem !== 'NONE') {
          const action: BotAction = { type: 'SPACE' };
          this.itemToPickupPos = null;
          return action;
        } else {
          this.itemToPickupPos = null;
        }
      } else {
        const dir = this.botNav.findPath(curPos, this.itemToPickupPos, map, player, enemies, player.canDiagonal, dragon);
        if (dir) return this.handleMoveOrBreak(dir, player, map);
        else this.itemToPickupPos = null;
      }
    }

    if (player.holdItem === 'NONE' && this.itemToPickupPos === null && this.tempDroppedKeyPos !== null) {
      if (map.getItem(this.tempDroppedKeyPos) === 'KEY') {
        if (curPos.x === this.tempDroppedKeyPos.x && curPos.y === this.tempDroppedKeyPos.y) {
          this.tempDroppedKeyPos = null;
          return { type: 'SPACE' };
        } else {
          const dir = this.botNav.findPath(curPos, this.tempDroppedKeyPos, map, player, enemies, player.canDiagonal, dragon);
          if (dir) return this.handleMoveOrBreak(dir, player, map);
          else this.tempDroppedKeyPos = null;
        }
      } else {
        this.tempDroppedKeyPos = null;
      }
    }

    if (player.holdItem === 'NONE' && (floorItem === 'KEY' || isValuableItem)) {
      return { type: 'SPACE' };
    }

    // 3. 宝箱開錠（8歩周期の活用）
    if (floorObj === 'CHEST' && player.holdItem === 'KEY' && this.itemToPickupPos === null) {
      return { type: 'SPACE' };
    }

    // 4. 周囲の安全な敵を撃破（EXP稼ぎ＆障害排除）
    const adjacentTargets = this.botNav.getAdjacentEnemies(curPos, enemies, map);

    if (adjacentTargets.length >= 2 || adjacentTargets.some(({ enemy }) => ThreatEvaluator.evaluateThreat(player, enemy) === 'DANGER')) {
      if (MagicSystem.canCast(player, 'FREEZE').allowed) {
        const target = adjacentTargets.find(({ enemy }) => !enemy.isPermanentlyFrozen);
        if (target) {
          return { type: 'MAGIC', magic: 'FREEZE' };
        }
      }
      if (MagicSystem.canCast(player, 'FLASH').allowed) {
        return { type: 'MAGIC', magic: 'FLASH' };
      }
    }

    for (const { enemy, dir } of adjacentTargets) {
      const threat = ThreatEvaluator.evaluateThreat(player, enemy);
      if (threat === 'ONE_SHOT') {
        return { type: 'MOVE', dir };
      }
    }

    // 4-B. RETURN魔法解禁・斜め移動解禁・決戦前EXP（防御力・HP）育成
    if (player.hasSword && player.strength >= 1000) {
      const needReturn = player.experience < 2000;
      const needDiagonal = player.experience < 12000 && !player.canDiagonal;
      const targetDefense = this.tuning.targetDefenseExp;
      const needExp = player.experience < targetDefense;
      if (needReturn || needDiagonal || needExp) {
        const safeCandidates = this.botNav.findNearestSafeEnemyCandidates(player, enemies, map, 15);
        for (const safeEnemy of safeCandidates) {
          const dist = map.getTorusDistance(curPos, safeEnemy.pos).manhattan;
          const maxDist = (needReturn || needDiagonal) ? 20 : (player.strength >= 350000 ? 45 : 5);
          if (dist <= maxDist) {
            const dir = this.botNav.findPath(curPos, safeEnemy.pos, map, player, enemies, player.canDiagonal, dragon);
            if (dir) return this.handleMoveOrBreak(dir, player, map);
          }
        }
      }
    }

    // 5. 鍵を持っている場合: 最寄りの宝箱へ向かう（近傍POTIONの一時回収も含む）
    if (player.holdItem === 'KEY') {
      if (player.magic < this.tuning.maxTargetMagic && this.itemToPickupPos === null && this.tempDroppedKeyPos === null) {
        const potionCandidates = this.botNav.findNearestItemCandidates(curPos, 'POTION', map, enemies, player, 5, {
          lockedItemPos: this.lockedItemPos,
          lockedItemType: this.lockedItemType,
          hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
        });
        const maxDist = player.strength >= 350000 ? 25 : 12;
        for (const candidate of potionCandidates) {
          const pDist = map.getTorusDistance(curPos, candidate).manhattan;
          if (pDist <= maxDist) {
            const dir = this.botNav.findPath(curPos, candidate, map, player, enemies, player.canDiagonal, dragon);
            if (dir) {
              this.setLockedItem(candidate, 'POTION');
              return this.handleMoveOrBreak(dir, player, map);
            }
          }
        }
      }

      if (player.strength < 350000) {
        const chestCandidates = this.botNav.findNearestChestCandidates(curPos, map, enemies, player, 5, {
          lockedChestPos: this.lockedChestPos,
          hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
        });
        for (const chestPos of chestCandidates) {
          const dir = this.botNav.findPath(curPos, chestPos, map, player, enemies, player.canDiagonal, dragon);
          if (dir) {
            this.setLockedChest(chestPos);
            return this.handleMoveOrBreak(dir, player, map);
          }
        }
        this.clearChestLock();
      } else {
        // STR 350,000 達成後は宝箱開錠不要。即座に鍵を手放して手ぶらでPOTION回収・敵狩りへ
        if (floorItem === 'NONE' && floorObj === 'NONE') {
          return { type: 'SPACE' };
        }
        const dirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
        for (const dir of dirs) {
          const nextPos = map.wrapPosition(MovementSystem.getNextPosition(curPos, dir));
          if (map.getBaseTile(nextPos) !== 'WALL_STATIC' && map.getObject(nextPos) === 'NONE' && map.getItem(nextPos) === 'NONE') {
            return { type: 'MOVE', dir };
          }
        }
        return { type: 'SPACE' };
      }
    }

    // 6. 手ぶらの場合: 床のパワーストーン、POTION、最寄りの鍵を回収
    if (player.holdItem === 'NONE') {
      const needMagic = player.magic < this.tuning.maxTargetMagic;
      const strDone = player.strength >= 350000;

      if (strDone && needMagic) {
        const potionCandidates = this.botNav.findNearestItemCandidates(curPos, 'POTION', map, enemies, player, 5, {
          lockedItemPos: this.lockedItemPos,
          lockedItemType: this.lockedItemType,
          hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
        });
        for (const nearestPotion of potionCandidates) {
          if (curPos.x === nearestPotion.x && curPos.y === nearestPotion.y) {
            return { type: 'SPACE' };
          }
          const dir = this.botNav.findPath(curPos, nearestPotion, map, player, enemies, player.canDiagonal, dragon);
          if (dir) {
            this.setLockedItem(nearestPotion, 'POTION');
            return this.handleMoveOrBreak(dir, player, map);
          }
        }
        this.clearItemLock();
      }

      if (!strDone) {
        const stoneCandidates = this.botNav.findNearestItemCandidates(curPos, 'POWER_STONE', map, enemies, player, 5, {
          lockedItemPos: this.lockedItemPos,
          lockedItemType: this.lockedItemType,
          hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
        });
        for (const nearestStone of stoneCandidates) {
          const sDist = map.getTorusDistance(curPos, nearestStone).manhattan;
          if (sDist <= 15) {
            if (curPos.x === nearestStone.x && curPos.y === nearestStone.y) {
              return { type: 'SPACE' };
            }
            const dir = this.botNav.findPath(curPos, nearestStone, map, player, enemies, player.canDiagonal, dragon);
            if (dir) {
              this.setLockedItem(nearestStone, 'POWER_STONE');
              return this.handleMoveOrBreak(dir, player, map);
            }
          }
        }
        this.clearItemLock();
      }

      if (needMagic) {
        const potionCandidates = this.botNav.findNearestItemCandidates(curPos, 'POTION', map, enemies, player, 5, {
          lockedItemPos: this.lockedItemPos,
          lockedItemType: this.lockedItemType,
          hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
        });
        for (const nearestPotion of potionCandidates) {
          const pDist = map.getTorusDistance(curPos, nearestPotion).manhattan;
          if (strDone || pDist <= 15) {
            if (curPos.x === nearestPotion.x && curPos.y === nearestPotion.y) {
              return { type: 'SPACE' };
            }
            const dir = this.botNav.findPath(curPos, nearestPotion, map, player, enemies, player.canDiagonal, dragon);
            if (dir) {
              this.setLockedItem(nearestPotion, 'POTION');
              return this.handleMoveOrBreak(dir, player, map);
            }
          }
        }
        this.clearItemLock();
      }

      if (player.strength < 350000) {
        const keyCandidates = this.botNav.findNearestItemCandidates(curPos, 'KEY', map, enemies, player, 5, {
          lockedItemPos: this.lockedItemPos,
          lockedItemType: this.lockedItemType,
          hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
        });
        for (const nearestKey of keyCandidates) {
          if (curPos.x === nearestKey.x && curPos.y === nearestKey.y) {
            return { type: 'SPACE' };
          }
          const dir = this.botNav.findPath(curPos, nearestKey, map, player, enemies, player.canDiagonal, dragon);
          if (dir) {
            this.setLockedItem(nearestKey, 'KEY');
            return this.handleMoveOrBreak(dir, player, map);
          }
        }
        this.clearItemLock();
      }
    }

    return this.botNav.wanderSafe(player, map, enemies, dragon, this.turnsInPhase);
  }

  public actFarming(player: Player, map: WorldMap, enemies: EnemyInstance[], dragon: Dragon): BotAction {
    return this.actPowerRush(player, map, enemies, dragon);
  }

  private actRelocateHome(player: Player, map: WorldMap, dragon: Dragon, enemies: EnemyInstance[]): BotAction {
    return this.homeRelocationTactics.actRelocateHome(player, map, dragon, enemies, {
      tuning: this.tuning,
      setPhase: (p) => this.setPhase(p),
      actDragonSlay: (pl, m, d, e) => this.actDragonSlay(pl, m, d, e),
      handleMoveOrBreak: (dir, pl, m) => this.handleMoveOrBreak(dir, pl, m),
    });
  }

  private actDragonSlay(player: Player, map: WorldMap, dragon: Dragon, enemies: EnemyInstance[]): BotAction {
    const livingHeads = dragon.heads.filter(h => h.isAlive);
    if (livingHeads.length === 0) {
      return { type: 'WAIT' };
    }

    const curPos = player.pos;

    // 1. 首の斜め隣接マスにいる場合、首攻撃が何よりも最優先！！
    for (const head of livingHeads) {
      const delta = this.botNav.getTorusDelta(curPos, head.pos, map.width, map.height);
      if (Math.abs(delta.dx) === 1 && Math.abs(delta.dy) === 1) {
        const dir = this.botNav.getDirectionFromDelta(delta.dx, delta.dy);
        if (dir) {
          return { type: 'MOVE', dir };
        }
      }
    }

    // 2. 首から離れており(チェビシェフ距離5超)、かつ近場にPOTIONがある場合のみ補給
    const nearestHeadDist = Math.min(...livingHeads.map(h => map.getTorusDistance(curPos, h.pos).chebyshev));
    if (nearestHeadDist > 5 && player.magic < 2 && player.holdItem === 'NONE') {
      const potionPos = this.botNav.findNearestItem(curPos, 'POTION', map, enemies, player);
      if (potionPos) {
        const pDist = map.getTorusDistance(curPos, potionPos).manhattan;
        if (pDist <= 15) {
          if (curPos.x === potionPos.x && curPos.y === potionPos.y) {
            return { type: 'SPACE' };
          }
          const dir = this.botNav.findPath(curPos, potionPos, map, player, enemies, player.canDiagonal, dragon);
          if (dir) return this.handleMoveOrBreak(dir, player, map);
        }
      }
    }

    let bestSpot: Position | null = null;
    let bestDir: Direction | null = null;
    let minDist = Infinity;

    for (const head of livingHeads) {
      const deltas = [
        { dx: -1, dy: -1 },
        { dx: 1, dy: -1 },
        { dx: -1, dy: 1 },
        { dx: 1, dy: 1 },
      ];

      for (const d of deltas) {
        const spot = map.wrapPosition({ x: head.pos.x + d.dx, y: head.pos.y + d.dy });
        const part = dragon.getPartAt(spot);
        if (part) continue;
        if (map.getBaseTile(spot) === 'WALL_STATIC') continue;

        const isOrthogonalToAnyHead = livingHeads.some(h => {
          return map.getTorusDistance(spot, h.pos).manhattan === 1;
        });
        if (isOrthogonalToAnyHead) continue;

        const dist = map.getTorusDistance(curPos, spot).chebyshev;
        if (dist < minDist) {
          const dir = this.botNav.findPath(curPos, spot, map, player, enemies, player.canDiagonal, dragon);
          if (dir) {
            minDist = dist;
            bestSpot = spot;
            bestDir = dir;
          }
        }
      }
    }

    if (bestSpot && bestDir) {
      return this.handleMoveOrBreak(bestDir, player, map);
    }

    return this.botNav.wanderSafe(player, map, enemies, dragon, this.turnsInPhase);
  }

  private actCrownEscape(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    _ghosts?: Ghost[]
  ): BotAction {
    const curPos = player.pos;

    // 0. 手持ちに王冠以外の不要な道具（RING, KEY, CROSS等）があれば即座に手放して手ぶらになる
    if (player.holdItem !== 'NONE' && player.holdItem !== 'CROWN') {
      if (map.getItem(curPos) === 'NONE' && map.getObject(curPos) === 'NONE' &&
          map.getBaseTile(curPos) !== 'WALL_STATIC' && map.getBaseTile(curPos) !== 'WARP') {
        return { type: 'SPACE' };
      }
      const stepDir = this.findAdjacentDropTile(curPos, map, enemies, dragon, player);
      if (stepDir) return { type: 'MOVE', dir: stepDir };
      return { type: 'SPACE' };
    }

    // 1. 手ぶら時: 足元の王冠回収（安全確認＆帰路開通確認）
    if (player.holdItem === 'NONE' && map.getItem(curPos) === 'CROWN') {
      // 王冠を持った状態で我が家へ帰還できるか事前シミュレーション
      // （※王冠所持時は敵マスが進入不可になるため、道が塞がれる可能性がある）
      const testPlayer = { ...player, holdItem: 'CROWN' } as Player;
      const dirWithCrown = this.botNav.findPath(curPos, map.realHomePos, map, testPlayer, enemies, player.canDiagonal, dragon, undefined, 'CROWN_ESCAPE', _ghosts);

      if (!dirWithCrown) {
        // 王冠を持つと道が塞がれてしまう袋小路状態！
        // 手ぶらのうちに、直角隣接の敵を攻撃排除するか、ブロックを破壊して道を切り開く！
        const adjacentTargets = this.botNav.getAdjacentEnemies(curPos, enemies, map);
        for (const { enemy, dir } of adjacentTargets) {
          if (dragon && dragon.getPartAt(enemy.pos)) continue;
          if (ThreatEvaluator.evaluateThreat(player, enemy) === 'ONE_SHOT') {
            const rawDmg = Math.max(0, enemy.atk - player.experience);
            if (rawDmg === 0) {
              return { type: 'MOVE', dir };
            }
          }
        }

        // 直角隣接にブロックがあれば BREAK
        const cardDirs: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
        for (const d of cardDirs) {
          const adj = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
          if (map.getObject(adj) === 'BLOCK' && MagicSystem.canCast(player, 'BREAK').allowed) {
            player.dir = d;
            return { type: 'MAGIC', magic: 'BREAK' };
          }
        }

        // 周囲に敵がいれば FREEZE または FLASH
        if (player.magic > 0 && !player.hasDeath) {
          if (MagicSystem.canCast(player, 'FREEZE').allowed) {
            return { type: 'MAGIC', magic: 'FREEZE' };
          }
          if (MagicSystem.canCast(player, 'FLASH').allowed) {
            return { type: 'MAGIC', magic: 'FLASH' };
          }
        }
      }

      // 直角隣接に即死級（LETHAL）敵がいる場合のみ、拾う前に FREEZE または FLASH で無力化
      const adjacentLethal = enemies.find(e => {
        if (!e.isAlive || e.isPermanentlyFrozen) return false;
        const d = map.getTorusDistance(curPos, e.pos).manhattan;
        if (d !== 1) return false;
        const threat = ThreatEvaluator.evaluateThreat(player, e);
        const rawDmg = Math.max(0, e.atk - player.experience);
        return threat === 'LETHAL' || rawDmg >= player.hp;
      });
      if (adjacentLethal && player.magic > 0 && !player.hasDeath) {
        if (MagicSystem.canCast(player, 'FREEZE').allowed) {
          return { type: 'MAGIC', magic: 'FREEZE' };
        }
        if (MagicSystem.canCast(player, 'FLASH').allowed) {
          return { type: 'MAGIC', magic: 'FLASH' };
        }
      }
      return { type: 'SPACE' };
    }

    // 2. 王冠所持中（holdItem === 'CROWN'）: 我が家（前線基地）への最速運搬
    if (player.holdItem === 'CROWN') {
      // 2-A. 足元が我が家なら奉納完了
      if (curPos.x === map.realHomePos.x && curPos.y === map.realHomePos.y) {
        return { type: 'SPACE' };
      }

      // 2-B. 直角隣接に即死級（LETHAL）敵が迫っている場合の緊急回避または王冠ドロップ
      const adjacentLethal = enemies.find(e => {
        if (!e.isAlive || e.isPermanentlyFrozen) return false;
        const d = map.getTorusDistance(curPos, e.pos).manhattan;
        if (d !== 1) return false;
        const threat = ThreatEvaluator.evaluateThreat(player, e);
        const rawDmg = Math.max(0, e.atk - player.experience);
        return threat === 'LETHAL' || rawDmg >= player.hp;
      });

      if (adjacentLethal) {
        const evadeDir = this.botNav.findEvadeDirection(curPos, map, enemies, player, dragon);
        if (evadeDir) return { type: 'MOVE', dir: evadeDir };

        // 逃げ場がない場合、王冠を床に置いて魔法封印を解除し次ターン反撃
        if (map.getItem(curPos) === 'NONE') {
          return { type: 'SPACE' };
        }
      }

      // 2-C. 我が家（前線基地）へ最短直行！
      const dirToHome = this.botNav.findPath(curPos, map.realHomePos, map, player, enemies, player.canDiagonal, dragon, undefined, 'CROWN_ESCAPE', _ghosts);
      if (dirToHome) return this.handleMoveOrBreak(dirToHome, player, map);

      // 経路が完全に塞がれている場合（岩や敵で道がない）、王冠を一時ドロップして道を拓く
      if (map.getItem(curPos) === 'NONE') {
        return { type: 'SPACE' };
      }

      return this.botNav.wanderSafe(player, map, enemies, dragon, this.turnsInPhase);
    }

    // 3. 手ぶら時（holdItem === 'NONE'）:
    // 3-A. 足元の POTION を拾う（MP不足時）
    if (map.getItem(curPos) === 'POTION' && player.magic < this.tuning.maxTargetMagic) {
      return { type: 'SPACE' };
    }

    // 3-B. 直角隣接の即死級（LETHAL）敵への対応
    const adjacentLethal = enemies.find(e => {
      if (!e.isAlive || e.isPermanentlyFrozen) return false;
      const d = map.getTorusDistance(curPos, e.pos).manhattan;
      if (d !== 1) return false;
      const threat = ThreatEvaluator.evaluateThreat(player, e);
      const rawDmg = Math.max(0, e.atk - player.experience);
      return threat === 'LETHAL' || rawDmg >= player.hp;
    });

    if (adjacentLethal) {
      if (player.magic > 0 && !player.hasDeath) {
        if (MagicSystem.canCast(player, 'FREEZE').allowed) {
          return { type: 'MAGIC', magic: 'FREEZE' };
        }
        if (MagicSystem.canCast(player, 'FLASH').allowed) {
          return { type: 'MAGIC', magic: 'FLASH' };
        }
      }
      const evadeDir = this.botNav.findEvadeDirection(curPos, map, enemies, player, dragon);
      if (evadeDir) return { type: 'MOVE', dir: evadeDir };
    }

    // 3-C. MP不足時（magic < 2）の近傍 POTION 回収（王冠往路での魔力補給・安全確保）
    if (player.magic < 2) {
      const potionPos = this.botNav.findNearestItem(curPos, 'POTION', map, enemies, player);
      if (potionPos) {
        const pDist = map.getTorusDistance(curPos, potionPos).manhattan;
        const maxDist = player.magic === 0 ? 25 : 12;
        if (pDist <= maxDist) {
          const dirToPotion = this.botNav.findPath(curPos, potionPos, map, player, enemies, player.canDiagonal, dragon, undefined, 'CROWN_ESCAPE', _ghosts);
          if (dirToPotion) return this.handleMoveOrBreak(dirToPotion, player, map);
        }
      }
    }

    // 3-D. 床の王冠を最優先で回収に向かう！（最優先目標！！）
    const crownPos = this.botNav.findNearestItem(curPos, 'CROWN', map, enemies, player);
    if (crownPos) {
      const dirToCrown = this.botNav.findPath(curPos, crownPos, map, player, enemies, player.canDiagonal, dragon, undefined, 'CROWN_ESCAPE', _ghosts);
      if (dirToCrown) {
        return this.handleMoveOrBreak(dirToCrown, player, map);
      }
    }

    // 3-E. 王冠への進路上または退避先を塞いでいる直角隣接の ONE_SHOT 敵のみ排除
    const adjacentTargets = this.botNav.getAdjacentEnemies(curPos, enemies, map);
    for (const { enemy, dir } of adjacentTargets) {
      if (dragon && dragon.getPartAt(enemy.pos)) continue; // ドラゴンの部位に重なっている敵は攻撃不可
      if (ThreatEvaluator.evaluateThreat(player, enemy) === 'ONE_SHOT') {
        const rawDmg = Math.max(0, enemy.atk - player.experience);
        if (rawDmg === 0) {
          return { type: 'MOVE', dir };
        }
      }
    }

    // 3-F. 床に王冠がまだない場合（ゴーストが運搬中等）
    // MPが尽きていれば近傍の POTION を回収
    const potionPos = this.botNav.findNearestItem(curPos, 'POTION', map, enemies, player);
    if (potionPos) {
      const pDist = map.getTorusDistance(curPos, potionPos).manhattan;
      if (pDist <= 20) {
        const dirToPotion = this.botNav.findPath(curPos, potionPos, map, player, enemies, player.canDiagonal, dragon, undefined, 'CROWN_ESCAPE', _ghosts);
        if (dirToPotion) return this.handleMoveOrBreak(dirToPotion, player, map);
      }
    }

    // 周囲に近接する未凍結の強敵がいれば FREEZE で永久凍結（前線基地周辺の露払い）
    if (player.magic > 0 && !player.hasDeath) {
      const nearbyEnemies = enemies.filter(
        e => e.isAlive && !e.isPermanentlyFrozen && map.getTorusDistance(curPos, e.pos).chebyshev <= 2
      );
      if (nearbyEnemies.length > 0 && MagicSystem.canCast(player, 'FREEZE').allowed) {
        return { type: 'MAGIC', magic: 'FREEZE' };
      }
    }

    // 前線基地（我が家）へ移動して待機
    const dirToHome = this.botNav.findPath(curPos, map.realHomePos, map, player, enemies, player.canDiagonal, dragon, undefined, 'CROWN_ESCAPE', _ghosts);
    if (dirToHome) return this.handleMoveOrBreak(dirToHome, player, map);

    return this.botNav.wanderSafe(player, map, enemies, dragon, this.turnsInPhase);
  }

  // ==========================================================================
  // 後方互換委譲メソッド群
  // ==========================================================================

  public isTargetUnreachable(pos: Position): boolean {
    return this.botNav.isTargetUnreachable(pos);
  }
  public markTargetUnreachable(pos: Position, turns?: number): void {
    this.botNav.markTargetUnreachable(pos, turns);
  }
  public clearUnreachableTargets(): void {
    this.botNav.clearUnreachableTargets();
  }
  public updateUnreachableTargets(): void {
    this.botNav.updateUnreachableTargets();
  }

  public isDragonFireLine(pos: Position, dragon: Dragon, map: WorldMap): boolean {
    return this.botNav.isDragonFireLine(pos, dragon, map);
  }

  public getAdjacentDirection(from: Position, to: Position, map: WorldMap): Direction | null {
    return this.botNav.getAdjacentDirection(from, to, map);
  }

  public getAdjacentSafeFloors(pos: Position, map: WorldMap, enemies: EnemyInstance[], dragon?: Dragon): Position[] {
    return this.botNav.getAdjacentSafeFloors(pos, map, enemies, dragon);
  }

  public findHomeRelocateAnchor(map: WorldMap, dragon: Dragon, enemies: EnemyInstance[], player: Player): Position | null {
    return this.homeRelocationTactics.findHomeRelocateAnchor(map, dragon, enemies, player, this.tuning);
  }

  public hasAvailableSealTools(map: WorldMap, player: Player, enemies: EnemyInstance[], dragon?: Dragon): boolean {
    return this.graveSealTactics.hasAvailableSealTools(map, player, enemies, dragon, {
      tuning: this.tuning,
      mapAssessment: this.mapAssessment,
    });
  }

  public findNearbyChestForEightStepCycle(
    curPos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    player: Player
  ) {
    return this.eightStepController.findNearbyChestForEightStepCycle(curPos, map, enemies, dragon, player);
  }

  public findDiagonalChestForEightStepCycle(
    curPos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    player: Player
  ) {
    return this.eightStepController.findDiagonalChestForEightStepCycle(curPos, map, enemies, dragon, player);
  }

  public findNearestChestCandidates(from: Position, map: WorldMap, enemies?: EnemyInstance[], player?: Player, limit: number = 5): Position[] {
    return this.botNav.findNearestChestCandidates(from, map, enemies, player, limit, {
      lockedChestPos: this.lockedChestPos,
      hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
    });
  }

  public findNearestChest(from: Position, map: WorldMap, enemies?: EnemyInstance[], player?: Player): Position | null {
    return this.botNav.findNearestChest(from, map, enemies, player, {
      lockedChestPos: this.lockedChestPos,
      hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
    });
  }

  public findNearestItemCandidates(from: Position, itemType: TileType, map: WorldMap, enemies?: EnemyInstance[], player?: Player, limit: number = 5): Position[] {
    return this.botNav.findNearestItemCandidates(from, itemType, map, enemies, player, limit, {
      lockedItemPos: this.lockedItemPos,
      lockedItemType: this.lockedItemType,
      hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
    });
  }

  public findNearestItem(from: Position, itemType: TileType, map: WorldMap, enemies?: EnemyInstance[], player?: Player): Position | null {
    return this.botNav.findNearestItem(from, itemType, map, enemies, player, {
      lockedItemPos: this.lockedItemPos,
      lockedItemType: this.lockedItemType,
      hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
    });
  }

  public findAnyItemOnMap(itemType: TileType, map: WorldMap): Position | null {
    return this.botNav.findAnyItemOnMap(itemType, map);
  }

  public isCrossSealingAnyGrave(pos: Position, map: WorldMap): boolean {
    return this.graveSealTactics.isCrossSealingAnyGrave(pos, map);
  }

  public findNearestAnyCross(from: Position, map: WorldMap): Position | null {
    return this.graveSealTactics.findNearestAnyCross(from, map);
  }

  public findNearestUnusedCross(from: Position, map: WorldMap, enemies?: EnemyInstance[], player?: Player): Position | null {
    return this.graveSealTactics.findNearestUnusedCross(from, map, enemies, player);
  }

  public isTileSealingGrave(pos: Position, map: WorldMap, enemies: EnemyInstance[]): boolean {
    return this.graveSealTactics.isTileSealingGrave(pos, map, enemies);
  }

  public getOpenGraveSpots(grave: Position, map: WorldMap, enemies: EnemyInstance[]): Position[] {
    return this.graveSealTactics.getOpenGraveSpots(grave, map, enemies);
  }

  public getAllOpenGraves(map: WorldMap, enemies: EnemyInstance[]): { grave: Position; openSpots: Position[] }[] {
    return this.graveSealTactics.getAllOpenGraves(map, enemies);
  }

  public getTargetOpenGraves(map: WorldMap, enemies: EnemyInstance[], policy?: GraveSealPolicy): { grave: Position; openSpots: Position[] }[] {
    return this.graveSealTactics.getTargetOpenGraves(map, enemies, policy, this.tuning, this.mapAssessment);
  }

  public getTutorialMessage(): string {
    switch (this.currentPhase) {
      case 'BOOTSTRAP':
        return '【序盤】まずはダンジョン内の剣（SWORD）や鍵（KEY）を拾おう！ 弱いスライムを倒して経験値（EXP）稼ぎ！';
      case 'GRAVE_SEAL':
      case 'GRAVE_CONTROL':
        return '【墓封鎖】モンスター無限湧きの元凶である墓を封鎖！ 十字架（CROSS）を置くか指輪（RING）で岩を押そう！';
      case 'POWER_RUSH':
      case 'FARMING':
        return '【育成】8歩周期開錠でパワーストーン（力）と壺（POTION/魔力）を大量獲得！ STR 350,000＆EXP育成を目指そう！';
      case 'RELOCATE_HOME':
        return '【前線基地】RINGで我が家をドラゴン要塞外縁へプッシュ移転！ 決戦・王冠脱出を最短2歩で完遂できる拠点を構築！';
      case 'DRAGON_SLAY':
        return '【決戦】ドラゴン要塞へ進軍！ 安全な斜めマスから首3本を各個撃破！';
      case 'CROWN_ESCAPE':
        return '【脱出】全魔法封印下で王冠4個を要塞から前線基地へ運搬！ 危険なモンスターを迂回して完全クリア！';
      default:
        return 'Dragon Slayer Level 2.0 自動探索中...';
    }
  }
}
