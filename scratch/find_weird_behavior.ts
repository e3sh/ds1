import { GameEngine } from '../src/core/GameEngine.js';
import { SeedRandom } from '../src/core/SeedRandom.js';
import { GameEventBus } from '../src/core/GameEventBus.js';
import { AdaptiveAutoPlayBot } from '../src/ai/v2/AdaptiveAutoPlayBot.js';

const masterRng = new SeedRandom(10000);
const runSeed = masterRng.nextInt(1, 0x7fffffff);
const eventBus = new GameEventBus();
const runRng = new SeedRandom(runSeed);
const engine = new GameEngine({ rng: runRng, eventBus });

engine.startProceduralGame({
  seed: runSeed,
  topology: 'STANDARD_ROOMS',
  difficulty: 'NORMAL',
  pacing: 'STANDARD',
});

const bot = new AdaptiveAutoPlayBot({ profile: 'STANDARD', maxTurnsLimit: 5000 });

let finalTurn = 0;
for (let t = 1; t <= 5000 && engine.getState() === 'PLAYING'; t++) {
  finalTurn = t;
  engine.stepFrame(100);
  const p = engine.getPlayer();
  if (t % 100 === 0 || t >= 3150 || engine.getState() !== 'PLAYING') {
    const dragon = engine.getDragon();
    const livingHeads = dragon ? dragon.heads.filter(h => h.isAlive).length : 0;
    console.log(`[T:${t}] Pos:(${p.pos.x},${p.pos.y}) Phase:${bot.currentPhase} HP:${p.hp}/${p.maxHp} Heads:${livingHeads} Crowns:${p.crowns} Item:${p.holdItem} Act:${bot.lastDecidedActionDesc} Target:${bot.currentTargetDesc}`);
  }
  bot.step(engine);
}

const p = engine.getPlayer();
console.log(`Final Seed 10000: State=${engine.getState()} Turns=${finalTurn} Crowns=${p.crowns} DeathCause=${p.deathInfo?.cause}`);
