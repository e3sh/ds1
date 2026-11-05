import assert from 'node:assert';
import { WorldMap } from '../src/models/WorldMap.js';
import {
  ThemeBlockTemplate,
  EdgePort,
  SubSlotDefinition,
  GravePuzzleHint,
  TreasureZoneHint,
  GRID_SIZE_CELLS,
  BLOCK_SIZE_CELLS,
} from '../src/systems/generator/ThemeBlockTypes.js';
import { ThemeBlockTransformer } from '../src/systems/generator/ThemeBlockTransformer.js';
import { ThemeBlockAllocator } from '../src/systems/generator/ThemeBlockAllocator.js';

console.log('--- Phase 14 Step 1: Theme Block Types, Transformer & Allocator Verification ---');

// ============================================================================
// Test 1: ThemeBlockTransformer - 回転・反転およびローカル戦術ピンの正確な自動変換
// ============================================================================
console.log('Testing 1: ThemeBlockTransformer rotation, flip & tactical pin preservation...');
{
  const testGraveTemplate: ThemeBlockTemplate = {
    id: 'test_grave_4x4',
    size: '4x4',
    category: 'GRAVE',
    layout: [
      '.#..',
      '#.G#',
      '..#.',
      '...#',
    ],
    edgePorts: [
      { direction: 'NORTH', cellIndex: 0, offsetInCell: 1 }, // (1, 0)
    ],
    localGraveHints: [
      {
        gravePos: { x: 2, y: 1 },
        themeId: 'test_grave_4x4',
        sealMode: 'DIRECT_8WAY',
        sealTargetPositions: [{ x: 1, y: 1 }, { x: 2, y: 0 }],
        recommendedPushes: [
          {
            blockPos: { x: 1, y: 0 },
            dir: 'DOWN',
            destinationPos: { x: 1, y: 1 },
          },
        ],
        priority: 'HIGH',
      },
    ],
  };

  // 1-A. 90度時計回り回転の検証
  const rot90 = ThemeBlockTransformer.transform(testGraveTemplate, { rotation: 90 });

  // (x, y) -> ((4-1)-y, x) = (3 - y, x)
  // 元の (2, 1) G -> (3 - 1, 2) = (2, 2)
  assert.strictEqual(rot90.layout[2][2], 'G', 'Grave tile must be rotated to (2, 2)');
  assert.strictEqual(rot90.localGraveHints![0].gravePos.x, 2);
  assert.strictEqual(rot90.localGraveHints![0].gravePos.y, 2);

  // sealTargetPositions: (1, 1) -> (2, 1), (2, 0) -> (3, 2)
  assert.deepStrictEqual(rot90.localGraveHints![0].sealTargetPositions, [
    { x: 2, y: 1 },
    { x: 3, y: 2 },
  ]);

  // recommendedPushes: blockPos (1, 0) -> (3, 1), dir 'DOWN' -> 'LEFT', dest (1, 1) -> (2, 1)
  const push90 = rot90.localGraveHints![0].recommendedPushes[0];
  assert.deepStrictEqual(push90.blockPos, { x: 3, y: 1 }, 'Rotated push blockPos must match');
  assert.strictEqual(push90.dir, 'LEFT', 'DOWN rotated 90 deg must be LEFT');
  assert.deepStrictEqual(push90.destinationPos, { x: 2, y: 1 }, 'Rotated destinationPos must match');

  // edgePort: NORTH (1, 0) -> EAST (3, 1)
  assert.strictEqual(rot90.edgePorts![0].direction, 'EAST');
  assert.strictEqual(rot90.edgePorts![0].offsetInCell, 1);

  // 1-B. 水平反転 (flipX) の検証
  const flipX = ThemeBlockTransformer.transform(testGraveTemplate, { flipX: true });
  // (x, y) -> ((4-1)-x, y) = (3 - x, y)
  // G: (2, 1) -> (3 - 2, 1) = (1, 1)
  assert.strictEqual(flipX.layout[1][1], 'G', 'Grave tile must be horizontally flipped to (1, 1)');
  assert.strictEqual(flipX.localGraveHints![0].gravePos.x, 1);
  assert.strictEqual(flipX.localGraveHints![0].gravePos.y, 1);
  // push: blockPos (1, 0) -> (2, 0), dir 'DOWN' -> 'DOWN', dest (1, 1) -> (2, 1)
  const pushFlipX = flipX.localGraveHints![0].recommendedPushes[0];
  assert.deepStrictEqual(pushFlipX.blockPos, { x: 2, y: 0 });
  assert.strictEqual(pushFlipX.dir, 'DOWN');
  assert.deepStrictEqual(pushFlipX.destinationPos, { x: 2, y: 1 });

  // 1-C. 垂直反転 (flipY) の検証
  const flipY = ThemeBlockTransformer.transform(testGraveTemplate, { flipY: true });
  // (x, y) -> (x, 3 - y)
  // G: (2, 1) -> (2, 2)
  assert.strictEqual(flipY.layout[2][2], 'G');
  // push: blockPos (1, 0) -> (1, 3), dir 'DOWN' -> 'UP', dest (1, 1) -> (1, 2)
  const pushFlipY = flipY.localGraveHints![0].recommendedPushes[0];
  assert.deepStrictEqual(pushFlipY.blockPos, { x: 1, y: 3 });
  assert.strictEqual(pushFlipY.dir, 'UP', 'DOWN flipped vertically must be UP');
  assert.deepStrictEqual(pushFlipY.destinationPos, { x: 1, y: 2 });

  // 1-D. 回転・反転禁止フラグの保護検証
  const lockedTemplate: ThemeBlockTemplate = {
    ...testGraveTemplate,
    allowRotation: false,
    allowFlip: false,
  };
  const lockedResult = ThemeBlockTransformer.transform(lockedTemplate, {
    rotation: 90,
    flipX: true,
    flipY: true,
  });
  assert.deepStrictEqual(lockedResult.layout, lockedTemplate.layout, 'Locked template layout must not change');
  assert.deepStrictEqual(
    lockedResult.localGraveHints![0].gravePos,
    testGraveTemplate.localGraveHints![0].gravePos,
    'Locked gravePos must remain unchanged'
  );

  console.log('✓ 1. ThemeBlockTransformer rotation, flip & tactical pin preservation passed.');
}

