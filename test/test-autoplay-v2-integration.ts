import assert from 'assert';
import { GameEngine } from '../src/core/GameEngine.js';
import { SeedRandom } from '../src/core/SeedRandom.js';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';

console.log('================================================================');
console.log('  Testing PST Step 2: AutoPlayBot PST Integration Test          ');
console.log('================================================================');

// Test 1: AutoPlayBot (PST) による実ゲーム 100 ターン自律実行テスト
console.log('Testing 1: AutoPlayBot procedural game step execution (100 turns)...');
{
  const rng = new SeedRandom(12345);
  const engine = new GameEngine({ rng });

  engine.startProceduralGame({
    seed: 12345,
    topology: 'STANDARD_ROOMS',
    difficulty: 'NORMAL',
    pacing: 'STANDARD',
  });

  const bot = new AutoPlayBot({
    profile: 'STANDARD',
  });

  let turns = 0;
  const missionRecords: string[] = [];

  while (turns < 100 && engine.getState() === 'PLAYING') {
    turns++;
    engine.stepFrame(100);

    const action = bot.step(engine);
    assert.ok(action, `ターン ${turns}: action が正常に生成されること`);

    const curMission = bot.strategicPlanner.activeMission?.name;
    if (curMission && !missionRecords.includes(curMission)) {
      missionRecords.push(curMission);
    }

    if (bot.isGivenUp) {
      console.log(`Bot gave up at turn ${turns}: ${bot.currentTargetDesc}`);
      break;
    }
  }

  const player = engine.getPlayer();
  console.log(`Executed ${turns} turns. State: ${engine.getState()}, HP: ${player.hp}/${player.maxHp}, STR: ${player.strength}, EXP: ${player.experience}`);
  console.log(`Missions engaged: ${missionRecords.join(' -> ')}`);
  console.log(`Current Target Desc: ${bot.currentTargetDesc}`);

  assert.ok(turns >= 30, '最低でも30ターン以上正常に進行すること');
  assert.ok(missionRecords.length >= 1, 'ミッションが少なくとも1つ実行されていること');

  console.log('✓ 1. AutoPlayBot PST procedural execution verified.');
}

console.log('================================================================');
console.log('  ALL PST STEP 2 INTEGRATION TESTS PASSED!                     ');
console.log('================================================================');
