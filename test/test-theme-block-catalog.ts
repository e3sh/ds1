import assert from 'node:assert';
import { WorldMap } from '../src/models/WorldMap.js';
import {
  BLOCK_SIZE_TILES,
  BLOCK_SIZE_CELLS,
  GRID_SIZE_CELLS,
} from '../src/systems/generator/ThemeBlockTypes.js';
import {
  ALL_THEME_BLOCKS,
  ALL_GRAVE_BLOCKS,
  ALL_TREASURE_AND_MAZE_BLOCKS,
  ALL_DRAGON_AND_HOME_BLOCKS,
  ALL_OPEN_AND_ENCLOSED_BLOCKS,
  OPEN_4x4_PLAINS,
  OPEN_8x8_COURTYARD,
  ENCLOSED_4x4_BOX,
  ENCLOSED_8x8_VAULT,
  SUPPLY_4x4_PANTRY,
  SUPPLY_4x4_CACHE,
  SUPPLY_4x4_CROSSROAD,
  GRAVE_4x4_A1,
  GRAVE_8x8_B1,
  DRAGON_8x8_MAZE_LAIR,
  DRAGON_12x12_MAZE_LAIR,
  DRAGON_16x16_GRAND_HALL,
  DRAGON_24x24_CITADEL,
  HOME_4x4_COZY,
  HOME_8x8_ESTATE,
} from '../src/systems/generator/blocks/index.js';
import { ThemeBlockAllocator } from '../src/systems/generator/ThemeBlockAllocator.js';

console.log('--- Phase 14 Step 2: Theme Block Catalog Verification ---');

// ============================================================================
// Test 1: 全カタログブロックのサイズ・文字列長・フォーマット厳密検証
// ============================================================================
console.log('Testing 1: Template layout dimensions and character validity...');
{
  assert.ok(ALL_THEME_BLOCKS.length >= 15, `Expected at least 15 theme blocks, got ${ALL_THEME_BLOCKS.length}`);

  for (const block of ALL_THEME_BLOCKS) {
    const expectedSize = BLOCK_SIZE_TILES[block.size];
    assert.strictEqual(
      block.layout.length,
      expectedSize,
      `Block ${block.id} row count (${block.layout.length}) must match ${expectedSize}`
    );

    for (let r = 0; r < expectedSize; r++) {
      const row = block.layout[r];
      assert.strictEqual(
        row.length,
        expectedSize,
        `Block ${block.id} row ${r} length (${row.length}) must match ${expectedSize}`
      );
    }
  }
  console.log(`✓ 1. All ${ALL_THEME_BLOCKS.length} theme block dimensions verified successfully.`);
}

// ============================================================================
// Test 2: ドラゴンブロック中心5×5コア規約検証
// ============================================================================
console.log('Testing 2: Dragon blocks 5x5 center core invariant specification...');
{
  const dragonBlocks = [
    { tpl: DRAGON_8x8_MAZE_LAIR, cx: 3, cy: 3 },
    { tpl: DRAGON_12x12_MAZE_LAIR, cx: 5, cy: 5 },
    { tpl: DRAGON_16x16_GRAND_HALL, cx: 7, cy: 7 },
    { tpl: DRAGON_24x24_CITADEL, cx: 11, cy: 11 },
  ];

  for (const { tpl, cx, cy } of dragonBlocks) {
    // 2-A. ドラゴン十字部位 (BODY, UP, LFT, RGT, DWN) は床 ('.')
    assert.strictEqual(tpl.layout[cy][cx], '.', `${tpl.id}: BODY (center) must be '.'`);
    assert.strictEqual(tpl.layout[cy - 1][cx], '.', `${tpl.id}: CENTER_HEAD (up) must be '.'`);
    assert.strictEqual(tpl.layout[cy][cx - 1], '.', `${tpl.id}: LEFT_HEAD (left) must be '.'`);
    assert.strictEqual(tpl.layout[cy][cx + 1], '.', `${tpl.id}: RIGHT_HEAD (right) must be '.'`);
    assert.strictEqual(tpl.layout[cy + 1][cx], '.', `${tpl.id}: TAIL (down) must be '.'`);

    // 2-B. 王冠出現マス 4箇所 (斜め) は CHEST_DRAGON ('D')
    assert.strictEqual(tpl.layout[cy - 1][cx - 1], 'D', `${tpl.id}: Crown NW must be 'D'`);
    assert.strictEqual(tpl.layout[cy - 1][cx + 1], 'D', `${tpl.id}: Crown NE must be 'D'`);
    assert.strictEqual(tpl.layout[cy + 1][cx - 1], 'D', `${tpl.id}: Crown SW must be 'D'`);
    assert.strictEqual(tpl.layout[cy + 1][cx + 1], 'D', `${tpl.id}: Crown SE must be 'D'`);

    // 2-C. 3首正面アンチ・ブロック押し込みバリア
    assert.strictEqual(tpl.layout[cy - 2][cx], 'P', `${tpl.id}: Center head front must be POTION ('P')`);
    assert.strictEqual(tpl.layout[cy][cx - 2], 'C', `${tpl.id}: Left head front must be CHEST ('C')`);
    assert.strictEqual(tpl.layout[cy][cx + 2], 'C', `${tpl.id}: Right head front must be CHEST ('C')`);

    // 2-D. 南進入路
    assert.strictEqual(tpl.layout[cy + 2][cx], '.', `${tpl.id}: South entrance must be '.'`);

    // 2-E. 回転禁止フラグが立っていること
    assert.strictEqual(tpl.allowRotation, false, `${tpl.id} must disallow rotation`);
  }
  console.log('✓ 2. Dragon blocks 5x5 center core invariant verified.');
}

