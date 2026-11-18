import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { BaseStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { Position } from '../../../models/Types.js';
import { WorldMap } from '../../../models/WorldMap.js';
import { Dragon } from '../../../models/Dragon.js';
import { Player } from '../../../models/Player.js';

/**
 * SlayDragonMission (ドラゴン討伐決戦作戦)
 *
 * 大・中・小分類ステートマシン：
 * - 中分類 (subMode): DROPPING_ITEM | RETREATING_HEAL | RESUPPLY_MP | ATTACKING_HEAD | APPROACHING_SPOT
 * - 小分類 (lockedTarget): HOME | POTION | DRAGON_HEAD | DRAGON_SPOT
 *
 * 確定した斜め安全攻撃マス（DRAGON_SPOT）をロック維持し、
 * 複数首・複数スポット間での目移り往復を防止する。
 */
export class SlayDragonMission extends BaseStrategicMission {
  public readonly id = 'SLAY_DRAGON';
  public readonly name = '🐉 ドラゴン討伐決戦作戦';
  public readonly maxTurns = 800;
  public override subMode: 'DROPPING_ITEM' | 'RETREATING_HEAL' | 'RESUPPLY_MP' | 'ATTACKING_HEAD' | 'APPROACHING_SPOT' = 'APPROACHING_SPOT';
  public override readonly auditProfile = {
    graceTurns: 48,
    tabooable: true,
    maxEscalation: 'TERMINAL' as const,
  };
  private initialLivingHeads: number | null = null;

  private ensureInitialized(engine: GameEngine): void {
    if (this.initialLivingHeads === null) {
      const dragon = engine.getDragon();
      this.initialLivingHeads = dragon ? dragon.heads.filter(h => h.isAlive).length : 0;
    }
  }

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    this.ensureInitialized(engine);
    const dragon = engine.getDragon();
    if (!dragon || dragon.isAllHeadsDefeated || dragon.heads.every(h => !h.isAlive)) {
      this.completionReason = 'OBJECTIVE_ACHIEVED';
      return 'COMPLETED';
    }

    const livingHeads = dragon.heads.filter(h => h.isAlive);
    const killedAnyHead = this.initialLivingHeads !== null && livingHeads.length < this.initialLivingHeads;

    if (this.turnsElapsed >= this.maxTurns) {
      this.completionReason = killedAnyHead ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_TIMEOUT';
      return 'ABORTED';
    }

    const map = snapshot.map;
    const hasAnyReachableSpot = livingHeads.some(head => {
      const spots = snapshot.spatial.calculateHeadAttackSpots(head, dragon, map);
      return spots.some(spot => !snapshot.memory.isTargetUnreachable(spot, snapshot.totalTurns));
    });
    if (!hasAnyReachableSpot) {
      this.completionReason = killedAnyHead ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
      return 'ABORTED';
    }

    return 'ACTIVE';
  }

  /**
   * Step 1: ロック済みターゲットの完了・有効性確認と状態遷移
   */
  private verifyLocks(
    snapshot: TacticalSnapshot,
    player: Player,
    dragon: Dragon,
    isHpDanger: boolean,
    livingHeadsCount: number
  ): void {
    const map = snapshot.map;
    this.updateLockProgress(player.pos, map);

    if (player.holdItem !== 'NONE') {
      this.clearTargetLock();
      this.subMode = 'DROPPING_ITEM';
      return;
    }

    if (!this.lockedTarget) return;

    switch (this.lockedTarget.kind) {
      case 'HOME': {
        if (!isHpDanger || this.isLockInvalidated(snapshot, 20)) {
          this.clearTargetLock();
        }
        break;
      }
      case 'POTION': {
        if (
          livingHeadsCount !== 1 ||
          player.magic >= 2 ||
          map.getItem(this.lockedTarget.pos) !== 'POTION' ||
          this.isLockInvalidated(snapshot, 15)
        ) {
          this.clearTargetLock();
        }
        break;
      }
      case 'DRAGON_HEAD': {
        const head = dragon.heads.find(h => h.type === this.lockedTarget?.entityId);
        if (!head || !head.isAlive || !this.isDiagonalAdjacent(player.pos, head.pos, map)) {
          this.clearTargetLock();
        }
        break;
      }
      case 'DRAGON_SPOT': {
        const head = dragon.heads.find(h => h.type === this.lockedTarget?.entityId);
        if (!head || !head.isAlive || this.isLockInvalidated(snapshot, 20)) {
          this.clearTargetLock();
          break;
        }
        const validSpots = snapshot.spatial.calculateHeadAttackSpots(head, dragon, map);
        const stillValidSpot = validSpots.some(
          s => s.x === this.lockedTarget!.pos.x && s.y === this.lockedTarget!.pos.y
        );
        if (!stillValidSpot) {
          this.clearTargetLock();
        }
        break;
      }
      default:
        this.clearTargetLock();
        break;
    }
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    this.ensureInitialized(engine);
    const dragon = engine.getDragon();
    const player = engine.getPlayer();
    const map = snapshot.map;

    if (!dragon) {
      return { type: 'WANDER_SAFELY', priority: 10, reason: 'ドラゴン不在' };
    }

    const livingHeads = dragon.heads.filter(h => h.isAlive);
    if (livingHeads.length === 0) {
      return { type: 'WANDER_SAFELY', priority: 10, reason: '全首討伐済み' };
    }

    const isHpDanger = player.hp < player.maxHp * 0.35 && player.hp < 20000;

    // Step 1: 毎ターン先頭での成否・ロック検証
    this.verifyLocks(snapshot, player, dragon, isHpDanger, livingHeads.length);

    // サブステップ 1: 不要アイテムの手放し（手ぶら化）
    if (player.holdItem !== 'NONE') {
      this.subMode = 'DROPPING_ITEM';
      return {
        type: 'DROP_HOLD_ITEM',
        priority: 100,
        reason: `決戦前不要アイテム手放し [${player.holdItem}]`,
      };
    }

    const allHomes = map.getAllHomePositions();
    let bestHome = map.realHomePos;
    let minHomeDist = Infinity;
    for (const h of allHomes) {
      const d = map.getTorusDistance(player.pos, h).manhattan;
      if (d < minHomeDist) {
        minHomeDist = d;
        bestHome = h;
      }
    }

    // サブステップ 2: HP危機時 (HP < 35% かつ HP < 20,000) の一時帰還
    if (isHpDanger) {
      this.subMode = 'RETREATING_HEAL';
      this.lockTarget('HOME', bestHome, snapshot.totalTurns, player.pos, map);
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: bestHome,
        priority: 99,
        reason: `決戦中HP回復のため前線基地(${bestHome.x}, ${bestHome.y})へ一時帰還`,
      };
    }

    // サブステップ 3: 最後の首撃破前の MP 補給 (残存首1体かつ MP < 2)
    if (livingHeads.length === 1 && player.magic < 2) {
      if (map.getItem(player.pos) === 'POTION') {
        this.subMode = 'RESUPPLY_MP';
        return {
          type: 'PICKUP_ITEM',
          targetItemType: 'POTION',
          priority: 96,
          reason: '最終首決戦前のMP補給（足元のポーション取得）',
        };
      }
      const potionTarget =
        this.lockedTarget?.kind === 'POTION'
          ? this.lockedTarget.pos
          : MapSituationEvaluator.get(snapshot, engine).items.nearestPotion;
      if (potionTarget) {
        this.subMode = 'RESUPPLY_MP';
        this.lockTarget('POTION', potionTarget, snapshot.totalTurns, player.pos, map);
        return {
          type: 'NAVIGATE_TO_POSITION',
          targetPos: potionTarget,
          targetItemType: 'POTION',
          priority: 95,
          reason: `最終首決戦前のMP補給ポーションへ移動 (${potionTarget.x}, ${potionTarget.y})`,
        };
      }
    }

    // プレイヤーのSTRで倒せる首（killableHeads）を優先
    const killableHeads = livingHeads.filter(h => player.strength > h.def);
    const candidateHeads = killableHeads.length > 0
      ? killableHeads
      : [livingHeads.slice().sort((a, b) => a.def - b.def)[0]];

    // サブステップ 4: 首の斜め隣接マスにいる場合 -> 斜め攻撃実行！
    for (const head of candidateHeads) {
      if (this.isDiagonalAdjacent(player.pos, head.pos, map)) {
        this.subMode = 'ATTACKING_HEAD';
        this.lockTarget('DRAGON_HEAD', head.pos, snapshot.totalTurns, player.pos, map, {
          entityId: head.type,
        });
        return {
          type: 'ATTACK_TARGET',
          targetPos: head.pos,
          priority: 98,
          reason: `🐉 ドラゴン首(${head.pos.x}, ${head.pos.y})へ斜め攻撃実行！[首DEF:${head.def}]`,
        };
      }
    }

    // サブステップ 5: 斜め安全攻撃可能マス (Attack Spot) への位置取り進軍
    // ロック済みスポットが有効であれば再選定せずそのまま進軍を維持する
    if (this.lockedTarget?.kind === 'DRAGON_SPOT') {
      const lockedHead = livingHeads.find(h => h.type === this.lockedTarget?.entityId);
      if (lockedHead) {
        const d = map.getTorusDistance(player.pos, this.lockedTarget.pos).chebyshev;
        this.subMode = 'APPROACHING_SPOT';
        return {
          type: 'NAVIGATE_TO_POSITION',
          targetPos: this.lockedTarget.pos,
          priority: 90,
          policy: { disallowFreezeNearHome: true },
          reason: `🐉 首(${lockedHead.pos.x}, ${lockedHead.pos.y})の斜め安全位置(${this.lockedTarget.pos.x}, ${this.lockedTarget.pos.y})へ進軍 [距離:${d}]`,
        };
      }
    }

    let bestSpot: Position | null = null;
    let targetHead = null;
    let minDistance = Infinity;

    for (const head of candidateHeads) {
      const attackSpots = snapshot.spatial.calculateHeadAttackSpots(head, dragon, map);
      for (const spot of attackSpots) {
        if (snapshot.memory.isTargetUnreachable(spot, snapshot.totalTurns)) {
          continue;
        }
        const d = map.getTorusDistance(player.pos, spot).chebyshev;
        if (d < minDistance) {
          minDistance = d;
          bestSpot = spot;
          targetHead = head;
        }
      }
    }

    if (bestSpot && targetHead) {
      this.subMode = 'APPROACHING_SPOT';
      this.lockTarget('DRAGON_SPOT', bestSpot, snapshot.totalTurns, player.pos, map, {
        entityId: targetHead.type,
        secondaryPos: targetHead.pos,
      });
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: bestSpot,
        priority: 90,
        policy: { disallowFreezeNearHome: true },
        reason: `🐉 首(${targetHead.pos.x}, ${targetHead.pos.y})の斜め安全位置(${bestSpot.x}, ${bestSpot.y})へ進軍 [距離:${minDistance}]`,
      };
    }

    // 全首が到達不能な場合は作戦をアボートして開削または準備へ回る
    const killedAnyHead = this.initialLivingHeads !== null && livingHeads.length < this.initialLivingHeads;
    this.completionReason = killedAnyHead ? 'PARTIAL_PROGRESS' : 'NO_PROGRESS_BLOCKED';
    this.status = 'ABORTED';
    this.clearTargetLock();
    return {
      type: 'WANDER_SAFELY',
      priority: 10,
      reason: '全ドラゴンの攻撃スポットが到達不能のため決戦を中断し開削・準備へ転進',
    };
  }

  private isDiagonalAdjacent(p1: Position, p2: Position, map: WorldMap): boolean {
    let dx = Math.abs(p1.x - p2.x);
    if (dx > map.width / 2) dx = map.width - dx;
    let dy = Math.abs(p1.y - p2.y);
    if (dy > map.height / 2) dy = map.height - dy;
    return dx === 1 && dy === 1;
  }
}
