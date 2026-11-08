import { Position } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { SeedRandom } from '../../core/SeedRandom.js';
import {
  BLOCK_SIZE_CELLS,
  BLOCK_SIZE_TILES,
  GRID_SIZE_CELLS,
  CELL_SIZE_TILES,
  WORLD_SIZE_TILES,
  ThemeBlockTemplate,
  PlacedThemeBlock,
  MapTacticalMetadata,
  GravePuzzleHint,
  TreasureZoneHint,
  DSLSymbol,
  DragonLairStyle,
} from './ThemeBlockTypes.js';
import { ThemeBlockTransformer } from './ThemeBlockTransformer.js';

export interface AllocationPlanOptions {
  seed?: number;
  dragonTemplate?: ThemeBlockTemplate;
  homeTemplate?: ThemeBlockTemplate;
  landmarkMinDistanceTiles?: number; // デフォルト 20
  largeTemplates?: ThemeBlockTemplate[]; // 16x16, 12x12
  mediumTemplates?: ThemeBlockTemplate[]; // 8x8
  smallTemplates?: ThemeBlockTemplate[]; // 4x4
  subSlotSmallTemplates?: ThemeBlockTemplate[]; // サブスロット用 4x4
  subSlotMediumTemplates?: ThemeBlockTemplate[]; // サブスロット用 8x8
  maxInstancesPerBlock?: Record<string, number>; // ブロックIDごとの最大配置数上限
}

export class ThemeBlockAllocator {
  private rng: SeedRandom;

  constructor(seed: number = 12345) {
    this.rng = new SeedRandom(seed);
  }

  /**
   * 重み付き＆上限管理を考慮したテンプレート抽選
   */
  public selectWeightedTemplate(
    pool: ThemeBlockTemplate[],
    placedCounts: Map<string, number>,
    maxOverrides?: Record<string, number>
  ): ThemeBlockTemplate | null {
    if (!pool || pool.length === 0) return null;

    // 上限未到達の候補をフィルタリング
    const available = pool.filter(tpl => {
      const current = placedCounts.get(tpl.id) ?? 0;
      const limit = maxOverrides?.[tpl.id] ?? tpl.maxInstances;
      if (limit !== undefined && current >= limit) {
        return false;
      }
      return true;
    });

    if (available.length === 0) {
      // 上限に達していないフォールバック（CORRIDOR/MAZE系またはTREASURE/GRAVE系優先、なければプール先頭）
      const fallback = pool.find(t => t.category === 'CORRIDOR' || t.category === 'MAZE' || t.category === 'TREASURE' || t.category === 'GRAVE') ?? pool[0];
      return fallback;
    }

    // 重み付き抽選
    let totalWeight = 0;
    for (const tpl of available) {
      totalWeight += Math.max(1, tpl.weight ?? 1);
    }

    let roll = this.rng.nextInt(1, totalWeight);
    for (const tpl of available) {
      const w = Math.max(1, tpl.weight ?? 1);
      if (roll <= w) {
        return tpl;
      }
      roll -= w;
    }

    return available[available.length - 1];
  }

