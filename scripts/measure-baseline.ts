import { GameEngine } from '../src/core/GameEngine.js';
import { SeedRandom } from '../src/core/SeedRandom.js';
import { GameEventBus } from '../src/core/GameEventBus.js';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { DungeonTopology, MapDifficulty, PlayPacingMode } from '../src/models/Types.js';
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

interface RunResult {
  runIndex: number;
  seed: number;
  topology: DungeonTopology;
  dragonLairStyle: string;
  won: boolean;
  turns: number;
  deathCause: string;
  finalPhase: string;
  playerHp: number;
  playerMaxHp: number;
  playerMp: number;
  playerExp: number;
  playerStr: number;
  hasSword: boolean;
  unlockedBreak: boolean;
  unlockedDiagonal: boolean;
  dragonHeadsAlive: number;
  crownsDelivered: number;
  blockCounts: {
    open: number;
    enclosed: number;
    supply: number;
    grave: number;
    treasure: number;
    maze: number;
    home: number;
    dragon: number;
    other: number;
  };
}

function getPlacedBlockCounts(seed: number, topology: DungeonTopology) {
  const rng = new SeedRandom(seed);
  let dragonTemplate;
  if (topology === 'FORTRESS_ARENA' || topology === 'GRAND_HALL' as any) {
    dragonTemplate = DRAGON_16x16_GRAND_HALL;
  } else if (topology === 'NARROW_MAZE') {
    dragonTemplate = rng.chance(0.5) ? DRAGON_8x8_MAZE_LAIR : DRAGON_12x12_MAZE_LAIR;
  } else {
    const candidates = [DRAGON_16x16_GRAND_HALL, DRAGON_12x12_MAZE_LAIR, DRAGON_8x8_MAZE_LAIR];
    dragonTemplate = candidates[rng.nextInt(0, candidates.length - 1)];
  }

  const homeTemplate = rng.chance(0.5) ? HOME_8x8_ESTATE : HOME_4x4_COZY;
  const largePool = [
    GRAVE_16x16_NECROPOLIS,
    TREASURE_16x16_GRAND_VAULT,
    TREASURE_12x12_COMPLEX,
    MAZE_12x12_SPIRAL,
  ];
  const largeTemplates = rng.shuffle([...largePool]);
  const mediumPool = ALL_THEME_BLOCKS.filter(b => b.size === '8x8' && b.category !== 'DRAGON' && b.category !== 'HOME');
  const mediumTemplates = rng.shuffle([...mediumPool]);
  const smallPool = ALL_THEME_BLOCKS.filter(b => b.size === '4x4' && b.category !== 'HOME');
  const smallTemplates = rng.shuffle([...smallPool]);

  const allocator = new ThemeBlockAllocator(seed);
  const placed = allocator.allocate({
    seed,
    dragonTemplate,
    homeTemplate,
    landmarkMinDistanceTiles: 20,
    largeTemplates,
    mediumTemplates,
    smallTemplates,
    subSlotSmallTemplates: smallTemplates,
    subSlotMediumTemplates: mediumTemplates,
  });

  const counts = {
    open: 0,
    enclosed: 0,
    supply: 0,
    grave: 0,
    treasure: 0,
    maze: 0,
    home: 0,
    dragon: 0,
    other: 0,
  };

  for (const b of placed) {
    const id = b.template.id.toLowerCase();
    if (id.startsWith('open_')) counts.open++;
    else if (id.startsWith('enclosed_')) counts.enclosed++;
    else if (id.startsWith('supply_')) counts.supply++;
    else if (id.startsWith('grave_')) counts.grave++;
    else if (id.startsWith('treasure_')) counts.treasure++;
    else if (id.startsWith('maze_')) counts.maze++;
    else if (id.startsWith('home_')) counts.home++;
    else if (id.startsWith('dragon_')) counts.dragon++;
    else counts.other++;
  }

  return counts;
}

