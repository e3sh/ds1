import { GameEngine } from '../src/core/GameEngine.js';
import { SeedRandom } from '../src/core/SeedRandom.js';
import { GameEventBus } from '../core/GameEventBus.js';
import { AdaptiveAutoPlayBot } from '../src/ai/v2/AdaptiveAutoPlayBot.js';

const runSeed = 10000;
const rng = new SeedRandom(runSeed);
const engine = new GameEngine({ rng });
engine.startProceduralGame({
  seed: runSeed,
  topology: 'STANDARD_ROOMS',
  difficulty: 'NORMAL',
  pacing: 'STANDARD',
});

const bot = new AdaptiveAutoPlayBot({ profile: 'STANDARD', maxTurnsLimit: 8000 });

console.log('Turn | Phase | Player Pos | HP | STR | EXP | Sword | TargetDesc | LastAction');
for (let turn = 1; turn <= 8000; turn++) {
  engine.stepFrame(100);
  const action = bot.step(engine);
  const p = engine.getPlayer();

  if (turn >= 2220 && turn <= 2235) {
    const enemies = engine.getEnemies ? engine.getEnemies() : (engine as any).enemies;
    const nearbyEnemies = enemies.filter((e: any) => e.isAlive && Math.abs(e.pos.x - p.pos.x) <= 3 && Math.abs(e.pos.y - p.pos.y) <= 3);
    console.log(`[Turn ${turn}] P:(${p.pos.x},${p.pos.y}) HP:${p.hp}/${p.maxHp} MP:${p.magic} Hold:${p.holdItem} Phase:${bot.currentPhase} Action:${JSON.stringify(action)} desc:${bot.currentTargetDesc}`);
    console.log(` Nearby enemies: ${nearbyEnemies.map((e: any) => `${e.name}@(${e.pos.x},${e.pos.y}) atk:${e.atk}`).join('; ')}`);
  }

  if (engine.getState() !== 'PLAYING') {
    console.log(`Finished at turn ${turn}: State = ${engine.getState()}, Cause = ${p.deathInfo?.cause}`);
    break;
  }
}