  /**
   * 16x16 マクロセル空間にテーマブロックを階層パッキングする
   */
  public allocate(options: AllocationPlanOptions = {}): PlacedThemeBlock[] {
    if (options.seed !== undefined) {
      this.rng = new SeedRandom(options.seed);
    }

    // 16x16 グリッド (セル占有フラグ & 配置ブロックID)
    const occupied: (string | null)[][] = Array.from({ length: GRID_SIZE_CELLS }, () =>
      Array.from({ length: GRID_SIZE_CELLS }, () => null)
    );

    const placedBlocks: PlacedThemeBlock[] = [];
    const placedCounts = new Map<string, number>();
    const minDistanceTiles = options.landmarkMinDistanceTiles ?? 20;

    const recordPlaced = (placed: PlacedThemeBlock) => {
      placedBlocks.push(placed);
      const count = placedCounts.get(placed.template.id) ?? 0;
      placedCounts.set(placed.template.id, count + 1);
    };

    // --- 1. ランドマーク配置: ドラゴン & 我が家 ---
    let dragonPlaced: PlacedThemeBlock | null = null;
    if (options.dragonTemplate) {
      dragonPlaced = this.tryPlaceLandmark(
        options.dragonTemplate,
        occupied,
        null,
        0
      );
      if (dragonPlaced) {
        recordPlaced(dragonPlaced);
      }
    }

    if (options.homeTemplate) {
      const dragonTilePos = dragonPlaced
        ? {
            x: dragonPlaced.cellX * CELL_SIZE_TILES,
            y: dragonPlaced.cellY * CELL_SIZE_TILES,
          }
        : null;

      const homePlaced = this.tryPlaceLandmark(
        options.homeTemplate,
        occupied,
        dragonTilePos,
        minDistanceTiles
      );
      if (homePlaced) {
        recordPlaced(homePlaced);
      }
    }

    // --- 2. 広域・準広域ブロック (16x16, 12x12) の配置 ---
    if (options.largeTemplates && options.largeTemplates.length > 0) {
      const shuffledLarge = this.shuffle([...options.largeTemplates]);
      for (const tpl of shuffledLarge) {
        const placed = this.tryPlaceAnywhere(tpl, occupied);
        if (placed) {
          recordPlaced(placed);
        }
      }
    }

    // --- 3. サブスロット・オーバーレイの配置 ---
    // 親ブロックとして配置されたブロックの中から subSlots を持つものを走査
    const parentBlocks = [...placedBlocks];
    for (const parent of parentBlocks) {
      if (!parent.template.subSlots || parent.template.subSlots.length === 0) continue;

      for (const slot of parent.template.subSlots) {
        // スロットサイズ (1x1 = 4x4, 2x2 = 8x8)
        const isSmall = slot.sizeCell.w === 1 && slot.sizeCell.h === 1;
        const candidatePool = isSmall
          ? (options.subSlotSmallTemplates ?? options.smallTemplates ?? [])
          : (options.subSlotMediumTemplates ?? options.mediumTemplates ?? []);

        // 許可カテゴリでフィルタ
        const filtered = candidatePool.filter(t => {
          if (!slot.allowedCategories || slot.allowedCategories.length === 0) return true;
          return slot.allowedCategories.includes(t.category);
        });

        if (filtered.length > 0) {
          const selectedTpl = this.selectWeightedTemplate(
            filtered,
            placedCounts,
            options.maxInstancesPerBlock
          ) ?? filtered[this.rng.nextInt(0, filtered.length - 1)];

          // サブスロット位置 (ワールドセル座標)
          const targetCellX = (parent.cellX + slot.offsetCell.x) % GRID_SIZE_CELLS;
          const targetCellY = (parent.cellY + slot.offsetCell.y) % GRID_SIZE_CELLS;

          // ランダム回転・反転
          const rotation = (selectedTpl.allowRotation !== false)
            ? ([0, 90, 180, 270][this.rng.nextInt(0, 3)] as 0 | 90 | 180 | 270)
            : 0;
          const flipX = (selectedTpl.allowFlip !== false) ? this.rng.chance(0.5) : false;
          const flipY = (selectedTpl.allowFlip !== false) ? this.rng.chance(0.5) : false;

          const transformedTpl = ThemeBlockTransformer.transform(selectedTpl, {
            rotation,
            flipX,
            flipY,
          });

          recordPlaced({
            template: transformedTpl,
            cellX: targetCellX,
            cellY: targetCellY,
            rotation,
            flipX,
            flipY,
            isSubSlotOverlay: true,
            parentBlockId: parent.template.id,
          });
        }
      }
    }

    // --- 4. 中規模ブロック (8x8) の充填 ---
    if (options.mediumTemplates && options.mediumTemplates.length > 0) {
      let attempts = 0;
      while (attempts < 50) {
        attempts++;
        const freeCell = this.findFreeCellForSize(occupied, 2, 2);
        if (!freeCell) break;

        const tpl = this.selectWeightedTemplate(
          options.mediumTemplates,
          placedCounts,
          options.maxInstancesPerBlock
        ) ?? options.mediumTemplates[this.rng.nextInt(0, options.mediumTemplates.length - 1)];

        const placed = this.placeAt(tpl, occupied, freeCell.x, freeCell.y);
        if (placed) {
          recordPlaced(placed);
        }
      }
    }

    // --- 5. 100%完全充填: 空きセルを 8x8 または 4x4 で埋め尽くす ---
    this.fillRemainingCells(placedBlocks, occupied, options, placedCounts);

    return placedBlocks;
  }

