import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { AdaptiveNavigator } from '../../AdaptiveNavigator.js';
import { OpportunisticEvaluator } from './OpportunisticEvaluator.js';
import { TacticalStallResolver } from './TacticalStallResolver.js';
import { IStrategicMission } from '../StrategicMission.js';

/**
 * DirectiveArbiter (戦略指令調停器)
 *
 * 主作戦ディレクティブ、戦術膠着打開ディレクティブ、および並行基本行動ディレクティブを
 * 優先度（priority）と緊急度・逸脱コストに基づいて調停し、
 * 戦術層がそのまま実行可能な単一の StrategicDirective を決定する。
 */
export class DirectiveArbiter {
  public static arbitrate(
    rawDirective: StrategicDirective,
    snapshot: TacticalSnapshot,
    engine: GameEngine,
    activeMission: IStrategicMission | null,
    nav?: AdaptiveNavigator
  ): StrategicDirective {
    // 0. 目標への進路遮断検知時: 当該目標を一時到達不能マークし、停滞ミッションをアボート
    if (snapshot.stagnation?.isGoalBlocked && rawDirective.targetPos) {
      snapshot.memory.markTargetUnreachable(rawDirective.targetPos, 45, snapshot.totalTurns);
      if (nav) {
        nav.markTargetUnreachable(rawDirective.targetPos, 45);
      }
      if (activeMission && activeMission.id !== 'EMERGENCY_EVACUATE' && activeMission.id !== 'CROWN_ESCAPE') {
        activeMission.status = 'ABORTED';
      }
    }

    // 0-B. 袋小路拘束・孤立ハマりの能動脱出判定（最優先打開: priority 97〜99）
    if (nav) {
      const incarcerationDirective = TacticalStallResolver.resolveIncarceration(snapshot, engine, nav);
      if (incarcerationDirective) {
        return incarcerationDirective;
      }
    }

    // 1. 周回ループ（カルーセル膠着）の能動打開判定（priority 94〜96）
    // 王冠脱出やドラゴン決戦のクライマックス以外で評価
    if (nav && activeMission?.id !== 'CROWN_ESCAPE' && activeMission?.id !== 'SLAY_DRAGON') {
      const circlingDirective = TacticalStallResolver.resolveCirclingLoop(snapshot, engine, nav);
      if (circlingDirective) {
        return circlingDirective;
      }
    }

    // 2. 調停をスキップすべきクリティカル状況
    if (
      activeMission?.id === 'EMERGENCY_EVACUATE' ||
      activeMission?.id === 'CROWN_ESCAPE' ||
      activeMission?.id === 'SLAY_DRAGON' ||
      snapshot.threats.isLethalDanger ||
      rawDirective.type === 'UNLOCK_CHEST_8STEP' ||
      rawDirective.type === 'SWAP_KEY_FOR_ITEM' ||
      rawDirective.type === 'SEAL_GRAVE_STEP' ||
      rawDirective.type === 'CAST_MAGIC' ||
      rawDirective.type === 'EVADE_DANGER'
    ) {
      return rawDirective;
    }

    // 3. 並行基本行動（Opportunistic Behaviors）の評価
    const candidates: StrategicDirective[] = [];

    // 並行行動 1: 動線上のついで拾い (手ぶら時のみ)
    const pickupDirective = OpportunisticEvaluator.evaluatePickup(snapshot, engine, rawDirective);
    if (pickupDirective) {
      candidates.push(pickupDirective);
    }

    // 並行行動 2: 動線上の安全敵ワンパン (剣所持時のみ)
    const combatDirective = OpportunisticEvaluator.evaluateCombat(snapshot, engine, rawDirective);
    if (combatDirective) {
      candidates.push(combatDirective);
    }

    if (candidates.length === 0) {
      return rawDirective;
    }

    // 最も優先度の高い並行基本行動を選択
    let bestCandidate = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].priority > bestCandidate.priority) {
        bestCandidate = candidates[i];
      }
    }

    // 主作戦ディレクティブと優先度比較
    if (bestCandidate.priority > rawDirective.priority) {
      return bestCandidate;
    }

    return rawDirective;
  }
}