async function runBenchmark() {
  const topologies: DungeonTopology[] = [
    'STANDARD_ROOMS',
    'PILLAR_GRID',
    'NARROW_MAZE',
    'SPIRAL_LABYRINTH',
    'FORTRESS_ARENA',
    'MULTI_SECTOR',
  ];

  const seedsPerTopology = 20;
  const maxTurnsLimit = 1600;
  const difficulty: MapDifficulty = 'NORMAL';
  const pacing: PlayPacingMode = 'STANDARD';
  const baseSeed = 20261105;

  console.log('========================================================================');
  console.log(`  Phase 14 Baseline Benchmark: 6 Topologies x ${seedsPerTopology} Seeds (Total: ${topologies.length * seedsPerTopology} Runs, MaxTurns: ${maxTurnsLimit})`);
  console.log('========================================================================\n');

  const allResults: RunResult[] = [];
  const masterRng = new SeedRandom(baseSeed);
  const totalStartTime = Date.now();

  for (const topology of topologies) {
    console.log(`>>> Benchmarking Topology: ${topology} ...`);
    const topoStartTime = Date.now();

    for (let i = 0; i < seedsPerTopology; i++) {
      const runSeed = masterRng.nextInt(1, 0x7fffffff);
      const eventBus = new GameEventBus();
      const runRng = new SeedRandom(runSeed);
      const engine = new GameEngine({ rng: runRng, eventBus });

      engine.startProceduralGame({
        seed: runSeed,
        topology,
        difficulty,
        pacing,
      });

      const map = engine.getMap();
      const dragonLairStyle = map.tacticalMetadata?.dragonLairStyle ?? 'STANDARD_FORTRESS';
      const blockCounts = getPlacedBlockCounts(runSeed, topology);

      const bot = new AutoPlayBot({
        profile: 'STANDARD',
        maxTurnsLimit,
      });

      let turns = 0;
      while (turns < maxTurnsLimit && engine.getState() === 'PLAYING') {
        turns++;
        engine.stepFrame(100);
        bot.step(engine);
      }

      const won = engine.getState() === 'STAGECLEAR';
      const player = engine.getPlayer();
      const dragon = engine.getDragon();
      const headsAlive = dragon ? dragon.heads.filter(h => h.isAlive).length : 0;
      const deathCause = won
        ? 'NONE'
        : (player.deathInfo?.cause ?? (turns >= maxTurnsLimit ? 'TIMEOUT_LIMIT' : 'UNKNOWN'));

      const result: RunResult = {
        runIndex: i,
        seed: runSeed,
        topology,
        dragonLairStyle,
        won,
        turns,
        deathCause,
        finalPhase: bot.currentPhase,
        playerHp: player.hp,
        playerMaxHp: player.maxHp,
        playerMp: player.magicPower,
        playerExp: player.experience,
        playerStr: player.strength,
        hasSword: player.hasSword,
        unlockedBreak: player.hasBreakMagic ?? false,
        unlockedDiagonal: player.canDiagonal ?? false,
        dragonHeadsAlive: headsAlive,
        crownsDelivered: player.crowns,
        blockCounts,
      };

      allResults.push(result);
    }
    const topoElapsed = ((Date.now() - topoStartTime) / 1000).toFixed(1);
    const topoWins = allResults.filter(r => r.topology === topology && r.won).length;
    console.log(`    Finished in ${topoElapsed}s | Win Rate: ${((topoWins / seedsPerTopology) * 100).toFixed(1)}% (${topoWins}/${seedsPerTopology})\n`);
  }

  const totalElapsed = ((Date.now() - totalStartTime) / 1000).toFixed(1);
  console.log(`All simulations finished in ${totalElapsed}s.\n`);

  // --- 集計とレポート出力 ---
  const totalRuns = allResults.length;
  const totalWins = allResults.filter(r => r.won);
  const winRate = totalWins.length / totalRuns;
  const clearTurns = totalWins.map(r => r.turns).sort((a, b) => a - b);
  const avgClearTurns = clearTurns.length > 0 ? (clearTurns.reduce((a, b) => a + b, 0) / clearTurns.length).toFixed(1) : 'N/A';
  const medianClearTurns = clearTurns.length > 0 ? clearTurns[Math.floor(clearTurns.length / 2)] : 'N/A';

  console.log('========================================================================');
  console.log(' 1. OVERALL METRICS');
  console.log('========================================================================');
  console.log(`- Total Runs       : ${totalRuns}`);
  console.log(`- Win Rate         : ${(winRate * 100).toFixed(1)}% (${totalWins.length}/${totalRuns})`);
  console.log(`- Avg Clear Turns  : ${avgClearTurns}`);
  console.log(`- Median Clear Turn: ${medianClearTurns}\n`);

  console.log('Milestone Reach Rates:');
  console.log(`- Got Sword         : ${((allResults.filter(r => r.hasSword || r.won).length / totalRuns) * 100).toFixed(1)}%`);
  console.log(`- Unlocked BREAK    : ${((allResults.filter(r => r.unlockedBreak || r.won).length / totalRuns) * 100).toFixed(1)}%`);
  console.log(`- Unlocked Diagonal : ${((allResults.filter(r => r.unlockedDiagonal || r.won).length / totalRuns) * 100).toFixed(1)}%`);
  console.log(`- Killed Head #1    : ${((allResults.filter(r => r.dragonHeadsAlive <= 2 || r.won).length / totalRuns) * 100).toFixed(1)}%`);
  console.log(`- Killed All Heads  : ${((allResults.filter(r => r.dragonHeadsAlive === 0 || r.won).length / totalRuns) * 100).toFixed(1)}%`);
  console.log(`- Crowns >= 1       : ${((allResults.filter(r => r.crownsDelivered >= 1 || r.won).length / totalRuns) * 100).toFixed(1)}%\n`);

  console.log('========================================================================');
  console.log(' 2. DEATH CAUSES & TIMEOUT PHASES');
  console.log('========================================================================');
  const deathCauses: Record<string, number> = {};
  const timeoutPhases: Record<string, number> = {};

  for (const r of allResults) {
    if (!r.won) {
      deathCauses[r.deathCause] = (deathCauses[r.deathCause] || 0) + 1;
      if (r.deathCause === 'TIMEOUT_LIMIT') {
        timeoutPhases[r.finalPhase] = (timeoutPhases[r.finalPhase] || 0) + 1;
      }
    }
  }

  console.log('Death Causes:');
  for (const [k, v] of Object.entries(deathCauses)) {
    console.log(`  - ${k.padEnd(20)}: ${v} (${((v / totalRuns) * 100).toFixed(1)}%)`);
  }
  console.log('Timeout Stuck Phase Breakdown:');
  for (const [k, v] of Object.entries(timeoutPhases)) {
    console.log(`  - Phase ${k.padEnd(16)}: ${v} (${((v / totalRuns) * 100).toFixed(1)}%)`);
  }
  console.log('');

  console.log('========================================================================');
  console.log(' 3. TOPOLOGY BREAKDOWN');
  console.log('========================================================================');
  console.log('Topology'.padEnd(20) + ' | Win Rate | Clear Avg | HP Loss | Timeout | Avg STR');
  console.log('---------------------+----------+-----------+---------+---------+--------');
  for (const topo of topologies) {
    const topoRuns = allResults.filter(r => r.topology === topo);
    const wins = topoRuns.filter(r => r.won);
    const wr = ((wins.length / topoRuns.length) * 100).toFixed(1);
    const cTurns = wins.map(r => r.turns);
    const avgT = cTurns.length > 0 ? (cTurns.reduce((a, b) => a + b, 0) / cTurns.length).toFixed(0) : '-';
    const hpLoss = topoRuns.filter(r => r.deathCause.includes('ENEMY') || r.deathCause.includes('FIREBALL') || r.deathCause.includes('COMBAT') || (r.playerHp <= 0 && r.deathCause !== 'TIMEOUT_LIMIT')).length;
    const timeouts = topoRuns.filter(r => r.deathCause === 'TIMEOUT_LIMIT').length;
    const avgStr = (topoRuns.reduce((a, b) => a + b.playerStr, 0) / topoRuns.length).toFixed(0);
    console.log(`${topo.padEnd(20)} | ${wr.padStart(7)}% | ${avgT.padStart(9)} | ${String(hpLoss).padStart(7)} | ${String(timeouts).padStart(7)} | ${avgStr.padStart(8)}`);
  }
  console.log('');

  console.log('========================================================================');
  console.log(' 4. DRAGON LAIR STYLE BREAKDOWN');
  console.log('========================================================================');
  const lairStyles = Array.from(new Set(allResults.map(r => r.dragonLairStyle)));
  console.log('Lair Style'.padEnd(25) + ' | Runs | Win Rate | Avg Clear');
  console.log('--------------------------+------+----------+----------');
  for (const style of lairStyles) {
    const styleRuns = allResults.filter(r => r.dragonLairStyle === style);
    const wins = styleRuns.filter(r => r.won);
    const wr = ((wins.length / styleRuns.length) * 100).toFixed(1);
    const cTurns = wins.map(r => r.turns);
    const avgT = cTurns.length > 0 ? (cTurns.reduce((a, b) => a + b, 0) / cTurns.length).toFixed(0) : '-';
    console.log(`${style.padEnd(25)} | ${String(styleRuns.length).padStart(4)} | ${wr.padStart(7)}% | ${avgT.padStart(10)}`);
  }
  console.log('');

  console.log('========================================================================');
  console.log(' 5. BLOCK TYPE DISTRIBUTION & CORRELATION WITH WIN/LOSS');
  console.log('========================================================================');
  const categories = ['open', 'enclosed', 'supply', 'grave', 'treasure', 'maze'] as const;
  console.log('Category'.padEnd(12) + ' | Avg Placed (Wins) | Avg Placed (Losses) | Diff');
  console.log('-------------+--------------------+---------------------+------');
  for (const cat of categories) {
    const winCounts = totalWins.map(r => r.blockCounts[cat]);
    const lossCounts = allResults.filter(r => !r.won).map(r => r.blockCounts[cat]);
    const avgWin = winCounts.length > 0 ? (winCounts.reduce((a, b) => a + b, 0) / winCounts.length).toFixed(2) : '-';
    const avgLoss = lossCounts.length > 0 ? (lossCounts.reduce((a, b) => a + b, 0) / lossCounts.length).toFixed(2) : '-';
    const diff = (winCounts.length > 0 && lossCounts.length > 0)
      ? (parseFloat(avgWin) - parseFloat(avgLoss)).toFixed(2)
      : '-';
    console.log(`${cat.padEnd(12)} | ${avgWin.padStart(18)} | ${avgLoss.padStart(19)} | ${diff.padStart(5)}`);
  }
  console.log('========================================================================\n');
}

runBenchmark().catch(err => {
  console.error(err);
  process.exit(1);
});
