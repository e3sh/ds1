import { GameEngine } from '../src/core/GameEngine.js';
import { SeedRandom } from '../src/core/SeedRandom.js';
import { AdaptiveAutoPlayBot } from '../src/ai/v2/AdaptiveAutoPlayBot.js';
import { ResourceFarmBehavior } from '../src/ai/v2/behaviors/ResourceFarmBehavior.js';

const runSeed = 10000;
const rng = new SeedRandom(runSeed);
const engine = new GameEngine({ rng });
engine.startProceduralGame({ seed: runSeed, topology: 'STANDARD_ROOMS', difficulty: 'NORMAL', pacing: 'STANDARD' });

const bot = new AdaptiveAutoPlayBot({ profile: 'STANDARD' });

for (let turn = 1; turn <= 280; turn++) {
  engine.stepFrame(100);
  if (turn === 279) {
    const map = engine.getMap();
    const player = engine.getPlayer();
    const enemies = engine.getEnemies().filter(e => e.isAlive);
    const dragon = engine.getDragon();
    const keyPos = { x: 17, y: 15 };
    console.log('Turn 279:');
    console.log('Player pos:', player.pos, 'Hold:', player.holdItem, 'STR:', player.strength, 'targetStr:', bot.params?.targetStr);
    console.log('Tile at KEY (17, 15): item =', map.getItem(keyPos), 'obj =', map.getObject(keyPos), 'base =', map.getBaseTile(keyPos));
    const enemyAtKey = enemies.find(e => e.pos.x === 17 && e.pos.y === 15);
    console.log('Enemy at KEY (17, 15):', enemyAtKey?.name);
    const path = bot.nav.findPath(player.pos, keyPos, map, player, enemies, bot.params!, { dragon });
    console.log('findPath to KEY:', path);
    const candidates = bot.nav.findNearestItemCandidates(player.pos, 'KEY', map, enemies, player, 8, bot.lockedItemPos);
    console.log('KEY candidates from (16, 15):', candidates);
  }
  bot.step(engine);
}