  /**
   * 未配置セルをすべてスキャンし、8x8または4x4ブロックで100%充填する
   */
  private fillRemainingCells(
    placedBlocks: PlacedThemeBlock[],
    occupied: (string | null)[][],
    options: AllocationPlanOptions,
    placedCounts: Map<string, number>
  ): void {
    const smallPool = (options.smallTemplates && options.smallTemplates.length > 0)
      ? options.smallTemplates
      : [this.createDefaultSmallBlock()];

    const mediumPool = (options.mediumTemplates && options.mediumTemplates.length > 0)
      ? options.mediumTemplates
      : [this.createDefaultMediumBlock()];

    const recordPlaced = (placed: PlacedThemeBlock) => {
      placedBlocks.push(placed);
      const count = placedCounts.get(placed.template.id) ?? 0;
      placedCounts.set(placed.template.id, count + 1);
    };

    // 走査して 2x2 が置ければ medium、そうでなければ 1x1 small で埋める
    for (let cy = 0; cy < GRID_SIZE_CELLS; cy++) {
      for (let cx = 0; cx < GRID_SIZE_CELLS; cx++) {
        if (occupied[cy][cx] !== null) continue;

        // 2x2 が空いているか確認
        if (this.canOccupy(occupied, cx, cy, 2, 2)) {
          const tpl = this.selectWeightedTemplate(
            mediumPool,
            placedCounts,
            options.maxInstancesPerBlock
          ) ?? mediumPool[this.rng.nextInt(0, mediumPool.length - 1)];

          const placed = this.placeAt(tpl, occupied, cx, cy);
          if (placed) {
            recordPlaced(placed);
            continue;
          }
        }

        // 1x1 で埋める
        const tpl = this.selectWeightedTemplate(
          smallPool,
          placedCounts,
          options.maxInstancesPerBlock
        ) ?? smallPool[this.rng.nextInt(0, smallPool.length - 1)];

        const placed = this.placeAt(tpl, occupied, cx, cy);
        if (placed) {
          recordPlaced(placed);
        }
      }
    }
  }

  /**
   * ランドマーク配置（ドラゴンまたは我が家）
   */
  private tryPlaceLandmark(
    template: ThemeBlockTemplate,
    occupied: (string | null)[][],
    otherPos: Position | null,
    minDistTiles: number
  ): PlacedThemeBlock | null {
    const sizeCells = BLOCK_SIZE_CELLS[template.size];
    const candidatePositions: Position[] = [];

    for (let cy = 0; cy < GRID_SIZE_CELLS; cy++) {
      for (let cx = 0; cx < GRID_SIZE_CELLS; cx++) {
        if (!this.canOccupy(occupied, cx, cy, sizeCells, sizeCells)) continue;

        if (otherPos) {
          const tileX = cx * CELL_SIZE_TILES;
          const tileY = cy * CELL_SIZE_TILES;
          const dist = this.getTorusManhattan(
            { x: tileX, y: tileY },
            otherPos,
            WORLD_SIZE_TILES
          );
          if (dist < minDistTiles) continue;
        }

        candidatePositions.push({ x: cx, y: cy });
      }
    }

    if (candidatePositions.length === 0) {
      // 距離制約を緩和して空き場所を探す
      for (let cy = 0; cy < GRID_SIZE_CELLS; cy++) {
        for (let cx = 0; cx < GRID_SIZE_CELLS; cx++) {
          if (this.canOccupy(occupied, cx, cy, sizeCells, sizeCells)) {
            candidatePositions.push({ x: cx, y: cy });
          }
        }
      }
    }

    if (candidatePositions.length === 0) return null;

    const chosen = candidatePositions[this.rng.nextInt(0, candidatePositions.length - 1)];
    return this.placeAt(template, occupied, chosen.x, chosen.y);
  }

