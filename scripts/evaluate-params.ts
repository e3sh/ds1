import { SimulationRunner, SimulationConfig } from '../src/simulation/SimulationRunner.js';
import { BotStrategyTuning } from '../src/ai/AutoPlayBot.js';

interface ExperimentCase {
  name: string;
  tuning: BotStrategyTuning;
}

const cases: ExperimentCase[] = [
  {
    name: '1. Baseline (No Seal, MaxMagic=3)',
    tuning: {
      graveSealPolicy: 'NONE',
      maxTargetMagic: 3,
    },
  },
  {
    name: '2. Potion Enhanced Only (No Seal, MaxMagic=5)',
    tuning: {
      graveSealPolicy: 'NONE',
      maxTargetMagic: 5,
    },
  },
  {
    name: '3. Near-Home Seal EARLY + MaxMagic=5',
    tuning: {
      graveSealPolicy: 'NEAR_HOME',
      graveSealTiming: 'EARLY',
      maxTargetMagic: 5,
    },
  },
  {
    name: '4. Near-Home Seal PRE_DRAGON + MaxMagic=5',
    tuning: {
      graveSealPolicy: 'NEAR_HOME',
      graveSealTiming: 'PRE_DRAGON',
      maxTargetMagic: 5,
    },
  },
  {
    name: '5. Auto Map Assessment + MaxMagic=5',
    tuning: {
      graveSealPolicy: 'AUTO',
      graveSealTiming: 'EARLY',
      maxTargetMagic: 5,
    },
  },
];

const runsPerCase = 10;
const baseSeed = 12345;
const maxTurnsLimit = 1500;

console.log('========================================================================');
console.log(`  Simulation Parameter Evaluation (Runs: ${runsPerCase}, MaxTurns: ${maxTurnsLimit})`);
console.log('========================================================================\n');

interface CaseResult {
  name: string;
  winRate: number;
  clearedRuns: number;
  avgTurns: number;
  milestones: {
    gotSword: number;
    unlockedBreakMagic: number;
    unlockedDiagonalMove: number;
    killedHead1: number;
    killedAllHeads: number;
    deliveredAtLeastOneCrown: number;
  };
  deathCauses: Record<string, number>;
}

const results: CaseResult[] = [];

for (const expCase of cases) {
  process.stdout.write(`Running: ${expCase.name} ... `);
  const start = Date.now();

  const report = SimulationRunner.runBatch({
    runs: runsPerCase,
    baseSeed,
    maxTurnsLimit,
    topology: 'STANDARD_ROOMS',
    difficulty: 'NORMAL',
    pacing: 'STANDARD',
    botProfile: 'STANDARD',
    strategyTuning: expCase.tuning,
  });

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Done (${duration}s) | Win Rate: ${(report.overall.winRate * 100).toFixed(1)}%`);

  const deathCauses = report.overall.deathCauses ?? {};

  results.push({
    name: expCase.name,
    winRate: report.overall.winRate,
    clearedRuns: Math.round(report.overall.winRate * runsPerCase),
    avgTurns: report.overall.avgClearTurns ?? 0,
    deathCauses,
    milestones: report.overall.milestoneReachRates,
  });
}

console.log('\n========================================================================');
console.log('  SUMMARY COMPARISON REPORT');
console.log('========================================================================');
console.table(
  results.map(r => ({
    Configuration: r.name,
    'Win Rate': `${(r.winRate * 100).toFixed(1)}% (${r.clearedRuns}/${runsPerCase})`,
    'Avg Clear Turns': r.avgTurns > 0 ? r.avgTurns.toFixed(1) : 'N/A',
    'Kill Head1': `${(r.milestones.killedHead1 * 100).toFixed(0)}%`,
    'Kill All Heads': `${(r.milestones.killedAllHeads * 100).toFixed(0)}%`,
    'Delivered Crown': `${(r.milestones.deliveredAtLeastOneCrown * 100).toFixed(0)}%`,
  }))
);

console.log('\nDeath Breakdown by Configuration:');
for (const r of results) {
  console.log(`- ${r.name}:`);
  const entries = Object.entries(r.deathCauses);
  if (entries.length === 0) {
    console.log('  No deaths (100% win rate)');
  } else {
    for (const [cause, cnt] of entries) {
      console.log(`  * ${cause}: ${cnt}`);
    }
  }
}
