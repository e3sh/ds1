import assert from 'node:assert';
import { Dragon } from '../src/models/Dragon.js';
import { Player } from '../src/models/Player.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { ProceduralMapGenerator, SeededRandom } from '../src/systems/ProceduralMapGenerator.js';
import { GameEngine } from '../src/core/GameEngine.js';
import { TuningPresetResolver } from '../src/config/TuningPresetResolver.js';

console.log('--- Dynamic Sector, Item Scaling & Anti-Block Fortress Verification ---');

// ============================================================================
// Test 1: 不規則・可変セクター分割 (Dynamic Sector & Organic Layout) 検証
// ============================================================================
console.log('Testing 1: Dynamic Sector generation, jitter & typology assignment...');
{
  const rng1 = new SeededRandom(1111);
  const sectors1 = ProceduralMapGenerator.generateDynamicSectors(rng1);

  const rng2 = new SeededRandom(9999);
  const sectors2 = ProceduralMapGenerator.generateDynamicSectors(rng2);

  // 1-A. セクター数が9つ（全域3x3分割）生成されること
  assert.strictEqual(sectors1.length, 9, 'Should generate 9 dynamic sectors covering whole map');
  assert.strictEqual(sectors2.length, 9);

  // 1-B. シードによって境界座標にジッター（揺らぎ）が存在し、固定格子ではないこと
  let hasCoordVariance = false;
  for (let i = 0; i < 9; i++) {
    if (
      sectors1[i].x1 !== sectors2[i].x1 ||
      sectors1[i].x2 !== sectors2[i].x2 ||
      sectors1[i].y1 !== sectors2[i].y1 ||
      sectors1[i].y2 !== sectors2[i].y2
    ) {
      hasCoordVariance = true;
      break;
    }
  }
  assert.strictEqual(hasCoordVariance, true, 'Dynamic sectors must have jittered variable bounds across seeds');

  // 1-C. 各セクターにタイポロジー（GRAND_HALL, LONG_CORRIDOR, CRANK_CHAMBER 等）が割り当てられること
  const typologies = sectors1.map(s => s.typology).filter(Boolean);
  assert.strictEqual(typologies.length, 9, 'All sectors must have an assigned typology');

  // 1-D. 可変セクターによるダンジョン全体の生成と解法性の検証
  const map = new WorldMap(64, 64);
  const report = ProceduralMapGenerator.generateDungeon(map, {
    seed: 55555,
    difficulty: 'NORMAL',
    topology: 'MULTI_SECTOR',
  });
  assert.strictEqual(report.isSolvable, true, 'Dynamic multi-sector dungeon must be solvable');
  assert.strictEqual(report.hasZeroOverlaps, true, 'Zero overlaps required in dynamic layout');
  assert.strictEqual(report.internalWallsAreBlocks, true, 'All internal walls must be BLOCK');

  console.log('✓ 1. Dynamic Sector jitter, typologies & solvability verified.');
}

