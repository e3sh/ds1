import * as fs from 'fs';
import * as path from 'path';
import { SimulationRunner } from '../src/simulation/SimulationRunner.js';
import { BotSkillProfile, BotStrategyTuning } from '../src/ai/BotTypes.js';
import { DungeonTopology, MapDifficulty, PlayPacingMode, RuleMode } from '../src/models/Types.js';
import { DEFAULT_COMMANDER_CONFIG } from '../src/ai/strategy/command/CommanderTypes.js';
import {
  DEFAULT_HUNTING_PARAMS,
  DEFAULT_MISSION_POLICY_PARAMS,
  DEFAULT_READINESS_PARAMS,
} from '../src/ai/TacticalContext.js';

type EvalMode = 'compare' | 'grid' | 'coordinate';

interface EvalCliOptions {
  mode: EvalMode;
  topologies: DungeonTopology[];
  ruleModes: RuleMode[];
  runs: number;
  maxTurnsLimit: number;
  baseSeed: number;
  difficulty: MapDifficulty;
  pacing: PlayPacingMode;
  botProfile: BotSkillProfile;
  passes: number;
  outputPath?: string;
}

interface ExperimentCase {
  name: string;
  tuning: BotStrategyTuning;
}

interface CellMetrics {
  topology: DungeonTopology;
  ruleMode: RuleMode;
  winRate: number;
  clearedRuns: number;
  avgClearTurns: number;
  medianClearTurns: number;
  avgMaxNoGain: number;
  giveUpRate: number;
  milestoneProgress: number;
  score: number;
  deathCauses: Record<string, number>;
  commanderLevelCounts: Record<string, number>;
}

interface CandidateEvaluation {
  name: string;
  tuning: BotStrategyTuning;
  overallScore: number;
  overallWinRate: number;
  overallAvgClearTurns: number;
  overallAvgMaxNoGain: number;
  durationSec: number;
  cells: CellMetrics[];
  totalDeathCauses: Record<string, number>;
  totalCommanderLevels: Record<string, number>;
}

function printHelp(): void {
  console.log(`
Usage: npm run evaluate -- [options]

Options:
  --mode=compare|grid|coordinate   Evaluation mode (default: compare)
  --topologies=LIST                Comma-separated topologies (default: STANDARD_ROOMS,NARROW_MAZE,FORTRESS_ARENA,PILLAR_GRID)
  --ruleModes=LIST                 Comma-separated rule modes: EXPONENTIAL,CLASSIC (default: EXPONENTIAL,CLASSIC)
  --runs=N                         Runs per topology x ruleMode cell (default: 10)
  --maxTurns=N                     Max turns per run (default: 2000)
  --seed=N                         Base seed for deterministic comparison (default: 12345)
  --difficulty=EASY|NORMAL|HARD    Map difficulty (default: NORMAL)
  --pacing=BLITZ|STANDARD|MARATHON Play pacing (default: STANDARD)
  --botProfile=NOVICE|STANDARD|EXPERT Bot profile (default: STANDARD)
  --passes=N                       Coordinate descent passes (default: 2)
  --output=PATH                    Save JSON report to PATH
  --help, -h                       Show this help
`);
}

