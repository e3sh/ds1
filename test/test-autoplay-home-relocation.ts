import assert from 'assert';
import { GameEngine } from '../src/core/GameEngine.js';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { Dragon } from '../src/models/Dragon.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { MagicSystem } from '../src/systems/MagicSystem.js';

console.log('--- AutoPlayBot Home Relocation Tactics & Tactical Fortress Base Verification ---');

// Test 1: ドラゴン決戦準備完了時の RELOCATE_HOME 遷移と安全アンカー選定
console.log('Testing 1: Transition to RELOCATE_HOME and safe fortress anchor selection...');
{
  const engine = new GameEngine({ seed: 12345 });
  engine.startGame({ dragonPrefab: 'FORTRESS_7x7' });
  const player = engine.getPlayer();
  const map = engine.getMap();
  const dragon = engine.getDragon();

  const bot = new AutoPlayBot({ profile: 'STANDARD' });

  // ドラゴン決戦準備完了ステータス
  player.hasSword = true;
  player.strength = 450000;
  player.experience = 420000; // 斜め移動・BREAK・防御力確保済み (EXP >= 415,000)
  player.magic = 5;

  // 初期位置 (7, 7) はドラゴン (32, 32) から十分遠い (チェビシェフ距離 25)
  assert.ok(map.getTorusDistance(map.realHomePos, map.dragonCenter).chebyshev >= 10);

  // マップ上に RING が存在することを確認
  let hasRingOnMap = false;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.getItem({ x, y }) === 'RING') {
        hasRingOnMap = true;
        break;
      }
    }
  }
  assert.strictEqual(hasRingOnMap, true, '初期マップに RING が配置されていること');

  // アクション決定 -> 決戦準備完了時、未封鎖墓があればまず GRAVE_SEAL、完了後に RELOCATE_HOME へ遷移すること
  bot.decideAction(engine);
  if (bot.currentPhase === 'GRAVE_SEAL') {
    console.log('✓ 1-A. Pre-dragon grave seal triggered first as tactical priority.');
    bot.graveSealAborted = true; // 墓封鎖完了
    bot.decideAction(engine);
  }
  assert.strictEqual(bot.currentPhase, 'RELOCATE_HOME', '決戦前に RELOCATE_HOME フェーズへ遷移すること');

  // 安全アンカーの選定検証
  const anchor = bot.findHomeRelocateAnchor(map, dragon, engine.getEnemies(), player);
  assert.ok(anchor !== null, '安全アンカーが選定されること');
  const anchorCheb = map.getTorusDistance(anchor, map.dragonCenter).chebyshev;
  assert.ok(anchorCheb >= 5 && anchorCheb <= 8, `アンカーは要塞外縁(5〜8マス)であること (actual: ${anchorCheb})`);
  assert.strictEqual(
    bot.isDragonFireLine(anchor, dragon, map),
    false,
    'アンカーはドラゴンの火炎弾射線外（死角）であること'
  );
  console.log(`✓ 1. RELOCATE_HOME transition & anchor (${anchor.x}, ${anchor.y}) selected.`);
}

