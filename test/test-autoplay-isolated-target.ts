import assert from 'node:assert';
import { AutoPlayBot } from '../src/ai/AutoPlayBot.js';
import { GameEngine } from '../src/core/GameEngine.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { Dragon } from '../src/models/Dragon.js';

console.log('--- AutoPlayBot Isolated & Sealed Target Handling Verification ---');

// =============================================================================
// Test 1: 封鎖エリア内の宝箱の即時ブラックリスト化＆同一ターン内での到達可能宝箱への切替
// =============================================================================
console.log('Testing 1: Sealed chest immediate blacklisting & instant switch to reachable chest...');
{
  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  const map = new WorldMap(30, 30);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      map.setTile({ x, y }, 'EMPTY');
      map.setObject({ x, y }, 'NONE');
      map.setItem({ x, y }, 'NONE');
    }
  }

  // プレイヤー: (10, 10)、鍵を所持しPOWER_RUSHフェーズ
  const player = new Player({ x: 10, y: 10, hp: 1000, experience: 2000 });
  player.hasSword = true;
  player.holdItem = 'KEY';
  bot.setPhase('POWER_RUSH');

  // 封鎖部屋: (12, 10) を四方（外壁 WALL_STATIC）で完全密閉し内部に宝箱Aを配置
  // 直線マンハッタン距離 = 2
  const sealedChestPos = { x: 12, y: 10 };
  map.setTile({ x: 12, y: 9 }, 'WALL_STATIC');
  map.setTile({ x: 12, y: 11 }, 'WALL_STATIC');
  map.setTile({ x: 11, y: 10 }, 'WALL_STATIC');
  map.setTile({ x: 13, y: 10 }, 'WALL_STATIC');
  map.setObject(sealedChestPos, 'CHEST');

  // 到達可能な宝箱B: (10, 14) に配置（直線マンハッタン距離 = 4、南へ直進可能）
  const reachableChestPos = { x: 10, y: 14 };
  map.setObject(reachableChestPos, 'CHEST');

  // モックエンジン相当の引数準備
  const dummyEngine = {
    getPlayer: () => player,
    getMap: () => map,
    getEnemies: () => [],
    getDragon: () => new Dragon({ x: 0, y: 0 }),
    getGhosts: () => [],
    executeTurn: () => {},
    castMagic: () => {},
  } as unknown as GameEngine;

  // 実行前の状態確認
  assert.strictEqual(bot.isTargetUnreachable(sealedChestPos), false, 'Sealed chest should not be blacklisted yet');

  // 1手目の行動決定
  const action = bot.decideAction(dummyEngine);

  // 1. 封鎖された宝箱A (12, 10) は即座にブラックリスト登録されること
  assert.strictEqual(
    bot.isTargetUnreachable(sealedChestPos),
    true,
    'Sealed chest must be marked as unreachable'
  );

  // 2. 同一ターン内で次点の到達可能宝箱B (10, 14) が選ばれ、南 (DOWN) へ移動すること！
  assert.strictEqual(action.type, 'MOVE', 'Action should be MOVE');
  if (action.type === 'MOVE') {
    assert.strictEqual(action.dir, 'DOWN', 'Bot must head DOWN towards reachable chest (10, 14)');
  }

  // 3. ロック対象が到達可能な宝箱Bに設定されていること
  const lockedPos = (bot as any).lockedChestPos;
  assert.deepStrictEqual(lockedPos, reachableChestPos, 'Bot should lock onto reachable chest');

  // 4. 次ターン以降、封鎖宝箱は候補リストからも除外されBFSすらスキップされること
  const candidates = bot.findNearestChestCandidates(player.pos, map, [], player, 5);
  assert.ok(
    !candidates.some(c => c.x === sealedChestPos.x && c.y === sealedChestPos.y),
    'Blacklisted sealed chest must not be included in chest candidates'
  );

  console.log('✓ 1. Sealed chest immediate blacklisting & instant switch to reachable chest verified.');
}

