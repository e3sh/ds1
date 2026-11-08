import { GameEngine } from '../src/core/GameEngine.js';
import { SeedRandom } from '../src/core/SeedRandom.js';

const runSeed = 10000;
const rng = new SeedRandom(runSeed);
const engine = new GameEngine({ rng });
engine.startProceduralGame({ seed: runSeed, topology: 'STANDARD_ROOMS', difficulty: 'NORMAL', pacing: 'STANDARD' });
const map = engine.getMap();
const keys: any[] = [];
const chests: any[] = [];
for (let y = 0; y < map.height; y++) {
  for (let x = 0; x < map.width; x++) {
    if (map.getItem({x, y}) === 'KEY') keys.push({x, y});
    if (map.getObject({x, y}) === 'CHEST') chests.push({x, y});
  }
}
console.log('Keys:', keys);
console.log('Chests count:', chests.length);
