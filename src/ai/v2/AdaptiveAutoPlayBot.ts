import { Direction, Position } from '../../models/Types.js';
import { GameEngine } from '../../core/GameEngine.js';
import { Player } from '../../models/Player.js';
import { WorldMap } from '../../models/WorldMap.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { Dragon } from '../../models/Dragon.js';
import { Ghost } from '../../models/Ghost.js';
import { MagicSystem } from '../../systems/MagicSystem.js';
import { MovementSystem } from '../../systems/MovementSystem.js';
import { ThreatEvaluator } from '../../systems/ThreatEvaluator.js';
import { MapProfiler } from '../../systems/generator/MapProfiler.js';

import {
  AdaptiveBotOptions,
  BehaviorResult,
  BotActionV2,
  BotPhaseV2,
  BotSkillProfile,
  DynamicBotParameters,
} from './BotTypesV2.js';
import { TacticalContext } from './TacticalContext.js';
import { AdaptiveNavigator } from './AdaptiveNavigator.js';
import { EightStepController } from '../EightStepController.js';
import { BootstrapBehavior } from './behaviors/BootstrapBehavior.js';
import { GraveSealBehavior } from './behaviors/GraveSealBehavior.js';
import { ResourceFarmBehavior, SwapState } from './behaviors/ResourceFarmBehavior.js';
import { RelocateBehavior } from './behaviors/RelocateBehavior.js';
import { CombatBehavior } from './behaviors/CombatBehavior.js';
import { DragonSlayBehavior } from './behaviors/DragonSlayBehavior.js';
import { EscapeBehavior } from './behaviors/EscapeBehavior.js';

export * from './BotTypesV2.js';
export { TacticalContext } from './TacticalContext.js';
export { AdaptiveNavigator } from './AdaptiveNavigator.js';

/**
 * AdaptiveAutoPlayBot (v2)
 *
 * 最新の階層テーマブロックマップ生成およびダンジョンチューニングに完全適合した、
 * 状況適応型自律エージェント。
 */
export class AdaptiveAutoPlayBot {
  public readonly profile: BotSkillProfile;
  public currentPhase: BotPhaseV2 = 'BOOTSTRAP';
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

  // ターゲットロック・ヒステリシス
  public lockedItemPos: Position | null = null;
  public lockedItemType: string | null = null;
  public lockedChestPos: Position | null = null;

  // テレメトリ
  public currentTargetDesc: string = '初期化中';
  public lastDecidedActionDesc: string = '待機';

  constructor(opts: AdaptiveBotOptions = {}) {
    this.profile = opts.profile ?? 'STANDARD';
    this.nav = new AdaptiveNavigator();
    this.eightStepController = new EightStepController(this.nav);
  }