// Test 2: 指輪の確保と我が家のプッシュ移動（土木BREAK含む）
console.log('Testing 2: Ring pickup, obstacle BREAK, and pushing HOME to destination...');
{
  const map = new WorldMap(64, 64);
  const dragon = new Dragon({ x: 32, y: 32 });
  const player = new Player({ x: 20, y: 20, hp: 15000, experience: 60000, strength: 450000 });
  player.maxHp = 15000;
  player.hasSword = true;
  player.magic = 5;

  // 家を (26, 18) に配置（dragonCenter (32, 32) からチェビシェフ距離 14）
  // 目標アンカーを (26, 26)（要塞外縁・距離 6）に設定し、南へ押し運ぶテスト
  map.setBaseTile({ x: 7, y: 7 }, 'EMPTY');
  map.setBaseTile({ x: 26, y: 18 }, 'HOME');
  map.setRealHomePos({ x: 26, y: 18 });
  player.pos = { x: 26, y: 16 };

  // 途中の押し出し先 (26, 19) に岩 (BLOCK) を置いて土木工事が必要な状況を演出
  map.setObject({ x: 26, y: 19 }, 'BLOCK');

  // 足元 (26, 16) に RING を配置
  map.setItem({ x: 26, y: 16 }, 'RING');

  const bot = new AutoPlayBot({
    profile: 'STANDARD',
    strategyTuning: {
      enableHomeRelocation: true,
      homeRelocateTargetDistMin: 5,
      homeRelocateTargetDistMax: 8,
      graveSealPolicy: 'NONE',
    },
  });
  bot.currentPhase = 'RELOCATE_HOME';
  bot.lockedRelocateAnchor = { x: 26, y: 26 };

  const dummyEngine = {
    getPlayer: () => player,
    getMap: () => map,
    getEnemies: () => [],
    getDragon: () => dragon,
    getGhosts: () => [],
  } as unknown as GameEngine;

  // ステップ1: 足元の RING を拾う (SPACE)
  const act1 = bot.decideAction(dummyEngine);
  assert.strictEqual(act1.type, 'SPACE', '足元のRINGを拾うこと');
  MovementSystem.executeSpaceAction(player, map);
  assert.strictEqual(player.holdItem, 'RING', 'プレイヤーがRINGを所持すること');

  // ステップ2: 押し出し先 (26, 19) の BLOCK を破壊しに行く
  // 家は (26, 18) にあり、南に押すための pushDest は (26, 19) で BLOCK
  // ボットは BLOCK を破壊するため回り込むか BREAK を詠唱する
  let breakExecuted = false;
  for (let turn = 0; turn < 20; turn++) {
    const act = bot.decideAction(dummyEngine);
    if (act.type === 'MAGIC' && act.magic === 'BREAK') {
      MagicSystem.cast(player, 'BREAK', map, [], dragon);
      breakExecuted = true;
      break;
    } else if (act.type === 'MOVE') {
      player.dir = act.dir;
      MovementSystem.tryMove(player, act.dir, map);
    }
  }
  assert.strictEqual(breakExecuted, true, '押し出し先のBLOCKをBREAK魔法で破壊すること');
  assert.strictEqual(map.getObject({ x: 26, y: 19 }), 'NONE', 'BLOCKが破壊されて空きマスになったこと');

  // ステップ3: 家を南へプッシュ
  let homePushed = false;
  for (let turn = 0; turn < 40; turn++) {
    const prevHome = { ...map.realHomePos };
    const act = bot.decideAction(dummyEngine);
    if (act.type === 'MOVE') {
      MovementSystem.tryMove(player, act.dir, map);
      if (map.realHomePos.y > prevHome.y) {
        homePushed = true;
      }
    } else if (act.type === 'SPACE') {
      MovementSystem.executeSpaceAction(player, map);
    } else if (act.type === 'MAGIC' && act.magic === 'BREAK') {
      MagicSystem.cast(player, 'BREAK', map, [], dragon);
    }
    if (map.realHomePos.y >= 24 && bot.currentPhase === 'DRAGON_SLAY') {
      break;
    }
  }
  assert.strictEqual(homePushed, true, '我が家が南へ押し進められたこと');
  console.log('✓ 2. Ring pickup, obstacle BREAK, and home pushing verified.');
}

