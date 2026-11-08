import { GameEngine } from '../src/core/GameEngine.js';
import { SeedRandom } from '../src/core/SeedRandom.js';
import { AdaptiveAutoPlayBot } from '../src/ai/v2/AdaptiveAutoPlayBot.js';

const runSeed = 10000;
const rng = new SeedRandom(runSeed);
const engine = new GameEngine({ rng });
engine.startProceduralGame({ seed: runSeed, topology: 'STANDARD_ROOMS', difficulty: 'NORMAL', pacing: 'STANDARD' });

const bot = new AdaptiveAutoPlayBot({ profile: 'STANDARD' });

for (let turn = 1; turn <= 1000; turn++) {
  engine.stepFrame(100);
  bot.step(engine);
}

const map = engine.getMap();
const p = engine.getPlayer();
const enemies = engine.getEnemies().filter(e => e.isAlive);
const dragon = engine.getDragon();

console.log('Turn 1000:');
console.log('Player pos:', p.pos, 'Hold:', p.holdItem, 'STR:', p.strength, 'EXP:', p.experience);
const keys: any[] = [];
const stones: any[] = [];
const coins: any[] = [];
const potions: any[] = [];
const chests: any[] = [];
for (let y = 0; y < map.height; y++) {
  for (let x = 0; x < map.width; x++) {
    const item = map.getItem({x, y});
    const obj = map.getObject({x, y});
    if (item === 'KEY') keys.push({x, y});
    if (item === 'POWER_STONE') stones.push({x, y});
    if (item === 'COIN') coins.push({x, y});
    if (item === 'POTION') potions.push({x, y});
    if (obj === 'CHEST') chests.push({x, y});
  }
}
console.log('Keys:', keys);
console.log('Stones:', stones);
console.log('Coins count:', coins.length);
console.log('Potions count:', potions.length);
console.log('Chests count:', chests.length);
console.log('Enemies count:', enemies.length);

const safeEnemies = enemies.filter(e => {
  const dist = map.getTorusDistance(p.pos, e.pos).manhattan;
  return dist <= 20;
});
console.log('Nearby enemies <= 20:', safeEnemies.map(e => ({ name: e.name, pos: e.pos, dist: map.getTorusDistance(p.pos, e.pos).manhattan })));
