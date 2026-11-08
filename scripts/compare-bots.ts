import { SimulationRunner, SimulationConfig } from '../src/simulation/SimulationRunner.js';
import { DungeonTopology } from '../models/Types.js';

interface BotComparisonResult {
  topology: DungeonTopology;
  v1: any;
  v2: any;
}

const TOPOLOGIES: DungeonTopology[] = [
  'STANDARD_ROOMS',
  'NARROW_MAZE',
  'MULTI_SECTOR',
];

const args = process.argv.slice(2);
let runs = 20;
let maxTurnsLimit = 10000;
let baseSeed = 10000;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--turns=')) {
    maxTurnsLimit = parseInt(arg.split('=')[1], 10);
  } else if (arg === '--turns' && args[i + 1]) {
    maxTurnsLimit = parseInt(args[++i], 10);
  } else if (arg.startsWith('--runs=')) {
    runs = parseInt(arg.split('=')[1], 10);
  } else if (arg === '--runs' && args[i + 1]) {
    runs = parseInt(args[++i], 10);
  } else if (arg.startsWith('--seed=')) {
    baseSeed = parseInt(arg.split('=')[1], 10);
  } else if (arg === '--seed' && args[i + 1]) {
    baseSeed = parseInt(args[++i], 10);
  }
}

console.log('========================================================================');
console.log('       AutoPlayBot Comparison Benchmark: v1 (Legacy) vs v2 (Adaptive)    ');
console.log(`       Runs: ${runs} | MaxTurns: ${maxTurnsLimit} | BaseSeed: ${baseSeed}`);
console.log('========================================================================\n');

const results: BotComparisonResult[] = [];

for (const topology of TOPOLOGIES) {
  console.log(`>>> Running Benchmark on Topology: [${topology}] ...`);

  // v1 Run
  process.stdout.write(`  [v1] Running ${runs} runs... `);
  const t0_v1 = Date.now();
  const v1Report = SimulationRunner.runBatch({
    runs,
    maxTurnsLimit,
    topology,
    difficulty: 'NORMAL',
    pacing: 'STANDARD',
    botProfile: 'STANDARD',
    baseSeed,
    botVersion: 'v1',
  });
  const dur_v1 = ((Date.now() - t0_v1) / 1000).toFixed(2);
  console.log(`done in ${dur_v1}s. (Win Rate: ${(v1Report.overall.winRate * 100).toFixed(1)}%)`);

  // v2 Run
  process.stdout.write(`  [v2] Running ${runs} runs... `);
  const t0_v2 = Date.now();
  const v2Report = SimulationRunner.runBatch({
    runs,
    maxTurnsLimit,
    topology,
    difficulty: 'NORMAL',
    pacing: 'STANDARD',
    botProfile: 'STANDARD',
    baseSeed,
    botVersion: 'v2',
  });
  const dur_v2 = ((Date.now() - t0_v2) / 1000).toFixed(2);
  console.log(`done in ${dur_v2}s. (Win Rate: ${(v2Report.overall.winRate * 100).toFixed(1)}%)`);

  results.push({
    topology,
    v1: v1Report,
    v2: v2Report,
  });
  console.log('');
}

console.log('========================================================================');
console.log('                       COMPARISON SUMMARY TABLE                         ');
console.log('========================================================================\n');

// Markdown Table Output
console.log('| トポロジー | 指標 (KPI) | v1 (旧Bot) | v2 (AdaptiveBot) | 差分 (v2 - v1) |');
console.log('| :--- | :--- | :--- | :--- | :--- |');