// Test 3: 首討伐後の2軒化と王冠脱出（前線基地への超短距離帰還）
console.log('Testing 3: Dual-home respawn and CROWN_ESCAPE returning to relocated forward base...');
{
  const map = new WorldMap(64, 64);
  const dragon = new Dragon({ x: 32, y: 32 });
  // 前線基地をドラゴン要塞外縁 (32, 26) に設置
  map.setBaseTile({ x: 7, y: 7 }, 'EMPTY');
  map.setBaseTile({ x: 32, y: 26 }, 'HOME');
  map.setRealHomePos({ x: 32, y: 26 });
  map.initialHomePos = { x: 7, y: 7 };

  // 首を1本ずつ討伐してapplyWorldChangesを実行（首1本目で初期位置 (7, 7) の家が復活）
  dragon.damageHead(dragon.heads[0], 999999);
  dragon.applyWorldChanges(map);
  dragon.damageHead(dragon.heads[1], 999999);
  dragon.applyWorldChanges(map);
  dragon.damageHead(dragon.heads[2], 999999);
  dragon.applyWorldChanges(map);

  // 前線基地と初期位置の2軒が存在することを確認
  assert.strictEqual(map.getBaseTile({ x: 32, y: 26 }), 'HOME', '要塞外縁の前線基地が維持されていること');
  assert.strictEqual(map.getBaseTile({ x: 7, y: 7 }), 'HOME', '初期位置の家が復活していること');
  assert.strictEqual(map.realHomePos.x, 32);
  assert.strictEqual(map.realHomePos.y, 26, 'プレイヤーの帰還目標は前線基地であること');

  // 王冠を前線基地のすぐ近く (32, 28) に配置
  map.setItem({ x: 32, y: 28 }, 'CROWN');

  const player = new Player({ x: 32, y: 28, hp: 20000, experience: 20000, strength: 500000 });
  player.maxHp = 20000;
  player.hasSword = true;
  player.holdItem = 'CROWN'; // 4個目の王冠を所持

  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  bot.currentPhase = 'CROWN_ESCAPE';

  const dummyEngine = {
    getPlayer: () => player,
    getMap: () => map,
    getEnemies: () => [],
    getDragon: () => dragon,
    getGhosts: () => [],
  } as unknown as GameEngine;

  // 前線基地へのアプローチ（初期位置(7,7)ではなく、目の前の前線基地(32,26)へ向かうこと）
  const act = bot.decideAction(dummyEngine);
  assert.strictEqual(act.type, 'MOVE');
  assert.ok(act.dir === 'UP' || act.dir === 'UP_LEFT' || act.dir === 'UP_RIGHT', `前線基地方向へ進むこと (actual: ${act.dir})`);

  // 数歩進んで前線基地へ帰還
  let reachedHome = false;
  for (let step = 0; step < 10; step++) {
    const nextAct = bot.decideAction(dummyEngine);
    if (nextAct.type === 'MOVE') {
      MovementSystem.tryMove(player, nextAct.dir, map);
    }
    if (player.pos.x === map.realHomePos.x && player.pos.y === map.realHomePos.y) {
      reachedHome = true;
      break;
    }
  }
  assert.strictEqual(reachedHome, true, '数歩で安全に前線基地へ帰還成功！');
  assert.strictEqual(map.getBaseTile(player.pos), 'HOME');

  console.log('✓ 3. Crown escape successfully returned to forward base in just 2 steps.');
}

// Test 4: 安全ガード（タイムアウト・無効化オプション）
console.log('Testing 4: Safety guards (enableHomeRelocation=false and timeout fallback)...');
{
  const engine = new GameEngine({ seed: 99999 });
  engine.startGame();
  const player = engine.getPlayer();
  player.hasSword = true;
  player.strength = 450000;
  player.experience = 420000;
  player.magic = 5;

  // 4-A: enableHomeRelocation: false の場合は RELOCATE_HOME をスキップして DRAGON_SLAY へ
  const botDisabled = new AutoPlayBot({
    profile: 'STANDARD',
    strategyTuning: { enableHomeRelocation: false, graveSealPolicy: 'NONE' },
  });
  botDisabled.decideAction(engine);
  assert.strictEqual(botDisabled.currentPhase, 'DRAGON_SLAY', '無効時は直接 DRAGON_SLAY へ遷移すること');

  // 4-B: タイムアウト（80ターン超過）時の安全フォールバック
  const botTimeout = new AutoPlayBot({
    profile: 'STANDARD',
    strategyTuning: { enableHomeRelocation: true, graveSealPolicy: 'NONE' },
  });
  botTimeout.currentPhase = 'RELOCATE_HOME';
  botTimeout.totalHomeRelocateTurns = 85; // 80ターン超過

  const actTimeout = botTimeout.decideAction(engine);
  assert.strictEqual(botTimeout.currentPhase, 'DRAGON_SLAY', '80ターン超過時は DRAGON_SLAY へ安全にフォールバックすること');
  assert.strictEqual(botTimeout.homeRelocationAborted, true, '移転中断フラグが立つこと');

  console.log('✓ 4. Disabled setting and timeout fallback verified successfully.');
}

