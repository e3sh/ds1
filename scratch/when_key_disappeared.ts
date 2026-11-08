import { GameEngine } from '../src/core/GameEngine.js';
import { SeedRandom } from '../src/core/SeedRandom.js';
import { AdaptiveAutoPlayBot } from '../src/ai/v2/AdaptiveAutoPlayBot.js';

const runSeed = 10000;
const rng = new SeedRandom(runSeed);
const engine = new GameEngine({ rng });
engine.startProceduralGame({ seed: runSeed, topology: 'STANDARD_ROOMS', difficulty: 'NORMAL', pacing: 'STANDARD' });

const bot = new AdaptiveAutoPlayBot({ profile: 'STANDARD' });

for (let turn = 1; turn <= 250; turn++) {
  const map = engine.getMap();
  const item = map.getItem({ x: 17, y: 15 });
  const p = engine.getPlayer();
  if (item === 'NONE') {
    console.log(`KEY disappeared at turn ${turn}! Player at (${p.pos.x}, ${p.pos.y}) Hold:${p.holdItem}`);
    break;
  }
  engine.stepFrame(100);
  bot.step(engine);
}
