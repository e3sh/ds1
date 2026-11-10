import { Direction, Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { Player } from '../../models/Player.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { Dragon } from '../../models/Dragon.js';
import { GameEngine } from '../../core/GameEngine.js';
import { BotAction, DynamicBotParameters } from '../BotTypes.js';
import { AdaptiveNavigator } from '../AdaptiveNavigator.js';
import { EightStepController } from '../EightStepController.js';
import { ItemSwapTactics, SwapState } from './ItemSwapTactics.js';
import { StrategicDirective } from '../strategy/StrategicDirective.js';
import { TacticalSnapshot } from '../perception/TacticalSnapshot.js';
import { MagicSystem } from '../../systems/MagicSystem.js';
import { MovementSystem } from '../../systems/MovementSystem.js';
import { ThreatEvaluator } from '../../systems/ThreatEvaluator.js';
import { TacticalCombat } from './TacticalCombat.js';

export type TacticalExecutionStatus = 'SUCCESS' | 'PATH_BLOCKED' | 'STALLED';

export interface TacticalExecutionResult {
  action: BotAction;
  description: string;
  status: TacticalExecutionStatus;
}

/**
 * TacticalExecutor (戦術実行ユニット)
 *
 * 戦略ユニットから下された作戦指令（StrategicDirective）を忠実に遂行し、
 * ナビゲーション、8歩周期同期、ショートカット開削、アイテムスワップ等の
 * マイクロ操作を解決して1手の BotAction を生成する。
 */
export class TacticalExecutor {
  public swapState: SwapState = {
    itemToPickupPos: null,
    tempDroppedKeyPos: null,
    swapTurns: 0,
  };
  private pivotTurns: number = 0;

  constructor(
    private readonly nav: AdaptiveNavigator,
    private readonly eightStepController: EightStepController
  ) {}

  public execute(
    directive: StrategicDirective,
    snapshot: TacticalSnapshot,
    engine: GameEngine
  ): TacticalExecutionResult {
    const player = engine.getPlayer();
    const map = snapshot.map;
    const enemies = snapshot.livingEnemies;
    const dragon = engine.getDragon();
    const params = snapshot.params;

    // 0. スワップ中の処理があれば最優先で継続
    if (this.swapState.itemToPickupPos !== null || this.swapState.tempDroppedKeyPos !== null) {
      const swapRes = ItemSwapTactics.execute(player, map, enemies, dragon, this.nav, params, this.swapState);
      if (swapRes) {
        return {
          action: this.resolveMoveOrBreak(swapRes.action, player, map),
          description: swapRes.description,
          status: 'SUCCESS',
        };
      }
    }

    // 0-A. 8歩周期チェーン実行中の処理（最優先で同期移動を継続）
    if (this.eightStepController.eightStepTargetChestPos !== null) {
      const targetChestPos = { ...this.eightStepController.eightStepTargetChestPos };
      const eightStepAction = this.eightStepController.handleEightStepCycle(player, map, enemies, dragon);
      if (eightStepAction) {
        return {
          action: this.resolveMoveOrBreak(eightStepAction, player, map),
          description: `📦 8歩周期調整 [歩数:${player.stepCountSinceStone}/8] -> 宝箱(${targetChestPos.x}, ${targetChestPos.y})`,
          status: 'SUCCESS',
        };
      }
    }

    if (player.holdItem === 'POWER_STONE') {
      this.eightStepController.clearEightStepState();
    }

    // 0-A. アイテム一時置きスワップの継続（最優先実行）
    if (this.swapState.itemToPickupPos !== null || this.swapState.tempDroppedKeyPos !== null) {
      if (player.holdItem === 'POWER_STONE') {
        // パワーストーン回収完了時はスワップを終了して我家奉納へ
        this.swapState.itemToPickupPos = null;
        this.swapState.tempDroppedKeyPos = null;
        this.swapState.swapTurns = 0;
      } else {
        const swapRes = ItemSwapTactics.execute(player, map, enemies, dragon, this.nav, params, this.swapState);
        if (swapRes) {
          return {
            action: this.resolveMoveOrBreak(swapRes.action, player, map),
            description: swapRes.description,
            status: 'SUCCESS',
          };
        }
      }
    }

    // 0-B. 直角隣接の即死・危険敵に対する緊急自衛FREEZE / FLASH
    // ※前線基地近傍（チェビシェフ<=2）またはディレクティブ方針では進入路封鎖を防ぐためFLASHを優先し、FREEZEは抑止
    // ※BREAK用 MP=1 温存: BREAK解禁済み(EXP>=4000)では MP>1 の時のみ自衛魔法を許可（退避方向がなく即死する場合を除く）
    const evadeDirForSelfDefense = this.nav.findEvadeDirection(player.pos, map, enemies, player, dragon);
    const canSpendForSelfDefense = !player.hasDeath && (player.magic > 1 || (player.experience < 4000 && player.magic > 0) || !evadeDirForSelfDefense);
    if (canSpendForSelfDefense) {
      const isNearEscapeHome = map.getTorusDistance(player.pos, map.realHomePos).chebyshev <= 2;
      const shouldDisallowFreeze = directive.policy?.disallowFreezeNearHome || isNearEscapeHome;
      const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
      const hasAdjacentDangerous = cardDirs.some(d => {
        const np = map.wrapPosition(MovementSystem.getNextPosition(player.pos, d));
        const e = enemies.find(
          enemy => enemy.isAlive && !enemy.isPermanentlyFrozen && (enemy.frozenTimer ?? 0) <= 0 && enemy.pos.x === np.x && enemy.pos.y === np.y
        );
        if (!e) return false;
        const details = ThreatEvaluator.evaluateThreatDetails(player, e);
        return details.defenseThreat === 'LETHAL' || (details.defenseThreat === 'TAKES_DAMAGE' && (details.damageToPlayer >= player.hp * 0.35 || details.attackThreat !== 'ONE_SHOT'));
      });

      if (hasAdjacentDangerous) {
        if (shouldDisallowFreeze && MagicSystem.canCast(player, 'FLASH').allowed) {
          return {
            action: { type: 'MAGIC', magic: 'FLASH' },
            description: '⚡ 緊急自衛: 前線基地近傍・方針に従いFLASHスタン（進入路封鎖抑止）',
            status: 'SUCCESS',
          };
        }
        if (!shouldDisallowFreeze && MagicSystem.canCast(player, 'FREEZE').allowed) {
          return {
            action: { type: 'MAGIC', magic: 'FREEZE' },
            description: '❄️ 緊急自衛: 直角隣接の危険敵をFREEZE無力化',
            status: 'SUCCESS',
          };
        }
        if (MagicSystem.canCast(player, 'FLASH').allowed) {
          return {
            action: { type: 'MAGIC', magic: 'FLASH' },
            description: '⚡ 緊急自衛: 直角隣接の危険敵をFLASHスタン',
            status: 'SUCCESS',
          };
        }
      }
    }

    // 0-C. 膠着・周回（カルーセルループ）の能動打開（王冠脱出中は除外）
    if (this.nav.oscillationCount >= 2 || snapshot.memory.pingPongCount >= 2) {
      const circlingAction = TacticalCombat.tryBreakCirclingLoop(player, map, enemies, dragon, this.nav, params);
      if (circlingAction) {
        return {
          action: this.resolveMoveOrBreak(circlingAction.action, player, map),
          description: `🌀 周回打開: ${circlingAction.description}`,
          status: 'STALLED',
        };
      }
      const breakthroughAction = TacticalCombat.tryBreakthroughCombat(player, map, enemies, dragon, this.nav, params);
      if (breakthroughAction) {
        return {
          action: this.resolveMoveOrBreak(breakthroughAction.action, player, map),
          description: `💥 強行突破: ${breakthroughAction.description}`,
          status: 'STALLED',
        };
      }
    }

    switch (directive.type) {
      case 'NAVIGATE_TO_POSITION':
        return this.executeNavigate(directive, player, map, enemies, dragon, params, snapshot);

      case 'BREACH_SHORTCUT':
        return this.executeBreach(directive, player, map, enemies, dragon, params, snapshot);

      case 'UNLOCK_CHEST_8STEP':
        return this.executeUnlockChest8Step(directive, player, map, enemies, dragon, params, snapshot);

      case 'UNLOCK_CHEST_RAPID':
        return this.executeUnlockChestRapid(directive, player, map, enemies, dragon, params, snapshot);

      case 'PICKUP_ITEM':
        return this.executePickupItem(directive, player, map, enemies, dragon, params, snapshot);

      case 'DROP_HOLD_ITEM':
        return this.executeDropItem(player, map, enemies, dragon, params);

      case 'SWAP_KEY_FOR_ITEM':
        return this.initiateSwap(directive, player, map, enemies, dragon, params);

      case 'SEAL_GRAVE_STEP':
        return this.executeSealGraveStep(directive, player, map, enemies, dragon, params, snapshot);

      case 'ATTACK_TARGET':
        return this.executeAttack(directive, player, map, enemies, dragon, params, snapshot);

      case 'CAST_MAGIC':
        if (directive.magicToCast) {
          // MP=1 リザーブ保護: BREAK習得後 (EXP >= 4000) は、即死危機以外かつ通常優先度で MP=1 の消費を抑止
          // ※BREAK自体の詠唱、RETURN、および緊急高優先度魔法 (priority >= 95) はリザーブ保護の対象外
          const isHighPriorityMagic = directive.priority >= 95 || directive.magicToCast === 'RETURN' || directive.magicToCast === 'BREAK';
          if (player.experience >= 4000 && player.magic <= 1 && !snapshot.threats.isLethalDanger && !isHighPriorityMagic) {
            // リザーブ保護のため安全徘徊へ
            const wander = this.nav.wanderSafe(player, map, enemies, dragon);
            return {
              action: this.resolveMoveOrBreak(wander, player, map),
              description: `🛡️ MP=1リザーブ保護（BREAK維持）のため詠唱見送り: ${directive.reason}`,
              status: 'SUCCESS',
            };
          }

          // RETURN または JUMP などのテレポート魔法を詠唱する場合、移動履歴とヒートマップを即時リセット
          if (directive.magicToCast === 'RETURN' || directive.magicToCast === 'JUMP') {
            this.nav.clearPositionHistory();
          }

          return {
            action: { type: 'MAGIC', magic: directive.magicToCast },
            description: `✨ 魔法詠唱 [${directive.magicToCast}]: ${directive.reason}`,
            status: 'SUCCESS',
          };
        }
        break;

      case 'GIVE_UP':
        return {
          action: { type: 'GIVE_UP' },
          description: directive.reason,
          status: 'SUCCESS',
        };

      case 'EVADE_DANGER':
        return this.executeEvadeDanger(player, map, enemies, dragon, params, snapshot);

      case 'WANDER_SAFELY':
      default:
        break;
    }

    // デフォルト: 安全徘徊
    const wanderAction = this.nav.wanderSafe(player, map, enemies, dragon);
    return {
      action: this.resolveMoveOrBreak(wanderAction, player, map),
      description: `🧭 安全徘徊: ${directive.reason}`,
      status: 'SUCCESS',
    };
  }

  /**
   * ナビゲーション実行
   */
  private executeNavigate(
    directive: StrategicDirective,
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    params: DynamicBotParameters,
    snapshot: TacticalSnapshot
  ): TacticalExecutionResult {
    const targetPos = directive.targetPos!;
    const atTarget = player.pos.x === targetPos.x && player.pos.y === targetPos.y;

    if (atTarget) {
      // 既に目的地にいる場合は足元アクション
      if (directive.targetItemType && map.getItem(player.pos) === directive.targetItemType) {
        return {
          action: { type: 'SPACE' },
          description: `📦 目的地アイテム取得 [${directive.targetItemType}]`,
          status: 'SUCCESS',
        };
      }
      // 足元が宝箱で鍵を所持している場合は、決してWAITに陥らず即座に開錠！
      if (map.getObject(player.pos) === 'CHEST' && player.holdItem === 'KEY') {
        return {
          action: { type: 'SPACE' },
          description: `🔓 目的地宝箱開錠 (${player.pos.x}, ${player.pos.y})`,
          status: 'SUCCESS',
        };
      }
      return {
        action: { type: 'WAIT' },
        description: `目的地到達: ${directive.reason}`,
        status: 'SUCCESS',
      };
    }

    const allHomes = map.getAllHomePositions();
    const isTargetHome = allHomes.some(h => targetPos.x === h.x && targetPos.y === h.y) || map.getBaseTile(targetPos) === 'HOME';

    const isEscapePhase = player.holdItem === 'CROWN' || !dragon || dragon.isAllHeadsDefeated;
    // 徒歩経路探索（BREAK習得済みなら道中の岩をBREAK開削して通路を拓きながら前進）
    const dir = this.nav.findPath(player.pos, targetPos, map, player, enemies, params, { dragon, isEscapePhase });
    if (dir) {
      const dist = map.getTorusDistance(player.pos, targetPos).manhattan;
      const action = this.resolveMoveOrBreak({ type: 'MOVE', dir }, player, map);
      return {
        action,
        description: `🚶 移動 -> (${targetPos.x}, ${targetPos.y}) [距離:${dist}]: ${directive.reason}`,
        status: 'SUCCESS',
      };
    }

    // 我が家への徒歩経路が完全に塞がれている場合のみ緊急RETURNで脱出
    if (isTargetHome && player.holdItem !== 'CROWN') {
      if (MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying) {
        this.nav.clearPositionHistory();
        return {
          action: { type: 'MAGIC', magic: 'RETURN' },
          description: `🏠 徒歩ルート遮断のため緊急RETURN帰還: ${directive.reason}`,
          status: 'SUCCESS',
        };
      }
    }

    // 経路が見つからない場合: 到達不能マーク
    this.nav.markTargetUnreachable(targetPos, 16);
    snapshot.memory.markTargetUnreachable(targetPos, 16, snapshot.totalTurns);
    const wander = this.nav.wanderSafe(player, map, enemies, dragon);
    return {
      action: this.resolveMoveOrBreak(wander, player, map),
      description: `⚠️ 経路遮断のため安全徘徊: ${directive.reason}`,
      status: 'PATH_BLOCKED',
    };
  }

  /**
   * ショートカット壁・岩のBREAK開削
   */
  private executeBreach(
    directive: StrategicDirective,
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    params: DynamicBotParameters,
    snapshot: TacticalSnapshot
  ): TacticalExecutionResult {
    const targetPos = directive.targetPos!;
    const dist = map.getTorusDistance(player.pos, targetPos);

    // 隣接している場合: その方向を向いて BREAK 詠唱
    if (dist.manhattan === 1) {
      const dir = this.nav.getAdjacentDirection(player.pos, targetPos, map);
      if (dir) {
        player.dir = dir;
        if (MagicSystem.canCast(player, 'BREAK').allowed) {
          return {
            action: { type: 'MAGIC', magic: 'BREAK' },
            description: `⛏️ ショートカット開削 BREAK 詠唱 (${targetPos.x}, ${targetPos.y})`,
            status: 'SUCCESS',
          };
        }
        if (MagicSystem.canCast(player, 'KICK').allowed) {
          return {
            action: { type: 'MAGIC', magic: 'KICK' },
            description: `⛏️ ショートカット開削 KICK 詠唱 (${targetPos.x}, ${targetPos.y})`,
            status: 'SUCCESS',
          };
        }
        // MP不足等でBREAK/KICKが唱えられない場合: 開削を断念してブラックリスト化
        this.nav.markTargetUnreachable(targetPos, 40);
        snapshot.memory.markTargetUnreachable(targetPos, 40, snapshot.totalTurns);
        const wander = this.nav.wanderSafe(player, map, enemies, dragon);
        return {
          action: this.resolveMoveOrBreak(wander, player, map),
          description: `⚠️ MP不足のためショートカット開削を断念 (${targetPos.x}, ${targetPos.y})`,
          status: 'PATH_BLOCKED',
        };
      }
    }

    // 壁または岩の周囲4マス（隣接歩行可能マス）を候補として探索
    const standCandidates: Position[] = [];
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    for (const d of cardDirs) {
      const p = map.wrapPosition(MovementSystem.getNextPosition(targetPos, d));
      if (map.getBaseTile(p) !== 'WALL_STATIC' && map.getObject(p) !== 'BLOCK') {
        standCandidates.push(p);
      }
    }

    if (standCandidates.length === 0) {
      this.nav.markTargetUnreachable(targetPos, 30);
      snapshot.memory.markTargetUnreachable(targetPos, 30, snapshot.totalTurns);
      const wander = this.nav.wanderSafe(player, map, enemies, dragon);
      return {
        action: this.resolveMoveOrBreak(wander, player, map),
        description: `⚠️ ショートカット隣接マスが存在しないため安全徘徊 (${targetPos.x}, ${targetPos.y})`,
        status: 'PATH_BLOCKED',
      };
    }

    // プレイヤーから最も近い隣接マスへ向かう
    standCandidates.sort((a, b) => {
      const da = map.getTorusDistance(player.pos, a).manhattan;
      const db = map.getTorusDistance(player.pos, b).manhattan;
      return da - db;
    });

    const canBreak = snapshot.milestones.canBreak;
    for (const standPos of standCandidates) {
      const dir = this.nav.findPath(player.pos, standPos, map, player, enemies, { ...params, allowBreakAsRoad: canBreak }, { dragon });
      if (dir) {
        const distToStand = map.getTorusDistance(player.pos, standPos).manhattan;
        return {
          action: this.resolveMoveOrBreak({ type: 'MOVE', dir }, player, map),
          description: `⛏️ ショートカット開削位置へ接近 (${standPos.x}, ${standPos.y}) [距離:${distToStand}]: ${directive.reason}`,
          status: 'SUCCESS',
        };
      }
    }

    // どの隣接マスへの経路も見つからない場合: 到達不能マーク
    this.nav.markTargetUnreachable(targetPos, 20);
    snapshot.memory.markTargetUnreachable(targetPos, 20, snapshot.totalTurns);
    const wander = this.nav.wanderSafe(player, map, enemies, dragon);
    return {
      action: this.resolveMoveOrBreak(wander, player, map),
      description: `⚠️ ショートカットへの経路遮断のため安全徘徊: ${directive.reason}`,
      status: 'PATH_BLOCKED',
    };
  }

  /**
   * 8歩周期宝箱開錠
   */
  private executeUnlockChest8Step(
    directive: StrategicDirective,
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    params: DynamicBotParameters,
    snapshot: TacticalSnapshot
  ): TacticalExecutionResult {
    const chestPos = directive.targetPos!;
    const curPos = player.pos;
    const isAtChest = curPos.x === chestPos.x && curPos.y === chestPos.y;
    const dist = map.getTorusDistance(curPos, chestPos).manhattan;

    // 1. 宝箱マスにいる場合
    if (isAtChest) {
      const S = player.stepCountSinceStone;
      if (S >= 8 || this.pivotTurns >= 8) {
        this.pivotTurns = 0;
        const note = S === 8 ? '8/8 確定' : `${S}歩`;
        return {
          action: { type: 'SPACE' },
          description: `🔓 宝箱開錠 (${curPos.x}, ${curPos.y}) [${note}]`,
          status: 'SUCCESS',
        };
      }

      // 歩数不足 (S < 8): 隣接安全ピボット移動
      const safePivotDir = this.findAdjacentSafePivot(curPos, map, enemies, dragon, player);
      if (safePivotDir) {
        this.pivotTurns++;
        this.nav.resetPingPong();
        return {
          action: { type: 'MOVE', dir: safePivotDir },
          description: `🚶 8歩周期ピボット移動 [歩数:${S}/8, 試行:${this.pivotTurns}/8]`,
          status: 'SUCCESS',
        };
      }

      // ピボット不可なら即開錠
      this.pivotTurns = 0;
      return {
        action: { type: 'SPACE' },
        description: `🔓 宝箱即座開錠 (${curPos.x}, ${curPos.y})`,
        status: 'SUCCESS',
      };
    }

    // 2. 宝箱に隣接（距離1）の場合
    if (dist === 1) {
      const S = player.stepCountSinceStone;
      if (S === 7) {
        // 次の1歩でちょうど8歩到達！
        const dir = this.nav.getAdjacentDirection(curPos, chestPos, map);
        if (dir) {
          return {
            action: { type: 'MOVE', dir },
            description: `📦 宝箱へ進入 [8歩同期 目前 歩数:7->8]`,
            status: 'SUCCESS',
          };
        }
      }

      if (S < 7) {
        // 歩数稼ぎピボット往復
        const safePivotDir = this.findAdjacentSafePivot(curPos, map, enemies, dragon, player, chestPos);
        if (safePivotDir) {
          this.nav.resetPingPong();
          return {
            action: { type: 'MOVE', dir: safePivotDir },
            description: `🚶 8歩周期調整ピボット往復 [歩数:${S}/8]`,
            status: 'SUCCESS',
          };
        }
      }

      // S >= 8 の場合は躊躇せず宝箱マスへ進入
      const dir = this.nav.getAdjacentDirection(curPos, chestPos, map);
      if (dir) {
        return {
          action: { type: 'MOVE', dir },
          description: `📦 宝箱へ進入 (${chestPos.x}, ${chestPos.y}) [歩数:${S}]`,
          status: 'SUCCESS',
        };
      }
    }

    // 3. 通常ナビゲーション
    return this.executeNavigate(directive, player, map, enemies, dragon, params, snapshot);
  }

  /**
   * 最速宝箱開錠（直行＆即座に開錠、コイン・ポーション回収用）
   */
  private executeUnlockChestRapid(
    directive: StrategicDirective,
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    params: DynamicBotParameters,
    snapshot: TacticalSnapshot
  ): TacticalExecutionResult {
    const chestPos = directive.targetPos!;
    const curPos = player.pos;
    const isAtChest = curPos.x === chestPos.x && curPos.y === chestPos.y;

    // 1. 宝箱マスにいる場合: 即座に開錠！
    if (isAtChest) {
      return {
        action: { type: 'SPACE' },
        description: `🔓 宝箱最速開錠 (${curPos.x}, ${curPos.y})`,
        status: 'SUCCESS',
      };
    }

    // 2. 宝箱に隣接（距離1）の場合: 直ちに宝箱マスへ進入
    const dist = map.getTorusDistance(curPos, chestPos).manhattan;
    if (dist === 1) {
      const dir = this.nav.getAdjacentDirection(curPos, chestPos, map);
      if (dir) {
        return {
          action: { type: 'MOVE', dir },
          description: `📦 宝箱へ進入 (${chestPos.x}, ${chestPos.y})`,
          status: 'SUCCESS',
        };
      }
    }

    // 3. 通常ナビゲーション
    return this.executeNavigate(directive, player, map, enemies, dragon, params, snapshot);
  }

  /**
   * アイテム拾い
   */
  private executePickupItem(
    directive: StrategicDirective,
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    params: DynamicBotParameters,
    snapshot: TacticalSnapshot
  ): TacticalExecutionResult {
    const floorItem = map.getItem(player.pos);
    if (floorItem !== 'NONE' && (!directive.targetItemType || floorItem === directive.targetItemType)) {
      return {
        action: { type: 'SPACE' },
        description: `📦 足元のアイテム取得 [${floorItem}]`,
        status: 'SUCCESS',
      };
    }

    if (directive.targetPos) {
      return this.executeNavigate(directive, player, map, enemies, dragon, params, snapshot);
    }

    return {
      action: { type: 'SPACE' },
      description: '足元アイテム取得',
      status: 'SUCCESS',
    };
  }

  /**
   * 所持品を床に置く
   */
  private executeDropItem(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    _params: DynamicBotParameters
  ): TacticalExecutionResult {
    const curPos = player.pos;
    const isFireLine = dragon && this.nav.isDragonFireLine(curPos, dragon, map);
    const canDropHere = !isFireLine &&
                        map.getItem(curPos) === 'NONE' &&
                        map.getObject(curPos) === 'NONE' &&
                        map.getBaseTile(curPos) !== 'WALL_STATIC' &&
                        map.getBaseTile(curPos) !== 'WARP' &&
                        map.getBaseTile(curPos) !== 'GRAVE';

    if (canDropHere) {
      return {
        action: { type: 'SPACE' },
        description: `📦 所持品を床に置く [${player.holdItem}]`,
        status: 'SUCCESS',
      };
    }

    const safeDir = ItemSwapTactics.findAdjacentDropTile(curPos, map, enemies, dragon, player, this.nav);
    if (safeDir) {
      return {
        action: { type: 'MOVE', dir: safeDir },
        description: `📦 所持品を置くため安全マスへ移動 [${player.holdItem}]`,
        status: 'SUCCESS',
      };
    }

    return {
      action: { type: 'WAIT' },
      description: '所持品を置く安全マスを待機',
      status: 'SUCCESS',
    };
  }

  /**
   * アイテムスワップ開始
   */
  private initiateSwap(
    _directive: StrategicDirective,
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    params: DynamicBotParameters
  ): TacticalExecutionResult {
    if (this.swapState.itemToPickupPos === null) {
      this.swapState.itemToPickupPos = { ...player.pos };
      this.swapState.tempDroppedKeyPos = null;
      this.swapState.swapTurns = 0;
    }

    const swapRes = ItemSwapTactics.execute(player, map, enemies, dragon, this.nav, params, this.swapState);
    if (swapRes) {
      return {
        action: this.resolveMoveOrBreak(swapRes.action, player, map),
        description: swapRes.description,
        status: 'SUCCESS',
      };
    }

    // スワップ不能（隣接空き床不在等）の場合は無効なSPACE連打を防ぐためリセットして安全移動
    this.swapState.itemToPickupPos = null;
    this.swapState.tempDroppedKeyPos = null;
    this.swapState.swapTurns = 0;
    const wander = this.nav.wanderSafe(player, map, enemies, dragon);
    return {
      action: this.resolveMoveOrBreak(wander, player, map),
      description: '⚠️ 鍵一時置きスペース不在のためスワップ中断・安全離脱',
      status: 'PATH_BLOCKED',
    };
  }

  /**
   * 墓封鎖ステップ実行 (ブロック押し等)
   */
  private executeSealGraveStep(
    directive: StrategicDirective,
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    params: DynamicBotParameters,
    snapshot: TacticalSnapshot
  ): TacticalExecutionResult {
    if (directive.pushBlockPos && directive.pushDestPos) {
      const bPos = directive.pushBlockPos;
      const dPos = directive.pushDestPos;
      const pushDir = this.nav.getAdjacentDirection(bPos, dPos, map);

      if (pushDir) {
        // 押すための立ち位置: bPos の反対側
        const oppDir = this.getOppositeDirection(pushDir);
        const standPos = map.wrapPosition(MovementSystem.getNextPosition(bPos, oppDir));

        if (player.pos.x === standPos.x && player.pos.y === standPos.y) {
          // dPos（移動先）が進入可能かチェック
          const dBase = map.getBaseTile(dPos);
          const dObj = map.getObject(dPos);
          if (dBase === 'WALL_STATIC' || dObj === 'BLOCK') {
            snapshot.memory.markTargetUnreachable(bPos, 100, snapshot.totalTurns);
            const wander = this.nav.wanderSafe(player, map, enemies, dragon);
            return {
              action: this.resolveMoveOrBreak(wander, player, map),
              description: `⚠️ ブロックプッシュ先が障害物のため断念 (${dPos.x}, ${dPos.y})`,
              status: 'PATH_BLOCKED',
            };
          }

          // 既に立ち位置にいるなら bPos 方向へ直進して押す！
          return {
            action: { type: 'MOVE', dir: pushDir },
            description: `🪦 墓封鎖ブロックプッシュ実行 -> ${pushDir}`,
            status: 'SUCCESS',
          };
        }

        // 立ち位置へ移動
        const dir = this.nav.findPath(player.pos, standPos, map, player, enemies, params, { dragon });
        if (dir) {
          return {
            action: this.resolveMoveOrBreak({ type: 'MOVE', dir }, player, map),
            description: `🪦 ブロックプッシュ位置へ移動 (${standPos.x}, ${standPos.y})`,
            status: 'SUCCESS',
          };
        }
      }
    }

    return this.executeNavigate(directive, player, map, enemies, dragon, params, snapshot);
  }

  /**
   * 攻撃ターゲットへ向かう (ドラゴン首斜め安全攻撃 / 通常敵攻撃)
   */
  private executeAttack(
    directive: StrategicDirective,
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    params: DynamicBotParameters,
    snapshot: TacticalSnapshot
  ): TacticalExecutionResult {
    const targetPos = directive.targetPos!;

    // 1. 直角隣接または斜め隣接している場合 -> Bump Attack 実行！
    const adj8Dir = this.nav.get8WayAdjacentDirection(player.pos, targetPos, map);
    if (adj8Dir) {
      return {
        action: { type: 'MOVE', dir: adj8Dir },
        description: `⚔️ 隣接・斜め攻撃実行 -> (${targetPos.x}, ${targetPos.y}) [${adj8Dir}]: ${directive.reason}`,
        status: 'SUCCESS',
      };
    }

    // 2. まだ隣接していない場合 -> 火炎射線を完全回避しながら目標へ接近
    const dir = this.nav.findPath(player.pos, targetPos, map, player, enemies, params, { dragon });
    if (dir) {
      return {
        action: this.resolveMoveOrBreak({ type: 'MOVE', dir }, player, map),
        description: `⚔️ 攻撃進軍 -> (${targetPos.x}, ${targetPos.y}): ${directive.reason}`,
        status: 'SUCCESS',
      };
    }

    // 3. 経路が見つからない場合:
    // ※ドラゴン首（dragon.heads）の場合は絶対に unreachable マークしてはならない！
    const isDragonPart = dragon && dragon.heads.some(h => h.pos.x === targetPos.x && h.pos.y === targetPos.y);
    if (!isDragonPart) {
      this.nav.markTargetUnreachable(targetPos, 8);
      snapshot.memory.markTargetUnreachable(targetPos, 8, snapshot.totalTurns);
    }

    return {
      action: this.resolveMoveOrBreak(this.nav.wanderSafe(player, map, enemies, dragon), player, map),
      description: `攻撃経路なし(安全徘徊): ${directive.reason}`,
      status: 'PATH_BLOCKED',
    };
  }

  /**
   * MOVE 先が BLOCK の場合に BREAK/KICK 詠唱へ解決する共通ヘルパー
   */
  public resolveMoveOrBreak(action: BotAction, player: Player, map: WorldMap): BotAction {
    if (action.type !== 'MOVE') return action;

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

  private findAdjacentSafePivot(
    curPos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    _player: Player,
    excludePos?: Position
  ): Direction | null {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    for (const d of cardDirs) {
      const np = map.wrapPosition(MovementSystem.getNextPosition(curPos, d));
      if (excludePos && np.x === excludePos.x && np.y === excludePos.y) continue;
      if (map.getBaseTile(np) === 'WALL_STATIC') continue;
      if (map.getObject(np) === 'BLOCK') continue;
      if (dragon && this.nav.isDragonFireLine(np, dragon, map)) continue;

      const hasEnemy = enemies.some(e => e.isAlive && e.pos.x === np.x && e.pos.y === np.y);
      if (hasEnemy) continue;

      return d;
    }
    return null;
  }

  /**
   * 緊急危機退避実行 (即死敵隣接迎撃、FREEZE/FLASH無力化、回避移動、RETURN帰還)
   */
  private executeEvadeDanger(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon: Dragon | undefined,
    params: DynamicBotParameters,
    snapshot: TacticalSnapshot
  ): TacticalExecutionResult {
    const curPos = player.pos;
    const isPinch = snapshot.threats.isPinchHp;

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

    // 2. 直角隣接の即死級敵が1体のみで、かつ一撃撃破（ONE_SHOT）可能な場合は即座に殴り倒して排除
    if (
      lethalDefenseAdjacent.length === 1 &&
      player.holdItem !== 'CROSS' &&
      ThreatEvaluator.evaluateThreatDetails(player, lethalDefenseAdjacent[0].enemy).attackThreat === 'ONE_SHOT'
    ) {
      return {
        action: { type: 'MOVE', dir: lethalDefenseAdjacent[0].dir },
        description: `⚔️ 緊急迎撃: 即死級敵を一撃排除 (${lethalDefenseAdjacent[0].enemy.name})`,
        status: 'SUCCESS',
      };
    }

    // 3. 王冠所持中に即死敵が隣接
    if (player.holdItem === 'CROWN' && lethalDefenseAdjacent.length > 0) {
      const evadeDir = this.nav.findEvadeDirection(curPos, map, enemies, player, dragon);
      if (evadeDir) {
        return {
          action: { type: 'MOVE', dir: evadeDir },
          description: '👑 王冠運搬中緊急退避',
          status: 'SUCCESS',
        };
      }
      if (player.magic > 0 && !player.hasDeath && map.getItem(curPos) === 'NONE') {
        return {
          action: { type: 'SPACE' },
          description: '👑 魔法自衛のため王冠一時ドロップ',
          status: 'SUCCESS',
        };
      }
    }

    // 4. 直角隣接に未凍結・未スタンの即死敵（LETHAL）がいる場合の迎撃・退避
    if (lethalDefenseAdjacent.length > 0) {
      const evadeDir = this.nav.findEvadeDirection(curPos, map, enemies, player, dragon);
      const canSpendReserve = !player.hasDeath && (player.magic > 1 || (player.experience < 4000 && player.magic > 0) || !evadeDir);

      // 4-A. FREEZE 詠唱で周囲8方向の敵を永久凍結無力化（前線基地近傍では進入路保護のため抑止）
      const isNearEscapeHome = map.getTorusDistance(curPos, map.realHomePos).chebyshev <= 2;
      if (!isNearEscapeHome && canSpendReserve && MagicSystem.canCast(player, 'FREEZE').allowed) {
        return {
          action: { type: 'MAGIC', magic: 'FREEZE' },
          description: `🚨 緊急無力化: FREEZE詠唱 (${lethalDefenseAdjacent[0].enemy.name})`,
          status: 'SUCCESS',
        };
      }

      // 4-B. 岩があれば KICK スナイプで反撃（敵即死排除＋通路開削）
      if (canSpendReserve) {
        const kickAction = TacticalCombat.tryKickSnipe(player, map, enemies, dragon ?? ({} as any));
        if (kickAction) {
          return {
            action: kickAction.action,
            description: kickAction.description,
            status: 'SUCCESS',
          };
        }
      }

      // 4-C. FLASH 詠唱で足止め
      const hasAnyActiveEnemy = enemies.some(e => e.isAlive && !e.isPermanentlyFrozen && e.frozenTimer <= 0);
      if (canSpendReserve && hasAnyActiveEnemy && MagicSystem.canCast(player, 'FLASH').allowed) {
        return {
          action: { type: 'MAGIC', magic: 'FLASH' },
          description: '🚨 緊急足止め: FLASH詠唱',
          status: 'SUCCESS',
        };
      }

      // 4-D. 安全な空床へ回避移動
      if (evadeDir) {
        return {
          action: { type: 'MOVE', dir: evadeDir },
          description: '🚨 緊急退避: 安全マスへ回避移動',
          status: 'SUCCESS',
        };
      }
    }

    // 5. HPピンチ時の帰還・退避（ポーション浪費を防ぐため徒歩帰還・BREAK開削を最優先）
    if (isPinch && player.holdItem !== 'CROWN') {
      const allHomes = map.getAllHomePositions();
      let bestHome = map.realHomePos;
      let minHomeDist = Infinity;
      for (const h of allHomes) {
        const d = map.getTorusDistance(curPos, h).manhattan;
        if (d < minHomeDist) {
          minHomeDist = d;
          bestHome = h;
        }
      }
      const homeDist = minHomeDist;
      const canCastReturn = MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying;
      const dirToHome = this.nav.findPath(curPos, bestHome, map, player, enemies, params, { dragon });

      // 徒歩ルートが遮断されている場合、または極限瀕死（HP <= 15%）時のみRETURN
      const isExtremeDanger = player.hp <= Math.max(1000, player.maxHp * 0.15) || !dirToHome;
      if (canCastReturn && homeDist > 2 && isExtremeDanger) {
        this.nav.clearPositionHistory();
        return {
          action: { type: 'MAGIC', magic: 'RETURN' },
          description: '🚨 絶体絶命のため緊急RETURN全回復帰還',
          status: 'SUCCESS',
        };
      }

      // 徒歩帰還（BREAK習得済みなら道中の岩を壊して最短開削）
      if (dirToHome) {
        return {
          action: this.resolveMoveOrBreak({ type: 'MOVE', dir: dirToHome }, player, map),
          description: `🏠 HPピンチのため我が家へ徒歩帰還 [距離:${homeDist}]`,
          status: 'SUCCESS',
        };
      }
    }

    // 6. デフォルト: 回避移動またはその場待機（無謀な特攻を防止）
    const evadeDir = this.nav.findEvadeDirection(curPos, map, enemies, player, dragon);
    if (evadeDir) {
      return {
        action: { type: 'MOVE', dir: evadeDir },
        description: '🚨 緊急退避: 安全マスへ回避移動',
        status: 'SUCCESS',
      };
    }

    // 周囲に安全な退避先がない場合: RETURN または JUMP、不可なら WAIT で様子見
    if (MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying) {
      this.nav.clearPositionHistory();
      return {
        action: { type: 'MAGIC', magic: 'RETURN' },
        description: '🚨 退避先不在のため緊急RETURN脱出',
        status: 'SUCCESS',
      };
    }
    if (MagicSystem.canCast(player, 'JUMP').allowed) {
      return {
        action: { type: 'MAGIC', magic: 'JUMP' },
        description: '🚨 退避先不在のため緊急JUMP脱出',
        status: 'SUCCESS',
      };
    }

    return {
      action: { type: 'WAIT' },
      description: '🚨 緊急退避: 退避先なしのため待機',
      status: 'STALLED',
    };
  }

  private getOppositeDirection(dir: Direction): Direction {
    switch (dir) {
      case 'UP': return 'DOWN';
      case 'DOWN': return 'UP';
      case 'LEFT': return 'RIGHT';
      case 'RIGHT': return 'LEFT';
      default: return 'UP';
    }
  }
}