function parseCliArgs(): EvalCliOptions {
  const rawArgs = process.argv.slice(2).filter(a => a !== '--');
  const opts: EvalCliOptions = {
    mode: 'compare',
    topologies: ['STANDARD_ROOMS', 'NARROW_MAZE', 'FORTRESS_ARENA', 'PILLAR_GRID'],
    ruleModes: ['EXPONENTIAL', 'CLASSIC'],
    runs: 10,
    maxTurnsLimit: 2000,
    baseSeed: 12345,
    difficulty: 'NORMAL',
    pacing: 'STANDARD',
    botProfile: 'STANDARD',
    passes: 2,
  };

  for (let i = 0; i < rawArgs.length; i++) {
    const raw = rawArgs[i];
    if (raw === '--help' || raw === '-h') {
      printHelp();
      process.exit(0);
    }
    let key = raw;
    let val = rawArgs[i + 1];
    if (raw.includes('=')) {
      const idx = raw.indexOf('=');
      key = raw.slice(0, idx);
      val = raw.slice(idx + 1);
    }
    const consumeNext = !raw.includes('=');

    if (key === '--mode' && val) {
      opts.mode = val as EvalMode;
      if (consumeNext) i++;
    } else if (key === '--topologies' && val) {
      opts.topologies = val.split(',').map(s => s.trim()) as DungeonTopology[];
      if (consumeNext) i++;
    } else if (key === '--ruleModes' && val) {
      opts.ruleModes = val.split(',').map(s => s.trim()) as RuleMode[];
      if (consumeNext) i++;
    } else if ((key === '--runs' || key === '-r') && val) {
      opts.runs = Math.max(1, parseInt(val, 10));
      if (consumeNext) i++;
    } else if ((key === '--maxTurns' || key === '--turns' || key === '-t') && val) {
      opts.maxTurnsLimit = Math.max(200, parseInt(val, 10));
      if (consumeNext) i++;
    } else if (key === '--seed' && val) {
      opts.baseSeed = parseInt(val, 10);
      if (consumeNext) i++;
    } else if (key === '--difficulty' && val) {
      opts.difficulty = val as MapDifficulty;
      if (consumeNext) i++;
    } else if (key === '--pacing' && val) {
      opts.pacing = val as PlayPacingMode;
      if (consumeNext) i++;
    } else if (key === '--botProfile' && val) {
      opts.botProfile = val as BotSkillProfile;
      if (consumeNext) i++;
    } else if (key === '--passes' && val) {
      opts.passes = Math.max(1, parseInt(val, 10));
      if (consumeNext) i++;
    } else if (key === '--output' && val) {
      opts.outputPath = val;
      if (consumeNext) i++;
    }
  }

  return opts;
}

function computeCellScore(
  winRate: number,
  avgClearTurns: number,
  maxTurnsLimit: number,
  avgMaxNoGain: number,
  giveUpRate: number,
  milestoneProgress: number
): number {
  const turnPenalty = winRate > 0 ? 20.0 * (avgClearTurns / maxTurnsLimit) * winRate : 0;
  const stallPenalty = 10.0 * Math.min(1.0, avgMaxNoGain / 200);
  const giveUpPenalty = 15.0 * giveUpRate;
  return (
    100.0 * winRate +
    15.0 * milestoneProgress -
    turnPenalty -
    stallPenalty -
    giveUpPenalty
  );
}

function mergeCounts(target: Record<string, number>, src: Record<string, number> | undefined): void {
  if (!src) return;
  for (const [k, v] of Object.entries(src)) {
    target[k] = (target[k] ?? 0) + v;
  }
}

