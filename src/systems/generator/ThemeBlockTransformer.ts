import { Direction, Position } from '../../models/Types.js';
import {
  BLOCK_SIZE_TILES,
  BLOCK_SIZE_CELLS,
  ThemeBlockTemplate,
  EdgePort,
} from './ThemeBlockTypes.js';

export interface TransformOptions {
  rotation?: 0 | 90 | 180 | 270;
  flipX?: boolean;
  flipY?: boolean;
}

export class ThemeBlockTransformer {
  /**
   * ブロックテンプレートを回転・反転変換した新しいテンプレートを生成
   */
  public static transform(
    template: ThemeBlockTemplate,
    options: TransformOptions
  ): ThemeBlockTemplate {
    const rotation = template.allowRotation === false ? 0 : (options.rotation ?? 0);
    const flipX = template.allowFlip === false ? false : (options.flipX ?? false);
    const flipY = template.allowFlip === false ? false : (options.flipY ?? false);

    let result = this.cloneTemplate(template);

    if (flipX) {
      result = this.flipHorizontal(result);
    }
    if (flipY) {
      result = this.flipVertical(result);
    }
    if (rotation === 90) {
      result = this.rotate90(result);
    } else if (rotation === 180) {
      result = this.rotate90(this.rotate90(result));
    } else if (rotation === 270) {
      result = this.rotate90(this.rotate90(this.rotate90(result)));
    }

    return result;
  }

  /**
   * テンプレートのディープコピー
   */
  public static cloneTemplate(template: ThemeBlockTemplate): ThemeBlockTemplate {
    return {
      ...template,
      layout: [...template.layout],
      edgePorts: template.edgePorts ? template.edgePorts.map(p => ({ ...p })) : undefined,
      subSlots: template.subSlots
        ? template.subSlots.map(s => ({
            ...s,
            offsetCell: { ...s.offsetCell },
            sizeCell: { ...s.sizeCell },
            allowedCategories: s.allowedCategories ? [...s.allowedCategories] : undefined,
          }))
        : undefined,
      localGraveHints: template.localGraveHints
        ? template.localGraveHints.map(g => ({
            ...g,
            gravePos: { ...g.gravePos },
            sealTargetPositions: g.sealTargetPositions.map(p => ({ ...p })),
            recommendedPushes: g.recommendedPushes.map(p => ({
              blockPos: { ...p.blockPos },
              dir: p.dir,
              destinationPos: { ...p.destinationPos },
            })),
          }))
        : undefined,
      localTreasureHints: template.localTreasureHints
        ? template.localTreasureHints.map(t => ({
            ...t,
            bounds: { ...t.bounds },
            entryPorts: t.entryPorts.map(p => ({ ...p })),
          }))
        : undefined,
      localRelocateAnchors: template.localRelocateAnchors
        ? template.localRelocateAnchors.map(p => ({ ...p }))
        : undefined,
      localBreachShortcuts: template.localBreachShortcuts
        ? template.localBreachShortcuts.map(p => ({ ...p }))
        : undefined,
      botTuning: template.botTuning ? { ...template.botTuning } : undefined,
    };
  }

  /**
   * 時計回りに 90 度回転
   */
  public static rotate90(template: ThemeBlockTemplate): ThemeBlockTemplate {
    const sizeTiles = BLOCK_SIZE_TILES[template.size];
    const sizeCells = BLOCK_SIZE_CELLS[template.size];

    // 1. タイルレイアウト文字列の回転
    // newLayout[r][c] = oldLayout[(sizeTiles - 1) - c][r]
    const newLayout: string[] = [];
    for (let r = 0; r < sizeTiles; r++) {
      let rowChars = '';
      for (let c = 0; c < sizeTiles; c++) {
        rowChars += template.layout[(sizeTiles - 1) - c][r];
      }
      newLayout.push(rowChars);
    }

    const transformPos = (p: Position): Position => ({
      x: (sizeTiles - 1) - p.y,
      y: p.x,
    });

    const transformDir = (d: Direction): Direction => this.rotateDirection90(d);

    // 2. エッジポートの回転
    const newEdgePorts = template.edgePorts?.map(port => {
      const localPos = this.portToLocalPos(port, sizeTiles);
      const rotatedPos = transformPos(localPos);
      return this.localPosToPort(rotatedPos, sizeTiles);
    });

    // 3. サブスロットの回転 (セル座標系)
    const newSubSlots = template.subSlots?.map(slot => {
      const newX = sizeCells - (slot.offsetCell.y + slot.sizeCell.h);
      const newY = slot.offsetCell.x;
      return {
        ...slot,
        offsetCell: { x: newX, y: newY },
        sizeCell: { w: slot.sizeCell.h, h: slot.sizeCell.w },
      };
    });

    // 4. 墓パズルヒントの回転
    const newGraveHints = template.localGraveHints?.map(g => ({
      ...g,
      gravePos: transformPos(g.gravePos),
      sealTargetPositions: g.sealTargetPositions.map(transformPos),
      recommendedPushes: g.recommendedPushes.map(push => ({
        blockPos: transformPos(push.blockPos),
        dir: transformDir(push.dir),
        destinationPos: transformPos(push.destinationPos),
      })),
    }));

    // 5. 宝物ゾーンヒントの回転
    const newTreasureHints = template.localTreasureHints?.map(t => {
      const p1 = transformPos({ x: t.bounds.x1, y: t.bounds.y1 });
      const p2 = transformPos({ x: t.bounds.x2, y: t.bounds.y2 });
      return {
        ...t,
        bounds: {
          x1: Math.min(p1.x, p2.x),
          y1: Math.min(p1.y, p2.y),
          x2: Math.max(p1.x, p2.x),
          y2: Math.max(p1.y, p2.y),
        },
        entryPorts: t.entryPorts.map(transformPos),
      };
    });

    return {
      ...this.cloneTemplate(template),
      layout: newLayout,
      edgePorts: newEdgePorts,
      subSlots: newSubSlots,
      localGraveHints: newGraveHints,
      localTreasureHints: newTreasureHints,
      localRelocateAnchors: template.localRelocateAnchors?.map(transformPos),
      localBreachShortcuts: template.localBreachShortcuts?.map(transformPos),
    };
  }

