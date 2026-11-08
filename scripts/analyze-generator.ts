import { WorldMap } from '../src/models/WorldMap.js';
import { SeedRandom } from '../src/core/SeedRandom.js';
import { TuningPresetResolver } from '../src/config/TuningPresetResolver.js';
import { ProceduralMapGenerator } from '../src/systems/ProceduralMapGenerator.js';
import {
  HierarchicalThemeBlockGenerator,
} from '../src/systems/generator/HierarchicalThemeBlockGenerator.js';
import { ThemeBlockAllocator } from '../src/systems/generator/ThemeBlockAllocator.js';
import {
  ALL_THEME_BLOCKS,
  DRAGON_8x8_MAZE_LAIR,
  DRAGON_12x12_MAZE_LAIR,
  DRAGON_16x16_GRAND_HALL,
  HOME_4x4_COZY,
  HOME_8x8_ESTATE,
  GRAVE_16x16_NECROPOLIS,
  TREASURE_16x16_GRAND_VAULT,
  TREASURE_12x12_COMPLEX,
  MAZE_12x12_SPIRAL,
} from '../src/systems/generator/blocks/index.js';
import { BLOCK_SIZE_CELLS, PlacedThemeBlock } from '../src/systems/generator/ThemeBlockTypes.js';

interface StepStats {
  blocks: number;
  staticWalls: number;
  chests: number;
  graves: number;
  emptyFloor: number;
  isolatedBlocks: number; // 孤立した1マスのブロック
}

function countStats(map: WorldMap): StepStats {
  let blocks = 0;
  let staticWalls = 0;
  let chests = 0;
  let graves = 0;
  let emptyFloor = 0;
  let isolatedBlocks = 0;

  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const pos = { x, y };
      const base = map.getBaseTile(pos);
      const obj = map.getObject(pos);

      if (obj === 'BLOCK') {
        blocks++;
        // 4近傍をチェックして隣接にBLOCK/WALL_STATICがあるか調べる
        let neighbors = 0;
        const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
        for (const d of dirs) {
          const np = map.wrapPosition({ x: x + d.dx, y: y + d.dy });
          if (map.getObject(np) === 'BLOCK' || map.getBaseTile(np) === 'WALL_STATIC') {
            neighbors++;
          }
        }
        if (neighbors === 0) {
          isolatedBlocks++;
        }
      }
      if (base === 'WALL_STATIC') staticWalls++;
      if (obj === 'CHEST' || obj === 'CHEST_DRAGON') chests++;
      if (base === 'GRAVE') graves++;
      if (base === 'EMPTY' && obj === 'NONE') emptyFloor++;
    }
  }

  return { blocks, staticWalls, chests, graves, emptyFloor, isolatedBlocks };
}