// ============================================================================
// Test 2: SubSlot & TreasureZoneHint の回転・反転幾何変換
// ============================================================================
console.log('Testing 2: SubSlot and TreasureZoneHint transformation...');
{
  const testLargeTemplate: ThemeBlockTemplate = {
    id: 'test_large_16x16',
    size: '16x16',
    category: 'MAZE',
    layout: Array.from({ length: 16 }, () => '................'),
    subSlots: [
      {
        id: 'slot_1',
        offsetCell: { x: 1, y: 0 }, // 16x16 (4x4セル) 内のセル(1, 0)
        sizeCell: { w: 1, h: 1 },
      },
    ],
    localTreasureHints: [
      {
        id: 'treasure_zone_1',
        bounds: { x1: 4, y1: 2, x2: 10, y2: 8 },
        entryPorts: [{ x: 4, y: 5 }],
        chestCount: 6,
        isEightStepOptimal: true,
      },
    ],
  };

  // 90度回転: sizeCells = 4, sizeTiles = 16
  // slot (x=1, y=0, w=1, h=1) -> newX = 4 - (0 + 1) = 3, newY = 1
  const rot90 = ThemeBlockTransformer.transform(testLargeTemplate, { rotation: 90 });
  assert.strictEqual(rot90.subSlots![0].offsetCell.x, 3, 'SubSlot offsetCell.x rotated');
  assert.strictEqual(rot90.subSlots![0].offsetCell.y, 1, 'SubSlot offsetCell.y rotated');

  // TreasureZoneHint bounds: (4, 2) -> (15 - 2, 4) = (13, 4), (10, 8) -> (15 - 8, 10) = (7, 10)
  // bounds: x1: 7, y1: 4, x2: 13, y2: 10
  assert.strictEqual(rot90.localTreasureHints![0].bounds.x1, 7);
  assert.strictEqual(rot90.localTreasureHints![0].bounds.y1, 4);
  assert.strictEqual(rot90.localTreasureHints![0].bounds.x2, 13);
  assert.strictEqual(rot90.localTreasureHints![0].bounds.y2, 10);
  // entryPort (4, 5) -> (15 - 5, 4) = (10, 4)
  assert.deepStrictEqual(rot90.localTreasureHints![0].entryPorts[0], { x: 10, y: 4 });

  console.log('✓ 2. SubSlot and TreasureZoneHint transformation verified.');
}

