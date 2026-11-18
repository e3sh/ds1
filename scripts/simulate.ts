import { SimulationRunner, SimulationConfig } from '../src/simulation/SimulationRunner.js';
import { DungeonTopology, MapDifficulty, PlayPacingMode, RuleMode } from '../src/models/Types.js';
import { BotSkillProfile, BotVersion, GraveSealPolicy, GraveSealTiming } from '../src/ai/BotTypes.js';

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
      config.botVersion = val as BotVersion;
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
    } else if (key === '--details' || key === '-d') {
      config.includeRunDetails = true;
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
  console.log(`    * ${cause.padEnd(25)}: ${count}`);
}
if (report.overall.giveUpBreakdown) {
  const g = report.overall.giveUpBreakdown;
  console.log(
    `- Give-Up Subtypes       : SWORD_TRAPPED=${g.swordTrapped}, CONFINED=${g.confined}, CHURN=${g.churn}, LOOP=${g.loop}, FRUITLESS=${g.fruitless}, OTHER=${g.other}`
  );
}
if (report.overall.earlyGiveUpStats) {
  const eg = report.overall.earlyGiveUpStats;
  const minStr = eg.minGiveUpTurn !== null ? `${eg.minGiveUpTurn}T` : 'N/A';
  const avgStr = eg.avgGiveUpTurn !== null ? `${eg.avgGiveUpTurn}T` : 'N/A';
  console.log(
    `- Early Give-Up (<1000T) : ${eg.under1000TurnsCount} runs (Min: ${minStr}, Avg: ${avgStr})`
  );
}
if (report.overall.milestoneTurnStats) {
  const m = report.overall.milestoneTurnStats;
  const fmt = (label: string, s: { count: number; avg: number; median: number }) =>
    s.count > 0 ? `${label.padEnd(18)}: avg ${String(s.avg).padStart(4)}T / med ${String(s.median).padStart(4)}T (n=${s.count})` : `${label.padEnd(18)}: N/A`;
  console.log(`- Milestone Turns        :`);
  console.log(`    * ${fmt('Got Sword', m.gotSword)}`);
  console.log(`    * ${fmt('Unlocked BREAK', m.unlockedBreak)}`);
  console.log(`    * ${fmt('Unlocked Diag', m.unlockedDiagonal)}`);
  console.log(`    * ${fmt('Target STR', m.reachedTargetStr)}`);
  console.log(`    * ${fmt('Killed Head #1', m.killedHead1)}`);
  console.log(`    * ${fmt('Killed All Heads', m.killedAllHeads)}`);
  console.log(`    * ${fmt('1st Crown', m.deliveredFirstCrown)}`);
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

if (report.pstMetrics) {
  console.log('\n----------------------------------------------------------------');
  console.log(' 5. PST ARCHITECTURE & PCG STRUCTURAL TELEMETRY');
  console.log('----------------------------------------------------------------');
  console.log(`- Avg Breach Shortcuts Opened: ${report.pstMetrics.avgBreachShortcutsUsed} per run`);
  console.log('- Mission Turns Distribution :');
  for (const [mid, avgTurns] of Object.entries(report.pstMetrics.avgMissionTurns)) {
    const rate = report.pstMetrics.missionCompletionRates[mid];
    const rateStr = rate ? `[Tries: ${rate.total}, ClearRate: ${(rate.rate * 100).toFixed(0)}%]` : '';
    console.log(`    * ${mid.padEnd(24)}: ${avgTurns.toString().padStart(4)} turns  ${rateStr}`);
  }
  console.log('- Terminal Mission Breakdown :');
  for (const [mid, count] of Object.entries(report.pstMetrics.terminalMissionBreakdown)) {
    console.log(`    * ${mid.padEnd(24)}: ${count}`);
  }
}

if (report.overall.failedRunSamples && report.overall.failedRunSamples.length > 0) {
  console.log('\n----------------------------------------------------------------');
  console.log(' 6. FAILED / GIVE-UP RUN SAMPLES');
  console.log('----------------------------------------------------------------');
  for (const s of report.overall.failedRunSamples) {
    const trans =
      s.recentVerdicts.length > 0
        ? s.recentVerdicts
            .map(v => `T${v.turn}:${v.from}->${v.to}${v.stallKind ? `[${v.stallKind}]` : ''}`)
            .join(', ')
        : 'none';
    console.log(
      `- Run#${s.runIndex} seed=${s.seed} | ${s.totalTurns}T | ${s.cause} | mission=${s.finalMissionId ?? 'NONE'} | cmd=${s.commanderLevel ?? 'N/A'}`
    );
    console.log(`    transitions: ${trans}`);
  }
}

if (config.includeRunDetails && report.runDetails && report.runDetails.length > 0) {
  console.log('\n----------------------------------------------------------------');
  console.log(' 7. PER-RUN DIAGNOSTIC DETAILS (--details)');
  console.log('----------------------------------------------------------------');
  for (const d of report.runDetails) {
    const status = d.won ? 'CLEAR' : (d.deathCause ?? 'FAIL');
    const ms = d.milestoneTurns;
    const msStr = [
      ms.gotSword !== undefined ? `Sword:${ms.gotSword}T` : null,
      ms.unlockedBreak !== undefined ? `Break:${ms.unlockedBreak}T` : null,
      ms.reachedTargetStr !== undefined ? `Str:${ms.reachedTargetStr}T` : null,
      ms.killedHead1 !== undefined ? `Head1:${ms.killedHead1}T` : null,
      ms.killedAllHeads !== undefined ? `AllHeads:${ms.killedAllHeads}T` : null,
      ms.deliveredFirstCrown !== undefined ? `Crown1:${ms.deliveredFirstCrown}T` : null,
    ]
      .filter(Boolean)
      .join(' ');
    const verdicts = d.verdictsSummary
      .slice(-4)
      .map(v => `T${v.turn}:${v.from}->${v.to}${v.stallKind ? `[${v.stallKind}]` : ''}`)
      .join(', ');
    console.log(
      `- Run#${d.runIndex} seed=${d.seed} | ${status} @ ${d.totalTurns}T | mission=${d.terminalMissionId ?? 'NONE'} | cmd=${d.commanderFinalLevel} | maxNoGain=${d.maxTurnsWithoutSubstantiveGain}T`
    );
    if (msStr) console.log(`    milestones : ${msStr}`);
    if (verdicts) console.log(`    verdicts   : ${verdicts}`);
  }
}

console.log('================================================================\n');