  /**
   * 水平反転 (左右反転 Flip X)
   */
  public static flipHorizontal(template: ThemeBlockTemplate): ThemeBlockTemplate {
    const sizeTiles = BLOCK_SIZE_TILES[template.size];
    const sizeCells = BLOCK_SIZE_CELLS[template.size];

    // 1. 各行の文字列を左右反転
    const newLayout = template.layout.map(row => row.split('').reverse().join(''));

    const transformPos = (p: Position): Position => ({
      x: (sizeTiles - 1) - p.x,
      y: p.y,
    });

    const transformDir = (d: Direction): Direction => this.flipDirectionHorizontal(d);

    // 2. エッジポートの反転
    const newEdgePorts = template.edgePorts?.map(port => {
      const localPos = this.portToLocalPos(port, sizeTiles);
      const flippedPos = transformPos(localPos);
      return this.localPosToPort(flippedPos, sizeTiles);
    });

    // 3. サブスロットの反転
    const newSubSlots = template.subSlots?.map(slot => {
      const newX = sizeCells - (slot.offsetCell.x + slot.sizeCell.w);
      return {
        ...slot,
        offsetCell: { x: newX, y: slot.offsetCell.y },
      };
    });

    // 4. 墓パズルヒントの反転
    const newGraveHints = template.localGraveHints?.map(g => ({
      ...g,
      gravePos: transformPos(g.gravePos),
      sealTargetPositions: g.sealTargetPositions.map(transformPos),
      recommendedPushes: g.recommendedPushes.map(push => ({
        blockPos: transformPos(push.blockPos),
        dir: transformDir(push.dir),
        destinationPos: transformPos(push.destinationPos),
      })),
    }));

    // 5. 宝物ゾーンヒントの反転
    const newTreasureHints = template.localTreasureHints?.map(t => {
      const p1 = transformPos({ x: t.bounds.x1, y: t.bounds.y1 });
      const p2 = transformPos({ x: t.bounds.x2, y: t.bounds.y2 });
      return {
        ...t,
        bounds: {
          x1: Math.min(p1.x, p2.x),
          y1: Math.min(p1.y, p2.y),
          x2: Math.max(p1.x, p2.x),
          y2: Math.max(p1.y, p2.y),
        },
        entryPorts: t.entryPorts.map(transformPos),
      };
    });

    return {
      ...this.cloneTemplate(template),
      layout: newLayout,
      edgePorts: newEdgePorts,
      subSlots: newSubSlots,
      localGraveHints: newGraveHints,
      localTreasureHints: newTreasureHints,
      localRelocateAnchors: template.localRelocateAnchors?.map(transformPos),
      localBreachShortcuts: template.localBreachShortcuts?.map(transformPos),
    };
  }

