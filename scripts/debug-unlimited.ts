import { GameEngine } from '../src/core/GameEngine.js';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';

async function runSeed(seed: number, maxTurns: number = 10000) {
  const engine = new GameEngine({ seed, topology: 'STANDARD_ROOMS', difficulty: 'NORMAL', pacing: 'STANDARD' });
  engine.startGame();
  const bot = new AutoPlayBot({ botVersion: 'pst' as any, enableGiveUp: false });
  let turns = 0;
  let chests = 0;
  engine.getEventBus().on('chest:open', () => { chests++; });

  console.log(`[Seed ${seed}] Start unlimited simulation (max ${maxTurns} turns)`);
  const startTime = Date.now();

  while (turns < maxTurns && engine.getState() === 'PLAYING' && !bot.isGivenUp) {
    turns++;
    engine.stepFrame(100);
    bot.step(engine);

    if (turns % 500 === 0) {
      const p = engine.getPlayer();
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  Seed ${seed} Turn ${turns} (${elapsed}s): STR=${p.strength}, EXP=${p.experience}, Gold=${p.gold}, Pot=${p.magic}, Chests=${chests}, Action="${bot.currentTargetDesc}"`);
    }
  }

  const p = engine.getPlayer();
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Seed ${seed} DONE in ${totalElapsed}s] State=${engine.getState()}, Turns=${turns}, Chests=${chests}, GivenUp=${bot.isGivenUp}, STR=${p.strength}, EXP=${p.experience}, DeathCause=${p.deathInfo?.cause ?? 'NONE'}`);
  console.log(`  Reason: ${bot.currentTargetDesc}`);
}

async function main() {
  for (let s = 0; s < 3; s++) {
    await runSeed(s, 5000);
  }
}

main().catch(console.error);
