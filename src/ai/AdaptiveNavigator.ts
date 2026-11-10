import { Direction, Position } from '../models/Types.js';
import { WorldMap } from '../models/WorldMap.js';
import { Player } from '../models/Player.js';
import { EnemyInstance } from '../models/Enemy.js';
import { Dragon } from '../models/Dragon.js';
import { Ghost } from '../models/Ghost.js';
import { ThreatEvaluator } from '../systems/ThreatEvaluator.js';
import { MagicSystem } from '../systems/MagicSystem.js';
import { MovementSystem } from '../systems/MovementSystem.js';
import { BotAction, DynamicBotParameters } from './BotTypes.js';
import type { TacticalContext } from './TacticalContext.js';
import type { MapTacticalMetadata } from '../systems/generator/ThemeBlockTypes.js';

export interface PathResult {
  dir: Direction;
  cost: number;
  steps: number;
}

export interface CirclingContext {
  enemy: EnemyInstance;
  obstacleType: 'BLOCK' | 'GRAVE' | 'WALL';
  obstaclePos: Position;
}

/**
 * AdaptiveNavigator
 *
 * トポロジー適応型BFS探索と、一元化されたスタック・ピンポン・周回ループ追跡器。
 * 複数のカウンタやブラックリストを単一の追跡モデルに統合し、
 * 動的パラメータに基づいて最適な安全経路を算出する。
 */
export class AdaptiveNavigator {
  // 1. 直近訪問座標履歴 (ピンポン・周回検知用)
  private recentPositions: Position[] = [];
  private readonly MAX_HISTORY_LEN: number = 32;

  // 1-B. 訪問ヒートマップ (時間減衰型熱量マップ: 座標キー "x,y" => 熱量)
  public heatMap: Map<string, number> = new Map();
  private readonly HEAT_ADD: number = 10.0;
  private readonly HEAT_DECAY: number = 0.85;

  // 1-C. 開拓履歴・新規マス停滞ターン追跡 (物理的詰み検知用)
  private visitedTilesEver: Set<string> = new Set();
  public turnsSinceNewTile: number = 0;
  public consecutiveSwordBlockedTurns: number = 0;
  public consecutiveFarmBlockedTurns: number = 0;

  // 2. 統合振動・停滞カウンタ
  public oscillationCount: number = 0;
  public pingPongCount: number = 0;

  // 3. 到達不能ターゲット・ブラックリスト (座標キー "x,y" => 残り除外ターン数)
  private unreachableTargets: Map<string, number> = new Map();

  // 4. ワープ往復防止タブー
  private recentWarpTiles: { pos: Position; turnsRemaining: number }[] = [];

  // 5. 危険ゾーン退避タイル記憶
  public recentEvadedTile: Position | null = null;
  public recentEvadedTurns: number = 0;

  // 6. 強制安全徘徊フラグ (スタック救出時)
  public forceWanderTurns: number = 0;

  // ==========================================================================
  // 状態追跡 & ターン更新
  // ==========================================================================

  /**
   * 毎ターンの開始時にプレイヤーの現在地を記録し、停滞やピンポンを検知
   */
  public updateTurn(playerPos: Position): void {
    // A. 訪問履歴記録
    this.recentPositions.push({ ...playerPos });
    if (this.recentPositions.length > this.MAX_HISTORY_LEN) {
      this.recentPositions.shift();
    }

    // A-2. 訪問ヒートマップの減衰と現在地への熱量加算
    for (const [key, heat] of this.heatMap.entries()) {
      const decayed = heat * this.HEAT_DECAY;
      if (decayed < 0.2) {
        this.heatMap.delete(key);
      } else {
        this.heatMap.set(key, decayed);
      }
    }
    const curKey = `${playerPos.x},${playerPos.y}`;
    this.heatMap.set(curKey, (this.heatMap.get(curKey) ?? 0) + this.HEAT_ADD);

    // A-3. 新規未踏マス開拓の追跡
    if (this.visitedTilesEver.has(curKey)) {
      this.turnsSinceNewTile++;
    } else {
      this.visitedTilesEver.add(curKey);
      this.turnsSinceNewTile = 0;
    }

    // B. ピンポン往復 (A -> B -> A) および狭小ループの厳格検知
    const rLen = this.recentPositions.length;
    let isPingPong = false;
    let isLooping = false;

    const prev1 = rLen >= 2 ? this.recentPositions[rLen - 2] : null;
    const isStationary = prev1 !== null && playerPos.x === prev1.x && playerPos.y === prev1.y;

    if (!isStationary) {
      if (rLen >= 3) {
        const prev2 = this.recentPositions[rLen - 3];
        if (playerPos.x === prev2.x && playerPos.y === prev2.y) {
          isPingPong = true;
        }
      }

      if (!isPingPong && rLen >= 4) {
        const prev3 = this.recentPositions[rLen - 4];
        if (playerPos.x === prev3.x && playerPos.y === prev3.y) {
          isLooping = true;
        }
      }
    }

    if (isPingPong) {
      this.pingPongCount++;
      this.oscillationCount++;
    } else if (isLooping) {
      this.oscillationCount++;
    } else {
      this.pingPongCount = Math.max(0, this.pingPongCount - 1);
      this.oscillationCount = Math.max(0, this.oscillationCount - 1);
    }

    // C. ブラックリスト・タイマーの減衰
    for (const [key, turns] of this.unreachableTargets.entries()) {
      if (turns <= 1) {
        this.unreachableTargets.delete(key);
      } else {
        this.unreachableTargets.set(key, turns - 1);
      }
    }

    for (let i = this.recentWarpTiles.length - 1; i >= 0; i--) {
      this.recentWarpTiles[i].turnsRemaining--;
      if (this.recentWarpTiles[i].turnsRemaining <= 0) {
        this.recentWarpTiles.splice(i, 1);
      }
    }

    if (this.recentEvadedTurns > 0) {
      this.recentEvadedTurns--;
      if (this.recentEvadedTurns <= 0) {
        this.recentEvadedTile = null;
      }
    }

    if (this.forceWanderTurns > 0) {
      this.forceWanderTurns--;
    }
  }

  // ==========================================================================
  // ブラックリスト＆タブー操作
  // ==========================================================================

  public markTargetUnreachable(pos: Position, turns: number = 30): void {
    this.unreachableTargets.set(`${pos.x},${pos.y}`, turns);
  }

  public isTargetUnreachable(pos: Position): boolean {
    const remaining = this.unreachableTargets.get(`${pos.x},${pos.y}`);
    return remaining !== undefined && remaining > 0;
  }

  public clearUnreachableTargets(): void {
    this.unreachableTargets.clear();
  }

  public recordWarpEvent(fromPos: Position, _toPos: Position): void {
    this.recentWarpTiles.push({ pos: { ...fromPos }, turnsRemaining: 12 });
  }