function renderAscii(map: WorldMap, startX = 0, startY = 0, width = 64, height = 32): string {
  const lines: string[] = [];
  for (let y = startY; y < startY + height; y++) {
    let line = '';
    for (let x = startX; x < startX + width; x++) {
      const pos = map.wrapPosition({ x, y });
      const base = map.getBaseTile(pos);
      const obj = map.getObject(pos);
      const item = map.getItem(pos);

      if (pos.x === map.dragonCenter.x && pos.y === map.dragonCenter.y) {
        line += 'D';
      } else if (pos.x === map.homePos.x && pos.y === map.homePos.y) {
        line += 'H';
      } else if (obj === 'BLOCK') {
        line += '#';
      } else if (base === 'WALL_STATIC') {
        line += 'W';
      } else if (obj === 'CHEST') {
        line += 'C';
      } else if (obj === 'CHEST_DRAGON') {
        line += 'c';
      } else if (base === 'GRAVE') {
        line += 'G';
      } else if (item !== 'NONE') {
        line += '!';
      } else {
        line += '.';
      }
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// HierarchicalThemeBlockGenerator の各ステップを分解実行して状態を記録する関数
function runStepByStep(seed: number, topology: string = 'STANDARD_ROOMS') {
  const map = new WorldMap(64, 64);
  const rng = new SeedRandom(seed);

  // 1. マップクリア
  map.clearWarpPairs();
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      map.setBaseTile({ x, y }, 'EMPTY');
      map.setObject({ x, y }, 'NONE');
      map.setItem({ x, y }, 'NONE');
    }
  }

  // 2. テンプレート選定
  // HierarchicalThemeBlockGenerator の private selectTemplatesForConfiguration を模擬
  const anyGen = HierarchicalThemeBlockGenerator as any;
  const config = anyGen.selectTemplatesForConfiguration(topology, undefined, rng);

  // 3. アロケーション
  const allocator = new ThemeBlockAllocator(seed);
  const placedBlocks = allocator.allocate({
    seed,
    dragonTemplate: config.dragonTemplate,
    homeTemplate: config.homeTemplate,
    landmarkMinDistanceTiles: 20,
    largeTemplates: config.largeTemplates,
    mediumTemplates: config.mediumTemplates,
    smallTemplates: config.smallTemplates,
    subSlotSmallTemplates: config.subSlotSmallTemplates,
    subSlotMediumTemplates: config.subSlotMediumTemplates,
    maxInstancesPerBlock: config.maxInstancesPerBlock,
  });

  // ブロック統計
  const blockHistogram = new Map<string, number>();
  let totalCellsOccupied = 0;
  for (const b of placedBlocks) {
    if (b.isSubSlotOverlay) continue;
    blockHistogram.set(b.template.id, (blockHistogram.get(b.template.id) ?? 0) + 1);
    const sizeCells = BLOCK_SIZE_CELLS[b.template.size];
    totalCellsOccupied += sizeCells * sizeCells;
  }
  const subSlotHistogram = new Map<string, number>();
  for (const b of placedBlocks) {
    if (b.isSubSlotOverlay) {
      subSlotHistogram.set(b.template.id, (subSlotHistogram.get(b.template.id) ?? 0) + 1);
    }
  }

  // Step 4: applyToWorldMap
  allocator.applyToWorldMap(map, placedBlocks, { activateChestSlots: false });
  const statsAfterStep4 = countStats(map);

  // Step 5: syncDragonAndHomePositions
  anyGen.syncDragonAndHomePositions(map, placedBlocks, undefined, rng);
  const statsAfterStep5 = countStats(map);

  // Step 6: connectEdgePorts
  anyGen.connectEdgePorts(map, placedBlocks, rng);
  const statsAfterStep6 = countStats(map);

  // Step 7: activateBudgets
  anyGen.activateBudgets(map, 100, 20, placedBlocks, rng);
  const statsAfterStep7 = countStats(map);

  // Step 8: ensureBootstrapRequirements
  anyGen.ensureBootstrapRequirements(map, 'NORMAL', 'STANDARD', 'BALANCED', rng);
  const statsAfterStep8 = countStats(map);

  // Step 9: setupWarpNetwork
  anyGen.setupWarpNetwork(map, 'BALANCED', rng);
  const statsAfterStep9 = countStats(map);

  // Step 10: enforceCriticalClearance & ensureDragonFireballClearance
  anyGen.enforceCriticalClearance(map, map.homePos, map.dragonCenter);
  ProceduralMapGenerator.ensureDragonFireballClearance(map, map.dragonCenter);
  const statsAfterStep10 = countStats(map);

  return {
    placedBlocks,
    blockHistogram,
    subSlotHistogram,
    totalCellsOccupied,
    stepStats: {
      step4: statsAfterStep4,
      step5: statsAfterStep5,
      step6: statsAfterStep6,
      step7: statsAfterStep7,
      step8: statsAfterStep8,
      step9: statsAfterStep9,
      step10: statsAfterStep10,
    },
    map,
  };
}

console.log('=== MULTI-SEED RUN ANALYSIS ===');
const topologies = ['STANDARD_ROOMS', 'SPIRAL_LABYRINTH', 'NARROW_MAZE', 'PILLAR_GRID'];
const testSeeds = [12345, 67890, 42, 99999];

for (const topo of topologies) {
  console.log(`\n==================================================`);
  console.log(`TOPOLOGY: ${topo}`);
  console.log(`==================================================`);

  for (const seed of testSeeds.slice(0, 2)) {
    console.log(`\n--- SEED: ${seed} ---`);
    const res = runStepByStep(seed, topo);

    console.log(`Total placed blocks (excl subslots): ${[...res.blockHistogram.values()].reduce((a, b) => a + b, 0)} (Cells occupied: ${res.totalCellsOccupied}/256)`);
    console.log('Placed Block Counts:');
    const sortedCounts = [...res.blockHistogram.entries()].sort((a, b) => b[1] - a[1]);
    for (const [id, cnt] of sortedCounts) {
      console.log(`  ${id.padEnd(28)}: ${cnt}`);
    }
    if (res.subSlotHistogram.size > 0) {
      console.log('SubSlot Overlay Counts:');
      for (const [id, cnt] of res.subSlotHistogram.entries()) {
        console.log(`  [sub] ${id.padEnd(22)}: ${cnt}`);
      }
    }

    console.log('\nStep Stats Transition:');
    console.log('Step | BLOCK | STATIC | CHEST | GRAVE | EMPTY | ISOLATED_BLOCKS');
    console.log(`St.4 | ${String(res.stepStats.step4.blocks).padStart(5)} | ${String(res.stepStats.step4.staticWalls).padStart(6)} | ${String(res.stepStats.step4.chests).padStart(5)} | ${String(res.stepStats.step4.graves).padStart(5)} | ${String(res.stepStats.step4.emptyFloor).padStart(5)} | ${String(res.stepStats.step4.isolatedBlocks).padStart(15)}`);
    console.log(`St.5 | ${String(res.stepStats.step5.blocks).padStart(5)} | ${String(res.stepStats.step5.staticWalls).padStart(6)} | ${String(res.stepStats.step5.chests).padStart(5)} | ${String(res.stepStats.step5.graves).padStart(5)} | ${String(res.stepStats.step5.emptyFloor).padStart(5)} | ${String(res.stepStats.step5.isolatedBlocks).padStart(15)}`);
    console.log(`St.6 | ${String(res.stepStats.step6.blocks).padStart(5)} | ${String(res.stepStats.step6.staticWalls).padStart(6)} | ${String(res.stepStats.step6.chests).padStart(5)} | ${String(res.stepStats.step6.graves).padStart(5)} | ${String(res.stepStats.step6.emptyFloor).padStart(5)} | ${String(res.stepStats.step6.isolatedBlocks).padStart(15)}`);
    console.log(`St.7 | ${String(res.stepStats.step7.blocks).padStart(5)} | ${String(res.stepStats.step7.staticWalls).padStart(6)} | ${String(res.stepStats.step7.chests).padStart(5)} | ${String(res.stepStats.step7.graves).padStart(5)} | ${String(res.stepStats.step7.emptyFloor).padStart(5)} | ${String(res.stepStats.step7.isolatedBlocks).padStart(15)}`);
    console.log(`St.10| ${String(res.stepStats.step10.blocks).padStart(5)} | ${String(res.stepStats.step10.staticWalls).padStart(6)} | ${String(res.stepStats.step10.chests).padStart(5)} | ${String(res.stepStats.step10.graves).padStart(5)} | ${String(res.stepStats.step10.emptyFloor).padStart(5)} | ${String(res.stepStats.step10.isolatedBlocks).padStart(15)}`);

    // 空き床率（EMPTY / 4096）
    const emptyRatio = ((res.stepStats.step10.emptyFloor / 4096) * 100).toFixed(1);
    console.log(`Final Empty Floor Ratio: ${emptyRatio}%`);

    if (seed === 12345 && topo === 'STANDARD_ROOMS') {
      console.log('\n--- ASCII Map (Top-Left 48x24) ---');
      console.log(renderAscii(res.map, 0, 0, 48, 24));
    }
  }
}