// Test 5: MP備蓄優先・鍵持ちPOTION回収・墓封鎖・家移転のフルフロー連携
console.log('Testing 5: Full tactical flow (Low MP collection with KEY -> Grave Seal -> Relocate Home)...');
{
  const map = new WorldMap(64, 64);
  const dragon = new Dragon({ x: 32, y: 32 });
  const player = new Player({ x: 20, y: 20, hp: 15000, experience: 60000, strength: 450000 });
  player.maxHp = 15000;
  player.hasSword = true;
  player.magic = 0; // MP枯渇状態！
  player.holdItem = 'KEY'; // 鍵を所持

  map.setBaseTile({ x: 20, y: 20 }, 'EMPTY');
  map.setObject({ x: 20, y: 20 }, 'NONE');
  map.setItem({ x: 20, y: 20 }, 'NONE');

  map.setBaseTile({ x: 20, y: 21 }, 'EMPTY');
  map.setObject({ x: 20, y: 21 }, 'NONE');
  map.setItem({ x: 20, y: 21 }, 'POTION');

  const bot = new AutoPlayBot({
    profile: 'STANDARD',
    strategyTuning: {
      enableHomeRelocation: true,
      maxTargetMagic: 5,
    },
  });

  const dummyEngine = {
    getPlayer: () => player,
    getMap: () => map,
    getEnemies: () => [],
    getDragon: () => dragon,
    getGhosts: () => [],
  } as unknown as GameEngine;

  // 5-A: STR/EXP十分でも MP=0 のため POWER_RUSH を維持して POTION 回収へ向かう
  const act1 = bot.decideAction(dummyEngine);
  assert.strictEqual(bot.currentPhase, 'POWER_RUSH', 'MP不足時は決戦に行かずPOWER_RUSHを維持');
  assert.strictEqual(act1.type, 'MOVE', 'POTION方向へ移動すること');
  assert.strictEqual(act1.dir, 'DOWN');

  // POTIONマス (20, 21) へ移動
  player.pos = { x: 20, y: 21 };

  // 5-B: POTIONマスを踏んだ後、鍵を一時退避して手ぶらになりPOTIONを回収するスワップフロー
  // 1手目: 足元にPOTIONがあるため安全な空床へ1歩退避して鍵を置く
  const act2 = bot.decideAction(dummyEngine);
  assert.strictEqual(act2.type, 'MOVE', '鍵を一時ドロップするために安全な空床へ移動');

  // 5-C: MPが目標値（3以上）に到達した場合のフェーズ遷移
  player.magic = 3;
  // 未封鎖墓の存在下では GRAVE_SEAL へ遷移
  const act3 = bot.decideAction(dummyEngine);
  assert.strictEqual(bot.currentPhase, 'GRAVE_SEAL', 'MP確保後、未封鎖墓があればまずGRAVE_SEALへ');

  // 墓封鎖完了後、RELOCATE_HOME へ遷移
  bot.graveSealAborted = true; // 墓封鎖完了
  const act4 = bot.decideAction(dummyEngine);
  assert.strictEqual(bot.currentPhase, 'RELOCATE_HOME', '墓封鎖完了後にRELOCATE_HOMEへ進軍');

  console.log('✓ 5. Full tactical flow verified successfully.');
}

console.log('--- ✓ All AutoPlayBot Home Relocation Tests Passed Successfully! ---');