function evaluateCandidate(
  name: string,
  tuning: BotStrategyTuning,
  opts: EvalCliOptions,
  cache?: Map<string, CandidateEvaluation>
): CandidateEvaluation {
  const cacheKey = JSON.stringify(tuning);
  const cached = cache?.get(cacheKey);
  if (cached) {
    return { ...cached, name };
  }

  const startMs = Date.now();
  const cells: CellMetrics[] = [];
  const totalDeathCauses: Record<string, number> = {};
  const totalCommanderLevels: Record<string, number> = {};

  for (const topology of opts.topologies) {
    for (const ruleMode of opts.ruleModes) {
      const report = SimulationRunner.runBatch({
        runs: opts.runs,
        baseSeed: opts.baseSeed,
        maxTurnsLimit: opts.maxTurnsLimit,
        topology,
        difficulty: opts.difficulty,
        pacing: opts.pacing,
        ruleMode,
        botProfile: opts.botProfile,
        strategyTuning: tuning,
      });

      const winRate = report.overall.winRate;
      const clearedRuns = Math.round(winRate * opts.runs);
      const avgClearTurns = report.overall.avgClearTurns ?? 0;
      const medianClearTurns = report.overall.medianClearTurns ?? 0;
      const avgMaxNoGain = report.pstMetrics?.avgMaxTurnsWithoutSubstantiveGain ?? 0;
      const deathCauses = report.overall.deathCauses ?? {};
      const giveUpCount = (deathCauses['GIVE_UP_UNSOLVABLE'] ?? 0) + (deathCauses['GIVE_UP'] ?? 0);
      const giveUpRate = opts.runs > 0 ? giveUpCount / opts.runs : 0;
      const m = report.overall.milestoneReachRates;
      const milestoneProgress = (m.killedHead1 + m.killedAllHeads + m.deliveredAtLeastOneCrown) / 3;
      const commanderLevelCounts = report.pstMetrics?.commanderLevelCounts ?? {};

      const score = computeCellScore(
        winRate,
        avgClearTurns,
        opts.maxTurnsLimit,
        avgMaxNoGain,
        giveUpRate,
        milestoneProgress
      );

      mergeCounts(totalDeathCauses, deathCauses);
      mergeCounts(totalCommanderLevels, commanderLevelCounts);

      cells.push({
        topology,
        ruleMode,
        winRate,
        clearedRuns,
        avgClearTurns,
        medianClearTurns,
        avgMaxNoGain,
        giveUpRate,
        milestoneProgress,
        score,
        deathCauses,
        commanderLevelCounts,
      });
    }
  }

  const n = Math.max(1, cells.length);
  const overallScore = cells.reduce((s, c) => s + c.score, 0) / n;
  const overallWinRate = cells.reduce((s, c) => s + c.winRate, 0) / n;
  const wonCells = cells.filter(c => c.avgClearTurns > 0);
  const overallAvgClearTurns =
    wonCells.length > 0 ? wonCells.reduce((s, c) => s + c.avgClearTurns, 0) / wonCells.length : 0;
  const overallAvgMaxNoGain = cells.reduce((s, c) => s + c.avgMaxNoGain, 0) / n;
  const durationSec = (Date.now() - startMs) / 1000;

  const result: CandidateEvaluation = {
    name,
    tuning,
    overallScore: Math.round(overallScore * 100) / 100,
    overallWinRate: Math.round(overallWinRate * 1000) / 1000,
    overallAvgClearTurns: Math.round(overallAvgClearTurns * 10) / 10,
    overallAvgMaxNoGain: Math.round(overallAvgMaxNoGain * 10) / 10,
    durationSec: Math.round(durationSec * 10) / 10,
    cells,
    totalDeathCauses,
    totalCommanderLevels,
  };

  cache?.set(cacheKey, result);
  return result;
}

function buildCompareCases(): ExperimentCase[] {
  return [
    {
      name: '1. Dynamic Auto (Default)',
      tuning: {},
    },
    {
      name: '2. Legacy Fixed (Static Defaults)',
      tuning: {
        crownReserveMagic: 10,
        readiness: { ...DEFAULT_READINESS_PARAMS },
        hunting: { ...DEFAULT_HUNTING_PARAMS },
        missionPolicy: { ...DEFAULT_MISSION_POLICY_PARAMS },
        commander: { ...DEFAULT_COMMANDER_CONFIG },
      },
    },
    {
      name: '3. Conservative Crown (MP=5)',
      tuning: { crownReserveMagic: 5 },
    },
    {
      name: '4. Balanced Crown (MP=7)',
      tuning: { crownReserveMagic: 7 },
    },
    {
      name: '5. Fast Prep Bypass (25/45T)',
      tuning: {
        readiness: {
          prepBypassTurnsNoChest: 25,
          prepBypassTurnsWithChest: 45,
        },
      },
    },
  ];
}

function buildGridCases(): ExperimentCase[] {
  const crownValues = [undefined, 5, 7, 9];
  const bypassNoChestValues = [25, 32];
  const goldThresholdValues = [6, 8];
  const cases: ExperimentCase[] = [];

  for (const crown of crownValues) {
    for (const bypass of bypassNoChestValues) {
      for (const gold of goldThresholdValues) {
        const tuning: BotStrategyTuning = {
          ...(crown !== undefined ? { crownReserveMagic: crown } : {}),
          readiness: { prepBypassTurnsNoChest: bypass },
          missionPolicy: { coinCashInGoldThreshold: gold },
        };
        const label = `crown=${crown ?? 'auto'}, bypass=${bypass}, gold=${gold}`;
        cases.push({ name: label, tuning });
      }
    }
  }
  return cases;
}

