import { GameEngine } from '../src/core/GameEngine.js';
import { SeedRandom } from '../src/core/SeedRandom.js';
import { GameEventBus } from '../src/core/GameEventBus.js';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';

const baseSeed = 10000;
const masterRng = new SeedRandom(baseSeed);
const runSeeds: number[] = [];
for (let i = 0; i < 20; i++) {
  runSeeds.push(masterRng.nextInt(1, 0x7fffffff));
}

const targetRun = parseInt(process.argv[2] ?? '3', 10);
const startLog = parseInt(process.argv[3] ?? '0', 10);
const endLog = parseInt(process.argv[4] ?? '0', 10);
const runIndex = targetRun - 1;
const runSeed = runSeeds[runIndex];

console.log(`Running Run ${targetRun} (seed: ${runSeed})...`);

const eventBus = new GameEventBus();
const runRng = new SeedRandom(runSeed);
const engine = new GameEngine({ rng: runRng, eventBus });

engine.startProceduralGame({
  seed: runSeed,
  topology: 'STANDARD_ROOMS',
  difficulty: 'NORMAL',
  pacing: 'STANDARD',
});

const bot = new AutoPlayBot({
  profile: 'STANDARD',
  maxTurnsLimit: 3000,
});

let turns = 0;
const logHistory: string[] = [];

while (turns < 3000 && engine.getState() === 'PLAYING') {
  turns++;
  engine.stepFrame(100);
  bot.step(engine);
  const p = engine.getPlayer();
  const line = `T${turns} [${bot.currentPhase}] Pos:(${p.pos.x},${p.pos.y}) Item:${p.holdItem} HP:${p.hp}/${p.maxHp} EXP:${p.experience} MP:${p.magic} Desc:${bot.currentTargetDesc}`;
  logHistory.push(line);
  if (logHistory.length > 50) logHistory.shift();

  if ((startLog > 0 && endLog > 0 && turns >= startLog && turns <= endLog) || (startLog === 0 && (turns <= 20 || turns % 200 === 0))) {
    console.log(line);
  }
  if ('isGivenUp' in bot && bot.isGivenUp) {
    console.log(`Bot GAVE UP at turn ${turns}: ${bot.currentTargetDesc}`);
    break;
  }
}

console.log(`\n--- Last 30 turns before end ---`);
for (const l of logHistory.slice(-30)) {
  console.log(l);
}

console.log(`\nFinal State: ${engine.getState()} at T${turns}`);
const p = engine.getPlayer();
console.log(`Player: HP:${p.hp} EXP:${p.experience} STR:${p.strength} hasSword:${p.hasSword} deathInfo:`, p.deathInfo);