  /**
   * 空いている任意の位置にブロックを配置
   */
  private tryPlaceAnywhere(
    template: ThemeBlockTemplate,
    occupied: (string | null)[][]
  ): PlacedThemeBlock | null {
    const sizeCells = BLOCK_SIZE_CELLS[template.size];
    const candidates: Position[] = [];

    for (let cy = 0; cy < GRID_SIZE_CELLS; cy++) {
      for (let cx = 0; cx < GRID_SIZE_CELLS; cx++) {
        if (this.canOccupy(occupied, cx, cy, sizeCells, sizeCells)) {
          candidates.push({ x: cx, y: cy });
        }
      }
    }

    if (candidates.length === 0) return null;
    const chosen = candidates[this.rng.nextInt(0, candidates.length - 1)];
    return this.placeAt(template, occupied, chosen.x, chosen.y);
  }

  /**
   * 指定セル位置にブロックを配置してグリッドをマーク
   */
  private placeAt(
    template: ThemeBlockTemplate,
    occupied: (string | null)[][],
    cellX: number,
    cellY: number
  ): PlacedThemeBlock | null {
    const sizeCells = BLOCK_SIZE_CELLS[template.size];
    if (!this.canOccupy(occupied, cellX, cellY, sizeCells, sizeCells)) {
      return null;
    }

    const rotation = (template.allowRotation !== false)
      ? ([0, 90, 180, 270][this.rng.nextInt(0, 3)] as 0 | 90 | 180 | 270)
      : 0;
    const flipX = (template.allowFlip !== false) ? this.rng.chance(0.5) : false;
    const flipY = (template.allowFlip !== false) ? this.rng.chance(0.5) : false;

    const transformedTpl = ThemeBlockTransformer.transform(template, {
      rotation,
      flipX,
      flipY,
    });

    // グリッド占有マーク (トーラスラップアラウンド)
    for (let dy = 0; dy < sizeCells; dy++) {
      for (let dx = 0; dx < sizeCells; dx++) {
        const gx = (cellX + dx) % GRID_SIZE_CELLS;
        const gy = (cellY + dy) % GRID_SIZE_CELLS;
        occupied[gy][gx] = template.id;
      }
    }

    return {
      template: transformedTpl,
      cellX,
      cellY,
      rotation,
      flipX,
      flipY,
    };
  }

