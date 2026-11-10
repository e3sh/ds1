import { SimulationRunner, SimulationConfig } from '../src/simulation/SimulationRunner.js';
import { DungeonTopology, MapDifficulty, PlayPacingMode, RuleMode } from '../src/models/Types.js';
import { BotSkillProfile, GraveSealPolicy, GraveSealTiming } from '../src/ai/BotTypes.js';

function parseArgs(): SimulationConfig {
  const rawArgs = process.argv.slice(2).filter(a => a !== '--');
  const config: SimulationConfig = {
    runs: 5,
    maxTurnsLimit: 2500,
    topology: 'STANDARD_ROOMS',
    difficulty: 'NORMAL',
    pacing: 'STANDARD',
    botProfile: 'STANDARD',
    strategyTuning: {},
  };

  for (let i = 0; i < rawArgs.length; i++) {
    const raw = rawArgs[i];
    let key = raw;
    let val = rawArgs[i + 1];
    if (raw.includes('=')) {
      const parts = raw.split('=');
      key = parts[0];
      val = parts.slice(1).join('=');
    }

    if ((key === '--runs' || key === '-r') && val) {
      config.runs = parseInt(val, 10);
      if (!raw.includes('=')) i++;
    } else if ((key === '--turns' || key === '-t') && val) {
      config.maxTurnsLimit = parseInt(val, 10);
      if (!raw.includes('=')) i++;
    } else if (key === '--topology' && val) {
      config.topology = val as DungeonTopology;
      if (!raw.includes('=')) i++;
    } else if (key === '--difficulty' && val) {
      config.difficulty = val as MapDifficulty;
      if (!raw.includes('=')) i++;
    } else if (key === '--pacing' && val) {
      config.pacing = val as PlayPacingMode;
      if (!raw.includes('=')) i++;
    } else if (key === '--ruleMode' && val) {
      config.ruleMode = val as RuleMode;
      if (!raw.includes('=')) i++;
    } else if (key === '--botProfile' && val) {
      config.botProfile = val as BotSkillProfile;
      if (!raw.includes('=')) i++;
    } else if (key === '--botVersion' && val) {
      config.botVersion = val as 'v1' | 'v2';
      if (!raw.includes('=')) i++;
    } else if (key === '--graveSealPolicy' && val) {
      config.strategyTuning!.graveSealPolicy = val as GraveSealPolicy;
      if (!raw.includes('=')) i++;
    } else if (key === '--graveSealTiming' && val) {
      config.strategyTuning!.graveSealTiming = val as GraveSealTiming;
      if (!raw.includes('=')) i++;
    } else if (key === '--maxTargetMagic' && val) {
      config.strategyTuning!.maxTargetMagic = parseInt(val, 10);
      if (!raw.includes('=')) i++;
    } else if (key === '--seed' && val) {
      config.baseSeed = parseInt(val, 10);
      if (!raw.includes('=')) i++;
    } else if (['EASY', 'NORMAL', 'HARD'].includes(raw)) {
      config.difficulty = raw as MapDifficulty;
    } else if (['STANDARD', 'BLITZ', 'ENDURANCE'].includes(raw)) {
      config.pacing = raw as PlayPacingMode;
    } else if (!isNaN(parseInt(raw, 10))) {
      const num = parseInt(raw, 10);
      if (num >= 500) {
        config.maxTurnsLimit = num;
      } else {
        config.runs = num;
      }
    }
  }

  return config;
}

console.log('================================================================');
console.log('  Dragon Slayer (Level 2.0) Headless Bot Simulator & Telemetry  ');
console.log('================================================================');

const config = parseArgs();
console.log(`[Config] Topology: ${config.topology} | Diff: ${config.difficulty} | Pacing: ${config.pacing}`);
console.log(`[Config] Runs: ${config.runs} | MaxTurns: ${config.maxTurnsLimit} | BotProfile: ${config.botProfile}\n`);
console.log('Running headless batch simulation... Please wait...');

const startTime = Date.now();
const report = SimulationRunner.runBatch(config);
const elapsedMs = Date.now() - startTime;

console.log(`\nSimulation completed in ${(elapsedMs / 1000).toFixed(2)}s.\n`);