  /**
   * 垂直反転 (上下反転 Flip Y)
   */
  public static flipVertical(template: ThemeBlockTemplate): ThemeBlockTemplate {
    const sizeTiles = BLOCK_SIZE_TILES[template.size];
    const sizeCells = BLOCK_SIZE_CELLS[template.size];

    // 1. 行の順序を反転
    const newLayout = [...template.layout].reverse();

    const transformPos = (p: Position): Position => ({
      x: p.x,
      y: (sizeTiles - 1) - p.y,
    });

    const transformDir = (d: Direction): Direction => this.flipDirectionVertical(d);

    // 2. エッジポートの反転
    const newEdgePorts = template.edgePorts?.map(port => {
      const localPos = this.portToLocalPos(port, sizeTiles);
      const flippedPos = transformPos(localPos);
      return this.localPosToPort(flippedPos, sizeTiles);
    });

    // 3. サブスロットの反転
    const newSubSlots = template.subSlots?.map(slot => {
      const newY = sizeCells - (slot.offsetCell.y + slot.sizeCell.h);
      return {
        ...slot,
        offsetCell: { x: slot.offsetCell.x, y: newY },
      };
    });

    // 4. 墓パズルヒントの反転
    const newGraveHints = template.localGraveHints?.map(g => ({
      ...g,
      gravePos: transformPos(g.gravePos),
      sealTargetPositions: g.sealTargetPositions.map(transformPos),
      recommendedPushes: g.recommendedPushes.map(push => ({
        blockPos: transformPos(push.blockPos),
        dir: transformDir(push.dir),
        destinationPos: transformPos(push.destinationPos),
      })),
    }));

    // 5. 宝物ゾーンヒントの反転
    const newTreasureHints = template.localTreasureHints?.map(t => {
      const p1 = transformPos({ x: t.bounds.x1, y: t.bounds.y1 });
      const p2 = transformPos({ x: t.bounds.x2, y: t.bounds.y2 });
      return {
        ...t,
        bounds: {
          x1: Math.min(p1.x, p2.x),
          y1: Math.min(p1.y, p2.y),
          x2: Math.max(p1.x, p2.x),
          y2: Math.max(p1.y, p2.y),
        },
        entryPorts: t.entryPorts.map(transformPos),
      };
    });

    return {
      ...this.cloneTemplate(template),
      layout: newLayout,
      edgePorts: newEdgePorts,
      subSlots: newSubSlots,
      localGraveHints: newGraveHints,
      localTreasureHints: newTreasureHints,
      localRelocateAnchors: template.localRelocateAnchors?.map(transformPos),
      localBreachShortcuts: template.localBreachShortcuts?.map(transformPos),
    };
  }

  // --- ヘルパーメソッド ---

  public static portToLocalPos(port: EdgePort, sizeTiles: number): Position {
    const offset = port.cellIndex * 4 + port.offsetInCell;
    switch (port.direction) {
      case 'NORTH':
        return { x: offset, y: 0 };
      case 'SOUTH':
        return { x: offset, y: sizeTiles - 1 };
      case 'WEST':
        return { x: 0, y: offset };
      case 'EAST':
        return { x: sizeTiles - 1, y: offset };
    }
  }

  public static localPosToPort(pos: Position, sizeTiles: number): EdgePort {
    if (pos.y === 0) {
      return {
        direction: 'NORTH',
        cellIndex: Math.floor(pos.x / 4),
        offsetInCell: (pos.x % 4) as 1 | 2,
      };
    }
    if (pos.y === sizeTiles - 1) {
      return {
        direction: 'SOUTH',
        cellIndex: Math.floor(pos.x / 4),
        offsetInCell: (pos.x % 4) as 1 | 2,
      };
    }
    if (pos.x === 0) {
      return {
        direction: 'WEST',
        cellIndex: Math.floor(pos.y / 4),
        offsetInCell: (pos.y % 4) as 1 | 2,
      };
    }
    if (pos.x === sizeTiles - 1) {
      return {
        direction: 'EAST',
        cellIndex: Math.floor(pos.y / 4),
        offsetInCell: (pos.y % 4) as 1 | 2,
      };
    }
    // 外周外のフォールバック
    return {
      direction: 'NORTH',
      cellIndex: 0,
      offsetInCell: 1,
    };
  }

  public static rotateDirection90(dir: Direction): Direction {
    switch (dir) {
      case 'UP': return 'RIGHT';
      case 'RIGHT': return 'DOWN';
      case 'DOWN': return 'LEFT';
      case 'LEFT': return 'UP';
      case 'UP_RIGHT': return 'DOWN_RIGHT';
      case 'DOWN_RIGHT': return 'DOWN_LEFT';
      case 'DOWN_LEFT': return 'UP_LEFT';
      case 'UP_LEFT': return 'UP_RIGHT';
    }
  }

  public static flipDirectionHorizontal(dir: Direction): Direction {
    switch (dir) {
      case 'LEFT': return 'RIGHT';
      case 'RIGHT': return 'LEFT';
      case 'UP_LEFT': return 'UP_RIGHT';
      case 'UP_RIGHT': return 'UP_LEFT';
      case 'DOWN_LEFT': return 'DOWN_RIGHT';
      case 'DOWN_RIGHT': return 'DOWN_LEFT';
      case 'UP': return 'UP';
      case 'DOWN': return 'DOWN';
    }
  }

  public static flipDirectionVertical(dir: Direction): Direction {
    switch (dir) {
      case 'UP': return 'DOWN';
      case 'DOWN': return 'UP';
      case 'UP_LEFT': return 'DOWN_LEFT';
      case 'UP_RIGHT': return 'DOWN_RIGHT';
      case 'DOWN_LEFT': return 'UP_LEFT';
      case 'DOWN_RIGHT': return 'UP_RIGHT';
      case 'LEFT': return 'LEFT';
      case 'RIGHT': return 'RIGHT';
    }
  }
}
