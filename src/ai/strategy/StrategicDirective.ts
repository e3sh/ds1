import { Position, MagicType } from '../../models/Types.js';

export type DirectiveType =
  | 'NAVIGATE_TO_POSITION'   // 指定座標へ移動 (最短経路 + 必要時BREAK開削)
  | 'BREACH_SHORTCUT'        // 指定ショートカット位置の壁/岩をBREAK開削
  | 'UNLOCK_CHEST_8STEP'     // 8歩周期に合わせて宝箱を開錠
  | 'PICKUP_ITEM'            // 足元または指定座標のアイテム取得
  | 'DROP_HOLD_ITEM'         // 不要な手持ち品を床に置いて手ぶらになる
  | 'SWAP_KEY_FOR_ITEM'      // 鍵を一時退避して足元の有益アイテムを回収
  | 'SEAL_GRAVE_STEP'        // 墓封鎖の1手 (ブロック押しまたは出口埋め)
  | 'ATTACK_TARGET'          // 指定の敵またはドラゴンヘッドを攻撃
  | 'CAST_MAGIC'             // 魔法詠唱 (RETURN, JUMP, SHIELD 等)
  | 'EVADE_DANGER'           // 危険マスからの緊急離脱
  | 'WANDER_SAFELY'          // 安全徘徊探索
  | 'GIVE_UP';               // 物理的・数学的詰みによる正式ギブアップ

export interface TacticalPolicy {
  /** 我が家進入路の封鎖を防ぐためFREEZEを抑止（FLASH優先） */
  disallowFreezeNearHome?: boolean;
}

export interface StrategicDirective {
  /** 指令種別 */
  type: DirectiveType;
  /** 移動目標または対象座標 */
  targetPos?: Position;
  /** 対象アイテム種別 (例: 'KEY', 'POWER_STONE', 'COIN', 'POTION') */
  targetItemType?: string;
  /** 詠唱すべき魔法 */
  magicToCast?: MagicType;
  /** 押し出し元座標 (SEAL_GRAVE_STEP 用) */
  pushBlockPos?: Position;
  /** 押し出し先座標 (SEAL_GRAVE_STEP 用) */
  pushDestPos?: Position;
  /** 戦略方針ポリシー */
  policy?: TacticalPolicy;
  /** 指令の優先度 (数値が大きいほど優先) */
  priority: number;
  /** デバッグ・テレメトリ用説明 */
  reason: string;
}
