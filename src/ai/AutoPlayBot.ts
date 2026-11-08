import { Direction, Position, TileType, ResolvedDungeonTuningParams } from '../models/Types.js';
import { GameEngine } from '../core/GameEngine.js';
import { Player } from '../models/Player.js';
import { WorldMap } from '../models/WorldMap.js';
import { EnemyInstance } from '../models/Enemy.js';
import { Dragon } from '../models/Dragon.js';
import { Ghost } from '../models/Ghost.js';
import { ThreatEvaluator } from '../systems/ThreatEvaluator.js';
import { MagicSystem } from '../systems/MagicSystem.js';
import { MovementSystem } from '../systems/MovementSystem.js';
import { KICK_MAX_RANGE } from '../config/Constants.js';

import {
  BotSkillProfile,
  GraveSealPolicy,
  BotStrategyTuning,
  MapAssessment,
  BotPhase,
  BotAction,
  AutoPlayBotOptions,
} from './BotTypes.js';
import { BotNavigator, NavigatorItemLockInfo } from './BotNavigator.js';
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
  public tuning: Required<BotStrategyTuning>;
  private userTuning?: Partial<BotStrategyTuning>;
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
  private justOpenedChestPos: Position | null = null;

  // 目標ロック＆ヒステリシス制御
  private lockedChestPos: Position | null = null;
  private lockedChestTurns: number = 0;

  private lockedItemPos: Position | null = null;
  private lockedItemType?: TileType;
  private lockedItemTurns: number = 0;
  // 直近でターゲット（ロック）に設定されたアイテム座標（局所ループ検知時の確実なブラックリスト化用）
  private lastTargetItemPos: Position | null = null;
  private recentTargetItemPositions: Position[] = [];

  private readonly MAX_TARGET_LOCK_TURNS: number = 20;
  private readonly TARGET_HYSTERESIS_BONUS: number = 3;

  // アイテム持ち替え経過ターンカウンタ（無限バイパス防止）
  private itemSwapTurns: number = 0;
  private readonly MAX_ITEM_SWAP_TURNS: number = 10;

  // 2マスピンポン往復・局所スタック制御
  public pingPongCount: number = 0;
  public forceWanderTurns: number = 0;
  private eightStepTurns: number = 0;
  private readonly MAX_EIGHT_STEP_TURNS: number = 16;

  // テレメトリ＆内部ステータス表示用
  public currentTargetDesc: string = '初期化中';
  public lastDecidedActionDesc: string = '待機';

  // 決戦前防御力・MP育成完了フラグ（フェーズ振動防止）
  public defenseReady: boolean = false;
  private defensePrepTurns: number = 0;

  // アクティブチューニングパラメータ（ゲームエンジンから注入）
  public activeTuning?: ResolvedDungeonTuningParams;

  constructor(opts: AutoPlayBotOptions = {}) {
    this.profile = opts.profile ?? 'STANDARD';
    this.userTuning = opts.strategyTuning;
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

  /**
   * ルールモードやドラゴンの生存首DEFに基づく動的な目標STRを算出
   */
  public getEffectiveTargetStr(dragon?: Dragon): number {
    const livingHeads = dragon ? dragon.heads.filter(h => h.isAlive) : [];
    const maxHeadDef = livingHeads.length > 0 ? Math.max(...livingHeads.map(h => h.def)) : 0;
    if (maxHeadDef > 0) {
      return maxHeadDef + 1000;
    }
    const isClassic = this.activeTuning?.progressionConfig.ruleMode === 'CLASSIC';
    return isClassic ? 11000 : 350000;
  }

  /**
   * ルールモードおよびフィールド全体の敵の攻撃力に応じた目標防御力(EXP)を算出
   */
  public getEffectiveTargetDefenseExp(enemies?: EnemyInstance[]): number {
    const isClassic = this.activeTuning?.progressionConfig.ruleMode === 'CLASSIC';
    if (this.tuning.targetDefenseExp !== undefined && this.tuning.targetDefenseExp !== 350000 && this.tuning.targetDefenseExp !== 450000) {
      return this.tuning.targetDefenseExp;
    }
    if (isClassic) {
      return 15000;
    }
    let target = this.tuning.targetDefenseExp ?? 450000;
    if (enemies && enemies.length > 0) {
      const living = enemies.filter(e => e.isAlive);
      if (living.length > 0) {
        const maxAtk = Math.max(...living.map(e => e.atk));
        if (maxAtk > target) {
          target = Math.min(655350, maxAtk);
        }
      }
    }
    return target;
  }

  /**
   * ルールモードに応じた早期墓封じ可能STRを算出
   */
  public getEffectiveGraveSealEarlyStr(): number {
    const isClassic = this.activeTuning?.progressionConfig.ruleMode === 'CLASSIC';
    if (this.tuning.graveSealEarlyStr !== undefined && this.tuning.graveSealEarlyStr !== 30000) {
      return this.tuning.graveSealEarlyStr;
    }
    if (isClassic) {
      return 2500;
    }
    return this.tuning.graveSealEarlyStr ?? 30000;
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
    this.lastTargetItemPos = { ...pos };
    if (!this.recentTargetItemPositions.some(p => p.x === pos.x && p.y === pos.y)) {
      this.recentTargetItemPositions.push({ ...pos });
      if (this.recentTargetItemPositions.length > 5) {
        this.recentTargetItemPositions.shift();
      }
    }
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

    if (this.recentTargetItemPositions.length > 0) {
      this.recentTargetItemPositions = this.recentTargetItemPositions.filter(p => map.getItem(p) !== 'NONE');
    }
  }

  private getItemDisplayLabel(type: TileType): string {
    switch (type) {
      case 'POWER_STONE': return '💎 パワーストーン';
      case 'POTION': return '🧪 ポーション';
      case 'COIN': return '🪙 コイン';
      case 'KEY': return '🗝️ 鍵';
      case 'SWORD': return '🗡️ 剣';
      case 'CROSS': return '✝️ 十字架';
      case 'RING': return '💍 指輪';
      case 'CROWN': return '👑 王冠';
      default: return type;
    }
  }

  /**
   * 極近傍（マンハッタン距離 <= 2）に現在ロック中のアイテムより優先度が高い上位アイテムが存在し、
   * 安全に回収可能か判定する（ついで回収の判定）
   */
  private hasNearbyHigherPriorityItem(
    curPos: Position,
    currentLockedType: TileType,
    map: WorldMap,
    enemies: EnemyInstance[],
    player: Player,
    targetStr: number
  ): boolean {
    const needStr = player.strength < targetStr;
    const needMagic = player.magic < this.tuning.maxTargetMagic;

    const higherTypes: TileType[] = [];
    if (currentLockedType === 'COIN' || currentLockedType === 'KEY') {
      if (needStr) higherTypes.push('POWER_STONE');
      if (needMagic) higherTypes.push('POTION');
    } else if (currentLockedType === 'POTION') {
      if (needStr) higherTypes.push('POWER_STONE');
    }

    if (higherTypes.length === 0) return false;

    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 2) continue;
        const p = map.wrapPosition({ x: curPos.x + dx, y: curPos.y + dy });
        if (this.botNav.isTargetUnreachable(p)) continue;
        const item = map.getItem(p);
        if (item !== 'NONE' && higherTypes.includes(item)) {
          const enemy = enemies.find(e => e.isAlive && e.pos.x === p.x && e.pos.y === p.y);
          if (enemy) {
            const threat = ThreatEvaluator.evaluateThreat(player, enemy);
            if (threat !== 'ONE_SHOT' && threat !== 'SAFE') continue;
          }
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 手ぶら時または鍵所持時、すでに有効にロックされているアイテムへの移動を優先継続する（スティッキーターゲット）
   */
  private tryStickyItemMove(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    targetStr: number
  ): BotAction | null {
    if (!this.lockedItemPos || !this.lockedItemType) return null;

    if (map.getItem(this.lockedItemPos) !== this.lockedItemType) {
      this.clearItemLock();
      return null;
    }

    const curPos = player.pos;

    // 足元に到達している場合
    if (curPos.x === this.lockedItemPos.x && curPos.y === this.lockedItemPos.y) {
      if (player.holdItem === 'NONE') {
        return { type: 'SPACE' };
      }
      return null;
    }

    // 極近傍（マンハッタン距離 <= 2）に上位アイテムやついで回収すべき対象がある場合はスティッキー解除して上位アイテム回収へ
    if (this.hasNearbyHigherPriorityItem(curPos, this.lockedItemType, map, enemies, player, targetStr)) {
      return null;
    }

    // 鍵所持時に近傍（距離 <= 2）に開錠すべき宝箱がある場合は宝箱を優先
    if (player.holdItem === 'KEY' && (player.strength < targetStr || this.shouldContinueChestClearing(player, map, enemies, dragon))) {
      const chestCandidates = this.botNav.findNearestChestCandidates(curPos, map, enemies, player, 1, {
        lockedChestPos: this.lockedChestPos,
        hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
        tacticalMetadata: map.tacticalMetadata,
      });
      if (chestCandidates.length > 0) {
        const cDist = map.getTorusDistance(curPos, chestCandidates[0]).manhattan;
        if (cDist <= 2) {
          return null;
        }
      }
    }

    // ロック中アイテムへの安全な移動経路を探索（距離境界によるキャンセルを防ぎ、一貫して追跡）
    const dir = this.botNav.findPath(curPos, this.lockedItemPos, map, player, enemies, player.canDiagonal, dragon);
    if (dir) {
      const dist = map.getTorusDistance(curPos, this.lockedItemPos).manhattan;
      const itemLabel = this.getItemDisplayLabel(this.lockedItemType);
      this.currentTargetDesc = `🎯 ロック継続: ${itemLabel} (${this.lockedItemPos.x}, ${this.lockedItemPos.y}) dist:${dist}`;
      return this.handleMoveOrBreak(dir, player, map);
    }

    // 到達経路がない場合はロックを解除して通常探索へ
    this.clearItemLock();
    return null;
  }

  /**
   * 魔力セーフティリザーブ判定
   * player.magic === 1 かつ BREAK 習得済み (EXP >= 4000) の場合、
   * コスト0の BREAK / KICK (非命中時) を永続維持するために、FREEZE / FLASH / RETURN の消費を温存する。
   * ただし以下の緊急例外時は消費を許可する:
   * 1. 隣接または直撃圏内に即死級 (LETHAL または 被ダメ >= 現HP) の敵がいて、安全な逃げ場がなく絶体絶命の場合
   * 2. パワーストーン所持中の帰還、または王冠脱出フェーズ (CROWN_ESCAPE)
   */
  public canSpendMagicReserve(
    player: Player,
    _enemies: EnemyInstance[],
    _map: WorldMap,
    options?: { isLethalEmergency?: boolean; hasEvadeRoute?: boolean }
  ): boolean {
    if (player.magic > 1) return true;
    if (player.magic <= 0) return false;

    // player.magic === 1 の場合
    // BREAK未習得 (EXP < 4000) であればリザーブする BREAK がないので使用可
    if (player.experience < 4000) return true;

    // 王冠脱出フェーズなら許可
    if (this.currentPhase === 'CROWN_ESCAPE') return true;

    // 即死級の緊急事態かつ逃げ場がない場合のみ許可
    if (options?.isLethalEmergency && !options?.hasEvadeRoute) {
      return true;
    }

    return false;
  }

  /**
   * KICKスナイプ判定
   * 目の前（4方向隣接マス）に岩(BLOCK)があり、その直線方向（最大15マス）に
   * 障害物なく敵が存在する場合、KICKで長距離狙撃即死させる
   */
  public tryKickSnipe(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon?: Dragon,
    targetGoal?: Position | null
  ): BotAction | null {
    if (!MagicSystem.canCast(player, 'KICK').allowed) return null;

    const dirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const maxSteps = KICK_MAX_RANGE;

    for (const dir of dirs) {
      const rockPos = map.wrapPosition(MovementSystem.getNextPosition(player.pos, dir));
      if (map.getObject(rockPos) !== 'BLOCK') continue;

      let currPos = rockPos;
      for (let step = 1; step <= maxSteps; step++) {
        const nextPos = map.wrapPosition(MovementSystem.getNextPosition(currPos, dir));

        // A. 生存している敵に衝突
        const hitEnemy = enemies.find(e => e.isAlive && e.pos.x === nextPos.x && e.pos.y === nextPos.y);
        if (hitEnemy) {
          const threat = ThreatEvaluator.evaluateThreat(player, hitEnemy);
          // MP=1 の場合はリザーブ保護（自爆転落防止）のため、
          // 足元または極近傍（マンハッタン距離<=3以内）にすぐに拾える安全な POTION があるか、
          // あるいは逃げ場のない LETHAL 敵への緊急自衛時以外は対敵スナイプを控える
          if (player.magic === 1 && player.experience >= 4000) {
            const hasNearbyPotion = map.getItem(player.pos) === 'POTION' ||
              this.botNav.findNearestItemCandidates(player.pos, 'POTION', map, enemies, player, 1).some(
                p => map.getTorusDistance(player.pos, p).manhattan <= 3
              );
            const isLethalEmergency = threat === 'LETHAL' && !this.botNav.findAdjacentSafeEmptyFloor(player.pos, map, enemies, dragon, player);
            if (!hasNearbyPotion && !isLethalEmergency) {
              break; // MP=0 転落防止のためスナイプ見送り
            }
          }

          player.dir = dir;
          this.currentTargetDesc = `🎯 KICKスナイプ狙撃 [${hitEnemy.name} (dist:${step + 1}, ${threat})]`;
          return { type: 'MAGIC', magic: 'KICK' };
        }

        // B. 障害物に衝突（プレイヤー自身、ドラゴン部位、または移動不可マス）
        const isPlayerAtNext = nextPos.x === player.pos.x && nextPos.y === player.pos.y;
        const dragonPart = dragon ? dragon.getPartAt(nextPos) : null;
        const isBlocked = isPlayerAtNext || dragonPart !== null || !map.isPushDestinationValid(nextPos, enemies);
        if (isBlocked) {
          break; // 岩が止まるか砕けるため射線終了
        }

        currPos = nextPos;
      }
    }

    return null;
  }

  /**
   * 能動的KICKスナイプのポジショニング判定
   * MPに余裕がある時（player.magic >= 2）、近傍の強敵の射線上に岩(BLOCK)があり、
   * その岩を蹴る立ち位置(standPos)へ2〜3歩以内で安全に移動できるなら移動する。
   */
  public tryKickSnipePositioning(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon?: Dragon
  ): BotAction | null {
    if (!MagicSystem.canCast(player, 'KICK').allowed || player.magic < 2) return null;

    // 近傍（距離10以内）の生存敵で、DANGERまたはLETHAL、あるいは狩り対象の敵をリストアップ
    const dangerousEnemies = enemies.filter(e => {
      if (!e.isAlive || e.isPermanentlyFrozen) return false;
      const d = map.getTorusDistance(player.pos, e.pos).manhattan;
      if (d > 10) return false;
      const threat = ThreatEvaluator.evaluateThreat(player, e);
      return threat === 'DANGER' || threat === 'LETHAL' || threat === 'ONE_SHOT';
    });

    if (dangerousEnemies.length === 0) return null;

    const dirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const oppDirs: Record<string, Direction> = {
      UP: 'DOWN',
      DOWN: 'UP',
      LEFT: 'RIGHT',
      RIGHT: 'LEFT',
    };

    // プレイヤーの周囲（マンハッタン距離1〜3）にある BLOCK を探索
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const manhattan = Math.abs(dx) + Math.abs(dy);
        if (manhattan < 1 || manhattan > 3) continue;
        const rockPos = map.wrapPosition({ x: player.pos.x + dx, y: player.pos.y + dy });
        if (map.getObject(rockPos) !== 'BLOCK') continue;

        // この岩から4直角方向に敵がいるか射線チェック
        for (const dir of dirs) {
          let currPos = rockPos;
          let hitEnemy: EnemyInstance | null = null;
          for (let step = 1; step <= KICK_MAX_RANGE; step++) {
            const nextPos = map.wrapPosition(MovementSystem.getNextPosition(currPos, dir));
            const enemy = dangerousEnemies.find(e => e.pos.x === nextPos.x && e.pos.y === nextPos.y);
            if (enemy) {
              hitEnemy = enemy;
              break;
            }
            const isBlocked = !map.isPushDestinationValid(nextPos, enemies) || (dragon && dragon.getPartAt(nextPos) !== null);
            if (isBlocked) break;
            currPos = nextPos;
          }

          if (hitEnemy) {
            // 岩をこの方向へ蹴るための立ち位置（岩の反対隣接）
            const kickDirOpp = oppDirs[dir];
            const standPos = map.wrapPosition(MovementSystem.getNextPosition(rockPos, kickDirOpp));

            // standPos が現在のプレイヤー位置なら既に tryKickSnipe が処理しているはず
            if (standPos.x === player.pos.x && standPos.y === player.pos.y) continue;

            // standPos が安全に侵入可能か確認
            if (map.getBaseTile(standPos) === 'WALL_STATIC' || map.getObject(standPos) !== 'NONE') continue;
            if (enemies.some(e => e.isAlive && e.pos.x === standPos.x && e.pos.y === standPos.y)) continue;

            // プレイヤーから standPos への安全な移動経路
            const dirToStand = this.botNav.findPath(player.pos, standPos, map, player, enemies, false, dragon);
            if (dirToStand) {
              this.currentTargetDesc = `🎯 KICK狙撃ポジショニング [${hitEnemy.name}狙い -> (${standPos.x}, ${standPos.y})]`;
              return this.handleMoveOrBreak(dirToStand, player, map);
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * 最終局面前の積極的宝箱開錠・事前POTION備蓄の継続判定
   * 目標STRに達していても、MPが目標最大値未満であるか、
   * または近傍に安全に到達可能な未開封宝箱が存在する場合は
   * 鍵を手放さずに宝箱を開錠してリソースを床に解放する。
   */
  public shouldContinueChestClearing(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    _dragon?: Dragon,
    targetDefenseExp?: number
  ): boolean {
    const nearbyChests = this.botNav.findNearestChestCandidates(player.pos, map, enemies, player, 5, {
      tacticalMetadata: map.tacticalMetadata,
    });
    if (nearbyChests.length === 0) return false;

    // A. 自身のMPが目標最大値未満の場合、未開封宝箱があれば開錠継続してMP補充・POTION排出を狙う
    if (player.magic < this.tuning.maxTargetMagic) {
      return true;
    }

    // B. MPは目標値に達しているが、防御EXPが未達（決戦準備中）の場合、
    // 周辺（マンハッタン距離20マス以内）の宝箱を開けて床にPOTION備蓄を作っておく
    const targetDefense = targetDefenseExp ?? this.getEffectiveTargetDefenseExp(enemies);
    const needDefense = player.experience < targetDefense;
    const maxChestDist = needDefense ? 20 : 5; // 防御完了後は直近（5マス以内）のみ開けて即決戦へ

    for (const chestPos of nearbyChests) {
      const dist = map.getTorusDistance(player.pos, chestPos).manhattan;
      if (dist <= maxChestDist) {
        return true;
      }
    }

    return false;
  }

  public assessMap(map: WorldMap, _player?: Player): MapAssessment {
    if (this.mapAssessment && this.lastAssessedMapRef === map) {
      return this.mapAssessment;
    }

    // tacticalMetadata による戦術チューニングの適用
    if (map.tacticalMetadata) {
      if (this.userTuning?.enableHomeRelocation === undefined && map.tacticalMetadata.dragonLairStyle === 'MAZE_LAIR') {
        this.tuning.enableHomeRelocation = false;
      }
      if (map.tacticalMetadata.recommendedBotTuning) {
        for (const [key, value] of Object.entries(map.tacticalMetadata.recommendedBotTuning)) {
          if (this.userTuning?.[key as keyof BotStrategyTuning] === undefined && value !== undefined) {
            (this.tuning as any)[key] = value;
          }
        }
      }
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
    if (typeof engine.getActiveTuningParams === 'function') {
      this.activeTuning = engine.getActiveTuningParams();
    }
    const player = engine.getPlayer();
    const map = engine.getMap ? engine.getMap() : (engine as any).getWorldMap();
    const enemies = engine.getEnemies().filter(e => e.isAlive);
    const dragon = engine.getDragon();
    const ghosts = engine.getGhosts ? engine.getGhosts() : [];

    MagicSystem.updatePassiveSkills(player);

    this.botNav.updateWarpTaboos();
    this.botNav.updateUnreachableTargets();
    this.updateTargetLock(map, player);

    // 0. 強制安全離脱（ピンポン回避やスタック救出による複数ターンの安全徘徊）
    if (this.botNav.forceWanderNextTurn || this.forceWanderTurns > 0) {
      this.botNav.forceWanderNextTurn = false;
      if (this.forceWanderTurns > 0) {
        this.forceWanderTurns--;
      }
      this.itemToPickupPos = null;
      this.tempDroppedKeyPos = null;
      this.eightStepController.clearEightStepState();
      this.clearTargetLock();
      this.currentTargetDesc = `安全離脱・徘徊中 [残り ${this.forceWanderTurns}T]`;
      return this.handleWanderSafe(player, map, enemies, dragon);
    }

    // 1. フェーズ自動遷移の判定
    this.updatePhase(player, dragon, map, enemies);

    // 2. 緊急行動（HPピンチ、死神憑依、パワーストーン帰還）
    const emergencyAction = this.checkEmergency(player, map, enemies, dragon);
    if (emergencyAction) return emergencyAction;

    // 3. 8歩周期およびアイテム持ち替えの停滞監視
    if (this.eightStepController.eightStepTargetChestPos !== null) {
      this.eightStepTurns++;
      if (this.eightStepTurns >= this.MAX_EIGHT_STEP_TURNS) {
        this.eightStepController.clearEightStepState();
        this.eightStepTurns = 0;
      }
    } else {
      this.eightStepTurns = 0;
    }

    if (this.itemToPickupPos !== null || this.tempDroppedKeyPos !== null) {
      this.itemSwapTurns++;
      if (this.itemSwapTurns >= this.MAX_ITEM_SWAP_TURNS) {
        this.itemToPickupPos = null;
        this.tempDroppedKeyPos = null;
        this.itemSwapTurns = 0;
        this.clearTargetLock();
        this.forceWanderTurns = 3;
        this.currentTargetDesc = '持ち替えタイムアウト脱出';
        return this.handleWanderSafe(player, map, enemies, dragon);
      }
    } else {
      this.itemSwapTurns = 0;
    }

    // 4. 2マス往復（ピンポン挙動）および周回ループの厳格検知
    // ※アイテム持ち替えや8歩周期は意図的な短距離往復のため、誤検知を防止する
    const isHandlingItemSwap = this.itemToPickupPos !== null || this.tempDroppedKeyPos !== null;
    const isHandlingEightStep = this.eightStepController.eightStepTargetChestPos !== null;
    const rLen = this.botNav.recentPositions.length;

    let isPingPong = false;
    let isStuckOrLooping = false;
    let prev1: Position | null = null;

    if (!isHandlingItemSwap && !isHandlingEightStep) {
      // step() 経由の場合、現在地 player.pos は既に recordPosition() されて末尾に入っている
      const lastRecorded = rLen > 0 ? this.botNav.recentPositions[rLen - 1] : null;
      const offset = (lastRecorded && lastRecorded.x === player.pos.x && lastRecorded.y === player.pos.y) ? 1 : 0;

      prev1 = rLen >= (1 + offset) ? this.botNav.recentPositions[rLen - 1 - offset] : null;
      const prev2 = rLen >= (2 + offset) ? this.botNav.recentPositions[rLen - 2 - offset] : null;

      // 直近2マスでの反復: 現在地が2手前(prev2)と同一で、かつ1手前(prev1)と異なる (A -> B -> A)
      if (prev1 && prev2 && player.pos.x === prev2.x && player.pos.y === prev2.y && (player.pos.x !== prev1.x || player.pos.y !== prev1.y)) {
        isPingPong = true;
      }

      // 狭小周回ループ検知: 直近3〜4歩の短いサイクルでの完全同一巡回のみを検知（十字路の自然な交差は誤検知しない）
      isStuckOrLooping = isPingPong;
      if (!isStuckOrLooping && rLen >= (4 + offset)) {
        const prev3 = rLen >= (3 + offset) ? this.botNav.recentPositions[rLen - 3 - offset] : null;
        const prev4 = rLen >= (4 + offset) ? this.botNav.recentPositions[rLen - 4 - offset] : null;
        if (prev3 && player.pos.x === prev3.x && player.pos.y === prev3.y) {
          isStuckOrLooping = true;
        } else if (prev4 && player.pos.x === prev4.x && player.pos.y === prev4.y) {
          isStuckOrLooping = true;
        }
      }

      if (isStuckOrLooping) {
        this.botNav.oscillationCount++;
        if (isPingPong) {
          this.pingPongCount++;
        }
      } else {
        this.botNav.oscillationCount = Math.max(0, this.botNav.oscillationCount - 1);
        this.pingPongCount = Math.max(0, this.pingPongCount - 1);
      }
    }

    // 5. ピンポン往復・局所ループ検出時の多層エスケープ
    if (this.pingPongCount >= 2 || this.botNav.oscillationCount >= 3) {
      // (a) 現在ロックしていたターゲットを短時間ブラックリスト（12ターン除外）
      if (this.lockedChestPos) {
        this.botNav.markTargetUnreachable(this.lockedChestPos, 12);
      }
      if (this.lockedItemPos) {
        this.botNav.markTargetUnreachable(this.lockedItemPos, 12);
      }
      if (this.lastTargetItemPos) {
        this.botNav.markTargetUnreachable(this.lastTargetItemPos, 12);
      }
      for (const p of this.recentTargetItemPositions) {
        this.botNav.markTargetUnreachable(p, 12);
      }
      this.recentTargetItemPositions = [];
      this.lastTargetItemPos = null;
      this.clearTargetLock();
      this.itemToPickupPos = null;
      this.eightStepController.clearEightStepState();

      // (b) 直前にいたマス（1手前）を引き返し抑止タイルに指定
      if (prev1) {
        this.botNav.recentEvadedTile = { ...prev1 };
        this.botNav.recentEvadedTurns = 4;
      }

      // (c) 3ターンの安全徘徊へ移行
      this.forceWanderTurns = 3;
      this.botNav.oscillationCount = 0;
      this.pingPongCount = 0;

      // (d) 隣接に敵がいる場合、FREEZE または FLASH で無力化
      // 要件②: 魔力セーフティリザーブ保護（MP=1時はピンポン脱出で安易に魔法を消費しない）
      const adjacentEnemies = this.botNav.getAdjacentEnemies(player.pos, enemies, map);
      if (adjacentEnemies.length > 0 && player.magic > 0 && !player.hasDeath && this.canSpendMagicReserve(player, enemies, map)) {
        if (MagicSystem.canCast(player, 'FREEZE').allowed) {
          const adjTarget = adjacentEnemies.find(({ enemy }) => !enemy.isPermanentlyFrozen);
          if (adjTarget) {
            this.currentTargetDesc = `ピンポン脱出: FREEZE敵足止め (${adjTarget.enemy.name})`;
            return { type: 'MAGIC', magic: 'FREEZE' };
          }
        }
        if (MagicSystem.canCast(player, 'FLASH').allowed) {
          this.currentTargetDesc = 'ピンポン脱出: FLASH全敵足止め';
          return { type: 'MAGIC', magic: 'FLASH' };
        }
      }

      this.currentTargetDesc = '⚠️ ピンポン往復検知: 安全離脱徘徊';
      return this.handleWanderSafe(player, map, enemies, dragon);
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
    this.lastDecidedActionDesc = this.formatActionDesc(action);

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
    this.forceWanderTurns = 4;
    this.itemToPickupPos = null;
    this.tempDroppedKeyPos = null;
    this.eightStepController.clearEightStepState();
    if (this.lockedChestPos) {
      this.botNav.markTargetUnreachable(this.lockedChestPos, 40);
    }
    if (this.lockedItemPos) {
      this.botNav.markTargetUnreachable(this.lockedItemPos, 40);
    }
    this.clearTargetLock();
    this.botNav.clearPositionHistory();
    this.currentTargetDesc = '⚠️ スタック救出: 連続安全徘徊';
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
    // 剣所持 ＋ STR >= targetStr ＋ (EXP >= 12,000 または斜め移動解禁) ＋ 最低MP備蓄 ＋ フィールド脅威度評価
    const livingHeads = dragon ? dragon.heads.filter(h => h.isAlive) : [];
    const targetStr = this.getEffectiveTargetStr(dragon);
    const canDamageDragon = player.hasSword && player.strength >= targetStr;
    const hasDiagonal = player.experience >= 12000 || player.canDiagonal;
    const targetDefense = this.getEffectiveTargetDefenseExp(enemies);
    const minDragonMagic = Math.min(3, this.tuning.maxTargetMagic);

    if (canDamageDragon && (hasDiagonal || this.profile === 'NOVICE')) {
      if (this.currentPhase === 'POWER_RUSH') {
        this.defensePrepTurns++;
      }
      const livingEnemies = enemies ? enemies.filter(e => e.isAlive) : [];
      const hasLethalEnemy = livingEnemies.some(
        e => ThreatEvaluator.evaluateThreat(player, e) === 'LETHAL'
      );
      const hasNearbyHuntableEnemy = enemies && enemies.some(
        e => e.isAlive && !e.isPermanentlyFrozen &&
             ThreatEvaluator.evaluateThreat(player, e) === 'ONE_SHOT' &&
             map.getTorusDistance(player.pos, e.pos).manhattan <= 35
      );
      // 防御力・MP・HPの十分性を総合評価: 首討伐後の激化と王冠脱出（魔法封印）に耐えうる備蓄
      const hasEnoughMagic = player.magic >= minDragonMagic ||
        (player.magic >= 2 && player.experience >= targetDefense) ||
        (this.defensePrepTurns > 60 && player.magic >= 1) ||
        (this.defensePrepTurns > 100);

      const hasEnoughHp = player.hp >= player.maxHp * 0.7 || player.hp >= 50000;
      const hasMinDefense = (player.experience >= targetDefense && !hasLethalEnemy) ||
        (!hasNearbyHuntableEnemy && !hasLethalEnemy && player.experience >= 50000) ||
        (this.defensePrepTurns > 150 && !hasLethalEnemy && player.experience >= 100000);

      if ((hasMinDefense && hasEnoughMagic && hasEnoughHp) || this.currentPhase === 'RELOCATE_HOME' || this.currentPhase === 'DRAGON_SLAY') {
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

      // 要件①: 目標STR・EXP到達時でも、MPが最低決戦ライン未満（minDragonMagic未満）の場合は、
      // 決戦・移転へ突撃せず、POWER_RUSH を継続してMPを整えてから遷移する
      if (player.magic < minDragonMagic) {
        this.setPhase('POWER_RUSH');
        return;
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
    const earlyGraveStr = this.getEffectiveGraveSealEarlyStr();
    const canDoEarlyGraveSeal =
      effectivePolicy !== 'NONE' &&
      this.tuning.graveSealTiming === 'EARLY' &&
      !this.graveSealTactics.graveSealAborted &&
      this.graveSealTactics.totalGraveSealTurns < 60 &&
      player.hasSword &&
      player.strength >= earlyGraveStr &&
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
      if (this.botNav.oscillationCount >= 2 && !player.hasDeath && !hasPowerStone && this.canSpendMagicReserve(player, enemies, map)) {
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
      if ((!isEscapePhase || hasPowerStone || (player.holdItem === 'NONE' && isPinch && player.magic >= 2)) && this.canSpendMagicReserve(player, enemies, map)) {
        if (MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying) {
          this.currentTargetDesc = '🚨 緊急退避: RETURN魔法帰還';
          return { type: 'MAGIC', magic: 'RETURN' };
        }
      }

      if (hasLethalAdjacent && !player.hasDeath) {
        // A. 目の前に岩があれば KICK スナイプで反撃即死撃破を試みる
        const emergencyKick = this.tryKickSnipe(player, map, enemies, dragon);
        if (emergencyKick) {
          return emergencyKick;
        }

        // B. 安全な退避先（逃げ道）の有無を確認
        const evadeDir = this.botNav.findEvadeDirection(player.pos, map, enemies, player, dragon);
        const canCastEmergency = this.canSpendMagicReserve(player, enemies, map, {
          isLethalEmergency: true,
          hasEvadeRoute: evadeDir !== null,
        });

        if (canCastEmergency) {
          if (MagicSystem.canCast(player, 'FREEZE').allowed) {
            const adjLethal = adjacentEnemies.find(
              ({ enemy }) => ThreatEvaluator.evaluateThreat(player, enemy) === 'LETHAL' && !enemy.isPermanentlyFrozen
            );
            if (adjLethal) {
              this.currentTargetDesc = `🚨 緊急回避: FREEZE詠唱 (${adjLethal.enemy.name})`;
              return { type: 'MAGIC', magic: 'FREEZE' };
            }
          }
          if (MagicSystem.canCast(player, 'FLASH').allowed) {
            this.currentTargetDesc = '🚨 緊急回避: FLASH詠唱';
            return { type: 'MAGIC', magic: 'FLASH' };
          }
        } else if (evadeDir) {
          // MP=1 温存のため、安全な逃げ場があれば移動で回避
          this.currentTargetDesc = '🚨 緊急退避: MPリザーブ温存のため安全マスへ回避移動';
          return this.handleMoveOrBreak(evadeDir, player, map);
        }
      }

      if (player.hasDeath && nearestCross && crossDist <= 5) {
        this.currentTargetDesc = '✝️ 十字架で死神浄化へ移動';
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
            this.currentTargetDesc = '💍 我が家近傍でRING手放し';
            return { type: 'SPACE' };
          }
          const safeDir = this.botNav.findAdjacentSafeEmptyFloor(player.pos, map, enemies, dragon, player);
          if (safeDir) {
            this.currentTargetDesc = '💍 RING手放し空床へ移動';
            return { type: 'MOVE', dir: safeDir };
          }
        }
      }

      const dirToHome = this.botNav.findPath(player.pos, homePos, map, player, enemies, player.canDiagonal, dragon);
      if (dirToHome) {
        this.currentTargetDesc = '🚨 緊急退避: 我が家全回復帰還へ移動';
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
      if (MagicSystem.canCast(player, 'KICK').allowed) {
        player.dir = dir;
        this.botNav.clearUnreachableTargets();
        return { type: 'MAGIC', magic: 'KICK' };
      }
    }
    return { type: 'MOVE', dir };
  }

  public handleWanderSafe(player: Player, map: WorldMap, enemies: EnemyInstance[], dragon?: Dragon): BotAction {
    const act = this.botNav.wanderSafe(player, map, enemies, dragon, this.turnsInPhase);
    if (act.type === 'MOVE') {
      return this.handleMoveOrBreak(act.dir, player, map);
    }
    return act;
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
      this.currentTargetDesc = '🗡️ 剣（SWORD）回収へ移動';
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
    }

    if (player.hasSword && player.holdItem === 'NONE') {
      // 0. スティッキーターゲットの確認（ロック中のアイテムへ優先移動）
      const stickyAction = this.tryStickyItemMove(player, map, enemies, dragon, 0);
      if (stickyAction) return stickyAction;

      // 1. 最優先: POTION回収 (MP備蓄)
      if (player.magic < this.tuning.maxTargetMagic) {
        const potionCandidates = this.botNav.findNearestItemCandidates(player.pos, 'POTION', map, enemies, player, 5, {
          lockedItemPos: this.lockedItemPos,
          lockedItemType: this.lockedItemType,
          hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
        });
        const maxPotionDist = player.magic <= 1 ? 25 : 15;
        for (const potionPos of potionCandidates) {
          const pDist = map.getTorusDistance(player.pos, potionPos).manhattan;
          if (pDist <= maxPotionDist) {
            this.currentTargetDesc = `🧪 ポーション回収 (${potionPos.x}, ${potionPos.y})`;
            const dir = this.botNav.findPath(player.pos, potionPos, map, player, enemies, false, dragon);
            if (dir) {
              this.setLockedItem(potionPos, 'POTION');
              return this.handleMoveOrBreak(dir, player, map);
            }
          }
        }
      }

      // 2. 近傍のコイン回収 (非戦闘EXP獲得による早期魔法解禁: EXPONENTIAL限定、MP備蓄優先)
      const isClassic = this.activeTuning?.progressionConfig.ruleMode === 'CLASSIC';
      const isSafeFromEnemies = !enemies.some(
        e => e.isAlive && !e.isPermanentlyFrozen && map.getTorusDistance(player.pos, e.pos).chebyshev <= 3
      );
      if (!isClassic && player.experience < 12000 && isSafeFromEnemies && (player.magic >= 1 || player.experience < 2000)) {
        const coinCandidates = this.botNav.findNearestItemCandidates(player.pos, 'COIN', map, enemies, player, 5, {
          lockedItemPos: this.lockedItemPos,
          lockedItemType: this.lockedItemType,
          hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
        });
        for (const coinPos of coinCandidates) {
          const cDist = map.getTorusDistance(player.pos, coinPos).manhattan;
          if (cDist <= 10) {
            this.currentTargetDesc = `🪙 コイン回収 (${coinPos.x}, ${coinPos.y})`;
            const dir = this.botNav.findPath(player.pos, coinPos, map, player, enemies, false, dragon);
            if (dir) {
              this.setLockedItem(coinPos, 'COIN');
              return this.handleMoveOrBreak(dir, player, map);
            }
          }
        }
      }

      const keyCandidates = this.botNav.findNearestItemCandidates(player.pos, 'KEY', map, enemies, player, 5, {
        lockedItemPos: this.lockedItemPos,
        lockedItemType: this.lockedItemType,
        hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
      });
      for (const keyPos of keyCandidates) {
        this.currentTargetDesc = `🗝️ 鍵（KEY）回収へ移動 (${keyPos.x}, ${keyPos.y})`;
        const dir = this.botNav.findPath(player.pos, keyPos, map, player, enemies, false, dragon);
        if (dir) {
          this.setLockedItem(keyPos, 'KEY');
          return this.handleMoveOrBreak(dir, player, map);
        }
      }
      this.clearItemLock();
    }

    return this.handleWanderSafe(player, map, enemies, dragon);
  }

  private actGraveSeal(player: Player, map: WorldMap, enemies: EnemyInstance[], dragon: Dragon): BotAction {
    this.currentTargetDesc = '🪦 墓封鎖戦術実行中';
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

    const isClassic = this.activeTuning?.progressionConfig.ruleMode === 'CLASSIC';
    const targetStr = this.getEffectiveTargetStr(dragon);
    const targetDefense = this.getEffectiveTargetDefenseExp();

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
      // ※注意: tempDroppedKeyPos はここでは消去しない（奉納後に鍵回収へ復帰するため）
      this.currentTargetDesc = `💎 パワーストーン奉納帰還 -> HOME(${map.realHomePos.x}, ${map.realHomePos.y})`;
      const dirToHome = this.botNav.findPath(curPos, map.realHomePos, map, player, enemies, player.canDiagonal, dragon);
      const canCastReturn = MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying;

      // MP=1 の時は原則 RETURN 禁止（MP=0自爆転落防止のため徒歩帰還）。
      // 例外: 徒歩ルートが遮断（dirToHome === null）され、周囲に敵がいて絶体絶命の場合のみ
      const isEmergencyBlocked = !dirToHome && enemies.some(e => e.isAlive && map.getTorusDistance(curPos, e.pos).chebyshev <= 2);
      const allowReturn = canCastReturn && (player.magic >= 2 || player.experience < 4000 || isEmergencyBlocked);

      if (allowReturn) {
        return { type: 'MAGIC', magic: 'RETURN' };
      }
      if (dirToHome) return this.handleMoveOrBreak(dirToHome, player, map);
      if (canCastReturn) return { type: 'MAGIC', magic: 'RETURN' }; // 徒歩ルートもなく徘徊もできない最終手段
      return this.handleWanderSafe(player, map, enemies, dragon);
    }

    // 我が家に到達した場合は退避アイテム取得状態をクリア（一時置き鍵は存在確認して維持）
    if (curPos.x === map.realHomePos.x && curPos.y === map.realHomePos.y) {
      this.itemToPickupPos = null;
      if (this.tempDroppedKeyPos !== null && map.getItem(this.tempDroppedKeyPos) !== 'KEY') {
        this.tempDroppedKeyPos = null;
      }
    }

    // 1-B. 8歩周期宝箱開錠モード中なら歩数調整＆確定開錠を最優先！
    if (this.eightStepController.eightStepTargetChestPos !== null) {
      this.currentTargetDesc = `📦 8歩周期調整 [歩数:${player.stepCountSinceStone}/8] -> 宝箱(${this.eightStepController.eightStepTargetChestPos.x}, ${this.eightStepController.eightStepTargetChestPos.y})`;
      const eightStepAction = this.eightStepController.handleEightStepCycle(player, map, enemies, dragon);
      if (eightStepAction) return eightStepAction;
    }

    // 1-C. コイン奉納による早期魔法解禁・オーバーヒール帰還
    // （EXPONENTIALモード時、コイン所持時、未解禁魔法があり換金で到達見込みがある場合や、近傍に家がある場合）
    if (!isClassic && player.gold >= 2 && player.experience < 12000 && this.itemToPickupPos === null) {
      this.currentTargetDesc = `🪙 コイン早期換金帰還 [所持:${player.gold}枚] -> HOME`;
      if (MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying && this.canSpendMagicReserve(player, enemies, map)) {
        return { type: 'MAGIC', magic: 'RETURN' };
      }
      const distToHome = map.getTorusDistance(curPos, map.realHomePos).manhattan;
      const shouldReturnHomeForCoin = (player.experience < 4000 && (distToHome <= 25 || player.gold >= 2)) ||
                                      distToHome <= 15 || player.gold >= 3;
      if (shouldReturnHomeForCoin) {
        const dirToHome = this.botNav.findPath(curPos, map.realHomePos, map, player, enemies, player.canDiagonal, dragon);
        if (dirToHome) return this.handleMoveOrBreak(dirToHome, player, map);
      }
    }

    // 2. 宝箱開錠後のアイテム持ち替え制御 (Hands-Free Rule)
    const isSafeAround = !enemies.some(
      e => e.isAlive && !e.isPermanentlyFrozen && map.getTorusDistance(curPos, e.pos).chebyshev <= 4
    );
    // 鍵所持中の一時置きを伴うコイン回収は、MPに余裕があり周囲が安全で、かつ本当にコインEXP/オーバーヒールが必要な局面のみに厳格限定
    const needCoinWithKey = !isClassic && isSafeAround && player.magic >= 2 &&
      (player.experience < 2000 || player.hp < player.maxHp * 0.4);

    const isChestJustOpened = this.justOpenedChestPos !== null &&
      this.justOpenedChestPos.x === curPos.x && this.justOpenedChestPos.y === curPos.y;
    const needChests = player.strength < targetStr || this.shouldContinueChestClearing(player, map, enemies, dragon);
    // 道端の床置き石を踏んだだけで鍵を捨てるのを厳禁とする。
    // 石への持ち替えは「宝箱直後」「周囲に宝箱なし」「8歩周期確定石」に厳格限定
    const allowStoneSwap = !needChests || isChestJustOpened || (player.stepCountSinceStone === 0);

    const isValuableItem = (floorItem === 'POWER_STONE' && allowStoneSwap) ||
      (floorItem === 'POTION' && player.magic < this.tuning.maxTargetMagic) ||
      (floorItem === 'COIN' && needCoinWithKey);

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
      this.currentTargetDesc = `🔄 鍵一時置き退避 [足元:${floorItem}]`;
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
        this.currentTargetDesc = '🔄 鍵を床に置く';
        return { type: 'SPACE' };
      } else {
        this.currentTargetDesc = '🔄 鍵置き場所を探して移動';
        const stepDir = this.findAdjacentDropTile(curPos, map, enemies, dragon, player);
        if (stepDir) {
          return { type: 'MOVE', dir: stepDir };
        }
      }
    }

    if (player.holdItem === 'NONE' && this.itemToPickupPos !== null) {
      if (curPos.x === this.itemToPickupPos.x && curPos.y === this.itemToPickupPos.y) {
        if (floorItem !== 'NONE') {
          this.currentTargetDesc = `🔄 退避アイテム取得 [${floorItem}]`;
          const action: BotAction = { type: 'SPACE' };
          this.itemToPickupPos = null;
          return action;
        } else {
          this.itemToPickupPos = null;
        }
      } else {
        this.currentTargetDesc = `🔄 退避アイテムへ戻る (${this.itemToPickupPos.x}, ${this.itemToPickupPos.y})`;
        const dir = this.botNav.findPath(curPos, this.itemToPickupPos, map, player, enemies, player.canDiagonal, dragon);
        if (dir) return this.handleMoveOrBreak(dir, player, map);
        else this.itemToPickupPos = null;
      }
    }

    if (player.holdItem === 'NONE' && this.itemToPickupPos === null && this.tempDroppedKeyPos !== null) {
      if (map.getItem(this.tempDroppedKeyPos) === 'KEY') {
        if (curPos.x === this.tempDroppedKeyPos.x && curPos.y === this.tempDroppedKeyPos.y) {
          this.tempDroppedKeyPos = null;
          this.currentTargetDesc = '🔄 一時置きした鍵を再回収';
          return { type: 'SPACE' };
        } else {
          this.currentTargetDesc = `🔄 一時置き鍵へ戻る (${this.tempDroppedKeyPos.x}, ${this.tempDroppedKeyPos.y})`;
          const dir = this.botNav.findPath(curPos, this.tempDroppedKeyPos, map, player, enemies, player.canDiagonal, dragon);
          if (dir) return this.handleMoveOrBreak(dir, player, map);
          else this.tempDroppedKeyPos = null;
        }
      } else {
        this.tempDroppedKeyPos = null;
      }
    }

    if (player.holdItem === 'NONE' && (floorItem === 'KEY' || floorItem === 'COIN' || isValuableItem)) {
      this.currentTargetDesc = `📦 足元アイテム取得 [${floorItem}]`;
      return { type: 'SPACE' };
    }

    // 3. 宝箱開錠（8歩周期の活用）
    if (floorObj === 'CHEST' && player.holdItem === 'KEY' && this.itemToPickupPos === null) {
      this.justOpenedChestPos = { ...curPos };
      this.currentTargetDesc = `🔓 宝箱開錠 (${curPos.x}, ${curPos.y})`;
      return { type: 'SPACE' };
    }

    // 3-B. KICK魔法による遠距離スナイプ（反撃不可・直線強敵即死撃破）
    const kickAction = this.tryKickSnipe(player, map, enemies, dragon);
    if (kickAction) {
      return kickAction;
    }

    // 3-C. 能動的 KICK スナイプポジショニング（MP>=2時、近傍強敵を狙撃するための射点へ移動）
    const kickPosAction = this.tryKickSnipePositioning(player, map, enemies, dragon);
    if (kickPosAction) {
      return kickPosAction;
    }

    // 4. 周囲の安全な敵を撃破（EXP稼ぎ＆障害排除）
    const adjacentTargets = this.botNav.getAdjacentEnemies(curPos, enemies, map);

    if (adjacentTargets.length >= 2 || adjacentTargets.some(({ enemy }) => ThreatEvaluator.evaluateThreat(player, enemy) === 'DANGER')) {
      if (this.canSpendMagicReserve(player, enemies, map)) {
        if (MagicSystem.canCast(player, 'FREEZE').allowed) {
          const target = adjacentTargets.find(({ enemy }) => !enemy.isPermanentlyFrozen);
          if (target) {
            this.currentTargetDesc = `❄️ FREEZE詠唱: 隣接危険敵足止め (${target.enemy.name})`;
            return { type: 'MAGIC', magic: 'FREEZE' };
          }
        }
        if (MagicSystem.canCast(player, 'FLASH').allowed) {
          this.currentTargetDesc = '⚡ FLASH詠唱: 全敵足止め';
          return { type: 'MAGIC', magic: 'FLASH' };
        }
      }
    }

    for (const { enemy, dir } of adjacentTargets) {
      const threat = ThreatEvaluator.evaluateThreat(player, enemy);
      if (threat === 'ONE_SHOT') {
        this.currentTargetDesc = `⚔️ 隣接敵撃破 (${enemy.name})`;
        return { type: 'MOVE', dir };
      }
    }

    // 4-B. 成長段階に応じた安全な敵追尾狩り（序盤の投機的遠征抑制 / 終盤の防御EXP育成）
    if (player.hasSword) {
      const isStrDone = player.strength >= targetStr;
      const needExp = player.experience < targetDefense;
      const needDiagonal = !player.canDiagonal && player.experience < 12000;
      const needReturn = player.experience < 2000;

      let maxHuntDist = 0;

      if (isStrDone) {
        // 【終盤: 決戦前準備段階 (player.strength >= targetStr)】
        // ドラゴンの首を攻撃できる目標STRに到達した後は、敵を圧倒できる戦力があるため、
        // ドラゴン戦・王冠脱出戦に必要な防御力と最大HP（targetDefenseExp）を仕上げるための能動的敵追尾狩りを有効化
        if (needExp || needDiagonal) {
          maxHuntDist = 45;
        }
      } else {
        // 【序盤〜中盤: STR育成段階 (player.strength < targetStr)】
        // 本作の仕様（SpawnSystem）では敵を2体倒すごとに出現モンスターのランクが+1されるため、
        // パワーストーン回収（STR育成）が進んでいない段階で敵を倒しまくると強敵が出現し事故死を招く。
        if (!isClassic) {
          // EXPONENTIAL モード:
          // 序盤の魔法解禁（RETURN: 2,000 / BREAK: 4,000 / 斜め移動: 12,000）は
          // 敵ランクを上げない「無害なコインの回収・換金（非戦闘EXP）」で行う。
          // そのため遠距離敵追尾狩り（maxDist = 20）を廃止し、
          // 鍵所持中は追尾狩りを行わず宝箱開錠を最優先、手ぶら時は極近傍（距離2マス以内）の安全な敵のみに抑制。
          if (player.holdItem !== 'KEY') {
            maxHuntDist = 2;
          }
        } else {
          // CLASSIC モード:
          // コイン換金でEXPが入らないため戦闘でEXPを稼ぐ必要があるが、
          // 序盤からむやみに遠征してキルランクを暴走させないよう、現在のSTRに応じた安全な距離に抑制。
          if (player.holdItem === 'KEY') {
            // 鍵所持中は宝箱開錠を最優先
            maxHuntDist = 2;
          } else if (needDiagonal || needReturn || needExp) {
            if (player.strength < 3000) {
              maxHuntDist = 3; // 最序盤: 目の前〜ごく近傍のみ
            } else if (player.strength < 6000) {
              maxHuntDist = 5; // 序盤: 近傍のみ
            } else {
              maxHuntDist = 8; // 中盤: 周辺8マス以内
            }
          }
        }
      }

      if (maxHuntDist > 0) {
        const safeCandidates = this.botNav.findNearestSafeEnemyCandidates(player, enemies, map, 15);
        for (const safeEnemy of safeCandidates) {
          const dist = map.getTorusDistance(curPos, safeEnemy.pos).manhattan;
          if (dist <= maxHuntDist) {
            this.currentTargetDesc = `⚔️ 敵狩り [${safeEnemy.name}(${safeEnemy.pos.x}, ${safeEnemy.pos.y}) dist:${dist}]`;
            const dir = this.botNav.findPath(curPos, safeEnemy.pos, map, player, enemies, player.canDiagonal, dragon);
            if (dir) return this.handleMoveOrBreak(dir, player, map);
          }
        }
      }
    }

    // 5. 鍵を持っている場合: 最寄りの宝箱へ向かう（近傍POTIONの一時回収、厳格限定の近傍コイン回収も含む）
    if (player.holdItem === 'KEY') {
      // 鍵所持時の一時回収スティッキーチェック
      const stickyKeyAction = this.tryStickyItemMove(player, map, enemies, dragon, targetStr);
      if (stickyKeyAction) return stickyKeyAction;

      // 5-A. 近傍POTIONの一時回収（最優先！MP枯渇を徹底防止）
      if (player.magic < this.tuning.maxTargetMagic && this.itemToPickupPos === null && this.tempDroppedKeyPos === null) {
        const potionCandidates = this.botNav.findNearestItemCandidates(curPos, 'POTION', map, enemies, player, 5, {
          lockedItemPos: this.lockedItemPos,
          lockedItemType: this.lockedItemType,
          hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
        });
        // 鍵所持中は宝箱開錠を最優先！MP>=2あれば遠くのPOTIONへ脇道に逸れず宝箱を目指す。
        // （宝箱を開ければPOTIONも石も出るため）
        const maxDist = player.magic <= 1 ? 25 : (player.strength >= targetStr ? 20 : 3);
        for (const candidate of potionCandidates) {
          const pDist = map.getTorusDistance(curPos, candidate).manhattan;
          if (pDist <= maxDist) {
            this.currentTargetDesc = `🧪 ポーション回収 (${candidate.x}, ${candidate.y}) dist:${pDist}`;
            const dir = this.botNav.findPath(curPos, candidate, map, player, enemies, player.canDiagonal, dragon);
            if (dir) {
              this.setLockedItem(candidate, 'POTION');
              return this.handleMoveOrBreak(dir, player, map);
            }
          }
        }
      }

      // 5-B. 宝箱へ向かう（STR未到達時、または事前クリアリング継続中）
      const needChestClearing = player.strength < targetStr || this.shouldContinueChestClearing(player, map, enemies, dragon);
      if (needChestClearing) {
        // 通り道や近傍（マンハッタン距離2〜3マス以内）に未開封の宝箱がある場合は、
        // 8歩周期外の通常開錠であっても積極的に開けて回転率とリソース解放を高める
        const immediateChests = this.botNav.findNearestChestCandidates(curPos, map, enemies, player, 1, {
          tacticalMetadata: map.tacticalMetadata,
        });
        if (immediateChests.length > 0) {
          const immChest = immediateChests[0];
          const immDist = map.getTorusDistance(curPos, immChest).manhattan;
          if (immDist <= 3) {
            this.currentTargetDesc = `📦 近傍宝箱即座開錠 (${immChest.x}, ${immChest.y}) dist:${immDist}`;
            const dir = this.botNav.findPath(curPos, immChest, map, player, enemies, player.canDiagonal, dragon);
            if (dir) {
              this.setLockedChest(immChest);
              return this.handleMoveOrBreak(dir, player, map);
            }
          }
        }

        const chestCandidates = this.botNav.findNearestChestCandidates(curPos, map, enemies, player, 5, {
          lockedChestPos: this.lockedChestPos,
          hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
          tacticalMetadata: map.tacticalMetadata,
        });
        for (const chestPos of chestCandidates) {
          const cDist = map.getTorusDistance(curPos, chestPos).manhattan;
          this.currentTargetDesc = `📦 宝箱へ移動 (${chestPos.x}, ${chestPos.y}) dist:${cDist}`;
          const dir = this.botNav.findPath(curPos, chestPos, map, player, enemies, player.canDiagonal, dragon);
          if (dir) {
            this.setLockedChest(chestPos);
            return this.handleMoveOrBreak(dir, player, map);
          }
        }
        this.clearChestLock();

        // 5-C. 近傍コインの一時回収 (宝箱開錠前、MP余裕・周囲安全・真に必要な局面のみ厳格限定)
        if (needCoinWithKey && this.itemToPickupPos === null && this.tempDroppedKeyPos === null) {
          const coinCandidates = this.botNav.findNearestItemCandidates(curPos, 'COIN', map, enemies, player, 5, {
            lockedItemPos: this.lockedItemPos,
            lockedItemType: this.lockedItemType,
            hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
          });
          const maxCoinDist = player.experience < 2000 ? 5 : 2;
          for (const coinPos of coinCandidates) {
            const cDist = map.getTorusDistance(curPos, coinPos).manhattan;
            if (cDist <= maxCoinDist) {
              this.currentTargetDesc = `🪙 コイン回収 (${coinPos.x}, ${coinPos.y}) dist:${cDist}`;
              const dir = this.botNav.findPath(curPos, coinPos, map, player, enemies, player.canDiagonal, dragon);
              if (dir) {
                this.setLockedItem(coinPos, 'COIN');
                return this.handleMoveOrBreak(dir, player, map);
              }
            }
          }
        }
      } else {
        // 目標STR達成かつ事前クリアリング完了（MP十分または周辺宝箱なし）
        this.currentTargetDesc = '🗝️ 鍵を手放す（目標STR＆リソース確保完了）';
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
      // 0. スティッキーターゲットの確認（ロック中のアイテムへ優先移動）
      const stickyAction = this.tryStickyItemMove(player, map, enemies, dragon, targetStr);
      if (stickyAction) return stickyAction;

      const needMagic = player.magic < this.tuning.maxTargetMagic;
      const strDone = player.strength >= targetStr;
      const needKeyForChests = player.strength < targetStr || this.shouldContinueChestClearing(player, map, enemies, dragon);

      // 6-A. MP枯渇・飢餓時（MP <= 1）の生命線確保（最優先POTION回収）
      if (needMagic && player.magic <= 1) {
        const potionCandidates = this.botNav.findNearestItemCandidates(curPos, 'POTION', map, enemies, player, 5, {
          lockedItemPos: this.lockedItemPos,
          lockedItemType: this.lockedItemType,
          hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
        });
        for (const nearestPotion of potionCandidates) {
          const pDist = map.getTorusDistance(curPos, nearestPotion).manhattan;
          if (pDist <= 35) {
            this.currentTargetDesc = `🧪 ポーション緊急回収 (${nearestPotion.x}, ${nearestPotion.y}) dist:${pDist}`;
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
      }

      // 6-B. 宝箱開錠サイクルの確立: 未開封宝箱があり、近傍に鍵があるなら遠方の石探索より鍵回収を優先！
      if (needKeyForChests) {
        const keyCandidates = this.botNav.findNearestItemCandidates(curPos, 'KEY', map, enemies, player, 5, {
          lockedItemPos: this.lockedItemPos,
          lockedItemType: this.lockedItemType,
          hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
        });
        const maxKeyDist = player.strength < targetStr ? 40 : 25;
        for (const nearestKey of keyCandidates) {
          const kDist = map.getTorusDistance(curPos, nearestKey).manhattan;
          if (kDist <= maxKeyDist) {
            this.currentTargetDesc = `🗝️ 鍵回収 (${nearestKey.x}, ${nearestKey.y}) dist:${kDist}`;
            if (curPos.x === nearestKey.x && curPos.y === nearestKey.y) {
              return { type: 'SPACE' };
            }
            const dir = this.botNav.findPath(curPos, nearestKey, map, player, enemies, player.canDiagonal, dragon);
            if (dir) {
              this.setLockedItem(nearestKey, 'KEY');
              return this.handleMoveOrBreak(dir, player, map);
            }
          }
        }
      }

      // 6-C. STR未達時のパワーストーン回収
      if (!strDone) {
        const stoneCandidates = this.botNav.findNearestItemCandidates(curPos, 'POWER_STONE', map, enemies, player, 5, {
          lockedItemPos: this.lockedItemPos,
          lockedItemType: this.lockedItemType,
          hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
        });
        for (const nearestStone of stoneCandidates) {
          const sDist = map.getTorusDistance(curPos, nearestStone).manhattan;
          if (sDist <= 15) {
            this.currentTargetDesc = `💎 パワーストーン回収 (${nearestStone.x}, ${nearestStone.y}) dist:${sDist}`;
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
      }

      // 6-D. 通常の POTION 回収（MP備蓄）
      if (needMagic) {
        const potionCandidates = this.botNav.findNearestItemCandidates(curPos, 'POTION', map, enemies, player, 5, {
          lockedItemPos: this.lockedItemPos,
          lockedItemType: this.lockedItemType,
          hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
        });
        for (const nearestPotion of potionCandidates) {
          const pDist = map.getTorusDistance(curPos, nearestPotion).manhattan;
          const maxDist = strDone || pDist <= 15 ? 18 : 10;
          if (pDist <= maxDist) {
            this.currentTargetDesc = `🧪 ポーション回収 (${nearestPotion.x}, ${nearestPotion.y}) dist:${pDist}`;
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
      }

      // 手ぶら時の近傍コイン回収 (MP枯渇時はPOTION/KEYを優先。MP>=1または最序盤EXP<2000かつ周囲安全時のみ)
      const isSafeFromEnemies = !enemies.some(
        e => e.isAlive && !e.isPermanentlyFrozen && map.getTorusDistance(curPos, e.pos).chebyshev <= 3
      );
      const shouldPickCoin = !isClassic
        ? (isSafeFromEnemies && (player.magic >= 1 || player.experience < 2000) && (player.experience < 12000 || player.hp < player.maxHp * 0.5))
        : (player.hp < player.maxHp * 0.8 && isSafeFromEnemies);
      if (shouldPickCoin) {
        const coinCandidates = this.botNav.findNearestItemCandidates(curPos, 'COIN', map, enemies, player, 5, {
          lockedItemPos: this.lockedItemPos,
          lockedItemType: this.lockedItemType,
          hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
        });
        const maxCoinDist = !isClassic ? (player.experience < 4000 ? 15 : (player.experience < 12000 ? 8 : 4)) : 3;
        for (const nearestCoin of coinCandidates) {
          const cDist = map.getTorusDistance(curPos, nearestCoin).manhattan;
          if (cDist <= maxCoinDist) {
            this.currentTargetDesc = `🪙 コイン回収 (${nearestCoin.x}, ${nearestCoin.y}) dist:${cDist}`;
            if (curPos.x === nearestCoin.x && curPos.y === nearestCoin.y) {
              return { type: 'SPACE' };
            }
            const dir = this.botNav.findPath(curPos, nearestCoin, map, player, enemies, player.canDiagonal, dragon);
            if (dir) {
              this.setLockedItem(nearestCoin, 'COIN');
              return this.handleMoveOrBreak(dir, player, map);
            }
          }
        }
      }


      // すべてのアイテム候補が見つからなかった場合のみロック解除
      this.clearItemLock();
    }

    this.currentTargetDesc = '🧭 安全徘徊探索中';
    return this.handleWanderSafe(player, map, enemies, dragon);
  }

  public actFarming(player: Player, map: WorldMap, enemies: EnemyInstance[], dragon: Dragon): BotAction {
    return this.actPowerRush(player, map, enemies, dragon);
  }

  private actRelocateHome(player: Player, map: WorldMap, dragon: Dragon, enemies: EnemyInstance[]): BotAction {
    this.currentTargetDesc = '🏠 前線基地移転戦術実行中';
    return this.homeRelocationTactics.actRelocateHome(player, map, dragon, enemies, {
      tuning: this.tuning,
      setPhase: (p) => this.setPhase(p),
      actDragonSlay: (pl, m, d, e) => this.actDragonSlay(pl, m, d, e),
      handleMoveOrBreak: (dir, pl, m) => this.handleMoveOrBreak(dir, pl, m),
    });
  }

  private actDragonSlay(player: Player, map: WorldMap, dragon: Dragon, enemies: EnemyInstance[]): BotAction {
    this.currentTargetDesc = '🐉 ドラゴン要塞進軍・首各個撃破';
    const livingHeads = dragon.heads.filter(h => h.isAlive);
    if (livingHeads.length === 0) {
      return { type: 'WAIT' };
    }

    const curPos = player.pos;
    const isLastHead = livingHeads.length === 1;

    // 足元が宝箱で鍵を持っていれば開錠（MP枯渇フォールバックや通りすがり）
    const floorObj = map.getObject(curPos);
    if (floorObj === 'CHEST' && player.holdItem === 'KEY') {
      this.currentTargetDesc = `🔓 決戦中宝箱開錠 (${curPos.x}, ${curPos.y})`;
      return { type: 'SPACE' };
    }

    // 0. 首討伐後の世界変化（怒り・上位敵湧き・全魔法封印）を見据えた安全制御
    // HPは70%未満かつ5万未満の場合に回復へ（HP5万以上あれば上位敵の一撃にも耐えられる）
    const isDamaged = player.hp < player.maxHp * 0.7 && player.hp < 50000;
    const isMpLow = player.magic < (isLastHead ? 2 : 1);
    const adjacentEnemies = this.botNav.getAdjacentEnemies(curPos, enemies, map);
    const hasDangerousAdjacent = adjacentEnemies.some(({ enemy }) => {
      const threat = ThreatEvaluator.evaluateThreat(player, enemy);
      return threat === 'LETHAL' || threat === 'DANGER' || enemy.atk > player.experience;
    });

    // HP低下時は安全に我が家（前線基地）へ帰還して全回復
    if (isDamaged) {
      this.currentTargetDesc = '🏠 決戦中HP回復のため我が家へ帰還';
      const dirToHome = this.botNav.findPath(curPos, map.realHomePos, map, player, enemies, player.canDiagonal, dragon);
      if (dirToHome) return this.handleMoveOrBreak(dirToHome, player, map);
    }

    // MP枯渇時は近傍POTION補給を優先
    if (isMpLow) {
      if (player.holdItem === 'NONE') {
        const potionPos = this.botNav.findNearestItem(curPos, 'POTION', map, enemies, player);
        if (potionPos) {
          const pDist = map.getTorusDistance(curPos, potionPos).manhattan;
          if (pDist <= 20) {
            this.currentTargetDesc = `🧪 決戦中MP補給へ移動 (${potionPos.x}, ${potionPos.y}) dist:${pDist}`;
            if (curPos.x === potionPos.x && curPos.y === potionPos.y) {
              return { type: 'SPACE' };
            }
            const dir = this.botNav.findPath(curPos, potionPos, map, player, enemies, player.canDiagonal, dragon);
            if (dir) return this.handleMoveOrBreak(dir, player, map);
          }
        }

        // 床置きPOTIONが近傍にない場合のセーフティネット:
        // 近傍に鍵と未開封宝箱があれば、鍵を回収して開錠しPOTIONを探す
        const keyCandidates = this.botNav.findNearestItemCandidates(curPos, 'KEY', map, enemies, player, 3);
        const chestCandidates = this.botNav.findNearestChestCandidates(curPos, map, enemies, player, 3);
        if (keyCandidates.length > 0 && chestCandidates.length > 0) {
          const nearestKey = keyCandidates[0];
          const kDist = map.getTorusDistance(curPos, nearestKey).manhattan;
          if (kDist <= 20) {
            this.currentTargetDesc = `🗝️ 決戦中MP枯渇フォールバック: 鍵回収 (${nearestKey.x}, ${nearestKey.y}) dist:${kDist}`;
            if (curPos.x === nearestKey.x && curPos.y === nearestKey.y) {
              return { type: 'SPACE' };
            }
            const dir = this.botNav.findPath(curPos, nearestKey, map, player, enemies, player.canDiagonal, dragon);
            if (dir) return this.handleMoveOrBreak(dir, player, map);
          }
        }
      } else if (player.holdItem === 'KEY') {
        // すでに鍵を持っている場合、未開封宝箱を開錠してPOTION排出を狙う
        const chestCandidates = this.botNav.findNearestChestCandidates(curPos, map, enemies, player, 3);
        if (chestCandidates.length > 0) {
          const targetChest = chestCandidates[0];
          const cDist = map.getTorusDistance(curPos, targetChest).manhattan;
          if (cDist <= 20) {
            this.currentTargetDesc = `📦 決戦中MP枯渇フォールバック: 宝箱開錠 (${targetChest.x}, ${targetChest.y}) dist:${cDist}`;
            if (curPos.x === targetChest.x && curPos.y === targetChest.y) {
              return { type: 'SPACE' };
            }
            const dir = this.botNav.findPath(curPos, targetChest, map, player, enemies, player.canDiagonal, dragon);
            if (dir) return this.handleMoveOrBreak(dir, player, map);
          }
        }
      }
    }

    // KICKスナイプによる射線上の敵排除
    const kickAction = this.tryKickSnipe(player, map, enemies, dragon);
    if (kickAction) {
      return kickAction;
    }

    // 最後の首で隣接に危険な敵がいる場合、FREEZE等で無力化してから首を攻撃
    if (isLastHead && hasDangerousAdjacent && player.magic > 0 && !player.hasDeath) {
      if (this.canSpendMagicReserve(player, enemies, map) && MagicSystem.canCast(player, 'FREEZE').allowed) {
        this.currentTargetDesc = '❄️ 最終首撃破前の隣接危険敵FREEZE無力化';
        return { type: 'MAGIC', magic: 'FREEZE' };
      }
    }

    // 1. 首の斜め隣接マスにいる場合、首攻撃を実行（※上記安全チェック通過後）
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
        if (pDist <= 20) {
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
    this.currentTargetDesc = player.holdItem === 'CROWN' ? `👑 王冠運搬中 -> HOME(${map.realHomePos.x}, ${map.realHomePos.y})` : '👑 床の王冠回収へ移動';
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
      if (nearbyEnemies.length > 0 && this.canSpendMagicReserve(player, enemies, map) && MagicSystem.canCast(player, 'FREEZE').allowed) {
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
  public getUnreachableCount(): number {
    return this.botNav.getUnreachableCount();
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

  public findNearestChestCandidates(
    from: Position,
    map: WorldMap,
    enemies?: EnemyInstance[],
    player?: Player,
    limit: number = 5,
    lockInfo?: NavigatorItemLockInfo
  ): Position[] {
    return this.botNav.findNearestChestCandidates(from, map, enemies, player, limit, lockInfo ?? {
      lockedChestPos: this.lockedChestPos,
      hysteresisBonus: this.TARGET_HYSTERESIS_BONUS,
      tacticalMetadata: map.tacticalMetadata,
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

  public findBlockPushForGraves(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon,
    openGraves: { grave: Position; openSpots: Position[] }[]
  ): BotAction | null {
    return this.graveSealTactics.findBlockPushForGraves(player, map, enemies, dragon, openGraves);
  }

  public getTargetOpenGraves(map: WorldMap, enemies: EnemyInstance[], policy?: GraveSealPolicy): { grave: Position; openSpots: Position[] }[] {
    return this.graveSealTactics.getTargetOpenGraves(map, enemies, policy, this.tuning, this.mapAssessment);
  }

  public formatActionDesc(action: BotAction): string {
    switch (action.type) {
      case 'MOVE':
        return `MOVE ${action.dir}`;
      case 'SPACE':
        return 'SPACE';
      case 'MAGIC':
        return `MAGIC ${action.magic}`;
      case 'WAIT':
        return 'WAIT';
      default:
        return 'UNKNOWN';
    }
  }

  public getTelemetryStatus(player: Player, _map?: WorldMap, turn?: number): string {
    const hold = player.holdItem === 'NONE' ? '手ぶら' : player.holdItem;

    let oscInfo = '';
    if (this.forceWanderTurns > 0) {
      oscInfo = ` | ⚠️ 脱出徘徊中(${this.forceWanderTurns}T)`;
    } else if (this.botNav.oscillationCount > 0 || this.pingPongCount > 0) {
      oscInfo = ` | 🔄 往復兆候(Osc:${this.botNav.oscillationCount}, PP:${this.pingPongCount})`;
    }

    const unreachCount = this.botNav.getUnreachableCount ? this.botNav.getUnreachableCount() : 0;
    const blacklistInfo = unreachCount > 0 ? ` [除外:${unreachCount}]` : '';
    const turnPrefix = turn !== undefined ? `T:${turn} | ` : '';

    return `${turnPrefix}${this.currentPhase} | 🎯 ${this.currentTargetDesc}${blacklistInfo} | 🤖 ${this.lastDecidedActionDesc} | [${hold}]${oscInfo}`;
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
