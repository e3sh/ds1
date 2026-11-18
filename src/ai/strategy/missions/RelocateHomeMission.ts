import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { BaseStrategicMission, MissionAuditProfile, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { Direction, Position } from '../../../models/Types.js';
import { WorldMap } from '../../../models/WorldMap.js';
import { Player } from '../../../models/Player.js';
import { Dragon } from '../../../models/Dragon.js';
import { MovementSystem } from '../../../systems/MovementSystem.js';
import { MagicSystem } from '../../../systems/MagicSystem.js';
import { CostMinHeap } from '../../utils/MinHeap.js';

export interface HomePushStep {
  homeFrom: Position;
  pushDir: Direction;
  homeTo: Position;
  standPos: Position;
}

const CARD_DIRS: readonly { dir: Direction; dx: number; dy: number }[] = [
  { dir: 'UP', dx: 0, dy: -1 },
  { dir: 'DOWN', dx: 0, dy: 1 },
  { dir: 'LEFT', dx: -1, dy: 0 },
  { dir: 'RIGHT', dx: 1, dy: 0 },
];

const ALL_DIRS: readonly { dir: Direction; dx: number; dy: number; isDiag: boolean }[] = [
  { dir: 'UP', dx: 0, dy: -1, isDiag: false },
  { dir: 'DOWN', dx: 0, dy: 1, isDiag: false },
  { dir: 'LEFT', dx: -1, dy: 0, isDiag: false },
  { dir: 'RIGHT', dx: 1, dy: 0, isDiag: false },
  { dir: 'UP_LEFT', dx: -1, dy: -1, isDiag: true },
  { dir: 'UP_RIGHT', dx: 1, dy: -1, isDiag: true },
  { dir: 'DOWN_LEFT', dx: -1, dy: 1, isDiag: true },
  { dir: 'DOWN_RIGHT', dx: 1, dy: 1, isDiag: true },
];

/**
 * RelocateHomeMission (前線基地移転作戦)
 *
 * 1. 家の押出ルートBFS（WALL_STATIC / GRAVE / WARP / 宝箱 / ドラゴン回避、背後回り込み検証付き）
 * 2. ルート開拓フェーズ（CLEARING_PATH: 岩のBREAK破壊、床アイテムの一時回収・退避）
 * 3. 進捗ベースの中断判定（固定45T制限を廃止し、到達不能または連続停滞時のみ中断）
 */
export class RelocateHomeMission extends BaseStrategicMission {
  public readonly id = 'RELOCATE_HOME';
  public readonly name: string;
  /** 安全上の最大上限（実質の打ち切りは到達不能・停滞判定で行う） */
  public readonly maxTurns = 300;
  public override readonly auditProfile: MissionAuditProfile = {
    graceTurns: 60,
    tabooable: true,
    maxEscalation: 'PHASE_WAIVER',
  };
  public override subMode: 'DROPPING_JUNK' | 'FETCHING_RING' | 'CLEARING_PATH' | 'PUSHING_HOME' = 'FETCHING_RING';

  private initialHomePos: Position | null = null;
  private initialHomeDist: number | null = null;
  private lastHomePos: Position | null = null;
  private turnsSinceHomeMove: number = 0;
  private turnsWithoutProgress: number = 0;
  private lastProgressKey: string = '';
  private lastTargetDist: number = Infinity;
  private droppedRingPos: Position | null = null;
  private unreachableDetected: boolean = false;

  private cachedPath: HomePushStep[] | null = null;
  private cachedPathKey: string = '';

  constructor(private readonly anchorPos: Position) {
    super();
    this.name = `⛺ 前線基地移転作戦 (${anchorPos.x}, ${anchorPos.y})`;
  }

  /**
   * spawnHomePos（初期ホーム）から十分離れた安全な2つ目の拠点アンカーを選定する。
   * 実際に家の押出BFSが到達可能な候補の中から最高スコアの地点を返す。
   */
  public static selectBestAnchor(snapshot: TacticalSnapshot, engine: GameEngine): Position | null {
    const map = snapshot.map;
    const player = engine.getPlayer();
    const dragon = engine.getDragon();
    const realHome = map.realHomePos;
    const canBreak = MagicSystem.canCast(player, 'BREAK').allowed || MagicSystem.canCast(player, 'KICK').allowed;

    const candidates = MapSituationEvaluator.findSafeRelocateAnchorCandidates(snapshot, dragon, 15);
    for (const cand of candidates) {
      const path = this.findHomePushPath(realHome, cand, map, player, dragon, canBreak);
      if (path && path.length > 0) {
        return cand;
      }
    }

    return null;
  }

  private static isFireLine(pos: Position, dragon: Dragon, map: WorldMap): boolean {
    for (const head of dragon.heads) {
      if (!head.isAlive) continue;
      if (dragon.canHeadSeePlayer(head, pos, map)) {
        return true;
      }
    }
    return false;
  }

  private ensureInitialized(snapshot: TacticalSnapshot): void {
    const home = snapshot.map.realHomePos;
    if (this.initialHomePos === null) {
      this.initialHomePos = { ...home };
      this.initialHomeDist = snapshot.map.getTorusDistance(home, this.anchorPos).manhattan;
      this.lastHomePos = { ...home };
    }
  }

  private updateProgressTracking(snapshot: TacticalSnapshot, engine: GameEngine): void {
    const map = snapshot.map;
    const player = engine.getPlayer();
    const home = map.realHomePos;
    const path = this.getOrComputePath(snapshot, engine);

    if (this.lastHomePos && (home.x !== this.lastHomePos.x || home.y !== this.lastHomePos.y)) {
      this.turnsSinceHomeMove = 0;
      this.turnsWithoutProgress = 0;
      this.lastHomePos = { ...home };
    } else {
      this.turnsSinceHomeMove++;
    }

    // 現在のサブターゲットと距離を追跡し、実質進展（接近・開拓・RING取得）を判定
    let progressKey = `${home.x},${home.y}|${player.holdItem}`;
    let targetDist = map.getTorusDistance(home, this.anchorPos).manhattan;

    if (path && path.length > 0) {
      const step = path[0];
      const obs = this.findObstacleForStep(step, map);
      if (obs) {
        progressKey += `|OBS:${obs.kind}:${obs.pos.x},${obs.pos.y}`;
        targetDist = map.getTorusDistance(player.pos, obs.pos).manhattan;
      } else if (player.holdItem !== 'RING') {
        const ringPos = this.resolveRingPos(snapshot, engine);
        if (ringPos) {
          progressKey += `|RING:${ringPos.x},${ringPos.y}`;
          targetDist = map.getTorusDistance(player.pos, ringPos).manhattan;
        }
      } else {
        progressKey += `|PUSH:${step.standPos.x},${step.standPos.y}`;
        targetDist = map.getTorusDistance(player.pos, step.standPos).manhattan;
      }
    } else if (player.holdItem !== 'RING') {
      const ringPos = this.resolveRingPos(snapshot, engine);
      if (ringPos) {
        progressKey += `|RING:${ringPos.x},${ringPos.y}`;
        targetDist = map.getTorusDistance(player.pos, ringPos).manhattan;
      }
    }

    if (progressKey !== this.lastProgressKey) {
      this.lastProgressKey = progressKey;
      this.lastTargetDist = targetDist;
      this.turnsWithoutProgress = 0;
    } else if (targetDist < this.lastTargetDist) {
      this.lastTargetDist = targetDist;
      this.turnsWithoutProgress = 0;
    } else {
      this.turnsWithoutProgress++;
    }
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    this.ensureInitialized(snapshot);
    const map = snapshot.map;
    const player = engine.getPlayer();
    const home = map.realHomePos;
    const dist = map.getTorusDistance(home, this.anchorPos).manhattan;

    if (dist <= 1) {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }

    // RING がマップ上にも手持ちにも無い場合
    const hasRing = player.holdItem === 'RING' || this.resolveRingPos(snapshot, engine) !== null;
    if (!hasRing) {
      this.completionReason = 'TARGET_LOST';
      return 'ABORTED';
    }

    this.updateProgressTracking(snapshot, engine);

    const movedFromStart =
      this.initialHomePos !== null &&
      (home.x !== this.initialHomePos.x || home.y !== this.initialHomePos.y);
    const movedCloser = this.initialHomeDist !== null && dist < this.initialHomeDist;
    const hasPartialProgress = movedCloser || movedFromStart;

    // BFSで開拓を含めても到達不能と判明した場合
    const path = this.getOrComputePath(snapshot, engine);
    if (!path || path.length === 0 || this.unreachableDetected) {
      this.completionReason = hasPartialProgress ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }

    // 一定ターン連続で実質進展がない（停滞）場合のみ中断
    if (this.turnsWithoutProgress >= 25 || this.turnsSinceHomeMove >= 60 || this.turnsElapsed >= this.maxTurns) {
      this.completionReason = hasPartialProgress ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  private verifyLocks(snapshot: TacticalSnapshot, engine: GameEngine): void {
    const player = engine.getPlayer();
    const map = snapshot.map;
    this.updateLockProgress(player.pos, map);

    if (this.droppedRingPos && map.getItem(this.droppedRingPos) !== 'RING') {
      this.droppedRingPos = null;
    }

    if (this.lockedTarget) {
      if (
        this.lockedTarget.kind === 'RING' &&
        map.getItem(this.lockedTarget.pos) !== 'RING'
      ) {
        this.clearTargetLock();
      } else if (this.isLockInvalidated(snapshot, 25)) {
        this.clearTargetLock();
      }
    }
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    this.ensureInitialized(snapshot);
    const player = engine.getPlayer();
    const map = snapshot.map;

    this.verifyLocks(snapshot, engine);

    const path = this.getOrComputePath(snapshot, engine);
    if (!path || path.length === 0) {
      this.unreachableDetected = true;
      this.completionReason =
        this.initialHomeDist !== null &&
        map.getTorusDistance(map.realHomePos, this.anchorPos).manhattan < this.initialHomeDist
          ? 'PARTIAL_PROGRESS'
          : 'NO_PROGRESS_BLOCKED';
      this.status = 'ABORTED';
      this.clearTargetLock();
      return {
        type: 'WANDER_SAFELY',
        priority: 10,
        reason: '前線基地移転の押出経路が到達不能のため中断',
      };
    }

    const step = path[0];
    const obstacle = this.findObstacleForStep(step, map);

    // 1. ルート開拓フェーズ (CLEARING_PATH): 押出先・背後立ち位置の BLOCK / 床アイテム排除
    if (obstacle) {
      this.subMode = 'CLEARING_PATH';

      if (obstacle.kind === 'BLOCK') {
        const canBreak =
          MagicSystem.canCast(player, 'BREAK').allowed ||
          MagicSystem.canCast(player, 'KICK').allowed;
        if (!canBreak) {
          this.unreachableDetected = true;
          this.status = 'ABORTED';
          this.completionReason = 'NO_PROGRESS_BLOCKED';
          return {
            type: 'WANDER_SAFELY',
            priority: 10,
            reason: 'BREAK不可のため岩開拓を中断',
          };
        }

        this.lockTarget('BLOCK', obstacle.pos, snapshot.totalTurns, player.pos, map);
        return {
          type: 'BREACH_SHORTCUT',
          targetPos: obstacle.pos,
          priority: 90,
          reason: `押出ルート上の岩をBREAK破壊開拓 (${obstacle.pos.x}, ${obstacle.pos.y})`,
        };
      }

      // 床アイテムの排除: まず手ぶら（NONE）になってから拾う
      if (player.holdItem !== 'NONE') {
        return this.issueDropOutsidePath(player, map, engine, path, 'ルート開拓（アイテム回収）のため所持品を一時退避');
      }

      this.lockTarget('COIN', obstacle.pos, snapshot.totalTurns, player.pos, map);
      if (player.pos.x === obstacle.pos.x && player.pos.y === obstacle.pos.y) {
        return {
          type: 'PICKUP_ITEM',
          targetItemType: obstacle.itemType,
          priority: 93,
          reason: `押出ルート上の [${obstacle.itemType}] を回収して退かす`,
        };
      }
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: obstacle.pos,
        targetItemType: obstacle.itemType,
        priority: 92,
        reason: `押出ルート上の [${obstacle.itemType}] へ移動 (${obstacle.pos.x}, ${obstacle.pos.y})`,
      };
    }

    // 2. RING 以外の所持品を持っている場合は、ルート外の安全な床に置く
    if (player.holdItem !== 'NONE' && player.holdItem !== 'RING') {
      this.subMode = 'DROPPING_JUNK';
      return this.issueDropOutsidePath(player, map, engine, path, `RING回収準備のため所持品をルート外に置く [${player.holdItem}]`);
    }

    // 3. RING を持っていない場合は回収しに行く
    if (player.holdItem !== 'RING') {
      this.subMode = 'FETCHING_RING';
      const ringPos = this.resolveRingPos(snapshot, engine);
      if (ringPos) {
        this.lockTarget('RING', ringPos, snapshot.totalTurns, player.pos, map);
        if (player.pos.x === ringPos.x && player.pos.y === ringPos.y) {
          this.droppedRingPos = null;
          return {
            type: 'PICKUP_ITEM',
            targetItemType: 'RING',
            priority: 91,
            reason: '足元のRINGを取得',
          };
        }
        return {
          type: 'NAVIGATE_TO_POSITION',
          targetPos: ringPos,
          targetItemType: 'RING',
          priority: 89,
          reason: `RINGへ移動 (${ringPos.x}, ${ringPos.y})`,
        };
      }
      this.completionReason = 'TARGET_LOST';
      this.status = 'ABORTED';
      this.clearTargetLock();
      return {
        type: 'WANDER_SAFELY',
        priority: 10,
        reason: 'RING不在のため前線基地移転を中断',
      };
    }

    // 4. RING 所持かつ直近ステップに障害物なし -> 家を押す
    this.subMode = 'PUSHING_HOME';
    this.lockTarget('HOME', step.standPos, snapshot.totalTurns, player.pos, map, {
      secondaryPos: step.homeFrom,
    });

    return {
      type: 'SEAL_GRAVE_STEP',
      pushBlockPos: step.homeFrom,
      pushDestPos: step.homeTo,
      targetPos: step.standPos,
      priority: 85,
      reason: `我が家を押してアンカー(${this.anchorPos.x}, ${this.anchorPos.y})へ移転 [-> ${step.pushDir}]`,
    };
  }

  private resolveRingPos(snapshot: TacticalSnapshot, engine: GameEngine): Position | null {
    const map = snapshot.map;
    if (this.droppedRingPos && map.getItem(this.droppedRingPos) === 'RING') {
      return this.droppedRingPos;
    }
    if (this.lockedTarget?.kind === 'RING' && map.getItem(this.lockedTarget.pos) === 'RING') {
      return this.lockedTarget.pos;
    }
    return MapSituationEvaluator.get(snapshot, engine).items.nearestRing;
  }

  /**
   * 押出ルート（特に今後の移動先マス）を塞がない安全な空き床へ移動してドロップする
   */
  private issueDropOutsidePath(
    player: Player,
    map: WorldMap,
    engine: GameEngine,
    path: HomePushStep[],
    reason: string
  ): StrategicDirective {
    const reservedSet = new Set<string>();
    const lookahead = Math.min(6, path.length);
    for (let i = 0; i < lookahead; i++) {
      reservedSet.add(`${path[i].homeTo.x},${path[i].homeTo.y}`);
      reservedSet.add(`${path[i].homeFrom.x},${path[i].homeFrom.y}`);
    }

    const dragon = engine.getDragon();
    const isGoodDropTile = (p: Position): boolean => {
      if (reservedSet.has(`${p.x},${p.y}`)) return false;
      if (map.getBaseTile(p) !== 'EMPTY') return false;
      if (map.getObject(p) !== 'NONE') return false;
      if (map.getItem(p) !== 'NONE') return false;
      if (dragon && (dragon.getPartAt(p) || RelocateHomeMission.isFireLine(p, dragon, map))) return false;
      return true;
    };

    if (isGoodDropTile(player.pos)) {
      if (player.holdItem === 'RING') {
        this.droppedRingPos = { ...player.pos };
      }
      return {
        type: 'DROP_HOLD_ITEM',
        priority: 95,
        reason,
      };
    }

    // 周囲の最も近いルート外安全床を探す
    let bestDropPos: Position | null = null;
    let bestDist = Infinity;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const p = map.wrapPosition({ x: player.pos.x + dx, y: player.pos.y + dy });
        if (!isGoodDropTile(p)) continue;
        const d = map.getTorusDistance(player.pos, p).manhattan;
        if (d < bestDist) {
          bestDist = d;
          bestDropPos = p;
        }
      }
    }

    if (bestDropPos) {
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: bestDropPos,
        priority: 94,
        reason: `ルート外へ所持品退避移動 (${bestDropPos.x}, ${bestDropPos.y})`,
      };
    }

    if (player.holdItem === 'RING') {
      this.droppedRingPos = { ...player.pos };
    }
    return {
      type: 'DROP_HOLD_ITEM',
      priority: 95,
      reason,
    };
  }

  private findObstacleForStep(
    step: HomePushStep,
    map: WorldMap
  ): { kind: 'BLOCK' | 'ITEM'; pos: Position; itemType?: string } | null {
    // 1. 押し出し先の岩
    if (map.getObject(step.homeTo) === 'BLOCK') {
      return { kind: 'BLOCK', pos: step.homeTo };
    }
    // 2. 立ち位置の岩
    if (map.getObject(step.standPos) === 'BLOCK') {
      return { kind: 'BLOCK', pos: step.standPos };
    }
    // 3. 押し出し先の床アイテム
    const item = map.getItem(step.homeTo);
    if (item !== 'NONE' && item !== 'DEATH' && item !== 'CROWN') {
      return { kind: 'ITEM', pos: step.homeTo, itemType: item };
    }
    return null;
  }

  private getOrComputePath(snapshot: TacticalSnapshot, engine: GameEngine): HomePushStep[] | null {
    const map = snapshot.map;
    const player = engine.getPlayer();
    const dragon = engine.getDragon();
    const home = map.realHomePos;
    const canBreak = MagicSystem.canCast(player, 'BREAK').allowed || MagicSystem.canCast(player, 'KICK').allowed;

    const key = `${home.x},${home.y}|${this.anchorPos.x},${this.anchorPos.y}|${canBreak}`;
    if (this.cachedPath && this.cachedPathKey === key) {
      // キャッシュされた先頭ステップが依然として有効（静的障害物に変化なし）か確認
      if (this.cachedPath.length > 0) {
        const first = this.cachedPath[0];
        if (
          this.getPushDestCost(first.homeTo, map, home, dragon, canBreak) < Infinity &&
          this.getStandPosCost(first.standPos, map, home, dragon, canBreak) < Infinity
        ) {
          return this.cachedPath;
        }
      }
    }

    const path = RelocateHomeMission.findHomePushPath(home, this.anchorPos, map, player, dragon, canBreak);
    this.cachedPath = path;
    this.cachedPathKey = key;
    return path;
  }

  private getPushDestCost(
    pos: Position,
    map: WorldMap,
    startHome: Position,
    dragon: Dragon | undefined,
    canBreak: boolean
  ): number {
    return RelocateHomeMission.getPushDestCostStatic(pos, map, startHome, dragon, canBreak);
  }

  private getStandPosCost(
    pos: Position,
    map: WorldMap,
    startHome: Position,
    dragon: Dragon | undefined,
    canBreak: boolean
  ): number {
    return RelocateHomeMission.getStandPosCostStatic(pos, map, startHome, dragon, canBreak);
  }

  private static getPushDestCostStatic(
    pos: Position,
    map: WorldMap,
    startHome: Position,
    dragon: Dragon | undefined,
    canBreak: boolean
  ): number {
    const base = map.getBaseTile(pos);
    if (base === 'WALL_STATIC' || base === 'GRAVE' || base === 'WARP') return Infinity;
    if (base === 'HOME' && !(pos.x === startHome.x && pos.y === startHome.y)) return Infinity;
    if (dragon?.getPartAt(pos)) return Infinity;

    const obj = map.getObject(pos);
    if (obj === 'BLOCK') {
      return canBreak ? 6 : Infinity;
    }
    if (obj !== 'NONE') {
      // CHEST, CHEST_DRAGON 等は迂回対象
      return Infinity;
    }

    const item = map.getItem(pos);
    if (item !== 'NONE') {
      if (item === 'DEATH' || item === 'CROWN') return Infinity;
      return 5;
    }

    return 1;
  }

  private static getStandPosCostStatic(
    pos: Position,
    map: WorldMap,
    startHome: Position,
    dragon: Dragon | undefined,
    canBreak: boolean
  ): number {
    const base = map.getBaseTile(pos);
    if (base === 'WALL_STATIC' || base === 'WARP') return Infinity;
    if (base === 'HOME' && !(pos.x === startHome.x && pos.y === startHome.y)) return Infinity;
    if (dragon?.getPartAt(pos)) return Infinity;

    const obj = map.getObject(pos);
    if (base === 'GRAVE' && obj === 'NONE') return Infinity;
    if (obj === 'BLOCK') {
      return canBreak ? 4 : Infinity;
    }
    return 0;
  }

  /**
   * 家の押出ルートBFS (Dijkstra)
   * - WALL_STATIC, GRAVE, WARP, 宝箱, ドラゴン部位を迂回
   * - BLOCK / 床アイテムは開拓コスト付きで通過可能
   * - 最初の1手と各曲がり角でのプレイヤー背後回り込み可否を検証
   */
  public static findHomePushPath(
    startHome: Position,
    anchor: Position,
    map: WorldMap,
    player: Player,
    dragon: Dragon | undefined,
    canBreak: boolean
  ): HomePushStep[] | null {
    const w = map.width;
    const h = map.height;
    const total = w * h;

    const startDist = map.getTorusDistance(startHome, anchor).manhattan;
    if (startDist <= 1) return [];

    const dist = new Float64Array(total).fill(Infinity);
    const parentIdx = new Int32Array(total).fill(-1);
    const parentDirIdx = new Int8Array(total).fill(-1);

    const startIdx = startHome.y * w + startHome.x;
    dist[startIdx] = 0;

    const heap = new CostMinHeap<number>();
    heap.push(startIdx, 0);

    let goalIdx = -1;

    while (heap.length > 0) {
      const curCost = heap.peekCost();
      const curIdx = heap.pop()!;
      if (curCost > dist[curIdx]) continue;

      const cx = curIdx % w;
      const cy = Math.floor(curIdx / w);
      const curPos = { x: cx, y: cy };

      if (map.getTorusDistance(curPos, anchor).manhattan <= 1) {
        goalIdx = curIdx;
        break;
      }

      const prevDirIdx = parentDirIdx[curIdx];

      for (let di = 0; di < CARD_DIRS.length; di++) {
        const d = CARD_DIRS[di];
        const nextHome = map.wrapPosition({ x: cx + d.dx, y: cy + d.dy });
        const destCost = this.getPushDestCostStatic(nextHome, map, startHome, dragon, canBreak);
        if (destCost === Infinity) continue;

        const standPos = map.wrapPosition({ x: cx - d.dx, y: cy - d.dy });
        const standCost = this.getStandPosCostStatic(standPos, map, startHome, dragon, canBreak);
        if (standCost === Infinity) continue;

        // 最初の1手: 現在のプレイヤーが家の背後に回り込めるか検証
        if (curIdx === startIdx) {
          if (!this.canPlayerReach(player.pos, standPos, startHome, map, player, dragon, canBreak, 2000)) {
            continue;
          }
        } else if (prevDirIdx >= 0 && prevDirIdx !== di) {
          // 曲がり角: 直前の立ち位置から次の背後位置へ curHome を通らずに回り込めるか局所検証
          const prevD = CARD_DIRS[prevDirIdx];
          const prevStand = map.wrapPosition({ x: cx - prevD.dx, y: cy - prevD.dy });
          if (!this.canPlayerReach(prevStand, standPos, curPos, map, player, dragon, canBreak, 80)) {
            continue;
          }
        }

        const nextIdx = nextHome.y * w + nextHome.x;
        const turnPenalty = prevDirIdx >= 0 && prevDirIdx !== di ? 0.5 : 0;
        const newCost = curCost + destCost + standCost + turnPenalty;
        if (newCost < dist[nextIdx]) {
          dist[nextIdx] = newCost;
          parentIdx[nextIdx] = curIdx;
          parentDirIdx[nextIdx] = di;
          heap.push(nextIdx, newCost);
        }
      }
    }

    if (goalIdx === -1) return null;

    const steps: HomePushStep[] = [];
    let trace = goalIdx;
    while (trace !== startIdx && trace !== -1) {
      const pIdx = parentIdx[trace];
      const di = parentDirIdx[trace];
      if (pIdx === -1 || di < 0) break;

      const fx = pIdx % w;
      const fy = Math.floor(pIdx / w);
      const tx = trace % w;
      const ty = Math.floor(trace / w);
      const d = CARD_DIRS[di];
      const standPos = map.wrapPosition({ x: fx - d.dx, y: fy - d.dy });

      steps.push({
        homeFrom: { x: fx, y: fy },
        pushDir: d.dir,
        homeTo: { x: tx, y: ty },
        standPos,
      });
      trace = pIdx;
    }

    steps.reverse();
    return steps;
  }

  /**
   * プレイヤーが家（blockedHomePos）を通らずに目標立ち位置へ到達可能かBFS判定
   */
  private static canPlayerReach(
    from: Position,
    to: Position,
    blockedHomePos: Position,
    map: WorldMap,
    player: Player,
    dragon: Dragon | undefined,
    canBreak: boolean,
    maxVisits: number
  ): boolean {
    if (from.x === to.x && from.y === to.y) return true;

    const w = map.width;
    const h = map.height;
    const visited = new Uint8Array(w * h);
    const queue: number[] = [];
    let head = 0;

    const startIdx = from.y * w + from.x;
    const goalIdx = to.y * w + to.x;
    const blockedIdx = blockedHomePos.y * w + blockedHomePos.x;
    const allowDiag = player.canDiagonal || player.experience >= 12000;

    visited[startIdx] = 1;
    queue.push(startIdx);

    while (head < queue.length && head < maxVisits) {
      const curIdx = queue[head++];
      if (curIdx === goalIdx) return true;

      const cx = curIdx % w;
      const cy = Math.floor(curIdx / w);

      for (const d of ALL_DIRS) {
        if (d.isDiag && !allowDiag) continue;
        const nx = (cx + d.dx + w) % w;
        const ny = (cy + d.dy + h) % h;
        const nIdx = ny * w + nx;

        if (visited[nIdx]) continue;
        if (nIdx === blockedIdx) continue;

        const np = { x: nx, y: ny };
        const base = map.getBaseTile(np);
        if (base === 'WALL_STATIC' || base === 'WARP') continue;
        const obj = map.getObject(np);
        if (base === 'GRAVE' && obj === 'NONE') continue;
        if (obj === 'BLOCK' && !canBreak) continue;
        if (dragon?.getPartAt(np)) continue;

        if (nIdx === goalIdx) return true;
        visited[nIdx] = 1;
        queue.push(nIdx);
      }
    }

    return false;
  }
}
