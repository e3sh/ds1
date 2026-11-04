import { WorldMap } from '../src/models/WorldMap.js';
import { Player } from '../src/models/Player.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { TurnManager } from '../src/core/TurnManager.js';

function runTests() {
  console.log('--- Phase 1 Logic Verification ---');

  // 1. マップとプレイヤーの初期化検証
  const map = new WorldMap(64, 64);
  const player = new Player({ x: 8, y: 8, hp: 1000, experience: 1000 });

  console.assert(player.pos.x === 8 && player.pos.y === 8, 'Player initial pos mismatch');
  console.assert(player.hp === 1000, 'Player HP mismatch');
  console.assert(player.effectiveAttack === 10, 'Player attack without sword should be 10');

  // 2. 移動と衝突判定の検証
  // 静的壁への移動不可テスト
  map.setBaseTile({ x: 1, y: 0 }, 'WALL_STATIC');
  const playerAtWall = new Player({ x: 1, y: 1 });
  const movedToWall = MovementSystem.tryMove(playerAtWall, 'UP', map);
  console.assert(!movedToWall, 'Player should not be able to move into static wall');
  console.assert(playerAtWall.pos.y === 1, 'Player position should remain unchanged after hitting wall');

  // 通行可能マスへの移動
  const movedOk = MovementSystem.tryMove(player, 'RIGHT', map);
  console.assert(movedOk, 'Player should move to empty tile');
  console.assert(player.pos.x === 9 && player.pos.y === 8, 'Player x should be 9');
  console.assert(player.dir === 'RIGHT', 'Player direction should be RIGHT');

  // 3. アイテム取得の検証 (剣を拾う)
  map.setTile({ x: 10, y: 8 }, 'SWORD');
  const movedToSword = MovementSystem.tryMove(player, 'RIGHT', map);
  console.assert(movedToSword, 'Player should step on sword tile');
  // DS1仕様: アイテムマスに乗った後、SPACEキーアクションで取得
  MovementSystem.executeSpaceAction(player, map);
  console.assert(player.hasSword === true, 'Player should now possess sword');
  console.assert(player.effectiveAttack === player.strength, 'Player attack should now use strength');
  console.assert(map.getTile({ x: 10, y: 8 }) === 'EMPTY', 'Sword tile should become EMPTY');

  // コインを拾う
  map.setTile({ x: 10, y: 9 }, 'COIN');
  MovementSystem.tryMove(player, 'DOWN', map);
  MovementSystem.executeSpaceAction(player, map);
  console.assert(player.gold === 1, 'Player gold should be 1');
  console.assert(map.getTile({ x: 10, y: 9 }) === 'EMPTY', 'Coin tile should become EMPTY');

  // 4. 我が家での回復処理検証
  player.hp = 200;
  player.holdItem = 'POWER_STONE';
  const initialStr = player.strength;
  player.healAtHome();
  console.assert(player.hp === player.experience + 10, 'Player HP should be healed to EXP + gold bonus');
  console.assert(player.gold === 0, 'Gold should be consumed at home');
  console.assert(player.strength === initialStr + 1000, 'Strength should increase from power stone');
  console.assert(player.holdItem === 'NONE', 'Power stone should be consumed');

  // 5. ターンマネージャーとインジケーターの検証
  let timeoutFired = false;
  const tm = new TurnManager(2500);
  tm.setOnTurnTimeout(() => {
    timeoutFired = true;
  });

  tm.update(1000);
  console.assert(Math.abs(tm.ratio - 0.4) < 0.01, 'Ratio should be ~0.4');
  console.assert(!timeoutFired, 'Timeout should not fire yet');

  tm.update(1500);
  console.assert(timeoutFired, 'Timeout should fire after 2500ms');
  console.assert(tm.ratio === 0, 'Ratio should be reset after timeout');

  console.log('✓ All Phase 1 Logic Tests Passed Successfully!');
}

runTests();
