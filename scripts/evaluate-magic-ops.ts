import { GameEngine } from '../src/core/GameEngine.js';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { MagicType } from '../src/models/Types.js';

interface SeedMetrics {
  seed: number;
  cleared: boolean;
  died: boolean;
  finalPhase: string;
  turns: number;
  finalHp: number;
  finalStr: number;
  finalExp: number;
  finalMagic: number;
  mpZeroTurns: number;
  mpOneTurns: number;
  breakCasts: number;
  kickCasts: number;
  freezeCasts: number;
  flashCasts: number;
  returnCasts: number;
  totalChestsOpened: number;
  remainingChests: number;
  potionsCollected: number;
  deathCause?: string;
}

const seeds = [111111, 222222, 333333, 444444, 555555, 666666, 777777, 888888, 999999, 123456];
const results: SeedMetrics[] = [];

console.log(`=== AutoPlayBot 魔法オペレーション実証評価 (${seeds.length} seeds) ===\n`);

for (const seed of seeds) {
  const engine = new GameEngine({ headless: true });
  engine.startGame(seed);
  const bot = new AutoPlayBot({ profile: 'STANDARD' });

  let mpZeroTurns = 0;
  let mpOneTurns = 0;
  let breakCasts = 0;
  let kickCasts = 0;
  let freezeCasts = 0;
  let flashCasts = 0;
  let returnCasts = 0;
  let potionsCollected = 0;
  let lastMagic = engine.getPlayer().magic;

  const maxTurns = 2000;
  let turn = 0;

  for (; turn < maxTurns; turn++) {
    if (engine.getState() !== 'PLAYING') break;

    const player = engine.getPlayer();
    if (player.magic === 0) mpZeroTurns++;
    if (player.magic === 1) mpOneTurns++;

    if (player.magic > lastMagic) {
      potionsCollected++;
    }
    lastMagic = player.magic;

    const action = bot.step(engine);

    if (action.type === 'MAGIC') {
      const m = action.magic as MagicType;
      if (m === 'BREAK') breakCasts++;
      else if (m === 'KICK') kickCasts++;
      else if (m === 'FREEZE') freezeCasts++;
      else if (m === 'FLASH') flashCasts++;
      else if (m === 'RETURN') returnCasts++;
    }
  }

  const map = engine.getMap();
  let remainingChests = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.getObject({ x, y }) === 'CHEST') remainingChests++;
    }
  }

  const finalPlayer = engine.getPlayer();
  results.push({
    seed,
    cleared: engine.getState() === 'STAGECLEAR',
    died: engine.getState() === 'GAMEOVER',
    finalPhase: bot.currentPhase,
    turns: turn,
    finalHp: finalPlayer.hp,
    finalStr: finalPlayer.strength,
    finalExp: finalPlayer.experience,
    finalMagic: finalPlayer.magic,
    mpZeroTurns,
    mpOneTurns,
    breakCasts,
    kickCasts,
    freezeCasts,
    flashCasts,
    returnCasts,
    totalChestsOpened: engine.getChestsOpened ? engine.getChestsOpened() : 0,
    remainingChests,
    potionsCollected,
    deathCause: engine.getDeathCause ? engine.getDeathCause() : undefined,
  });

  const stateStr = engine.getState();
  console.log(`Seed ${seed}: State=${stateStr}, Phase=${bot.currentPhase}, Turns=${turn}, STR=${finalPlayer.strength}, EXP=${finalPlayer.experience}, Crowns=${finalPlayer.crowns}/4, MP=${finalPlayer.magic} (0MP:${mpZeroTurns}T, 1MP:${mpOneTurns}T), BREAK=${breakCasts}, KICK=${kickCasts}, FREEZE=${freezeCasts}, RETURN=${returnCasts}, ChestsLeft=${remainingChests}`);
}

console.log('\n=== 評価サマリー ===');
const totalRuns = results.length;
const clearedCount = results.filter(r => r.cleared).length;
const totalBreaks = results.reduce((acc, r) => acc + r.breakCasts, 0);
const totalKicks = results.reduce((acc, r) => acc + r.kickCasts, 0);
const totalFreezes = results.reduce((acc, r) => acc + r.freezeCasts, 0);
const totalReturns = results.reduce((acc, r) => acc + r.returnCasts, 0);
const avgMpZero = (results.reduce((acc, r) => acc + r.mpZeroTurns, 0) / totalRuns).toFixed(1);
const avgMpOne = (results.reduce((acc, r) => acc + r.mpOneTurns, 0) / totalRuns).toFixed(1);
const avgTurns = (results.reduce((acc, r) => acc + r.turns, 0) / totalRuns).toFixed(0);

console.log(`勝率 (Clear Rate)   : ${((clearedCount / totalRuns) * 100).toFixed(1)}% (${clearedCount}/${totalRuns})`);
console.log(`平均ターン数        : ${avgTurns}`);
console.log(`累計 BREAK 発動回数 : ${totalBreaks} 回 (1ラン平均: ${(totalBreaks / totalRuns).toFixed(2)})`);
console.log(`累計 KICK  発動回数 : ${totalKicks} 回 (1ラン平均: ${(totalKicks / totalRuns).toFixed(2)})`);
console.log(`累計 FREEZE発動回数 : ${totalFreezes} 回 (1ラン平均: ${(totalFreezes / totalRuns).toFixed(2)})`);
console.log(`累計 RETURN発動回数 : ${totalReturns} 回 (1ラン平均: ${(totalReturns / totalRuns).toFixed(2)})`);
console.log(`平均 MP=0 ターン数  : ${avgMpZero} ターン / ラン`);
console.log(`平均 MP=1 ターン数  : ${avgMpOne} ターン / ラン`);
