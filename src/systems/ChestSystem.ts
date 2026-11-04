import { Player } from '../models/Player.js';
import { WorldMap } from '../models/WorldMap.js';
import { Ghost } from '../models/Ghost.js';
import { Position, TileType, DungeonTuningParams } from '../models/Types.js';
import { SeedRandom } from '../core/SeedRandom.js';

export type ChestItemType = 'POWER_STONE' | 'COIN' | 'POTION' | 'DEATH' | 'CROSS' | 'RING' | 'KEY' | 'SWORD';

export interface ChestContext {
  map?: WorldMap;
  ghosts?: Ghost[];
  resourceCapConfig?: DungeonTuningParams['resourceCapConfig'];
  rng?: SeedRandom;
}

export interface ChestOpenResult {
  item: ChestItemType;
  playerCanEnter: boolean;
  cappedFallbackFrom?: TileType;
}

export class ChestSystem {
  private static defaultRng: SeedRandom = new SeedRandom();

  public static setDefaultRng(rng: SeedRandom): void {
    this.defaultRng = rng;
  }
  /**
   * テスト・デバッグ用の確定排出オーバーライド
   */
  public static forcedNextItem: ChestItemType | null = null;

  /**
   * ワールド内に存在する非消耗アイテムの総数を集計
   * (床上アイテム + プレイヤー所持 + ゴースト運搬中)
   */
  public static countItemInWorld(
    itemType: 'CROSS' | 'RING' | 'KEY' | 'SWORD',
    map: WorldMap,
    player: Player,
    ghosts?: Ghost[]
  ): number {
    let count = 0;

    // 1. 床上アイテム数
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.getItem({ x, y }) === itemType) {
          count++;
        }
      }
    }

    // 2. プレイヤー所持分
    if (player.holdItem === itemType || (itemType === 'SWORD' && player.hasSword)) {
      count++;
    }

    // 3. ゴースト運搬中
    if (ghosts) {
      for (const g of ghosts) {
        if (g.carriedItem === itemType) {
          count++;
        }
      }
    }

    return count;
  }

  public static lastRollCappedFallbackFrom: TileType | null = null;

  /**
   * 8歩周期および確率テーブルに基づいて宝箱の中身を抽選
   */
  public static rollChestItem(player: Player, context?: ChestContext): ChestItemType {
    const details = this.rollChestItemDetails(player, context);
    this.lastRollCappedFallbackFrom = details.cappedFallbackFrom ?? null;
    return details.item;
  }

  /**
   * 宝箱の中身とキャップ抑制情報を詳細に抽選
   */
  public static rollChestItemDetails(
    player: Player,
    context?: ChestContext
  ): { item: ChestItemType; cappedFallbackFrom?: TileType } {
    const effectiveRng = context?.rng ?? this.defaultRng;

    if (this.forcedNextItem !== null) {
      const item = this.forcedNextItem;
      this.forcedNextItem = null;
      if (item === 'POWER_STONE') {
        player.stepCountSinceStone = 0;
      }
      return { item };
    }

    // 8歩周期仕様:
    // パワーストーン出現後、ちょうど8歩目であれば100%パワーストーンを排出
    if (player.stepCountSinceStone === 8) {
      player.stepCountSinceStone = 0;
      return { item: 'POWER_STONE' };
    }

    // 通常時の確率テーブル (8等分)
    // 0: POWER_STONE (1/8)
    // 1..3: COIN (3/8)
    // 4..5: POTION (2/8)
    // 6: DEATH (1/8)
    // 7: EQUIPMENT (CROSS / RING / KEY) (1/8)
    const roll = effectiveRng.nextInt(0, 7);

    if (roll === 0) {
      player.stepCountSinceStone = 0;
      return { item: 'POWER_STONE' };
    } else if (roll <= 3) {
      return { item: 'COIN' };
    } else if (roll <= 5) {
      return { item: 'POTION' };
    } else if (roll === 6) {
      return { item: 'DEATH' };
    } else {
      // 装備品枠 (CROSS, RING, KEY)
      const capConfig = context?.resourceCapConfig;
      if (context?.map && capConfig) {
        const availableEquip: ('CROSS' | 'RING' | 'KEY' | 'SWORD')[] = [];

        const crossCount = this.countItemInWorld('CROSS', context.map, player, context.ghosts);
        const crossMax = capConfig.cross?.maxCap ?? 99;
        if (crossCount < crossMax) availableEquip.push('CROSS');

        const ringCount = this.countItemInWorld('RING', context.map, player, context.ghosts);
        const ringMax = capConfig.ring?.maxCap ?? 99;
        if (ringCount < ringMax) availableEquip.push('RING');

        const keyCount = this.countItemInWorld('KEY', context.map, player, context.ghosts);
        const keyMax = capConfig.key?.maxCap ?? 99;
        if (keyCount < keyMax) availableEquip.push('KEY');

        const swordCount = this.countItemInWorld('SWORD', context.map, player, context.ghosts);
        const swordMax = capConfig.sword?.maxCap ?? 1;
        if (swordCount < swordMax) availableEquip.push('SWORD');

        if (availableEquip.length > 0) {
          const chosen = effectiveRng.choice(availableEquip);
          return { item: chosen };
        } else {
          // すべて上限到達: 消耗品 (POTION または COIN) にフォールバック
          const fallbackItem: ChestItemType = effectiveRng.chance(0.5) ? 'POTION' : 'COIN';
          return { item: fallbackItem, cappedFallbackFrom: 'CROSS' };
        }
      }

      // context なしの旧互換挙動
      const equipRoll = effectiveRng.nextInt(0, 2);
      if (equipRoll === 0) return { item: 'CROSS' };
      if (equipRoll === 1) return { item: 'RING' };
      return { item: 'KEY' };
    }
  }

  /**
   * 宝箱を開封する処理
   * @param player プレイヤーインスタンス
   * @param chestPos 宝箱の座標
   * @param map ワールドマップ
   * @param context アイテム上限判定用コンテキスト（オプショナル）
   * @returns 開封結果（排出されたアイテム種別、プレイヤーがそのマスに進めるかどうか）
   */
  public static openChest(
    player: Player,
    chestPos: Position,
    map: WorldMap,
    context?: {
      ghosts?: Ghost[];
      resourceCapConfig?: DungeonTuningParams['resourceCapConfig'];
      rng?: SeedRandom;
    }
  ): ChestOpenResult {
    const rollContext: ChestContext | undefined = context
      ? { map, ghosts: context.ghosts, resourceCapConfig: context.resourceCapConfig, rng: context.rng }
      : undefined;

    // 宝箱マスを初期化
    const details = this.rollChestItemDetails(player, rollContext);
    const item = details.item;

    if (item === 'DEATH') {
      if (!player.hasDeath) {
        // 未憑依の場合: プレイヤーに取り憑く
        player.hasDeath = true;
        map.setTile(chestPos, 'EMPTY');
        return { item, playerCanEnter: true, cappedFallbackFrom: details.cappedFallbackFrom };
      } else {
        // すでに死神憑依中の場合:
        // 新たに出た死神はその場に残る
        map.setTile(chestPos, 'DEATH');
        return { item, playerCanEnter: false, cappedFallbackFrom: details.cappedFallbackFrom };
      }
    }

    // 通常アイテムの場合: そのマスにアイテムタイルを配置
    map.setTile(chestPos, item as TileType);
    return { item, playerCanEnter: true, cappedFallbackFrom: details.cappedFallbackFrom };
  }

  /**
   * マップ上に残存している未開封の宝箱（CHEST）の総数をカウント
   */
  public static countChests(map: WorldMap): number {
    let count = 0;
    for (let y = 1; y < map.height - 1; y++) {
      for (let x = 1; x < map.width - 1; x++) {
        if (map.getObject({ x, y }) === 'CHEST') {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * 枯渇防止用の宝箱リポップ（補充）処理 (Phase 8 仕様)
   * マップ上の宝箱数が minChests 未満になった場合、targetChests に達するまで安全な空床に宝箱を再出現させる
   */
  public static replenishChestsIfNeeded(
    map: WorldMap,
    playerPos: Position,
    dragonCenter: Position = { x: 32, y: 32 },
    minChests: number = 10,
    targetChests: number = 18,
    rng?: SeedRandom
  ): number {
    const effectiveRng = rng ?? this.defaultRng;
    const current = this.countChests(map);
    if (current >= minChests) {
      return 0;
    }

    const candidates: Position[] = [];
    for (let y = 2; y < map.height - 2; y++) {
      for (let x = 2; x < map.width - 2; x++) {
        const pos = { x, y };
        if (map.getBaseTile(pos) !== 'EMPTY') continue;
        if (map.getObject(pos) !== 'NONE') continue;
        if (map.getItem(pos) !== 'NONE') continue;

        // プレイヤーの周囲3マス以内、我が家周囲2マス以内、ドラゴン要塞中心部(28..36, 28..36)は除外
        if (Math.abs(x - playerPos.x) <= 3 && Math.abs(y - playerPos.y) <= 3) continue;
        if (Math.abs(x - map.homePos.x) <= 2 && Math.abs(y - map.homePos.y) <= 2) continue;
        if (Math.abs(x - dragonCenter.x) <= 4 && Math.abs(y - dragonCenter.y) <= 4) continue;

        candidates.push(pos);
      }
    }

    let spawned = 0;
    const needed = targetChests - current;
    while (spawned < needed && candidates.length > 0) {
      const idx = effectiveRng.nextInt(0, candidates.length - 1);
      const chosen = candidates.splice(idx, 1)[0];
      map.setObject(chosen, 'CHEST');
      spawned++;
    }

    return spawned;
  }
}