function cloneTuning(t: BotStrategyTuning): BotStrategyTuning {
  return JSON.parse(JSON.stringify(t)) as BotStrategyTuning;
}

function runCoordinateDescent(
  opts: EvalCliOptions,
  cache: Map<string, CandidateEvaluation>
): CandidateEvaluation[] {
  interface AxisSpec {
    label: string;
    values: Array<number | undefined>;
    apply: (t: BotStrategyTuning, v: number | undefined) => void;
  }

  const axes: AxisSpec[] = [
    {
      label: 'crownReserveMagic',
      values: [undefined, 4, 5, 6, 8, 10],
      apply: (t, v) => {
        if (v === undefined) delete t.crownReserveMagic;
        else t.crownReserveMagic = v;
      },
    },
    {
      label: 'readiness.prepBypassTurnsNoChest',
      values: [undefined, 25, 32, 40],
      apply: (t, v) => {
        t.readiness = { ...(t.readiness ?? {}) };
        if (v === undefined) delete t.readiness.prepBypassTurnsNoChest;
        else t.readiness.prepBypassTurnsNoChest = v;
      },
    },
    {
      label: 'readiness.prepBypassTurnsWithChest',
      values: [undefined, 45, 58, 70],
      apply: (t, v) => {
        t.readiness = { ...(t.readiness ?? {}) };
        if (v === undefined) delete t.readiness.prepBypassTurnsWithChest;
        else t.readiness.prepBypassTurnsWithChest = v;
      },
    },
    {
      label: 'missionPolicy.coinCashInGoldThreshold',
      values: [undefined, 6, 8, 10],
      apply: (t, v) => {
        t.missionPolicy = { ...(t.missionPolicy ?? {}) };
        if (v === undefined) delete t.missionPolicy.coinCashInGoldThreshold;
        else t.missionPolicy.coinCashInGoldThreshold = v;
      },
    },
    {
      label: 'hunting.huntNoExpAbortTurns',
      values: [undefined, 15, 20, 25],
      apply: (t, v) => {
        t.hunting = { ...(t.hunting ?? {}) };
        if (v === undefined) delete t.hunting.huntNoExpAbortTurns;
        else t.hunting.huntNoExpAbortTurns = v;
      },
    },
    {
      label: 'commander.defaultGraceTurns',
      values: [undefined, 24, 32, 40],
      apply: (t, v) => {
        t.commander = { ...(t.commander ?? {}) };
        if (v === undefined) delete t.commander.defaultGraceTurns;
        else t.commander.defaultGraceTurns = v;
      },
    },
  ];

  let currentTuning: BotStrategyTuning = {};
  let bestEval = evaluateCandidate('Initial (Dynamic Auto)', currentTuning, opts, cache);
  const history: CandidateEvaluation[] = [bestEval];

  console.log(
    `[Coordinate] Initial Score: ${bestEval.overallScore.toFixed(2)} | WinRate: ${(bestEval.overallWinRate * 100).toFixed(1)}%`
  );

  for (let pass = 1; pass <= opts.passes; pass++) {
    let improvedInPass = false;
    console.log(`\n--- Coordinate Descent Pass ${pass}/${opts.passes} ---`);

    for (const axis of axes) {
      let bestAxisEval = bestEval;
      let bestAxisTuning = currentTuning;

      for (const val of axis.values) {
        const candidate = cloneTuning(currentTuning);
        axis.apply(candidate, val);
        const label = `P${pass} ${axis.label}=${val ?? 'auto'}`;
        process.stdout.write(`  Testing ${label} ... `);
        const ev = evaluateCandidate(label, candidate, opts, cache);
        console.log(
          `Score=${ev.overallScore.toFixed(2)} Win=${(ev.overallWinRate * 100).toFixed(1)}% Turns=${ev.overallAvgClearTurns.toFixed(0)} (${ev.durationSec}s)`
        );
        if (ev.overallScore > bestAxisEval.overallScore + 0.01) {
          bestAxisEval = ev;
          bestAxisTuning = candidate;
        }
      }

      if (bestAxisEval !== bestEval) {
        bestEval = bestAxisEval;
        currentTuning = bestAxisTuning;
        improvedInPass = true;
        history.push(bestEval);
        console.log(`  => Adopted ${bestEval.name} (Score: ${bestEval.overallScore.toFixed(2)})`);
      }
    }

    if (!improvedInPass) {
      console.log(`  Converged at pass ${pass}.`);
      break;
    }
  }

  return history;
}