// ============================================================================
// Test 3: 墓ブロックのモンスター斜め抜け防止＆戦術ヒント検証
// ============================================================================
console.log('Testing 3: Grave blocks structure and tactical hints...');
{
  for (const block of ALL_GRAVE_BLOCKS) {
    // 墓 G の存在確認
    let graveCount = 0;
    for (const row of block.layout) {
      graveCount += (row.match(/G/g) || []).length;
    }
    assert.ok(graveCount >= 1, `Grave block ${block.id} must contain at least 1 'G' tile`);

    // 戦術ヒントの確認
    assert.ok(block.localGraveHints, `Grave block ${block.id} must have localGraveHints`);
    assert.strictEqual(block.localGraveHints!.length, graveCount);

    for (const hint of block.localGraveHints!) {
      assert.strictEqual(
        block.layout[hint.gravePos.y][hint.gravePos.x],
        'G',
        `gravePos in hint must point to 'G' in block ${block.id}`
      );
      assert.ok(hint.sealTargetPositions.length > 0, 'sealTargetPositions must not be empty');

      // 8x8箱型墓は BOX_EXITS
      if (block.size === '8x8') {
        assert.strictEqual(hint.sealMode, 'BOX_EXITS');
      }
    }
  }

  // GRAVE_8x8_B1 の 4 出口封鎖ヒントの確認
  assert.strictEqual(GRAVE_8x8_B1.localGraveHints![0].sealTargetPositions.length, 4);
  assert.strictEqual(GRAVE_8x8_B1.localGraveHints![0].recommendedPushes.length, 4);

  console.log('✓ 3. Grave blocks structure and tactical hints verified.');
}

// ============================================================================
// Test 4: 我が家スタートブロックの初期必須アイテム完備検証
// ============================================================================
console.log('Testing 4: Home blocks bootstrap items completeness...');
{
  const requiredChars = ['H', '!', 'K', 'R', '+', 'S', 'P', '$'];

  for (const homeBlock of [HOME_4x4_COZY, HOME_8x8_ESTATE]) {
    const fullText = homeBlock.layout.join('');
    for (const ch of requiredChars) {
      assert.ok(
        fullText.includes(ch),
        `Home block ${homeBlock.id} must contain required item symbol '${ch}'`
      );
    }
  }
  console.log('✓ 4. Home blocks bootstrap items verified.');
}

// ============================================================================
// Test 5: サブスロット定義の幾何境界内検証
// ============================================================================
console.log('Testing 5: SubSlot definition bounds verification...');
{
  const blocksWithSubslots = ALL_THEME_BLOCKS.filter(b => b.subSlots && b.subSlots.length > 0);
  assert.ok(blocksWithSubslots.length >= 3, 'Must have multiple blocks with subslots');

  for (const block of blocksWithSubslots) {
    const maxCells = BLOCK_SIZE_CELLS[block.size];
    for (const slot of block.subSlots!) {
      assert.ok(
        slot.offsetCell.x >= 0 && slot.offsetCell.x + slot.sizeCell.w <= maxCells,
        `Subslot ${slot.id} in ${block.id} X bounds exceed parent size`
      );
      assert.ok(
        slot.offsetCell.y >= 0 && slot.offsetCell.y + slot.sizeCell.h <= maxCells,
        `Subslot ${slot.id} in ${block.id} Y bounds exceed parent size`
      );
    }
  }
  console.log('✓ 5. SubSlot definition bounds verified.');
}

