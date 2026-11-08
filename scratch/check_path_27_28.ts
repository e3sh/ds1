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

console.log('At turn 188:');
console.log('Player pos:', p.pos);
console.log('Tile at (27, 22):', 'obj =', map.getObject({x: 27, y: 22}), 'item =', map.getItem({x: 27, y: 22}), 'base =', map.getBaseTile({x: 27, y: 22}));
console.log('Tile at (28, 22):', 'obj =', map.getObject({x: 28, y: 22}), 'item =', map.getItem({x: 28, y: 22}), 'base =', map.getBaseTile({x: 28, y: 22}));

const path = bot.nav.findPath(p.pos, {x: 28, y: 22}, map, p, enemies, bot.params!, { dragon });
console.log('findPath from (27, 22) to (28, 22):', path);
const isUnreach = bot.nav.isTargetUnreachable({x: 28, y: 22});
console.log('is (28, 22) unreachable?', isUnreach);
