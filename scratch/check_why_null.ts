import { GameEngine } from '../src/core/GameEngine.js';
import { SeedRandom } from '../src/core/SeedRandom.js';
import { AdaptiveAutoPlayBot } from '../src/ai/v2/AdaptiveAutoPlayBot.js';

const runSeed = 10000;
const rng = new SeedRandom(runSeed);
const engine = new GameEngine({ rng });
engine.startProceduralGame({ seed: runSeed, topology: 'STANDARD_ROOMS', difficulty: 'NORMAL', pacing: 'STANDARD' });

const bot = new AdaptiveAutoPlayBot({ profile: 'STANDARD' });

for (let turn = 1; turn <= 188; turn++) {
  engine.stepFrame(100);
  bot.step(engine);
}

const map = engine.getMap();
const p = engine.getPlayer();
const enemies = engine.getEnemies().filter(e => e.isAlive);
const dragon = engine.getDragon();

// executeBfs の内部でなぜ (28, 22) が除外されたかチェック
console.log('Dragon fire line on (28, 22)?', bot.nav.isDragonFireLine({x: 28, y: 22}, dragon, map));
for (const e of enemies) {
  console.log(`Enemy ${e.name} at (${e.pos.x}, ${e.pos.y}), dist: ${map.getTorusDistance({x: 28, y: 22}, e.pos).manhattan}`);
}