// ============================================================================
// Test 6: カタログブロック群による 16x16 完全階層パッキング＆WorldMapスタンプ検証
// ============================================================================
console.log('Testing 6: End-to-end allocation using catalog blocks...');
{
  const allocator = new ThemeBlockAllocator(55555);

  const largeTemplates = ALL_THEME_BLOCKS.filter(b => b.size === '16x16' || b.size === '12x12');
  const mediumTemplates = ALL_THEME_BLOCKS.filter(b => b.size === '8x8' && b.category !== 'DRAGON' && b.category !== 'HOME');
  const smallTemplates = ALL_THEME_BLOCKS.filter(b => b.size === '4x4' && b.category !== 'HOME');

  const subSlotSmallTemplates = ALL_GRAVE_BLOCKS.filter(b => b.size === '4x4');
  const subSlotMediumTemplates = ALL_GRAVE_BLOCKS.filter(b => b.size === '8x8');

  // 異なる複数のシードで実行検証
  const testSeeds = [101, 202, 303, 404, 505];
  for (const seed of testSeeds) {
    const worldMap = new WorldMap(64, 64);
    const placedBlocks = allocator.allocate({
      seed,
      dragonTemplate: DRAGON_16x16_GRAND_HALL,
      homeTemplate: HOME_4x4_COZY,
      landmarkMinDistanceTiles: 20,
      largeTemplates,
      mediumTemplates,
      smallTemplates,
      subSlotSmallTemplates,
      subSlotMediumTemplates,
    });

    // 6-A. 16x16 セル空間が 100% 隙間なく重複なく充填されていること
    const cellCoverage = Array.from({ length: GRID_SIZE_CELLS }, () =>
      Array.from({ length: GRID_SIZE_CELLS }, () => 0)
    );

    for (const block of placedBlocks) {
      if (block.isSubSlotOverlay) continue;
      const sizeCells = BLOCK_SIZE_CELLS[block.template.size];
      for (let dy = 0; dy < sizeCells; dy++) {
        for (let dx = 0; dx < sizeCells; dx++) {
          const gx = (block.cellX + dx) % GRID_SIZE_CELLS;
          const gy = (block.cellY + dy) % GRID_SIZE_CELLS;
          cellCoverage[gy][gx]++;
        }
      }
    }

    for (let cy = 0; cy < GRID_SIZE_CELLS; cy++) {
      for (let cx = 0; cx < GRID_SIZE_CELLS; cx++) {
        assert.strictEqual(
          cellCoverage[cy][cx],
          1,
          `Seed ${seed}: Cell (${cx}, ${cy}) coverage count must be exactly 1`
        );
      }
    }

    // 6-B. WorldMap へのスタンプ展開とメタデータ集計
    const metadata = allocator.applyToWorldMap(worldMap, placedBlocks);
    assert.ok(worldMap.tacticalMetadata, `Seed ${seed}: WorldMap must have tacticalMetadata`);
    assert.ok(metadata.gravePuzzleHints.length > 0, `Seed ${seed}: Must collect grave hints`);
    assert.strictEqual(metadata.dragonLairStyle, 'GRAND_TREASURE_HALL');
    assert.ok(metadata.recommendedRelocateAnchors.length > 0, 'Must have relocate anchors');
  }

  console.log('✓ 6. End-to-end allocation across multiple seeds verified successfully.');
}

// ============================================================================
// Test 7: 空き地・密閉・補給ブロック（Open, Enclosed, Supply）の仕様検証
// ============================================================================
console.log('Testing 7: Open, enclosed, and supply blocks specifications...');
{
  assert.strictEqual(ALL_OPEN_AND_ENCLOSED_BLOCKS.length, 10, 'Must have exactly 10 open/enclosed/supply blocks');
  assert.strictEqual(ALL_THEME_BLOCKS.length, 31, 'Total theme blocks must be 31');

  // 7-A. 完全空床ブロック (4x4 PLAINS, 8x8 COURTYARD) の床タイル整合性
  for (const block of [OPEN_4x4_PLAINS, OPEN_8x8_COURTYARD]) {
    for (const row of block.layout) {
      assert.ok(/^(\.)+$/.test(row), `${block.id} must consist purely of empty floor '.'`);
    }
    assert.ok(block.edgePorts && block.edgePorts.length > 0, `${block.id} must have edgePorts`);
  }

  // 7-B. 密閉部屋ブロック (ENCLOSED) の突破口 (localBreachShortcuts) 検証
  for (const block of [ENCLOSED_4x4_BOX, ENCLOSED_8x8_VAULT]) {
    assert.ok(block.localBreachShortcuts && block.localBreachShortcuts.length > 0, `${block.id} must have breach shortcuts`);
    for (const breach of block.localBreachShortcuts!) {
      assert.strictEqual(block.layout[breach.y][breach.x], '#', `${block.id} breach shortcut must target a '#' block`);
    }
  }

  // 7-C. 補給所ブロック (SUPPLY) の物資（C/c, $, P）およびローカル戦術ピン検証
  for (const block of [SUPPLY_4x4_PANTRY, SUPPLY_4x4_CACHE, SUPPLY_4x4_CROSSROAD]) {
    const fullText = block.layout.join('');
    assert.ok(fullText.includes('$'), `${block.id} must include coin symbol '$'`);
    assert.ok(fullText.includes('P'), `${block.id} must include potion symbol 'P'`);
    assert.ok(fullText.includes('C') || fullText.includes('c'), `${block.id} must include chest symbol`);
    assert.ok(block.localTreasureHints && block.localTreasureHints.length > 0, `${block.id} must have localTreasureHints`);
  }

  console.log('✓ 7. Open, enclosed, and supply blocks verified successfully.');
}

console.log('--- ✓ All Phase 14 Step 2 Theme Block Catalog Tests Passed Successfully! ---');
