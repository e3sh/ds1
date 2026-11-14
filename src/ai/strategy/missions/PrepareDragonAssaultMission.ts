import { GameEngine } from '../../../core/GameEngine.js';
import { TacticalSnapshot } from '../../perception/TacticalSnapshot.js';
import { MapSituationEvaluator } from '../../perception/MapSituationEvaluator.js';
import { IStrategicMission, MissionStatus } from '../StrategicMission.js';
import { StrategicDirective } from '../StrategicDirective.js';
import { ReadinessEvaluator } from '../evaluators/ReadinessEvaluator.js';

/**
 * PrepareDragonAssaultMission (カテゴリ2: 決戦前リソース備蓄・最終調整作戦)
 *
 * STR達成後、ドラゴン要塞に突撃する前に必要なリソースを計画的に集める：
 * 1. 手持ちコインの一括換金（EXP防御力極大化 ＆ 最大HP超えのオーバーヒール獲得）
 * 2. 決戦・脱出用MPプール（FLASH, RETURN, FREEZE等）のポーション回収・備蓄
 * 3. 不要アイテムの整理
 */
export class PrepareDragonAssaultMission implements IStrategicMission {
  public readonly id = 'PREPARE_DRAGON_ASSAULT';
  public readonly name = '⚔️ 決戦前リソース備蓄・最終調整作戦';
  public readonly maxTurns = 120;
  public turnsElapsed = 0;
  public status: MissionStatus = 'ACTIVE';

  public evaluateStatus(snapshot: TacticalSnapshot, engine: GameEngine): MissionStatus {
    const assessment = ReadinessEvaluator.evaluateDragonReadiness(snapshot, engine, this.turnsElapsed);
    if (assessment.isFullyPrepared) {
      return 'COMPLETED';
    }

    if (this.turnsElapsed >= this.maxTurns) {
      return 'COMPLETED'; // 準備時間超過時は決戦へフォールスルー
    }

    return 'ACTIVE';
  }

  public generateDirective(snapshot: TacticalSnapshot, engine: GameEngine): StrategicDirective {
    const player = engine.getPlayer();
    const map = snapshot.map;

    // 1. 不要アイテム（CROSS, KEY等）の手放し（手ぶらでポーションを拾えるようにする）
    if (player.holdItem !== 'NONE' && player.holdItem !== 'POWER_STONE') {
      return {
        type: 'DROP_HOLD_ITEM',
        priority: 95,
        reason: `決戦準備のため不要アイテム手放し [${player.holdItem}]`,
      };
    }

    // 2. コイン所持中: 我が家で換金＆オーバーヒール
    if (player.gold > 0) {
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: map.realHomePos,
        priority: 92,
        reason: `決戦前コイン換金・EXPオーバーヒールへ帰還 [所持:${player.gold}G]`,
      };
    }

    // 3. 足元にポーションがある場合: 拾う
    if (map.getItem(player.pos) === 'POTION') {
      return {
        type: 'PICKUP_ITEM',
        targetItemType: 'POTION',
        priority: 90,
        reason: '決戦前MP備蓄: 足元のポーションを回収',
      };
    }

    // 4. マップ全域の安全な最寄りポーションを探索して回収 (認知層のマップサマリを参照)
    const potionPos = MapSituationEvaluator.get(snapshot, engine).items.nearestPotion;
    if (potionPos) {
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: potionPos,
        targetItemType: 'POTION',
        priority: 88,
        reason: `決戦前MP備蓄: ポーションへ移動 (${potionPos.x}, ${potionPos.y})`,
      };
    }

    // 5. HP不足時 (HP < 70%): 我が家で全回復
    if (player.hp < player.maxHp * 0.70 && player.hp < 30000) {
      return {
        type: 'NAVIGATE_TO_POSITION',
        targetPos: map.realHomePos,
        priority: 85,
        reason: '決戦前HP全回復のため我が家へ帰還',
      };
    }

    // 準備完了
    return {
      type: 'WANDER_SAFELY',
      priority: 20,
      reason: '決戦突入準備完了',
    };
  }


}