// ============================================================================
// Test 2: 難易度・ペーシング連動の重要アイテム配置スケーリング検証
// ============================================================================
console.log('Testing 2: Difficulty & pacing item placement distance scaling...');
{
  // 2-A. EASY モード: 全重要アイテムが我が家近傍（距離 <= 3）に即集結
  {
    const mapEasy = new WorldMap(64, 64);
    ProceduralMapGenerator.generateDungeon(mapEasy, {
      seed: 12345,
      difficulty: 'EASY',
      pacing: 'STANDARD',
    });

    const homePos = mapEasy.homePos;
    const swordDist = getShortestManhattanToItem(mapEasy, 'SWORD', homePos);
    const keyDist = getShortestManhattanToItem(mapEasy, 'KEY', homePos);
    const ringDist = getShortestManhattanToItem(mapEasy, 'RING', homePos);

    assert.ok(swordDist <= 3, `EASY: SWORD should be in start room (distance <= 3, got ${swordDist})`);
    assert.ok(keyDist <= 4, `EASY: KEY should be in start room (distance <= 4, got ${keyDist})`);
    assert.ok(ringDist <= 3, `EASY: RING should be in start room (distance <= 3, got ${ringDist})`);
  }

  // 2-B. NORMAL モード: 我が家近傍は RING と POTION。KEY は中距離、SWORD は遠距離セクター
  {
    const mapNormal = new WorldMap(64, 64);
    ProceduralMapGenerator.generateDungeon(mapNormal, {
      seed: 12345,
      difficulty: 'NORMAL',
      pacing: 'STANDARD',
    });

    const homePos = mapNormal.homePos;
    const ringDist = getShortestManhattanToItem(mapNormal, 'RING', homePos);
    const keyDist = getShortestManhattanToItem(mapNormal, 'KEY', homePos);
    const swordDist = getShortestManhattanToItem(mapNormal, 'SWORD', homePos);

    assert.ok(ringDist <= 3, `NORMAL: RING should be near home (got ${ringDist})`);
    assert.ok(keyDist >= 6 && keyDist <= 14, `NORMAL: KEY should be near home perimeter (got ${keyDist})`);
    assert.ok(swordDist >= 10, `NORMAL: SWORD should be in distant area (distance >= 10, got ${swordDist})`);
  }

  // 2-C. HARD モード: 我が家内は完全素手（POTION 1個のみ）。
  // RING は中距離、KEY は遠距離、SWORD は最遠隔セクター深部へ配置
  {
    const mapHard = new WorldMap(64, 64);
    ProceduralMapGenerator.generateDungeon(mapHard, {
      seed: 12345,
      difficulty: 'HARD',
      pacing: 'STANDARD',
    });

    const homePos = mapHard.homePos;

    // 我が家プレハブ内（周囲2マス）に SWORD, RING, KEY が存在しないこと（素手スタート）
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const it = mapHard.getItem(mapHard.wrapPosition({ x: homePos.x + dx, y: homePos.y + dy }));
        assert.ok(
          it !== 'SWORD' && it !== 'RING' && it !== 'KEY',
          `HARD start room must not contain weapons/keys (found ${it} at offset ${dx},${dy})`
        );
      }
    }

    const ringDist = getShortestManhattanToItem(mapHard, 'RING', homePos);
    const keyDist = getShortestManhattanToItem(mapHard, 'KEY', homePos);
    const swordDist = getShortestManhattanToItem(mapHard, 'SWORD', homePos);

    assert.ok(ringDist >= 8 && ringDist <= 16, `HARD: RING on outer perimeter (distance 8..16, got ${ringDist})`);
    assert.ok(keyDist >= 15, `HARD: KEY in distant area (distance >= 15, got ${keyDist})`);
    assert.ok(swordDist >= 20, `HARD: SWORD in far remote area (distance >= 20, got ${swordDist})`);
  }

  // 2-D. ペーシング補正（BLITZ vs MARATHON）のスケーリング検証
  {
    const mapBlitz = new WorldMap(64, 64);
    ProceduralMapGenerator.generateDungeon(mapBlitz, {
      seed: 98765,
      difficulty: 'HARD',
      pacing: 'BLITZ',
    });

    const mapMarathon = new WorldMap(64, 64);
    ProceduralMapGenerator.generateDungeon(mapMarathon, {
      seed: 98765,
      difficulty: 'HARD',
      pacing: 'MARATHON',
    });

    const swordBlitz = getShortestManhattanToItem(mapBlitz, 'SWORD', mapBlitz.homePos);
    const swordMarathon = getShortestManhattanToItem(mapMarathon, 'SWORD', mapMarathon.homePos);

    assert.ok(
      swordMarathon >= swordBlitz,
      `MARATHON SWORD distance (${swordMarathon}) should be >= BLITZ SWORD distance (${swordBlitz})`
    );
  }

  console.log('✓ 2. Item placement distance scaling & HARD stealth bootstrap verified.');
}

