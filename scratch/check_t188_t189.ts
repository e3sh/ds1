import { GameEngine } from '../src/core/GameEngine.js';
import { SeedRandom } from '../src/core/SeedRandom.js';
import { AdaptiveAutoPlayBot } from '../src/ai/v2/AdaptiveAutoPlayBot.js';

const runSeed = 10000;
const rng = new SeedRandom(runSeed);
const engine = new GameEngine({ rng });
engine.startProceduralGame({ seed: runSeed, topology: 'STANDARD_ROOMS', difficulty: 'NORMAL', pacing: 'STANDARD' });

const bot = new AdaptiveAutoPlayBot({ profile: 'STANDARD' });

for (let turn = 1; turn <= 190; turn++) {
  engine.stepFrame(100);
  if (turn === 188 || turn === 189) {
    const p = engine.getPlayer();
    console.log(`Before step ${turn}: Pos:(${p.pos.x},${p.pos.y}) Hold:${p.holdItem}`);
    console.log('  swapState:', (bot as any).swapState);
    const action = bot.decideAction(engine);
    console.log(`  decided:`, action, 'desc:', bot.currentTargetDesc);
    console.log('  swapState after decide:', (bot as any).swapState);
  }
  bot.step(engine);
}
