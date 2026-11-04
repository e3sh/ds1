import { strict as assert } from 'node:assert';
import { Player } from '../src/models/Player.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { EnemyInstance } from '../src/models/Enemy.js';
import { Dragon } from '../src/models/Dragon.js';
import { Ghost } from '../src/models/Ghost.js';
import { SaveManager, CURRENT_SAVE_VERSION, FullSaveData, SAVE_DATA_KEY } from '../src/services/SaveManager.js';
import { MagicSystem } from '../src/systems/MagicSystem.js';
import { SpawnSystem } from '../src/systems/SpawnSystem.js';

// Node.js 環境での LocalStorage モック
class LocalStorageMock {
  private store: Map<string, string> = new Map();

  public getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  public removeItem(key: string): void {
    this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }
}

// globalThis.localStorage にモックをセット
(globalThis as unknown as { localStorage: LocalStorageMock }).localStorage = new LocalStorageMock();

console.log('--- Phase 5.5: Save & Continue, Give Up Verification ---');

// 1. 各モデルのシリアライズ・デシリアライズ完全性テスト
console.log('Testing 1: Entity Serialization and Deserialization...');
{
  // Player
  const p1 = new Player({ x: 12, y: 15, hp: 850, experience: 2400 });
  p1.gold = 350;
  p1.magic = 4;
  p1.crowns = 2;
  p1.hasSword = true;
  p1.holdItem = 'RING';
  p1.canDiagonal = true;
  p1.isFlying = true;
  p1.flyTimer = 5;
  p1.totalKills = 7;
  p1.stepCountSinceStone = 3;

  const pSaved = p1.serialize();
  const p2 = new Player();
  p2.deserialize(pSaved);

  assert.equal(p2.pos.x, 12);
  assert.equal(p2.pos.y, 15);
  assert.equal(p2.hp, 850);
  assert.equal(p2.experience, 2400);
  assert.equal(p2.gold, 350);
  assert.equal(p2.magic, 4);
  assert.equal(p2.crowns, 2);
  assert.equal(p2.hasSword, true);
  assert.equal(p2.holdItem, 'RING');
  assert.equal(p2.canDiagonal, true);
  assert.equal(p2.isFlying, true);
  assert.equal(p2.flyTimer, 5);
  assert.equal(p2.totalKills, 7);
  assert.equal(p2.stepCountSinceStone, 3);
  console.log('✓ 1.1 Player serialization verified.');

  // WorldMap
  const m1 = new WorldMap();
  m1.moveTile({ x: 7, y: 7 }, { x: 7, y: 8 }); // 家を移動
  m1.setTile({ x: 10, y: 10 }, 'COIN');
  const mSaved = m1.serialize();

  const m2 = new WorldMap();
  m2.deserialize(mSaved);
  assert.equal(m2.homePos.x, 7);
  assert.equal(m2.homePos.y, 8);
  assert.equal(m2.getTile({ x: 10, y: 10 }), 'COIN');
  console.log('✓ 1.2 WorldMap serialization verified.');

  // EnemyInstance
  const e1 = new EnemyInstance({ typeId: 5, pos: { x: 20, y: 22 }, hp: 250 });
  e1.frozenTimer = 4;
  e1.moveCounter = 1;
  const eSaved = e1.serialize();
  const e2 = EnemyInstance.fromJSON(eSaved);
  assert.equal(e2.typeId, 5);
  assert.equal(e2.pos.x, 20);
  assert.equal(e2.pos.y, 22);
  assert.equal(e2.hp, 250);
  assert.equal(e2.frozenTimer, 4);
  assert.equal(e2.moveCounter, 1);
  console.log('✓ 1.3 EnemyInstance serialization verified.');

  // Dragon
  const d1 = new Dragon({ x: 32, y: 32 });
  d1.damageHead(d1.heads[0], 999999); // 首1本撃破
  assert.equal(d1.defeatedHeadsCount, 1);
  assert.equal(d1.heads[0].isAlive, false);
  const dSaved = d1.serialize();

  const d2 = new Dragon({ x: 32, y: 32 });
  d2.deserialize(dSaved);
  assert.equal(d2.defeatedHeadsCount, 1);
  assert.equal(d2.heads[0].isAlive, false);
  assert.equal(d2.heads[1].isAlive, true);
  console.log('✓ 1.4 Dragon serialization verified.');

  // Ghost
  const g1 = new Ghost({ pos: { x: 15, y: 18 } });
  g1.carriedItem = 'SWORD';
  const gSaved = g1.serialize();
  const g2 = Ghost.fromJSON(gSaved);
  assert.equal(g2.pos.x, 15);
  assert.equal(g2.pos.y, 18);
  assert.equal(g2.carriedItem, 'SWORD');
  console.log('✓ 1.5 Ghost serialization verified.');
}