  public setPhase(newPhase: BotPhaseV2): void {
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
  public decideAction(engine: GameEngine): BotActionV2 {
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

    let decidedAction: BotActionV2 | null = null;

    const isAdjacentToDragonHead = dragon?.heads.some(h => {
      if (!h.isAlive) return false;
      const dx = Math.abs(player.pos.x - h.pos.x);
      const dy = Math.abs(player.pos.y - h.pos.y);
      return (dx === 1 || dx === map.width - 1) && (dy === 1 || dy === map.height - 1);
    }) ?? false;

    // 鍵を持って宝箱の近くにいる場合、または8歩周期チェーン実行中はピンポンレスキューを抑止
    const isNearChestWithKey = player.holdItem === 'KEY' && (
      map.getObject(player.pos) === 'CHEST' ||
      this.eightStepController.eightStepTargetChestPos !== null ||
      (this.lockedChestPos !== null && map.getTorusDistance(player.pos, this.lockedChestPos).manhattan <= 2)
    );

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
        const circlingResult = CombatBehavior.tryBreakCirclingLoop(
          player, map, enemies, dragon, this.nav, this.params
        );
        if (circlingResult) {
          this.currentTargetDesc = circlingResult.description;
          decidedAction = circlingResult.action;
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
  public resolveMoveOrBreak(action: BotActionV2, player: Player, map: WorldMap): BotActionV2 {
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
  public step(engine: GameEngine): BotActionV2 {
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
        engine.executeTurn(null);
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
    if (canDamageDragon && (hasDiagonal || this.profile === 'NOVICE')) {
      if (this.currentPhase === 'RESOURCE_FARM') {
        this.defensePrepTurns++;
      }
      const hasEnoughMagic = player.magic >= this.params.minDragonMagic || this.defensePrepTurns > 30;
      const hasEnoughHp = player.hp >= player.maxHp * 0.70 || player.hp >= 30000;
      const hasMinDefense = player.experience >= this.params.targetDefenseExp ||
                            player.experience >= 15000 ||
                            this.defensePrepTurns > 40;

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
  private checkEmergency(player: Player, map: WorldMap, enemies: EnemyInstance[], dragon: Dragon): BotActionV2 | null {
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

    const hasLethalAdjacent = adjacentEnemies.some(
      ({ enemy }) => ThreatEvaluator.evaluateThreat(player, enemy) === 'LETHAL'
    );

    // 2. 王冠所持中に即死敵が隣接: 魔法自衛のため王冠を床に一時ドロップ
    if (player.holdItem === 'CROWN' && hasLethalAdjacent && player.magic > 0 && !player.hasDeath && map.getItem(curPos) === 'NONE') {
      this.currentTargetDesc = '👑 魔法自衛のため王冠一時ドロップ';
      return { type: 'SPACE' };
    }

    // 3. 直角隣接に即死敵（LETHAL）がいる場合の迎撃・退避
    if (hasLethalAdjacent && !player.hasDeath) {
      const evadeDir = this.nav.findEvadeDirection(curPos, map, enemies, player, dragon);
      const canSpendReserve = this.canSpendMagicReserve(player, {
        isLethalEmergency: true,
        hasEvadeRoute: !!evadeDir,
      });

      // 3-A. 岩があれば KICK スナイプで即死反撃（MPリザーブ保護下では敵中命中によるMP-1を防止）
      if (canSpendReserve) {
        const kickAction = CombatBehavior.tryKickSnipe(player, map, enemies, dragon);
        if (kickAction) {
          this.currentTargetDesc = kickAction.description;
          return kickAction.action;
        }
      }

      // 3-B. FREEZE 詠唱で永久凍結無力化
      if (canSpendReserve && MagicSystem.canCast(player, 'FREEZE').allowed) {
        const unfrozenLethal = adjacentEnemies.find(
          ({ enemy }) => ThreatEvaluator.evaluateThreat(player, enemy) === 'LETHAL' && !enemy.isPermanentlyFrozen
        );
        if (unfrozenLethal) {
          this.currentTargetDesc = `🚨 緊急無力化: FREEZE詠唱 (${unfrozenLethal.enemy.name})`;
          return { type: 'MAGIC', magic: 'FREEZE' };
        }
      }

      // 3-C. FLASH 詠唱で足止め
      if (canSpendReserve && MagicSystem.canCast(player, 'FLASH').allowed) {
        this.currentTargetDesc = '🚨 緊急足止め: FLASH詠唱';
        return { type: 'MAGIC', magic: 'FLASH' };
      }

      // 3-D. 安全な空床へ回避移動
      if (evadeDir) {
        this.currentTargetDesc = '🚨 緊急退避: 安全マスへ回避移動';
        return { type: 'MOVE', dir: evadeDir };
      }
    }

    // 4. HPピンチまたは死神憑依時の帰還・退避
    if (isPinch || player.hasDeath) {
      const homeDist = map.getTorusDistance(curPos, map.realHomePos).manhattan;
      const canCastReturn = MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying;
      const canSpendReserve = this.canSpendMagicReserve(player);
      const dirToHome = this.nav.findPath(curPos, map.realHomePos, map, player, enemies, this.params, { dragon });

      // RETURNで我が家へ瞬時帰還:
      // MPが潤沢(MP>=2)、または徒歩ルートが完全に塞がれている(!dirToHome)、またはHP極限危機(<=20%)・死神時は即座にRETURN
      const isExtremeDanger = player.hasDeath || player.hp <= player.maxHp * 0.20 || !dirToHome;
      if (canCastReturn && homeDist > 2 && (canSpendReserve || isExtremeDanger)) {
        this.currentTargetDesc = '🚨 緊急退避: RETURN全回復帰還';
        return { type: 'MAGIC', magic: 'RETURN' };
      }

      // 死神憑依時: 近傍の十字架があれば踏みに行く
      if (player.hasDeath) {
        const crossPos = this.findNearestCross(curPos, map);
        if (crossPos) {
          const crossDist = map.getTorusDistance(curPos, crossPos).manhattan;
          if (crossDist <= 10) {
            const dirCross = this.nav.findPath(curPos, crossPos, map, player, enemies, this.params, { dragon });
            if (dirCross) {
              this.currentTargetDesc = `✝️ 十字架で死神浄化へ移動 [距離: ${crossDist}]`;
              return { type: 'MOVE', dir: dirCross };
            }
          }
        }
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

  private findNearestCross(from: Position, map: WorldMap): Position | null {
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

  public formatAction(action: BotActionV2): string {
    switch (action.type) {
      case 'MOVE': return `移動 [${action.dir}]`;
      case 'SPACE': return 'アクション [SPACE]';
      case 'MAGIC': return `魔法 [${action.magic}]`;
      case 'WAIT': return '待機';
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

  public getTelemetryStatus(player: Player, _map?: WorldMap, turn?: number): string {
    const t = turn ?? this.totalTurns;
    return `T:${t} [${this.currentPhase}] HP:${player.hp}/${player.maxHp} STR:${player.strength} MP:${player.magic} | ${this.currentTargetDesc}`;
  }
}