// ============================================================================
// Test 3: ThemeBlockAllocator - 16x16マクログリッド階層パッキング＆100%充填
// ============================================================================
console.log('Testing 3: 16x16 Macrogrid hierarchical packing and 100% cell filling...');
{
  const allocator = new ThemeBlockAllocator(42);

  const dragonTemplate: ThemeBlockTemplate = {
    id: 'dragon_core_16x16',
    size: '16x16', // 4x4 セル
    category: 'DRAGON',
    layout: Array.from({ length: 16 }, () => '................'),
    allowRotation: false,
    dragonLairStyle: 'GRAND_TREASURE_HALL',
  };

  const homeTemplate: ThemeBlockTemplate = {
    id: 'home_start_4x4',
    size: '4x4', // 1x1 セル
    category: 'HOME',
    layout: [
      '....',
      '.H..',
      '....',
      '....',
    ],
  };

  const largeTemplate: ThemeBlockTemplate = {
    id: 'large_maze_12x12',
    size: '12x12', // 3x3 セル
    category: 'MAZE',
    layout: Array.from({ length: 12 }, () => '############'),
  };

  const mediumTemplate: ThemeBlockTemplate = {
    id: 'medium_room_8x8',
    size: '8x8', // 2x2 セル
    category: 'TREASURE',
    layout: Array.from({ length: 8 }, () => '........'),
  };

  const smallTemplate: ThemeBlockTemplate = {
    id: 'small_corridor_4x4',
    size: '4x4', // 1x1 セル
    category: 'CORRIDOR',
    layout: [
      '....',
      '....',
      '....',
      '....',
    ],
  };

  const placedBlocks = allocator.allocate({
    seed: 9999,
    dragonTemplate,
    homeTemplate,
    landmarkMinDistanceTiles: 20,
    largeTemplates: [largeTemplate, largeTemplate],
    mediumTemplates: [mediumTemplate],
    smallTemplates: [smallTemplate],
  });

  // 3-A. ドラゴンと我が家が確実に配置されていること
  const dragon = placedBlocks.find(b => b.template.id.startsWith('dragon_core'));
  const home = placedBlocks.find(b => b.template.id.startsWith('home_start'));
  assert.ok(dragon, 'Dragon template must be placed');
  assert.ok(home, 'Home template must be placed');

  // 3-B. ドラゴンと我が家のトーラス・マンハッタン距離が >= 20 タイルであること
  const dPos = { x: dragon.cellX * 4, y: dragon.cellY * 4 };
  const hPos = { x: home.cellX * 4, y: home.cellY * 4 };
  let dx = Math.abs(dPos.x - hPos.x);
  let dy = Math.abs(dPos.y - hPos.y);
  if (dx > 32) dx = 64 - dx;
  if (dy > 32) dy = 64 - dy;
  const dist = dx + dy;
  assert.ok(
    dist >= 20,
    `Dragon-Home torus Manhattan distance must be >= 20 (got ${dist})`
  );

  // 3-C. 16x16 セル空間（256セル）が重複なく100%埋め尽くされていること
  const cellCoverage = Array.from({ length: GRID_SIZE_CELLS }, () =>
    Array.from({ length: GRID_SIZE_CELLS }, () => 0)
  );

  for (const block of placedBlocks) {
    if (block.isSubSlotOverlay) continue; // サブスロットは親と重複するため除外して検証
    const sizeCells = BLOCK_SIZE_CELLS[block.template.size];
    for (let dy = 0; dy < sizeCells; dy++) {
      for (let dx = 0; dx < sizeCells; dx++) {
        const gx = (block.cellX + dx) % GRID_SIZE_CELLS;
        const gy = (block.cellY + dy) % GRID_SIZE_CELLS;
        cellCoverage[gy][gx]++;
      }
    }
  }

  let emptyCells = 0;
  let overlappingCells = 0;
  for (let cy = 0; cy < GRID_SIZE_CELLS; cy++) {
    for (let cx = 0; cx < GRID_SIZE_CELLS; cx++) {
      if (cellCoverage[cy][cx] === 0) emptyCells++;
      if (cellCoverage[cy][cx] > 1) overlappingCells++;
    }
  }

  assert.strictEqual(emptyCells, 0, 'Macrogrid must be 100% covered with zero empty cells');
  assert.strictEqual(overlappingCells, 0, 'Macrogrid must have zero overlapping base blocks');

  console.log('✓ 3. 16x16 Macrogrid hierarchical packing and 100% cell filling verified.');
}