  /**
   * セル領域がすべて未占有か判定 (トーラスラップアラウンド)
   */
  public canOccupy(
    occupied: (string | null)[][],
    cellX: number,
    cellY: number,
    wCells: number,
    hCells: number
  ): boolean {
    for (let dy = 0; dy < hCells; dy++) {
      for (let dx = 0; dx < wCells; dx++) {
        const gx = (cellX + dx) % GRID_SIZE_CELLS;
        const gy = (cellY + dy) % GRID_SIZE_CELLS;
        if (occupied[gy][gx] !== null) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * 指定サイズが置ける空きセルを探す
   */
  private findFreeCellForSize(
    occupied: (string | null)[][],
    wCells: number,
    hCells: number
  ): Position | null {
    const freeCells: Position[] = [];
    for (let cy = 0; cy < GRID_SIZE_CELLS; cy++) {
      for (let cx = 0; cx < GRID_SIZE_CELLS; cx++) {
        if (this.canOccupy(occupied, cx, cy, wCells, hCells)) {
          freeCells.push({ x: cx, y: cy });
        }
      }
    }
    if (freeCells.length === 0) return null;
    return freeCells[this.rng.nextInt(0, freeCells.length - 1)];
  }

  /**
   * トーラス・マンハッタン距離
   */
  private getTorusManhattan(a: Position, b: Position, size: number): number {
    let dx = Math.abs(a.x - b.x);
    let dy = Math.abs(a.y - b.y);
    if (dx > size / 2) dx = size - dx;
    if (dy > size / 2) dy = size - dy;
    return dx + dy;
  }

  private shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.rng.nextInt(0, i);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  // --- スタンプ展開 ＆ MapTacticalMetadata 組み立て ---

  /**
   * 配置済みブロック群を WorldMap にスタンプし、MapTacticalMetadata を生成して付与する
   */
  public applyToWorldMap(
    map: WorldMap,
    placedBlocks: PlacedThemeBlock[],
    options: { activateChestSlots?: boolean } = {}
  ): MapTacticalMetadata {
    // 1. 親ブロック（非サブスロット）を先に展開、その後にサブスロットオーバーレイを展開
    const sorted = [...placedBlocks].sort((a, b) => {
      const aIsSub = a.isSubSlotOverlay ? 1 : 0;
      const bIsSub = b.isSubSlotOverlay ? 1 : 0;
      return aIsSub - bIsSub;
    });

    const activateChests = options.activateChestSlots ?? true;

    // メタデータ集計コンテナ
    const gravePuzzleHints: GravePuzzleHint[] = [];
    const treasureZoneHints: TreasureZoneHint[] = [];
    const recommendedRelocateAnchors: Position[] = [];
    const breachShortcutPositions: Position[] = [];
    let dragonLairStyle: DragonLairStyle = 'STANDARD_FORTRESS';
    let mergedBotTuning = {};

    for (const placed of sorted) {
      const tpl = placed.template;
      const sizeTiles = BLOCK_SIZE_TILES[tpl.size];
      const originX = placed.cellX * CELL_SIZE_TILES;
      const originY = placed.cellY * CELL_SIZE_TILES;

      const toWorldPos = (p: Position): Position => ({
        x: ((originX + p.x) % WORLD_SIZE_TILES + WORLD_SIZE_TILES) % WORLD_SIZE_TILES,
        y: ((originY + p.y) % WORLD_SIZE_TILES + WORLD_SIZE_TILES) % WORLD_SIZE_TILES,
      });

      // タイルのスタンプ
      for (let ly = 0; ly < sizeTiles; ly++) {
        for (let lx = 0; lx < sizeTiles; lx++) {
          const ch = tpl.layout[ly][lx] as DSLSymbol;
          if (ch === ' ') continue; // 透過

          const wx = ((originX + lx) % WORLD_SIZE_TILES + WORLD_SIZE_TILES) % WORLD_SIZE_TILES;
          const wy = ((originY + ly) % WORLD_SIZE_TILES + WORLD_SIZE_TILES) % WORLD_SIZE_TILES;

          this.stampTile(map, wx, wy, ch, activateChests);
        }
      }

      // 戦術ピンのワールド座標変換と集計
      if (tpl.dragonLairStyle) {
        dragonLairStyle = tpl.dragonLairStyle;
      }
      if (tpl.botTuning) {
        mergedBotTuning = { ...mergedBotTuning, ...tpl.botTuning };
      }

      if (tpl.localGraveHints) {
        for (const hint of tpl.localGraveHints) {
          gravePuzzleHints.push({
            gravePos: toWorldPos(hint.gravePos),
            themeId: hint.themeId,
            sealMode: hint.sealMode,
            sealTargetPositions: hint.sealTargetPositions.map(toWorldPos),
            recommendedPushes: hint.recommendedPushes.map(push => ({
              blockPos: toWorldPos(push.blockPos),
              dir: push.dir,
              destinationPos: toWorldPos(push.destinationPos),
            })),
            priority: hint.priority,
          });
        }
      }

      if (tpl.localTreasureHints) {
        for (const hint of tpl.localTreasureHints) {
          const p1 = toWorldPos({ x: hint.bounds.x1, y: hint.bounds.y1 });
          const p2 = toWorldPos({ x: hint.bounds.x2, y: hint.bounds.y2 });
          treasureZoneHints.push({
            id: hint.id,
            bounds: {
              x1: Math.min(p1.x, p2.x),
              y1: Math.min(p1.y, p2.y),
              x2: Math.max(p1.x, p2.x),
              y2: Math.max(p1.y, p2.y),
            },
            entryPorts: hint.entryPorts.map(toWorldPos),
            chestCount: hint.chestCount,
            isEightStepOptimal: hint.isEightStepOptimal,
          });
        }
      }

      if (tpl.localRelocateAnchors) {
        for (const anchor of tpl.localRelocateAnchors) {
          recommendedRelocateAnchors.push(toWorldPos(anchor));
        }
      }

      if (tpl.localBreachShortcuts) {
        for (const shortcut of tpl.localBreachShortcuts) {
          breachShortcutPositions.push(toWorldPos(shortcut));
        }
      }
    }

    const metadata: MapTacticalMetadata = {
      dragonLairStyle,
      recommendedBotTuning: mergedBotTuning,
      recommendedRelocateAnchors,
      gravePuzzleHints,
      treasureZoneHints,
      breachShortcutPositions,
    };

    map.tacticalMetadata = metadata;
    return metadata;
  }

  /**
   * 1つのDSL文字を WorldMap に適切にスタンプ
   */
  private stampTile(
    map: WorldMap,
    x: number,
    y: number,
    ch: DSLSymbol,
    activateChests: boolean
  ): void {
    const pos = { x, y };

    switch (ch) {
      case '.':
        map.setTile(pos, 'EMPTY');
        break;
      case '#':
        map.setBaseTile(pos, 'EMPTY');
        map.setItem(pos, 'NONE');
        map.setObject(pos, 'BLOCK');
        break;
      case 'W':
        map.setBaseTile(pos, 'WALL_STATIC');
        map.setObject(pos, 'NONE');
        map.setItem(pos, 'NONE');
        break;
      case 'G':
        map.setBaseTile(pos, 'GRAVE');
        map.setObject(pos, 'NONE');
        map.setItem(pos, 'NONE');
        break;
      case 'C':
        map.setBaseTile(pos, 'EMPTY');
        map.setItem(pos, 'NONE');
        map.setObject(pos, 'CHEST');
        break;
      case 'c':
        map.setBaseTile(pos, 'EMPTY');
        map.setItem(pos, 'NONE');
        if (activateChests) {
          map.setObject(pos, 'CHEST');
        } else {
          map.setObject(pos, 'NONE');
        }
        break;
      case 'P':
        map.setBaseTile(pos, 'EMPTY');
        map.setObject(pos, 'NONE');
        map.setItem(pos, 'POTION');
        break;
      case 'S':
        map.setBaseTile(pos, 'EMPTY');
        map.setObject(pos, 'NONE');
        map.setItem(pos, 'POWER_STONE');
        break;
      case '$':
        map.setBaseTile(pos, 'EMPTY');
        map.setObject(pos, 'NONE');
        map.setItem(pos, 'COIN');
        break;
      case '+':
        map.setBaseTile(pos, 'EMPTY');
        map.setObject(pos, 'NONE');
        map.setItem(pos, 'CROSS');
        break;
      case 'H':
        map.setBaseTile(pos, 'HOME');
        map.setObject(pos, 'NONE');
        map.setItem(pos, 'NONE');
        map.homePos = { x, y };
        map.initialHomePos = { x, y };
        map.spawnHomePos = { x, y };
        break;
      case 'D':
        map.setBaseTile(pos, 'EMPTY');
        map.setItem(pos, 'NONE');
        map.setObject(pos, 'CHEST_DRAGON');
        break;
      case 'K':
        map.setBaseTile(pos, 'EMPTY');
        map.setObject(pos, 'NONE');
        map.setItem(pos, 'KEY');
        break;
      case 'R':
        map.setBaseTile(pos, 'EMPTY');
        map.setObject(pos, 'NONE');
        map.setItem(pos, 'RING');
        break;
      case '!':
        map.setBaseTile(pos, 'EMPTY');
        map.setObject(pos, 'NONE');
        map.setItem(pos, 'SWORD');
        break;
      case '*':
        map.setBaseTile(pos, 'WARP');
        map.setObject(pos, 'NONE');
        map.setItem(pos, 'NONE');
        break;
      default:
        map.setTile(pos, 'EMPTY');
        break;
    }
  }

  // --- デフォルトフィラーブロック（フォールバック用） ---

  public createDefaultSmallBlock(id: string = 'filler_4x4'): ThemeBlockTemplate {
    return {
      id,
      size: '4x4',
      category: 'MISC',
      layout: [
        '....',
        '....',
        '....',
        '....',
      ],
      allowRotation: true,
      allowFlip: true,
    };
  }

  public createDefaultMediumBlock(id: string = 'filler_8x8'): ThemeBlockTemplate {
    return {
      id,
      size: '8x8',
      category: 'MISC',
      layout: [
        '........',
        '........',
        '........',
        '........',
        '........',
        '........',
        '........',
        '........',
      ],
      allowRotation: true,
      allowFlip: true,
    };
  }
}