for (const r of results) {
  const top = r.topology;
  const v1 = r.v1.overall;
  const v2 = r.v2.overall;

  const winDiff = ((v2.winRate - v1.winRate) * 100).toFixed(1);
  const winSign = Number(winDiff) > 0 ? `+${winDiff}%` : `${winDiff}%`;

  const avgTurnsV1 = v1.avgClearTurns > 0 ? `${Math.round(v1.avgClearTurns)}` : 'N/A';
  const avgTurnsV2 = v2.avgClearTurns > 0 ? `${Math.round(v2.avgClearTurns)}` : 'N/A';
  const turnDiff = (v1.avgClearTurns > 0 && v2.avgClearTurns > 0)
    ? `${Math.round(v2.avgClearTurns - v1.avgClearTurns)} turns`
    : '-';

  console.log(`| **${top}** | **勝率 (Win Rate)** | ${(v1.winRate * 100).toFixed(1)}% (${Math.round(v1.winRate * runs)}/${runs}) | **${(v2.winRate * 100).toFixed(1)}%** (${Math.round(v2.winRate * runs)}/${runs}) | **${winSign}** |`);
  console.log(`| | 平均クリアターン数 | ${avgTurnsV1} | ${avgTurnsV2} | ${turnDiff} |`);
  console.log(`| | 剣取得率 (Sword) | ${(v1.milestoneReachRates.gotSword * 100).toFixed(1)}% | ${(v2.milestoneReachRates.gotSword * 100).toFixed(1)}% | ${(((v2.milestoneReachRates.gotSword - v1.milestoneReachRates.gotSword) * 100) >= 0 ? '+' : '')}${((v2.milestoneReachRates.gotSword - v1.milestoneReachRates.gotSword) * 100).toFixed(1)}% |`);
  console.log(`| | BREAK解禁率 (EXP>=4k) | ${(v1.milestoneReachRates.unlockedBreakMagic * 100).toFixed(1)}% | ${(v2.milestoneReachRates.unlockedBreakMagic * 100).toFixed(1)}% | ${(((v2.milestoneReachRates.unlockedBreakMagic - v1.milestoneReachRates.unlockedBreakMagic) * 100) >= 0 ? '+' : '')}${((v2.milestoneReachRates.unlockedBreakMagic - v1.milestoneReachRates.unlockedBreakMagic) * 100).toFixed(1)}% |`);
  console.log(`| | 首#1撃破率 (Head #1) | ${(v1.milestoneReachRates.killedHead1 * 100).toFixed(1)}% | ${(v2.milestoneReachRates.killedHead1 * 100).toFixed(1)}% | ${(((v2.milestoneReachRates.killedHead1 - v1.milestoneReachRates.killedHead1) * 100) >= 0 ? '+' : '')}${((v2.milestoneReachRates.killedHead1 - v1.milestoneReachRates.killedHead1) * 100).toFixed(1)}% |`);
  console.log(`| | 全首撃破率 (All Heads) | ${(v1.milestoneReachRates.killedAllHeads * 100).toFixed(1)}% | ${(v2.milestoneReachRates.killedAllHeads * 100).toFixed(1)}% | ${(((v2.milestoneReachRates.killedAllHeads - v1.milestoneReachRates.killedAllHeads) * 100) >= 0 ? '+' : '')}${((v2.milestoneReachRates.killedAllHeads - v1.milestoneReachRates.killedAllHeads) * 100).toFixed(1)}% |`);

  // 死因集計
  const deathKeys = Array.from(new Set([...Object.keys(v1.deathCauses), ...Object.keys(v2.deathCauses)]));
  const deathSummaryV1 = deathKeys.map(k => `${k}:${v1.deathCauses[k] || 0}`).join(', ');
  const deathSummaryV2 = deathKeys.map(k => `${k}:${v2.deathCauses[k] || 0}`).join(', ');
  console.log(`| | 死因・停滞内訳 | ${deathSummaryV1 || 'なし'} | ${deathSummaryV2 || 'なし'} | - |`);
}

console.log('\n========================================================================');
console.log('JSON Raw Data:');
console.log(JSON.stringify(results.map(r => ({
  topology: r.topology,
  v1_winRate: r.v1.overall.winRate,
  v1_avgTurns: r.v1.overall.avgClearTurns,
  v1_milestones: r.v1.overall.milestoneReachRates,
  v1_deaths: r.v1.overall.deathCauses,
  v2_winRate: r.v2.overall.winRate,
  v2_avgTurns: r.v2.overall.avgClearTurns,
  v2_milestones: r.v2.overall.milestoneReachRates,
  v2_deaths: r.v2.overall.deathCauses,
})), null, 2));