// =============================================================================
// Test 2: 封鎖エリア内の剣（SWORD）に対する即時ブラックリスト化と到達可能剣への直行
// =============================================================================
console.log('Testing 2: Sealed sword handling in BOOTSTRAP phase...');
{
  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  const map = new WorldMap(30, 30);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      map.setTile({ x, y }, 'EMPTY');
      map.setObject({ x, y }, 'NONE');
      map.setItem({ x, y }, 'NONE');
    }
  }

  // プレイヤー: (5, 5)、剣未所持、BOOTSTRAPフェーズ
  const player = new Player({ x: 5, y: 5, hp: 1000, experience: 0 });
  player.hasSword = false;
  player.holdItem = 'NONE';
  bot.setPhase('BOOTSTRAP');

  // 封鎖部屋: (5, 3) を四方壁で密閉し内部に SWORD_A を配置（距離 2）
  const sealedSwordPos = { x: 5, y: 3 };
  map.setTile({ x: 5, y: 2 }, 'WALL_STATIC');
  map.setTile({ x: 5, y: 4 }, 'WALL_STATIC');
  map.setTile({ x: 4, y: 3 }, 'WALL_STATIC');
  map.setTile({ x: 6, y: 3 }, 'WALL_STATIC');
  map.setItem(sealedSwordPos, 'SWORD');

  // 到達可能な SWORD_B: (9, 5) に配置（東に距離 4）
  const reachableSwordPos = { x: 9, y: 5 };
  map.setItem(reachableSwordPos, 'SWORD');

  const dummyEngine = {
    getPlayer: () => player,
    getMap: () => map,
    getEnemies: () => [],
    getDragon: () => new Dragon({ x: 0, y: 0 }),
    getGhosts: () => [],
    executeTurn: () => {},
    castMagic: () => {},
  } as unknown as GameEngine;

  const action = bot.decideAction(dummyEngine);

  // 封鎖された剣がブラックリストに登録され、到達可能な剣 (9, 5) に向かって東 (RIGHT) へ移動すること
  assert.strictEqual(bot.isTargetUnreachable(sealedSwordPos), true);
  assert.strictEqual(action.type, 'MOVE');
  if (action.type === 'MOVE') {
    assert.strictEqual(action.dir, 'RIGHT', 'Bot must head RIGHT towards reachable sword');
  }

  console.log('✓ 2. Sealed sword blacklisting & switch to reachable sword verified.');
}

// =============================================================================
// Test 3: 全ターゲットが封鎖されている場合の即時安全徘徊（長考・壁際張り付きなし）
// =============================================================================
console.log('Testing 3: Immediate safe wander fallback when all targets are sealed...');
{
  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  const map = new WorldMap(30, 30);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      map.setTile({ x, y }, 'EMPTY');
      map.setObject({ x, y }, 'NONE');
      map.setItem({ x, y }, 'NONE');
    }
  }

  // プレイヤー: (10, 10)、鍵所持
  const player = new Player({ x: 10, y: 10, hp: 1000, experience: 2000 });
  player.hasSword = true;
  player.holdItem = 'KEY';
  bot.setPhase('POWER_RUSH');

  // マップ上に四方を密閉された封鎖宝箱1個のみ存在
  const sealedChestPos = { x: 13, y: 10 };
  map.setTile({ x: 13, y: 9 }, 'WALL_STATIC');
  map.setTile({ x: 13, y: 11 }, 'WALL_STATIC');
  map.setTile({ x: 12, y: 10 }, 'WALL_STATIC');
  map.setTile({ x: 14, y: 10 }, 'WALL_STATIC');
  map.setObject(sealedChestPos, 'CHEST');

  const dummyEngine = {
    getPlayer: () => player,
    getMap: () => map,
    getEnemies: () => [],
    getDragon: () => new Dragon({ x: 0, y: 0 }),
    getGhosts: () => [],
    executeTurn: () => {},
    castMagic: () => {},
  } as unknown as GameEngine;

  // 1手目で封鎖宝箱がブラックリスト化され、wanderSafe へスムーズにフォールバック
  const action1 = bot.decideAction(dummyEngine);
  assert.strictEqual(bot.isTargetUnreachable(sealedChestPos), true);
  assert.strictEqual(action1.type, 'MOVE');

  // 2手目: 封鎖宝箱がすでにブラックリストにあるため、BFSを行わずに直ちに wanderSafe へ行くこと
  const startTime = Date.now();
  for (let i = 0; i < 20; i++) {
    const action = bot.decideAction(dummyEngine);
    assert.strictEqual(action.type, 'MOVE');
  }
  const elapsed = Date.now() - startTime;
  // 20ターン分の思考時間が数ミリ秒以内で瞬時に完了すること（長考・フルBFSループの完全根絶）
  assert.ok(elapsed < 100, `20 turns should complete almost instantaneously, took ${elapsed}ms`);

  console.log('✓ 3. Immediate safe wander fallback & zero BFS overhead verified.');
}

// =============================================================================
// Test 4: 地形変化・ワープ・フェーズ変更時のブラックリストクリア
// =============================================================================
console.log('Testing 4: Blacklist clearing upon warp & phase transitions...');
{
  const bot = new AutoPlayBot({ profile: 'STANDARD' });
  const sealedPos = { x: 15, y: 15 };
  bot.markTargetUnreachable(sealedPos, 30);
  assert.strictEqual(bot.isTargetUnreachable(sealedPos), true);

  // フェーズ変更でクリアされること
  bot.setPhase('DRAGON_SLAY');
  assert.strictEqual(bot.isTargetUnreachable(sealedPos), false, 'Phase transition should clear unreachable blacklist');

  // 再登録後、clearUnreachableTargets でクリアされること
  bot.markTargetUnreachable(sealedPos, 30);
  assert.strictEqual(bot.isTargetUnreachable(sealedPos), true);
  bot.clearUnreachableTargets();
  assert.strictEqual(bot.isTargetUnreachable(sealedPos), false);

  console.log('✓ 4. Blacklist clearing verified.');
}

console.log('--- All AutoPlayBot Isolated Target Tests PASSED Successfully! ---');
