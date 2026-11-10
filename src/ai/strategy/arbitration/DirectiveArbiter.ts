import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { OpportunisticEvaluator } from './OpportunisticEvaluator.js';
import { TacticalStallResolver } from './TacticalStallResolver.js';
import { IStrategicMission } from '../StrategicMission.js';

/**
 * DirectiveArbiter (戦略指令調停器)
 *
 * 主作戦ディレクティブ、袋小路拘束打開ディレクティブ、および並行基本行動ディレクティブを
 * 優先度（priority）と緊急度・逸脱コストに基づいて調停し、
 * 戦術層がそのまま実行可能な単一の StrategicDirective を決定する。
 */
export class DirectiveArbiter {
  public static arbitrate(
    rawDirective: StrategicDirective,
    snapshot: TacticalSnapshot,
    engine: GameEngine,
    activeMission: IStrategicMission | null
  ): StrategicDirective {
    // 0. 袋小路拘束・孤立ハマりの能動脱出判定（最優先打開: priority 94〜99 / GIVE_UP 100）
    const incarcerationDirective = TacticalStallResolver.resolveIncarceration(snapshot, engine);
    if (incarcerationDirective) {
      return incarcerationDirective;
    }

    // 1. 調停をスキップすべきクリティカル状況
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

    // 2. 並行基本行動（Opportunistic Behaviors）の評価
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