// ============================================================================
// Test 3: ドラゴン要塞の首正面防衛 & 火炎弾「岩置き完封ハック」の防止検証
// ============================================================================
console.log('Testing 3: Dragon Fortress anti-block barrier & fireball penetration...');
{
  const map = new WorldMap(64, 64);
  const cx = 32;
  const cy = 32;
  ProceduralMapGenerator.generateDungeon(map, {
    seed: 77777,
    difficulty: 'NORMAL',
    dragonCenter: { x: cx, y: cy },
  });

  const dragon = new Dragon({ x: cx, y: cy });

  // 3-A. 各首の正面1〜2マスに CHEST または POTION（アイテム）が配置されていること
  // 中首 (cx, cy-1: 上向き) 正面
  const centerFrontItem = map.getItem({ x: cx, y: cy - 2 });
  const centerFrontObj = map.getObject({ x: cx, y: cy - 3 });
  assert.strictEqual(centerFrontItem, 'POTION', 'Center head front must have POTION');
  assert.strictEqual(centerFrontObj, 'CHEST', 'Center head front must have CHEST');

  // 左首 (cx-1, cy: 左向き) 正面
  const leftFrontObj = map.getObject({ x: cx - 2, y: cy });
  const leftFrontItem = map.getItem({ x: cx - 3, y: cy });
  assert.strictEqual(leftFrontObj, 'CHEST', 'Left head front must have CHEST');
  assert.strictEqual(leftFrontItem, 'POTION', 'Left head front must have POTION');

  // 右首 (cx+1, cy: 右向き) 正面
  const rightFrontObj = map.getObject({ x: cx + 2, y: cy });
  const rightFrontItem = map.getItem({ x: cx + 3, y: cy });
  assert.strictEqual(rightFrontObj, 'CHEST', 'Right head front must have CHEST');
  assert.strictEqual(rightFrontItem, 'POTION', 'Right head front must have POTION');

  // 3-B. プレイヤーが指輪を持って首正面マスへ岩（BLOCK）を押そうとしても拒絶されること
  // （isPushDestinationValid により CHEST や POTION のあるマスへは押し込めない）
  assert.strictEqual(
    map.isPushDestinationValid({ x: cx, y: cy - 2 }),
    false,
    'Cannot push BLOCK onto POTION tile (Center head front)'
  );
  assert.strictEqual(
    map.isPushDestinationValid({ x: cx, y: cy - 3 }),
    false,
    'Cannot push BLOCK onto CHEST tile (Center head front)'
  );
  assert.strictEqual(
    map.isPushDestinationValid({ x: cx - 2, y: cy }),
    false,
    'Cannot push BLOCK onto CHEST tile (Left head front)'
  );
  assert.strictEqual(
    map.isPushDestinationValid({ x: cx + 2, y: cy }),
    false,
    'Cannot push BLOCK onto CHEST tile (Right head front)'
  );

  // プレイヤーが実際に岩を押して首正面に置こうとしても押せないことのシミュレーション
  const player = new Player({ x: cx, y: cy - 1, hp: 50000 });
  player.holdItem = 'RING';
  // (cx, cy-4) にある岩を (cx, cy-3: CHEST) へ向けて南へ押そうとする
  player.pos = { x: cx, y: cy - 5 };
  const pushAttempt = MovementSystem.tryMove(player, 'DOWN', map);
  assert.strictEqual(pushAttempt, false, 'Pushing rock onto CHEST must fail');
  assert.strictEqual(map.getObject({ x: cx, y: cy - 3 }), 'CHEST', 'CHEST remains intact');

  // 3-C. 火炎弾が首正面の POTION や CHEST を貫通して直線上のプレイヤーへ直撃すること
  // 中首 (cx, cy-1) から上方へ発射
  // プレイヤーを中首の射線上 (cx, cy-4) に配置（手前には POTION(cy-2) と CHEST(cy-3) がある）
  map.setObject({ x: cx, y: cy - 4 }, 'NONE'); // プレイヤーが立てるよう一時的に空床に
  player.pos = { x: cx, y: cy - 4 };
  const initialHp = player.hp;

  // 首が射線上のプレイヤーを視認できること（CHESTやPOTIONは視界を遮らない）
  const centerHead = dragon.heads[1];
  assert.strictEqual(
    dragon.canHeadSeePlayer(centerHead, player.pos, map),
    true,
    'Dragon center head must see player through POTION and CHEST'
  );

  // 火炎弾発射
  dragon.updateFireballs(player, map);
  assert.strictEqual(dragon.fireballs.length, 1, 'Fireball launched');

  // 火炎弾の進行（POTIONとCHESTを通過してプレイヤーに到達するまで進める）
  while (dragon.fireballs.length > 0 && player.hp === initialHp) {
    dragon.updateFireballs(player, map);
  }
  assert.ok(player.hp < initialHp, 'Player must take fireball damage through CHEST and POTION');

  console.log('✓ 3. Dragon Fortress anti-block barrier & fireball penetration verified.');
}

// ============================================================================
// Test 4: デバッグモード & CLASSIC_FIXED 固定マップ動作確認モードの検証
// ============================================================================
console.log('Testing 4: Debug Mode & CLASSIC_FIXED mode verification...');
{
  const engine = new GameEngine();

  // 4-A. デフォルトの startGame() がプロシージャルモードで開始されること
  engine.startGame();
  assert.strictEqual(engine.getState(), 'PLAYING');
  assert.strictEqual(engine.isProceduralMode, true, 'Default startGame() should launch procedural dungeon');

  // 4-B. CLASSIC_FIXED モードでクラシック固定マップが起動できること (動作確認・回帰テスト用)
  engine.startProceduralGame({ topology: 'CLASSIC_FIXED' });
  assert.strictEqual(engine.getState(), 'PLAYING');
  assert.strictEqual(engine.isProceduralMode, false, 'CLASSIC_FIXED should run in classic fixed map mode');

  // 4-C. TuningPresetResolver で CLASSIC_FIXED が解決可能であること
  const classicResolved = TuningPresetResolver.resolve('CLASSIC_FIXED');
  assert.strictEqual(classicResolved.progressionConfig.expCurveMode, 'CLASSIC_LINEAR');
  assert.strictEqual(classicResolved.resourceCapConfig.cross.maxCap, 99);

  // 4-D. Player.reset() による参照維持とプロパティ初期化の検証
  const player = engine.getPlayer();
  player.hp = 50;
  player.strength = 9999;
  player.hasSword = true;
  player.reset({ hp: 1000, strength: 10 });
  assert.strictEqual(player.hp, 1000);
  assert.strictEqual(player.strength, 10);
  assert.strictEqual(player.hasSword, false);
  assert.strictEqual(player, engine.getPlayer(), 'Player reference must be preserved across reset');

  console.log('✓ 4. Debug Mode & CLASSIC_FIXED mode verified.');
}

// ============================================================================
// ヘルパー関数
// ============================================================================
function getShortestManhattanToItem(map: WorldMap, itemType: string, fromPos: { x: number; y: number }): number {
  let minDist = 9999;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.getItem({ x, y }) === itemType) {
        const d = map.getTorusDistance(fromPos, { x, y }).manhattan;
        if (d < minDist) {
          minDist = d;
        }
      }
    }
  }
  return minDist;
}

console.log('--- ✓ All Dynamic Sector Tests Passed Successfully! ---');