// 2. SaveManager の入出力、バージョン整合性テスト
console.log('Testing 2: SaveManager storage, version check & fallback...');
{
  SaveManager.clear();
  assert.equal(SaveManager.hasSave(), false);
  assert.equal(SaveManager.load(), null);

  const testData: FullSaveData = {
    version: CURRENT_SAVE_VERSION,
    savedAt: new Date().toISOString(),
    player: new Player({ x: 5, y: 6, hp: 900 }).serialize(),
    map: new WorldMap().serialize(),
    enemies: [new EnemyInstance({ typeId: 1, pos: { x: 10, y: 10 } }).serialize()],
    dragon: new Dragon().serialize(),
    ghosts: [new Ghost({ pos: { x: 8, y: 8 } }).serialize()],
    system: {
      totalTurns: 42,
      paletteMode: 'PINCH',
      selectedMagicIndex: 1,
      showMiniMap: false,
      spawnTurnCounter: 3,
    },
  };

  const saveSuccess = SaveManager.save(testData);
  assert.equal(saveSuccess, true);
  assert.equal(SaveManager.hasSave(), true);

  const loaded = SaveManager.load();
  assert.notEqual(loaded, null);
  assert.equal(loaded?.version, '1.0.0');
  assert.equal(loaded?.system.totalTurns, 42);
  assert.equal(loaded?.system.paletteMode, 'PINCH');

  const summary = SaveManager.getSummary();
  assert.notEqual(summary, null);
  assert.equal(summary?.hp, 900);

  // 不正バージョンデータのフォールバック検証
  localStorage.setItem(SAVE_DATA_KEY, JSON.stringify({ version: '0.9.0', player: {} }));
  assert.equal(SaveManager.load(), null);
  assert.equal(SaveManager.hasSave(), false);

  // 破損JSONデータのフォールバック検証
  localStorage.setItem(SAVE_DATA_KEY, '{ invalid json');
  assert.equal(SaveManager.load(), null);
  assert.equal(SaveManager.hasSave(), false);

  SaveManager.clear();
  assert.equal(SaveManager.hasSave(), false);
  console.log('✓ 2. SaveManager persistence & error handling verified.');
}

// 3. MagicSystem.cast('SAVE') との統合テスト
console.log('Testing 3: MagicSystem SAVE integration...');
{
  const p = new Player({ x: 8, y: 8, hp: 1000, experience: 15000 });
  p.magic = 3;
  const map = new WorldMap();
  const dragon = new Dragon();

  const res = MagicSystem.cast(p, 'SAVE', map, [], [], dragon, {
    totalTurns: 100,
    paletteMode: 'NORMAL',
    selectedMagicIndex: 0,
    showMiniMap: false,
    spawnTurnCounter: 2,
  });

  assert.equal(res.success, true);
  assert.equal(p.magic, 2); // MAGIC 1消費
  assert.equal(SaveManager.hasSave(), true);

  const saved = SaveManager.load();
  assert.equal(saved?.system.totalTurns, 100);
  assert.equal(saved?.player.experience, 15000);
  console.log('✓ 3. MagicSystem SAVE complete serialization verified.');
}

console.log('--- ✓ All Phase 5.5 Save & Give Up Tests Passed Successfully! ---');