function printSummary(evaluations: CandidateEvaluation[], opts: EvalCliOptions): void {
  const sorted = [...evaluations].sort((a, b) => b.overallScore - a.overallScore);

  console.log('\n========================================================================');
  console.log('  OVERALL SUMMARY RANKING');
  console.log('========================================================================');
  console.table(
    sorted.map((r, idx) => ({
      Rank: idx + 1,
      Candidate: r.name,
      Score: r.overallScore.toFixed(2),
      'Win Rate': `${(r.overallWinRate * 100).toFixed(1)}%`,
      'Avg Turns': r.overallAvgClearTurns > 0 ? r.overallAvgClearTurns.toFixed(1) : 'N/A',
      'Max NoGain': r.overallAvgMaxNoGain.toFixed(0),
      Time: `${r.durationSec}s`,
    }))
  );

  const top = sorted[0];
  if (top) {
    console.log(`\n[Best Candidate] ${top.name} (Score: ${top.overallScore.toFixed(2)})`);
    console.log('Matrix Breakdown:');
    console.table(
      top.cells.map(c => ({
        Topology: c.topology,
        RuleMode: c.ruleMode,
        Score: c.score.toFixed(2),
        'Win Rate': `${(c.winRate * 100).toFixed(1)}% (${c.clearedRuns}/${opts.runs})`,
        'Avg Turns': c.avgClearTurns > 0 ? c.avgClearTurns.toFixed(1) : 'N/A',
        'Max NoGain': c.avgMaxNoGain.toFixed(0),
        GiveUp: `${(c.giveUpRate * 100).toFixed(0)}%`,
      }))
    );

    console.log('Total Death Causes (Best):', top.totalDeathCauses);
    console.log('Commander Escalation Counts (Best):', top.totalCommanderLevels);
    console.log('Best Tuning JSON:', JSON.stringify(top.tuning, null, 2));
  }
}

function main(): void {
  const opts = parseCliArgs();
  console.log('========================================================================');
  console.log(`  DS1 AutoPlayBot Parameter Evaluation & Tuning (${opts.mode.toUpperCase()})`);
  console.log(`  Topologies: ${opts.topologies.join(', ')}`);
  console.log(`  RuleModes : ${opts.ruleModes.join(', ')}`);
  console.log(`  Runs/Cell : ${opts.runs} | MaxTurns: ${opts.maxTurnsLimit} | Seed: ${opts.baseSeed}`);
  console.log('========================================================================\n');

  const cache = new Map<string, CandidateEvaluation>();
  let evaluations: CandidateEvaluation[] = [];

  if (opts.mode === 'compare' || opts.mode === 'grid') {
    const cases = opts.mode === 'compare' ? buildCompareCases() : buildGridCases();
    for (const c of cases) {
      process.stdout.write(`Running: ${c.name} ... `);
      const ev = evaluateCandidate(c.name, c.tuning, opts, cache);
      console.log(
        `Done (${ev.durationSec}s) | Score: ${ev.overallScore.toFixed(2)} | Win: ${(ev.overallWinRate * 100).toFixed(1)}% | Turns: ${ev.overallAvgClearTurns.toFixed(0)}`
      );
      evaluations.push(ev);
    }
  } else if (opts.mode === 'coordinate') {
    evaluations = runCoordinateDescent(opts, cache);
  }

  printSummary(evaluations, opts);

  if (opts.outputPath) {
    const absPath = path.resolve(process.cwd(), opts.outputPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const sorted = [...evaluations].sort((a, b) => b.overallScore - a.overallScore);
    const payload = {
      generatedAt: new Date().toISOString(),
      options: opts,
      bestCandidate: sorted[0] ?? null,
      evaluations: sorted,
    };
    fs.writeFileSync(absPath, JSON.stringify(payload, null, 2), 'utf-8');
    console.log(`\nSaved JSON report to: ${absPath}`);
  }
}

main();