console.log('----------------------------------------------------------------');
console.log(' 1. OVERALL RESULTS & PERFORMANCE');
console.log('----------------------------------------------------------------');
console.log(`- Win Rate               : ${(report.overall.winRate * 100).toFixed(1)}%`);
console.log(`- Avg Clear Turns        : ${report.overall.avgClearTurns} turns`);
console.log(`- Median Clear Turns     : ${report.overall.medianClearTurns} turns`);
console.log(`- Est. Human Play Time   : ${report.overall.estimatedPlayTimeMinutes} mins`);
console.log(`- Milestone Reach Rates  :`);
console.log(`    * Got Sword          : ${(report.overall.milestoneReachRates.gotSword * 100).toFixed(1)}%`);
console.log(`    * Unlocked BREAK     : ${(report.overall.milestoneReachRates.unlockedBreakMagic * 100).toFixed(1)}%`);
console.log(`    * Killed Head #1     : ${(report.overall.milestoneReachRates.killedHead1 * 100).toFixed(1)}%`);
console.log(`    * Killed All Heads   : ${(report.overall.milestoneReachRates.killedAllHeads * 100).toFixed(1)}%`);
console.log(`- Death Causes Breakdown :`);
for (const [cause, count] of Object.entries(report.overall.deathCauses)) {
  console.log(`    * ${cause.padEnd(20)}: ${count}`);
}

console.log('\n----------------------------------------------------------------');
console.log(' 2. ISSUE 1: HOME SPAWN & CAP BLOCK HEALTH (Target: Cap Block <= 5%)');
console.log('----------------------------------------------------------------');
console.log(`- Total Home Spawn Tries : ${report.homeSpawnMetrics.totalHomeSpawnAttempts}`);
console.log(`- Home Spawn Success Rate: ${report.homeSpawnMetrics.homeSpawnSuccessRate.toFixed(1)}%`);
console.log(`- Global Cap Block Rate  : ${report.homeSpawnMetrics.blockedByGlobalCapRate.toFixed(1)}%`);
console.log(`- Distant Eviction Count : ${report.homeSpawnMetrics.evictedDistantEnemyCount}`);

console.log('\n----------------------------------------------------------------');
console.log(' 3. ISSUE 2: EXP / STR PROGRESSION & COMBAT BIPOLARIZATION');
console.log('----------------------------------------------------------------');
console.log(`- Max Single-Kill EXP Jump: +${report.progressionMetrics.maxSingleKillExpJump.toLocaleString()}`);
console.log(`- Zero Damage Ratio      : ${(report.progressionMetrics.combatOutcomeDistribution.zeroDamageTakenRatio * 100).toFixed(1)}%`);
console.log(`- Moderate Damage Ratio  : ${(report.progressionMetrics.combatOutcomeDistribution.moderateDamageRatio * 100).toFixed(1)}%`);
console.log(`- Lethal Death Ratio     : ${(report.progressionMetrics.combatOutcomeDistribution.lethalOneShotDeathRatio * 100).toFixed(1)}%`);

console.log('\n----------------------------------------------------------------');
console.log(' 4. ISSUE 3: RESOURCE CAPS & GHOST INTERACTIONS');
console.log('----------------------------------------------------------------');
console.log(`- Avg Spawns / Run       : CROSS: ${report.resourceAndGhostMetrics.avgItemsSpawnedPerRun.cross}, RING: ${report.resourceAndGhostMetrics.avgItemsSpawnedPerRun.ring}, KEY: ${report.resourceAndGhostMetrics.avgItemsSpawnedPerRun.key}, STONE: ${report.resourceAndGhostMetrics.avgItemsSpawnedPerRun.powerStone}`);
console.log(`- Chest Cap Fallbacks    : ${report.resourceAndGhostMetrics.chestCapFallbackCount} times`);
console.log(`- Ghost Items Transported: ${report.resourceAndGhostMetrics.ghostInteractions.itemsPickedUp}`);
console.log(`- Ghost Player Steals    : ${report.resourceAndGhostMetrics.ghostInteractions.itemsStolenFromPlayer}`);
console.log('================================================================\n');