  public isWarpTaboo(pos: Position): boolean {
    return this.recentWarpTiles.some(w => w.pos.x === pos.x && w.pos.y === pos.y);
  }

  public triggerRescue(turns: number = 4): void {
    this.forceWanderTurns = turns;
    this.oscillationCount = 0;
    this.pingPongCount = 0;
  }

  /**
   * 8歩周期調整や意図的待機によるピンポン誤検知をリセット
   */
  public resetPingPong(): void {
    this.oscillationCount = 0;
    this.pingPongCount = 0;
  }

  // ==========================================================================
  // 訪問ヒートマップ操作 & 周回カルーセル検知
  // ==========================================================================

  /**
   * 指定座標の訪問熱量を取得
   */
  public getHeat(pos: Position): number {
    return this.heatMap.get(`${pos.x},${pos.y}`) ?? 0;
  }

  /**
   * 指定座標の周囲（radius）の総熱量を取得
   */
  public getNeighborhoodHeat(pos: Position, map: WorldMap, radius: number = 1): number {
    let total = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const p = map.wrapPosition({ x: pos.x + dx, y: pos.y + dy });
        total += this.getHeat(p);
      }
    }
    return total;
  }

  /**
   * 訪問ヒートマップと敵・障害物配置に基づくカルーセル（周回ループ）状態の検知
   *
   * 条件:
   * 1. プレイヤー現在地の熱量 >= 12 かつ 周辺8マスの総熱量 >= 35 (同一局所エリアの連続周回)
   * 2. プレイヤーの直角隣接（距離1）に障害物（BLOCK または GRAVE）が存在する
   * 3. その障害物の周囲（距離1〜2以内、かつプレイヤーから距離1〜3）に未凍結の生存敵が存在する
   */
  public detectObstacleCircling(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[]
  ): CirclingContext | null {
    const curPos = player.pos;
    const curHeat = this.getHeat(curPos);
    const neighborhoodHeat = this.getNeighborhoodHeat(curPos, map, 1);

    // 熱量閾値チェック
    if (curHeat < 12 || neighborhoodHeat < 35) {
      return null;
    }

    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

    // 直角隣接する障害物（BLOCK または GRAVE）を探す
    for (const dir of cardDirs) {
      const obsPos = map.wrapPosition(MovementSystem.getNextPosition(curPos, dir));
      const obj = map.getObject(obsPos);
      const isBlock = obj === 'BLOCK';
      const isGrave = obj === 'GRAVE';

      if (!isBlock && !isGrave) continue;

      // その障害物の周囲にいる未凍結・未スタンの生存敵を探す
      for (const enemy of enemies) {
        if (!enemy.isAlive || enemy.isPermanentlyFrozen || enemy.frozenTimer > 0) continue;
        const distFromObs = map.getTorusDistance(obsPos, enemy.pos).manhattan;
        const distFromPlayer = map.getTorusDistance(curPos, enemy.pos).manhattan;

        if (distFromObs <= 2 && distFromPlayer >= 1 && distFromPlayer <= 3) {
          return {
            enemy,
            obstacleType: isBlock ? 'BLOCK' : 'GRAVE',
            obstaclePos: obsPos,
          };
        }
      }
    }

    return null;
  }

  /**
   * 序盤の剣回収前ハマり（物理的詰み）の検知
   *
   * 条件:
   * 1. 剣未所持 (!player.hasSword) かつ BREAK / JUMP / FLY 魔法が使えない
   * 2. マップ上のすべての剣 (SWORD) への経路が到達不能 (findPath === null)
   * 3. 岩を動かす指輪 (RING) も未所持かつ到達可能な RING も存在しない
   * 4. 訪問ヒートマップによる局所熱量飽和 (周辺半径2の総熱量 >= 40 かつ 現在地熱量 >= 12)、
   *    または新規未踏マスへの移動が 35 ターン以上発生していない
   */
  public detectEarlySwordTrap(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    params: DynamicBotParameters,
    dragon?: Dragon
  ): boolean {
    if (player.hasSword) {
      this.consecutiveSwordBlockedTurns = 0;
      return false;
    }
    if (MagicSystem.canCast(player, 'BREAK').allowed) return false;
    if (MagicSystem.canCast(player, 'JUMP').allowed) return false;
    if (MagicSystem.canCast(player, 'FLY').allowed) return false;

    const curPos = player.pos;
    // 剣が足元にあるなら詰みではない
    if (map.getItem(curPos) === 'SWORD') {
      this.consecutiveSwordBlockedTurns = 0;
      return false;
    }

    // 1. 訪問ヒートマップの局所飽和チェック（軽量な事前判定）
    const curHeat = this.getHeat(curPos);
    const neighborhoodHeat = this.getNeighborhoodHeat(curPos, map, 2);
    const isHeatSaturated = curHeat >= 11 && neighborhoodHeat >= 48 && this.turnsSinceNewTile >= 10;
    const isLongStagnant = this.turnsSinceNewTile >= 45 && neighborhoodHeat >= 42;

    if (!isHeatSaturated && !isLongStagnant) {
      return false;
    }

    // 2. マップ上のすべての剣 (SWORD) を列挙（一時ブラックリストを無視して真の到達性を検査）
    const swordPositions: Position[] = [];
    const ringPositions: Position[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        const item = map.getItem(p);
        if (item === 'SWORD') {
          swordPositions.push(p);
        } else if (item === 'RING') {
          ringPositions.push(p);
        }
      }
    }

    // 剣が1本でも到達可能なら詰みではない
    for (const swordPos of swordPositions) {
      const dir = this.findPath(curPos, swordPos, map, player, enemies, params, { dragon });
      if (dir !== null) {
        this.consecutiveSwordBlockedTurns = 0;
        return false;
      }
    }

    // 未所持だが到達可能な指輪 (RING) があり、指輪を持てば剣へ到達できる可能性がある場合は除外
    if (player.holdItem !== 'RING') {
      for (const ringPos of ringPositions) {
        const dirToRing = this.findPath(curPos, ringPos, map, player, enemies, params, { dragon });
        if (dirToRing !== null) {
          const testPlayerWithRing = { ...player, holdItem: 'RING' } as Player;
          const canReachSwordWithRing = swordPositions.some(
            sp => this.findPath(ringPos, sp, map, testPlayerWithRing, enemies, params, { dragon }) !== null
          );
          if (canReachSwordWithRing) {
            this.consecutiveSwordBlockedTurns = 0;
            return false;
          }
        }
      }
    }

    this.consecutiveSwordBlockedTurns++;

    // 3. 静的地形（壁・岩）自体で完全に封鎖されているか確認（敵を除外しても経路がない場合は即時確定）
    const isStaticallySealed = swordPositions.every(
      sp => this.findPath(curPos, sp, map, player, [], params, { dragon }) === null
    );

    if (isStaticallySealed && isHeatSaturated) {
      return true;
    }

    // 敵による封鎖も含め、長期間（新規未踏マスなし55ターン以上）完全にハマっている場合も詰み確定
    if (isLongStagnant && this.consecutiveSwordBlockedTurns >= 15) {
      return true;
    }

    return false;
  }
  /**
   * 訪問ヒートマップ・往復履歴に基づく総合停滞判定
   */
  public isStagnated(player: Player, map: WorldMap): boolean {
    const curHeat = this.getHeat(player.pos);
    const neighborhoodHeat = this.getNeighborhoodHeat(player.pos, map, 1);
    const isHeatHigh = curHeat >= 11 || neighborhoodHeat >= 35;
    const isStuckWithoutNewTile = this.turnsSinceNewTile >= 12;
    const isPingPong = this.pingPongCount >= 2 || this.oscillationCount >= 2;
    return (isHeatHigh && isStuckWithoutNewTile) || isPingPong || neighborhoodHeat >= 45;
  }

  /**
   * 袋小路・敵封鎖による完全拘束・孤立ハマり（Incarceration Trap）の検知
   *
   * 1マスの完全静止だけでなく、2〜3マスを往復・循環して袋小路から出られない閉域ループも確実に検知。
   *
   * 条件:
   * 1. 周辺総熱量が極限飽和 (neighborhoodHeat >= 52.0、2〜3マス往復でも合計は約66.7に収束)
   * 2. 新規マス開拓なしターン数が 18 ターン以上継続
   * 3. 直近 18 ターンの訪問マスが「高々 3 種類以下」（小閉域ループ）
   * 4. 閉域から外部へ抜ける脱出路が、壁または安全に倒せない敵（turnsToKill > 8）で完全に塞がれている
   */
  public detectIncarcerationTrap(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[]
  ): boolean {
    const curPos = player.pos;

    // 1. 周辺総熱量（半径2）の飽和チェック (1〜3マス往復でも20ターン前後で55〜66に収束)
    const neighborhoodHeat = this.getNeighborhoodHeat(curPos, map, 2);
    if (neighborhoodHeat < 52.0) {
      return false;
    }

    // 2. 新規未踏マスの開拓停滞チェック (最低18ターン以上同一局所エリアに滞留)
    if (this.turnsSinceNewTile < 18) {
      return false;
    }

    // 3. 直近の移動履歴が「高々 3 種類以下」の閉域ループかチェック
    const rLen = this.recentPositions.length;
    if (rLen < 18) {
      return false;
    }
    const recentSlice = this.recentPositions.slice(-18);
    const uniquePositions = new Set(recentSlice.map(p => `${p.x},${p.y}`));
    if (uniquePositions.size > 3) {
      return false;
    }

    // 4. 閉域内の各マスから、外部へ安全に脱出できる出口が存在するか検査
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const effectiveDef = Math.floor(player.experience * 1.0);

    for (const posKey of uniquePositions) {
      const [px, py] = posKey.split(',').map(Number);
      const cellPos = { x: px, y: py };

      for (const d of cardDirs) {
        const nextPos = map.wrapPosition(MovementSystem.getNextPosition(cellPos, d));
        const nextKey = `${nextPos.x},${nextPos.y}`;

        // すでに閉域内部のマスであれば、内部移動なので外部脱出路ではない
        if (uniquePositions.has(nextKey)) continue;

        const baseTile = map.getBaseTile(nextPos);
        const objTile = map.getObject(nextPos);

        // 壁や墓（オブジェクトなし）は進入不能
        if (baseTile === 'WALL_STATIC') continue;
        if (baseTile === 'GRAVE' && objTile === 'NONE') continue;

        // 岩（BLOCK）がある場合、BREAK可能なら脱出経路になり得るので除外
        if (objTile === 'BLOCK') {
          if (MagicSystem.canCast(player, 'BREAK').allowed) return false;
          if (player.holdItem === 'RING') {
            const pushDest = map.wrapPosition(MovementSystem.getNextPosition(nextPos, d));
            if (map.isPushDestinationValid(pushDest, enemies)) return false;
          }
          continue;
        }

        // 敵がいるマス
        const enemy = enemies.find(e => e.isAlive && e.pos.x === nextPos.x && e.pos.y === nextPos.y);
        if (enemy) {
          if (player.holdItem === 'CROSS') continue;
          const details = ThreatEvaluator.evaluateThreatDetails(player, enemy);
          // 安全に短手数（8ターン以内）で倒せる敵なら、殴り倒して脱出できるため除外
          if (details.defenseThreat === 'NO_DAMAGE' && details.turnsToKill <= 8) {
            return false;
          }
          continue;
        }

        // 敵も障害物もない空き床が存在する場合：
        // ただし、そのマスが即死敵の直角隣接（進入した瞬間に即死するマス）でないか確認
        const isLethalDeathTrap = enemies.some(e => {
          if (!e.isAlive || e.isPermanentlyFrozen || e.frozenTimer > 0) return false;
          if (map.getTorusDistance(nextPos, e.pos).manhattan !== 1) return false;
          return Math.max(0, e.atk - effectiveDef) >= player.hp;
        });

        // 即死デストラップではない安全な空き床が1つでもあれば、外部へ脱出可能
        if (!isLethalDeathTrap) {
          return false;
        }
      }
    }

    // 閉域内の全マスから外部への脱出路が完全に遮断されている
    return true;
  }

  /**
   * 序盤 RESOURCE_FARM 時の資源遮断・攻撃力不足ハマり（物理的詰み）の検知
   *
   * 条件:
   * 1. 剣所持直後 (player.hasSword && player.strength <= 10)
   * 2. 魔法（BREAK/JUMP/FLY）および指輪（RING）が未所持・使用不能
   * 3. マップ上の全有効資源（宝箱、石、鍵、コイン、指輪）への経路がすべて到達不能 (findPath === null)
   * 4. 安全に撃破可能な敵（被ダメ0 かつ turnsToKill <= 8）がマップ上に存在しない
   * 5. 局所熱量飽和または長期停滞
   */
  public detectEarlyResourceFarmTrap(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    params: DynamicBotParameters,
    dragon?: Dragon
  ): boolean {
    if (!player.hasSword || player.strength > 10) {
      this.consecutiveFarmBlockedTurns = 0;
      return false;
    }
    if (MagicSystem.canCast(player, 'BREAK').allowed) return false;
    if (MagicSystem.canCast(player, 'JUMP').allowed) return false;
    if (MagicSystem.canCast(player, 'FLY').allowed) return false;
    if (player.holdItem === 'RING') return false;

    const curPos = player.pos;

    // 1. 訪問ヒートマップの局所飽和チェック
    const curHeat = this.getHeat(curPos);
    const neighborhoodHeat = this.getNeighborhoodHeat(curPos, map, 2);
    const isHeatSaturated = curHeat >= 11 && neighborhoodHeat >= 45 && this.turnsSinceNewTile >= 10;
    const isLongStagnant = this.turnsSinceNewTile >= 35 && neighborhoodHeat >= 40;

    if (!isHeatSaturated && !isLongStagnant) {
      return false;
    }

    // 2. マップ上の全主要育成資源（宝箱、パワーストーン、鍵、コイン、指輪）を列挙
    const resourcePositions: Position[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (p.x === curPos.x && p.y === curPos.y) continue;
        if (map.getObject(p) === 'CHEST') {
          resourcePositions.push(p);
          continue;
        }
        const item = map.getItem(p);
        if (item === 'POWER_STONE' || item === 'KEY' || item === 'COIN' || item === 'RING') {
          resourcePositions.push(p);
        }
      }
    }

    // 資源が1つでも到達可能なら詰みではない
    for (const resPos of resourcePositions) {
      const dir = this.findPath(curPos, resPos, map, player, enemies, params, { dragon });
      if (dir !== null) {
        this.consecutiveFarmBlockedTurns = 0;
        return false;
      }
    }

    // 安全に撃破可能な敵（被ダメ0 かつ turnsToKill <= 8）が生存していれば、排除して道が開ける可能性があるため除外
    const hasSafeKillableEnemy = enemies.some(e => {
      if (!e.isAlive || e.isPermanentlyFrozen) return false;
      const details = ThreatEvaluator.evaluateThreatDetails(player, e);
      return details.defenseThreat === 'NO_DAMAGE' && details.turnsToKill <= 8;
    });
    if (hasSafeKillableEnemy) {
      this.consecutiveFarmBlockedTurns = 0;
      return false;
    }

    this.consecutiveFarmBlockedTurns++;

    // 静的地形で全資源が完全に封鎖されている場合は即時確定
    const isStaticallySealed = resourcePositions.every(
      rp => this.findPath(curPos, rp, map, player, [], params, { dragon }) === null
    );

    if (isStaticallySealed && isHeatSaturated) {
      return true;
    }

    // 敵による封鎖も含め、12ターン以上連続で全資源が遮断されている場合は詰み確定
    if (isLongStagnant && this.consecutiveFarmBlockedTurns >= 12) {
      return true;
    }

    return false;
  }


  // ==========================================================================
  // トポロジー適応型 BFS 経路探索
  // ==========================================================================

  /**
   * 始点から終点への最適行動方向を探索
   */
  public findPath(
    from: Position,
    to: Position,
    map: WorldMap,
    player: Player,
    enemies: EnemyInstance[],
    params: DynamicBotParameters,
    options?: {
      dragon?: Dragon;
      extraBlocked?: Position[];
      isEscapePhase?: boolean;
      ghosts?: Ghost[];
      context?: TacticalContext;
    }
  ): Direction | null {
    const result = this.executeBfs(from, to, map, player, enemies, params, options);
    return result ? result.dir : null;
  }

  public executeBfs(
    from: Position,
    to: Position,
    map: WorldMap,
    player: Player,
    enemies: EnemyInstance[],
    params: DynamicBotParameters,
    options?: {
      dragon?: Dragon;
      extraBlocked?: Position[];
      isEscapePhase?: boolean;
      ghosts?: Ghost[];
      context?: TacticalContext;
    }
  ): PathResult | null {
    if (!from || !to) return null;
    if (from.x === to.x && from.y === to.y) return null;

    const dragon = options?.dragon;
    const isEscapePhase = options?.isEscapePhase ?? false;
    const ghosts = options?.ghosts;

    // 敵マスの高速判定マップ & 危険ゾーンの事前セット化 (O(1) ルックアップ)
    const enemyTileMap = new Map<string, EnemyInstance>();
    const threatDangerZones = new Set<string>();
    const lethalOrthogonalZones = new Set<string>();
    const lethalAdjacentDiagZones = new Set<string>();
    const lethalChebyshevZones = new Set<string>();
    const effectiveDef = Math.floor(player.experience * 1.0);

    for (const e of enemies) {
      if (!e.isAlive) continue;
      enemyTileMap.set(`${e.pos.x},${e.pos.y}`, e);

      if (!e.isPermanentlyFrozen && e.frozenTimer <= 0) {
        if (to && e.pos.x === to.x && e.pos.y === to.y) continue;

        const rawDmg = Math.max(0, e.atk - effectiveDef);
        const isTwoShotWithCrown = player.holdItem === 'CROWN' && rawDmg >= player.hp * 0.45;
        const isLethal = rawDmg >= player.hp || isTwoShotWithCrown || ThreatEvaluator.evaluateThreat(player, e) === 'LETHAL';
        const cannotDefeat = !isLethal && ThreatEvaluator.evaluateThreatDetails(player, e).turnsToKill > 8;
        const isDangerous = isLethal || cannotDefeat || rawDmg >= player.hp * params.dangerHpRatio || rawDmg >= 10000 || (player.holdItem === 'CROWN' && rawDmg > 0);

        if (isLethal) {
          const cardDeltas = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
          for (const cd of cardDeltas) {
            const p = map.wrapPosition({ x: e.pos.x + cd.dx, y: e.pos.y + cd.dy });
            lethalOrthogonalZones.add(`${p.x},${p.y}`);
          }
          const diagAdjacentDeltas = [
            { dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
          ];
          for (const dd of diagAdjacentDeltas) {
            const p = map.wrapPosition({ x: e.pos.x + dd.dx, y: e.pos.y + dd.dy });
            lethalAdjacentDiagZones.add(`${p.x},${p.y}`);
          }
          // チェビシェフ距離2の外周16マス（敵が1歩動いて直角隣接になりうる危険マス）
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) {
                const p = map.wrapPosition({ x: e.pos.x + dx, y: e.pos.y + dy });
                lethalChebyshevZones.add(`${p.x},${p.y}`);
              }
            }
          }
        }

        if (isDangerous) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const p = map.wrapPosition({ x: e.pos.x + dx, y: e.pos.y + dy });
              threatDangerZones.add(`${p.x},${p.y}`);
            }
          }
        }
      }
    }

    const queue: { pos: Position; firstDir: Direction | null; cost: number; steps: number }[] = [
      { pos: from, firstDir: null, cost: 0, steps: 0 },
    ];
    const visited = new Map<string, number>();
    visited.set(`${from.x},${from.y}`, 0);

    const cardDirs: { dir: Direction; dx: number; dy: number }[] = [
      { dir: 'UP', dx: 0, dy: -1 },
      { dir: 'DOWN', dx: 0, dy: 1 },
      { dir: 'LEFT', dx: -1, dy: 0 },
      { dir: 'RIGHT', dx: 1, dy: 0 },
    ];
    const diagDirs: { dir: Direction; dx: number; dy: number }[] = [
      { dir: 'UP_LEFT', dx: -1, dy: -1 },
      { dir: 'UP_RIGHT', dx: 1, dy: -1 },
      { dir: 'DOWN_LEFT', dx: -1, dy: 1 },
      { dir: 'DOWN_RIGHT', dx: 1, dy: 1 },
    ];

    const allowDiagonal = player.canDiagonal || player.experience >= 12000;
    const dirs = allowDiagonal ? [...cardDirs, ...diagDirs] : cardDirs;

    let stepCount = 0;
    while (queue.length > 0 && stepCount < params.maxBfsSteps) {
      stepCount++;
      const current = queue.shift()!;
      if (current.pos.x === to.x && current.pos.y === to.y) {
        return {
          dir: current.firstDir!,
          cost: current.cost,
          steps: current.steps,
        };
      }

      for (const d of dirs) {
        const nextPos = map.wrapPosition({
          x: current.pos.x + d.dx,
          y: current.pos.y + d.dy,
        });

        if (map.getBaseTile(nextPos) === 'WALL_STATIC') continue;

        if (options?.extraBlocked && options.extraBlocked.some(p => p.x === nextPos.x && p.y === nextPos.y && !(to.x === nextPos.x && to.y === nextPos.y))) {
          continue;
        }

        if (map.getBaseTile(nextPos) === 'GRAVE' && map.getObject(nextPos) === 'NONE') {
          continue;
        }

        let actualNextPos = nextPos;
        const isWarpTile = map.getBaseTile(nextPos) === 'WARP';
        if (isWarpTile && !(nextPos.x === to.x && nextPos.y === to.y)) {
          const warpDest = map.getWarpDestination(nextPos);
          if (warpDest) actualNextPos = warpDest;
        }
        const key = `${actualNextPos.x},${actualNextPos.y}`;

        let stepCost = 1;

        if (isWarpTile && !(nextPos.x === to.x && nextPos.y === to.y)) {
          stepCost += params.warpAvoidanceCost;
          if (this.isWarpTaboo(nextPos) || this.isWarpTaboo(actualNextPos)) {
            stepCost += 500;
          }
        }

        const obj = map.getObject(nextPos);
        if (obj === 'BLOCK') {
          // 墓封鎖ブロックは BREAK による破壊および一般通行から保護（通過不可）
          if (AdaptiveNavigator.isProtectedGraveBlock(nextPos, map, options?.context?.metadata)) {
            continue;
          }

          if (params.allowBreakAsRoad && MagicSystem.canCast(player, 'BREAK').allowed) {
            stepCost = params.breakCostMultiplier;
          } else if (player.holdItem === 'RING') {
            const pushDest = map.wrapPosition({ x: nextPos.x + d.dx, y: nextPos.y + d.dy });
            if (map.isPushDestinationValid(pushDest, enemies)) {
              stepCost = 3;
            } else {
              continue;
            }
          } else {
            continue;
          }
        }

        // ドラゴン部位・ファイアボール・ブレス射線回避
        if (dragon) {
          if (dragon.getPartAt(nextPos)) continue;
          if (dragon.heads.some(h => h.isAlive && map.getTorusDistance(nextPos, h.pos).manhattan === 1)) continue;
          if (dragon.fireballs && dragon.fireballs.length > 0) {
            const willHitFireball = dragon.fireballs.some(fb => {
              if (!fb.isAlive) return false;
              if (fb.pos.x === nextPos.x && fb.pos.y === nextPos.y) return true;
              const nextFb = map.wrapPosition(MovementSystem.getNextPosition(fb.pos, fb.dir));
              return nextFb.x === nextPos.x && nextFb.y === nextPos.y;
            });
            if (willHitFireball) continue;
          }
          // 首の正面至近（2マス以内）は発射と同時に被弾するため完全進入禁止
          if (this.isDragonFireLineClose(nextPos, dragon, map, 2)) continue;

          // それ以外の遠距離射線は完全進入禁止ではなくソフトペナルティ（迂回優先だが横切りを許容）
          if (this.isDragonFireLine(nextPos, dragon, map)) {
            stepCost += 10;
          }
        }

        // 敵マス進入判定
        const enemyOnTile = enemyTileMap.get(key);
        if (enemyOnTile) {
          if (player.holdItem === 'CROSS' || d.dir.includes('_')) continue;
          const threatDetails = ThreatEvaluator.evaluateThreatDetails(player, enemyOnTile);
          const threat = threatDetails.overallThreat;
          const isFrozenEnemy = enemyOnTile.isPermanentlyFrozen || (enemyOnTile.frozenTimer ?? 0) > 0;
          const isHeadingToHome = to && (map.getBaseTile(to) === 'HOME' || (to.x === map.realHomePos.x && to.y === map.realHomePos.y));

          if (player.holdItem === 'CROWN' && threat !== 'ONE_SHOT') {
            // 我が家への帰還進路上、または我が家マスの上にいる凍結敵は反撃ダメージ0のため攻撃突破を特別許可
            if (isFrozenEnemy && isHeadingToHome) {
              stepCost += 10;
            } else {
              continue;
            }
          }
          // 初手で敵を撃破する場合、プレイヤーはその場に留まるため他に即死敵が隣接していたら攻撃不可
          if (current.firstDir === null) {
            const hasOtherLethalAtFrom = enemies.some(e => {
              if (!e.isAlive || e.isPermanentlyFrozen || e.frozenTimer > 0 || e.id === enemyOnTile.id) return false;
              if (map.getTorusDistance(from, e.pos).manhattan !== 1) return false;
              return Math.max(0, e.atk - effectiveDef) >= player.hp;
            });
            if (hasOtherLethalAtFrom) continue;
          }
          if (player.hp < player.maxHp * params.emergencyHpRatio && threat !== 'ONE_SHOT' && !(nextPos.x === to.x && nextPos.y === to.y)) {
            if (!(isFrozenEnemy && isHeadingToHome)) continue;
          }

          // 安全撃破可能敵（被ダメ0 かつ 短手数で撃破可能）の突破判定
          const canBreakthrough = (threatDetails.defenseThreat === 'NO_DAMAGE' && threatDetails.turnsToKill <= 8) || (isFrozenEnemy && isHeadingToHome);

          if (nextPos.x === to.x && nextPos.y === to.y) {
            if (threat !== 'ONE_SHOT' && threat !== 'SAFE' && !canBreakthrough && threatDetails.defenseThreat !== 'NO_DAMAGE') continue;
          } else {
            if (threat !== 'ONE_SHOT' && !canBreakthrough) continue;
          }

          if (canBreakthrough && threat !== 'ONE_SHOT') {
            stepCost += (threatDetails.turnsToKill ?? 1) * 5;
          }
        }

        // 即死敵の周囲（直角隣接および斜め隣接＝周囲8マス）への飛び込み禁止（敵の追尾攻撃による即死を防ぐ）
        const isTargetHome = to && (map.getBaseTile(to) === 'HOME' || (to.x === map.realHomePos.x && to.y === map.realHomePos.y)) && nextPos.x === to.x && nextPos.y === to.y;
        if ((lethalOrthogonalZones.has(key) || lethalAdjacentDiagZones.has(key)) && !enemyTileMap.has(key) && !isTargetHome) {
          continue;
        }

        if (lethalChebyshevZones.has(key) && !enemyTileMap.has(key) && !isTargetHome) {
          stepCost += (player.holdItem === 'CROWN' || isEscapePhase) ? 50000 : 5000;
        }

        if (threatDangerZones.has(key) && !enemyTileMap.has(key) && !(nextPos.x === to.x && nextPos.y === to.y)) {
          stepCost += isEscapePhase ? 1000 : 400;
        }

        // ゴースト接近回避 (脱出時)
        if (ghosts && isEscapePhase) {
          const isNearGhost = ghosts.some(g => {
            if (g.pos.x === nextPos.x && g.pos.y === nextPos.y) return true;
            const predX = (g.pos.x + g.vx + map.width) % map.width;
            const predY = (g.pos.y + g.vy + map.height) % map.height;
            return predX === nextPos.x && predY === nextPos.y;
          });
          if (isNearGhost) stepCost += 5000;
        }

        // 直前マスへの逆戻り抑制:
        // this.recentPositions の末尾 (rLen - 1) は現在地 player.pos
        // 1手前の座標 (rLen - 2) への逆戻りには +100、2手前の座標 (rLen - 3) には +50 のペナルティ
        if (!(nextPos.x === to.x && nextPos.y === to.y) && current.firstDir === null) {
          const rLen = this.recentPositions.length;
          if (rLen >= 2) {
            const prev1 = this.recentPositions[rLen - 2];
            if (nextPos.x === prev1.x && nextPos.y === prev1.y) {
              stepCost += 100;
            }
          }
          if (rLen >= 3) {
            const prev2 = this.recentPositions[rLen - 3];
            if (nextPos.x === prev2.x && nextPos.y === prev2.y) {
              stepCost += 50;
            }
          }
        }

        // 訪問ヒートマップによる反発は最短経路探索を歪めて大回りを引き起こすため、
        // 移動ナビゲーションの findPath では加算せず、停滞・周回検知（認知層）のみで利用する

        const newCost = current.cost + stepCost;
        const prevCost = visited.get(key);
        if (prevCost !== undefined && prevCost <= newCost) continue;

        visited.set(key, newCost);
        const item = {
          pos: actualNextPos,
          firstDir: current.firstDir ?? d.dir,
          cost: newCost,
          steps: current.steps + 1,
        };

        const insertIdx = queue.findIndex(q => q.cost > newCost);
        if (insertIdx === -1) queue.push(item);
        else queue.splice(insertIdx, 0, item);
      }
    }

    return null;
  }

  // ==========================================================================
  // 安全徘徊 & 緊急回避
  // ==========================================================================

  public wanderSafe(
    player: Player,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon?: Dragon
  ): BotAction {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const diagDirs: Direction[] = ['UP_LEFT', 'UP_RIGHT', 'DOWN_LEFT', 'DOWN_RIGHT'];
    const dirs = (player.canDiagonal || player.experience >= 12000) ? [...cardDirs, ...diagDirs] : cardDirs;

    const validMoves: { dir: Direction; penalty: number }[] = [];

    for (const dir of dirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(player.pos, dir));
      if (map.getBaseTile(nextPos) === 'WALL_STATIC') continue;
      if (map.getBaseTile(nextPos) === 'GRAVE' && map.getObject(nextPos) === 'NONE') continue;

      const isBlock = map.getObject(nextPos) === 'BLOCK';
      const canBreak = MagicSystem.canCast(player, 'BREAK').allowed;
      if (isBlock && !canBreak) continue;

      if (dragon) {
        if (dragon.getPartAt(nextPos)) continue;
        if (dragon.heads.some(h => h.isAlive && map.getTorusDistance(nextPos, h.pos).manhattan === 1)) continue;
        if (this.isDragonFireLineClose(nextPos, dragon, map, 2)) continue;
        if (dragon.fireballs && dragon.fireballs.length > 0) {
          const willHit = dragon.fireballs.some(fb => {
            if (!fb.isAlive) return false;
            if (fb.pos.x === nextPos.x && fb.pos.y === nextPos.y) return true;
            const nextFb = map.wrapPosition(MovementSystem.getNextPosition(fb.pos, fb.dir));
            return nextFb.x === nextPos.x && nextFb.y === nextPos.y;
          });
          if (willHit) continue;
        }
      }

      const enemy = enemies.find(e => e.isAlive && e.pos.x === nextPos.x && e.pos.y === nextPos.y);
      if (enemy) {
        if (dir.includes('_')) continue;
        if (ThreatEvaluator.evaluateThreat(player, enemy) !== 'ONE_SHOT') continue;
      }

      // 即死敵の直角隣接マスへの飛び込み禁止（スタン・永久凍結中は行動不能のため除外）
      const hasAdjacentLethalEnemy = enemies.some(e => {
        if (!e.isAlive || e.isPermanentlyFrozen || e.frozenTimer > 0) return false;
        const d = map.getTorusDistance(nextPos, e.pos).manhattan;
        if (d !== 1) return false;
        const rawDmg = Math.max(0, e.atk - player.experience);
        return rawDmg >= player.hp || ThreatEvaluator.evaluateThreat(player, e) === 'LETHAL';
      });
      if (hasAdjacentLethalEnemy) continue;

      let penalty = 0;
      if (isBlock) penalty += 30;
      if (dragon && this.isDragonFireLine(nextPos, dragon, map)) penalty += 80;

      // 直近訪問履歴に対する段階的再訪ペナルティ
      // this.recentPositions の末尾 (length - 1) は現在地 player.pos
      const rLen = this.recentPositions.length;
      if (rLen >= 2) {
        // 1ターン前 (直前マス): 180度Uターン・往復を強力に抑止
        const p1 = this.recentPositions[rLen - 2];
        if (p1.x === nextPos.x && p1.y === nextPos.y) {
          penalty += 140;
        }
      }
      if (rLen >= 3) {
        // 2ターン前
        const p2 = this.recentPositions[rLen - 3];
        if (p2.x === nextPos.x && p2.y === nextPos.y) {
          penalty += 70;
        }
      }
      if (rLen >= 4) {
        // 3ターン前
        const p3 = this.recentPositions[rLen - 4];
        if (p3.x === nextPos.x && p3.y === nextPos.y) {
          penalty += 35;
        }
      }
      if (rLen >= 5) {
        // 4ターン前
        const p4 = this.recentPositions[rLen - 5];
        if (p4.x === nextPos.x && p4.y === nextPos.y) {
          penalty += 15;
        }
      }

      // 現在の進行方向と真逆（180度反転）へのUターン抑止ペナルティ
      if (player.dir && this.isOppositeDirection(player.dir, dir)) {
        penalty += 50;
      }

      if (this.recentEvadedTile && nextPos.x === this.recentEvadedTile.x && nextPos.y === this.recentEvadedTile.y) {
        penalty += 100;
      }

      if (map.getBaseTile(nextPos) === 'WARP') {
        penalty += 80;
        if (this.isWarpTaboo(nextPos)) penalty += 300;
      }

      if (dir === player.dir) penalty -= 2; // 直進バイアス

      validMoves.push({ dir, penalty });
    }

    if (validMoves.length === 0) {
      if (MagicSystem.canCast(player, 'RETURN').allowed && !player.isFlying) {
        return { type: 'MAGIC', magic: 'RETURN' };
      }
      if (MagicSystem.canCast(player, 'JUMP').allowed) {
        return { type: 'MAGIC', magic: 'JUMP' };
      }
      if (MagicSystem.canCast(player, 'FREEZE').allowed) {
        return { type: 'MAGIC', magic: 'FREEZE' };
      }
      return { type: 'WAIT' };
    }

    validMoves.sort((a, b) => a.penalty - b.penalty);
    return { type: 'MOVE', dir: validMoves[0].dir };
  }

  public findEvadeDirection(
    pos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    player: Player,
    dragon?: Dragon
  ): Direction | null {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const diagDirs: Direction[] = ['UP_LEFT', 'UP_RIGHT', 'DOWN_LEFT', 'DOWN_RIGHT'];
    const dirs = (player.canDiagonal || player.experience >= 12000) ? [...cardDirs, ...diagDirs] : cardDirs;

    const candidates: { dir: Direction; penalty: number }[] = [];

    for (const dir of dirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(pos, dir));
      if (map.getBaseTile(nextPos) === 'WALL_STATIC') continue;
      if (map.getObject(nextPos) !== 'NONE') continue;
      if (map.getBaseTile(nextPos) === 'GRAVE') continue;

      // 敵がいるマスは退避先にならない（体当たり攻撃になってその場に留まるため）
      const enemyOnTile = enemies.find(e => e.isAlive && e.pos.x === nextPos.x && e.pos.y === nextPos.y);
      if (enemyOnTile) continue;

      if (dragon) {
        if (dragon.getPartAt(nextPos)) continue;
        if (this.isDragonFireLineClose(nextPos, dragon, map, 2)) continue;
        if (dragon.fireballs && dragon.fireballs.length > 0) {
          const willHit = dragon.fireballs.some(fb => {
            if (!fb.isAlive) return false;
            if (fb.pos.x === nextPos.x && fb.pos.y === nextPos.y) return true;
            const nextFb = map.wrapPosition(MovementSystem.getNextPosition(fb.pos, fb.dir));
            return nextFb.x === nextPos.x && nextFb.y === nextPos.y;
          });
          if (willHit) continue;
        }
      }

      // 我が家（指輪非所持時）は絶対安全地帯なので最優先退避先
      if (map.getBaseTile(nextPos) === 'HOME' && player.holdItem !== 'RING') {
        return dir;
      }

      const effectiveDef = Math.floor(player.experience * 1.0);
      let hasLethalOrthogonal = false;
      let enemyPenalty = 0;

      for (const e of enemies) {
        if (!e.isAlive || e.isPermanentlyFrozen || e.frozenTimer > 0) continue;
        const dist = map.getTorusDistance(nextPos, e.pos);
        if (dist.chebyshev > 1) continue;
        const rawDmg = Math.max(0, e.atk - effectiveDef);
        const isTwoShotWithCrown = player.holdItem === 'CROWN' && rawDmg >= player.hp * 0.45;
        const isLethal = rawDmg >= player.hp || isTwoShotWithCrown || ThreatEvaluator.evaluateThreat(player, e) === 'LETHAL';

        if (dist.manhattan === 1) {
          if (isLethal) {
            hasLethalOrthogonal = true;
            break;
          }
          enemyPenalty += rawDmg > 0 ? 500 : 50;
        } else if (dist.chebyshev === 1 && isLethal) {
          enemyPenalty += 350;
        }
      }
      if (hasLethalOrthogonal) continue;
      if (dragon && this.isDragonFireLine(nextPos, dragon, map)) enemyPenalty += 60;

      let penalty = enemyPenalty;
      if (player.holdItem === 'CROWN') {
        penalty += map.getTorusDistance(nextPos, map.realHomePos).manhattan * 3;
      }
      // 直前マスへの逆戻り（ピンポン）抑止
      const rLen = this.recentPositions.length;
      if (rLen >= 2) {
        const lastP = this.recentPositions[rLen - 2];
        if (nextPos.x === lastP.x && nextPos.y === lastP.y) {
          penalty += 200;
        }
      }
      if (rLen >= 3) {
        const p2 = this.recentPositions[rLen - 3];
        if (nextPos.x === p2.x && nextPos.y === p2.y) {
          penalty += 100;
        }
      }

      candidates.push({ dir, penalty });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.penalty - b.penalty);
    return candidates[0].dir;
  }

  public isDragonFireLine(pos: Position, dragon: Dragon, map: WorldMap): boolean {
    if (!dragon || !dragon.heads) return false;
    for (const head of dragon.heads) {
      if (!head.isAlive) continue;
      if (dragon.canHeadSeePlayer(head, pos, map)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 首の正面射線のうち、至近距離（maxRangeマス以内）にあるか判定（発射即被弾の危険ゾーン）
   */
  public isDragonFireLineClose(pos: Position, dragon: Dragon, map: WorldMap, maxRange: number = 2): boolean {
    if (!dragon || !dragon.heads) return false;
    for (const head of dragon.heads) {
      if (!head.isAlive) continue;
      const d = map.getTorusDistance(pos, head.pos).manhattan;
      if (d <= maxRange && dragon.canHeadSeePlayer(head, pos, map)) {
        return true;
      }
    }
    return false;
  }

  public isOppositeDirection(d1: Direction, d2: Direction): boolean {
    if ((d1 === 'UP' && d2 === 'DOWN') || (d1 === 'DOWN' && d2 === 'UP')) return true;
    if ((d1 === 'LEFT' && d2 === 'RIGHT') || (d1 === 'RIGHT' && d2 === 'LEFT')) return true;
    if ((d1 === 'UP_LEFT' && d2 === 'DOWN_RIGHT') || (d1 === 'DOWN_RIGHT' && d2 === 'UP_LEFT')) return true;
    if ((d1 === 'UP_RIGHT' && d2 === 'DOWN_LEFT') || (d1 === 'DOWN_LEFT' && d2 === 'UP_RIGHT')) return true;
    return false;
  }

  /**
   * 指定アイテムの距離順上位候補を取得（ヒステリシスボーナス対応）
   */
  public findNearestItemCandidates(
    from: Position,
    itemType: string,
    map: WorldMap,
    enemies?: EnemyInstance[],
    player?: Player,
    limit: number = 8,
    lockedPos?: Position | null
  ): Position[] {
    const candidates: { pos: Position; score: number }[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (this.isTargetUnreachable(p)) continue;
        if (map.getItem(p) === itemType) {
          if (enemies && player) {
            const enemy = enemies.find(e => e.isAlive && e.pos.x === x && e.pos.y === y);
            if (enemy) {
              const threat = ThreatEvaluator.evaluateThreat(player, enemy);
              if (threat !== 'ONE_SHOT' && threat !== 'SAFE') continue;
            }
          }
          const dist = map.getTorusDistance(from, p).manhattan;
          let score = dist;
          if (lockedPos && lockedPos.x === x && lockedPos.y === y) {
            score = Math.max(0, dist - 20); // 強力なヒステリシスボーナス（渦巻き通路での浮気・ループ防止）
          }
          candidates.push({ pos: p, score });
        }
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates.slice(0, limit).map(c => c.pos);
  }

  /**
   * 宝箱の距離順上位候補を取得（最適ゾーンボーナス＆ヒステリシス対応）
   */
  public findNearestChestCandidates(
    from: Position,
    map: WorldMap,
    context?: TacticalContext,
    enemies?: EnemyInstance[],
    player?: Player,
    limit: number = 8,
    lockedPos?: Position | null
  ): Position[] {
    const candidates: { pos: Position; score: number }[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const p = { x, y };
        if (this.isTargetUnreachable(p)) continue;
        if (map.getObject(p) === 'CHEST') {
          if (enemies && player) {
            const enemy = enemies.find(e => e.isAlive && e.pos.x === x && e.pos.y === y);
            if (enemy) {
              const threat = ThreatEvaluator.evaluateThreat(player, enemy);
              if (threat !== 'ONE_SHOT' && threat !== 'SAFE') continue;
            }
          }
          const dist = map.getTorusDistance(from, p).manhattan;
          let score = dist;
          if (context && context.isInOptimalTreasureZone(p)) {
            score = Math.max(0, score - 6);
          }
          if (lockedPos && lockedPos.x === x && lockedPos.y === y) {
            score = Math.max(0, score - 20); // 強力なヒステリシスボーナス（渦巻き通路での浮気・ループ防止）
          }
          candidates.push({ pos: p, score });
        }
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates.slice(0, limit).map(c => c.pos);
  }

  public clearPositionHistory(): void {
    this.recentPositions = [];
    this.heatMap.clear();
    this.turnsSinceNewTile = 0;
    this.oscillationCount = 0;
    this.pingPongCount = 0;
    this.forceWanderTurns = 0;
  }

  public getAdjacentDirection(from: Position, to: Position, map: WorldMap): Direction | null {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    for (const dir of cardDirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(from, dir));
      if (nextPos.x === to.x && nextPos.y === to.y) {
        return dir;
      }
    }
    return null;
  }

  public get8WayAdjacentDirection(from: Position, to: Position, map: WorldMap): Direction | null {
    const allDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT', 'UP_LEFT', 'UP_RIGHT', 'DOWN_LEFT', 'DOWN_RIGHT'];
    for (const dir of allDirs) {
      const nextPos = map.wrapPosition(MovementSystem.getNextPosition(from, dir));
      if (nextPos.x === to.x && nextPos.y === to.y) {
        return dir;
      }
    }
    return null;
  }

  public getAdjacentEnemies(
    pos: Position,
    enemies: EnemyInstance[],
    map: WorldMap
  ): { enemy: EnemyInstance; dir: Direction }[] {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    const results: { enemy: EnemyInstance; dir: Direction }[] = [];
    for (const d of cardDirs) {
      const nextP = map.wrapPosition(MovementSystem.getNextPosition(pos, d));
      const e = enemies.find(enemy => enemy.isAlive && enemy.pos.x === nextP.x && enemy.pos.y === nextP.y);
      if (e) {
        results.push({ enemy: e, dir: d });
      }
    }
    return results;
  }

  /**
   * 墓封鎖用ブロック（墓周囲8マス、またはメタデータの封鎖ターゲット／推奨岩押しブロック）か判定
   */
  public static isProtectedGraveBlock(
    pos: Position,
    map: WorldMap,
    metadata?: MapTacticalMetadata
  ): boolean {
    if (map.getObject(pos) !== 'BLOCK') {
      return false;
    }

    // 1. 墓（GRAVE）の周囲8マス判定 (トーラス循環考慮)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const neighbor = map.wrapPosition({ x: pos.x + dx, y: pos.y + dy });
        if (map.getBaseTile(neighbor) === 'GRAVE') {
          return true;
        }
      }
    }

    // 2. メタデータ (gravePuzzleHints) による保護判定
    const hints = metadata?.gravePuzzleHints ?? map.tacticalMetadata?.gravePuzzleHints;
    if (hints && hints.length > 0) {
      for (const hint of hints) {
        if (hint.sealTargetPositions) {
          for (const target of hint.sealTargetPositions) {
            if (pos.x === target.x && pos.y === target.y) {
              return true;
            }
          }
        }
        if (hint.recommendedPushes) {
          for (const push of hint.recommendedPushes) {
            if (
              (pos.x === push.blockPos.x && pos.y === push.blockPos.y) ||
              (pos.x === push.destinationPos.x && pos.y === push.destinationPos.y)
            ) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * 手持ちアイテムを安全に置くための隣接空きマスを探す
   */
  public findAdjacentDropTile(
    pos: Position,
    map: WorldMap,
    enemies: EnemyInstance[],
    dragon?: Dragon,
    player?: Player
  ): Direction | null {
    const cardDirs: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    for (const d of cardDirs) {
      const p = map.wrapPosition(MovementSystem.getNextPosition(pos, d));
      if (map.getBaseTile(p) === 'WALL_STATIC') continue;
      if (map.getBaseTile(p) === 'GRAVE') continue;
      if (map.getBaseTile(p) === 'WARP') continue;
      if (map.getBaseTile(p) === 'HOME') continue;
      if (map.getObject(p) !== 'NONE') continue;
      if (map.getItem(p) !== 'NONE') continue;
      if (dragon && (dragon.getPartAt(p) || this.isDragonFireLine(p, dragon, map))) continue;

      const onEnemy = enemies.find(e => e.isAlive && e.pos.x === p.x && e.pos.y === p.y);
      if (onEnemy) continue;

      if (player) {
        const dangerousAdj = enemies.some(e => {
          if (!e.isAlive || e.isPermanentlyFrozen || e.frozenTimer > 0) return false;
          if (map.getTorusDistance(p, e.pos).chebyshev > 1) return false;
          const threat = ThreatEvaluator.evaluateThreat(player, e);
          return threat === 'LETHAL' || threat === 'DANGER';
        });
        if (dangerousAdj) continue;
      }

      return d;
    }
    return null;
  }
}