// ============================================================================
// Test 4: サブスロット・オーバーレイ合成と WorldMap への適用・MapTacticalMetadata 生成
// ============================================================================
console.log('Testing 4: SubSlot overlay and WorldMap MapTacticalMetadata generation...');
{
  const allocator = new ThemeBlockAllocator(777);
  const worldMap = new WorldMap(64, 64);

  // 親ブロック（16x16）: 全面 '.' の中に 4x4 のサブスロットを1つ持つ
  const parentTemplate: ThemeBlockTemplate = {
    id: 'parent_hall_16x16',
    size: '16x16',
    category: 'TREASURE',
    layout: Array.from({ length: 16 }, () => '................'),
    allowRotation: false,
    allowFlip: false,
    subSlots: [
      {
        id: 'grave_subslot_1',
        offsetCell: { x: 2, y: 2 }, // 親ブロック内のセル(2, 2) = タイルオフセット(8, 8)
        sizeCell: { w: 1, h: 1 },
        allowedCategories: ['GRAVE'],
      },
    ],
  };

  // サブスロット用墓ブロック（4x4）
  const subGraveTemplate: ThemeBlockTemplate = {
    id: 'sub_puzzle_grave_4x4',
    size: '4x4',
    category: 'GRAVE',
    layout: [
      '#.#.',
      '.G.#',
      '#...',
      '..#.',
    ],
    allowRotation: false,
    allowFlip: false,
    localGraveHints: [
      {
        gravePos: { x: 1, y: 1 },
        themeId: 'sub_puzzle_grave_4x4',
        sealMode: 'DIRECT_8WAY',
        sealTargetPositions: [{ x: 1, y: 0 }],
        recommendedPushes: [
          {
            blockPos: { x: 0, y: 0 },
            dir: 'RIGHT',
            destinationPos: { x: 1, y: 0 },
          },
        ],
        priority: 'HIGH',
      },
    ],
  };

  const homeTemplate: ThemeBlockTemplate = {
    id: 'home_simple_4x4',
    size: '4x4',
    category: 'HOME',
    layout: [
      '....',
      '.H..',
      '....',
      '....',
    ],
    allowRotation: false,
    allowFlip: false,
  };

  // 親ブロックを大ブロックとして渡し、サブスロット用小ブロックを指定
  const placedBlocks = allocator.allocate({
    seed: 12345,
    homeTemplate,
    largeTemplates: [parentTemplate],
    subSlotSmallTemplates: [subGraveTemplate],
  });

  // サブスロットオーバーレイブロックが存在することを確認
  const overlayBlock = placedBlocks.find(b => b.isSubSlotOverlay === true);
  assert.ok(overlayBlock, 'Subslot overlay block must be created');
  assert.strictEqual(overlayBlock.template.id, 'sub_puzzle_grave_4x4');

  // 親ブロックのセル座標
  const parentBlock = placedBlocks.find(b => b.template.id === 'parent_hall_16x16');
  assert.ok(parentBlock);
  assert.strictEqual(overlayBlock.cellX, (parentBlock.cellX + 2) % 16);
  assert.strictEqual(overlayBlock.cellY, (parentBlock.cellY + 2) % 16);

  // WorldMap への適用
  const metadata = allocator.applyToWorldMap(worldMap, placedBlocks);

  // 4-A. WorldMap の該当絶対座標にサブスロットの墓 'G' がスタンプされていること
  const expectedGraveWorldPos = {
    x: (overlayBlock.cellX * 4 + 1) % 64,
    y: (overlayBlock.cellY * 4 + 1) % 64,
  };
  assert.strictEqual(
    worldMap.getBaseTile(expectedGraveWorldPos),
    'GRAVE',
    'Grave tile must be stamped at absolute world position'
  );

  // 4-B. MapTacticalMetadata が WorldMap に付与されていること
  assert.ok(worldMap.tacticalMetadata, 'WorldMap must have tacticalMetadata attached');
  assert.strictEqual(worldMap.tacticalMetadata, metadata);

  // 4-C. gravePuzzleHints の座標がワールド絶対座標に変換されていること
  const hint = metadata.gravePuzzleHints.find(h => h.themeId === 'sub_puzzle_grave_4x4');
  assert.ok(hint, 'GravePuzzleHint from subslot must be collected into metadata');
  assert.deepStrictEqual(hint.gravePos, expectedGraveWorldPos, 'Metadata gravePos must match absolute world pos');

  // recommendedPushes のワールド座標検証: local blockPos (0, 0)
  const expectedPushBlockPos = {
    x: (overlayBlock.cellX * 4 + 0) % 64,
    y: (overlayBlock.cellY * 4 + 0) % 64,
  };
  assert.deepStrictEqual(hint.recommendedPushes[0].blockPos, expectedPushBlockPos);
  assert.strictEqual(hint.recommendedPushes[0].dir, 'RIGHT');

  console.log('✓ 4. SubSlot overlay and WorldMap MapTacticalMetadata generation verified.');
}

console.log('--- ✓ All Phase 14 Step 1 Theme Block Allocator Tests Passed Successfully! ---');
