import { GameEngine } from '../src/core/GameEngine.js';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { BotVersion } from '../src/ai/BotTypes.js';

const rawArg = process.argv[2] ?? 'pst';
const botVersion: BotVersion = (rawArg === 'v1' || rawArg === 'behavior') ? 'behavior' : 'pst';
const versionLabel = botVersion === 'behavior' ? 'Behavior (v1)' : 'PST (v2)';

console.log('================================================================');
console.log(` Running 10 Seeds Evaluation on [${versionLabel}]`);
console.log('================================================================');

for (let seed = 0; seed < 10; seed++) {
  const engine = new GameEngine({
    seed,
    topology: 'STANDARD_ROOMS',
    difficulty: 'NORMAL',
    pacing: 'STANDARD',
  });
  engine.startGame();
  const bot = new AutoPlayBot({
    botVersion: botVersion as any,
  });

  let turns = 0;
  let chestsOpened = 0;
  engine.getEventBus().on('chest:open', () => {
    chestsOpened++;
  });

  while (turns < 2500 && engine.getState() === 'PLAYING' && !bot.isGivenUp) {
    turns++;
    engine.stepFrame(100);
    bot.step(engine);
  }

  const p = engine.getPlayer();
  console.log(`Seed ${seed}: State=${engine.getState()}, Turns=${turns}, Chests=${chestsOpened}, GivenUp=${bot.isGivenUp}, Reason="${bot.currentTargetDesc}", DeathCause=${p.deathInfo?.cause ?? 'NONE'}, STR=${p.strength}, EXP=${p.experience}`);
}
