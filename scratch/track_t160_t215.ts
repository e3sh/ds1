import { GameEngine } from '../src/core/GameEngine.js';
import { SeedRandom } from '../src/core/SeedRandom.js';
import { AdaptiveAutoPlayBot } from '../src/ai/v2/AdaptiveAutoPlayBot.js';

const runSeed = 10000;
const rng = new SeedRandom(runSeed);
const engine = new GameEngine({ rng });
engine.startProceduralGame({ seed: runSeed, topology: 'STANDARD_ROOMS', difficulty: 'NORMAL', pacing: 'STANDARD' });

const bot = new AdaptiveAutoPlayBot({ profile: 'STANDARD' });

for (let turn = 1; turn <= 215; turn++) {
  engine.stepFrame(100);
  const action = bot.step(engine);
  const p = engine.getPlayer();
  if (turn >= 160) {
    console.log(`T:${turn} Pos:(${p.pos.x},${p.pos.y}) Hold:${p.holdItem} Desc:${bot.currentTargetDesc} Action:${JSON.stringify(action)}`);
  }
}
