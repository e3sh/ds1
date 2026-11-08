import assert from 'node:assert';
import { DOMUIManager } from '../src/view/DOMUIManager.js';
import { Player } from '../src/models/Player.js';
import { MAGIC_TABLE } from '../src/config/MagicTable.js';
import { InspectorModal } from '../src/view/InspectorModal.js';
import { WorldMap } from '../src/models/WorldMap.js';
import { Dragon } from '../src/models/Dragon.js';
import { TuningPresetResolver } from '../src/config/TuningPresetResolver.js';
import { CURATED_PRESETS } from '../src/services/MapPresetManager.js';

console.log('--- DOM UI Layer Verification ---');

// Test 1: 非ブラウザ環境（Node.js）でも例外なく安全に動作すること
{
  const domUI = new DOMUIManager('test-container');
  const player = new Player({ hp: 1000, experience: 2000 });
  player.crowns = 2;

  // update メソッドが例外なく完了すること
  domUI.update(player, 0.5, 'RETURN', MAGIC_TABLE.slice(0, 3));

  // ログ追加が例外なく完了すること
  domUI.addLog('Test log message', 'combat');
  domUI.addLog('Magic casted', 'magic');
  domUI.addLog('Item picked', 'success');

  assert.ok(true, 'DOMUIManager runs gracefully in headless/node environments');
  console.log('✓ 1. Headless environment safe-fallback verified.');
}

// Test 2: DOM HUD (DOMUIManager.update) のDirtyチェックと同一状態連続呼び出し時のDOM要素参照維持検証
{
  console.log('Testing 2: DOMUIManager Dirty check and DOM element reference persistence...');

  // 簡易DOM環境モックの構築
  class MockElement {
    public tagName: string;
    public id: string = '';
    public className: string = '';
    public textContent: string = '';
    public style: Record<string, string> = {};
    public children: MockElement[] = [];
    public attributes: Record<string, string> = {};
    public listeners: Record<string, Function[]> = {};
    public disabled: boolean = false;
    private _innerHTML: string = '';

    constructor(tagName: string) {
      this.tagName = tagName.toUpperCase();
    }

    get classList() {
      return {
        add: (...cls: string[]) => {
          const set = new Set(this.className.split(/\s+/).filter(Boolean));
          cls.forEach((c) => set.add(c));
          this.className = Array.from(set).join(' ');
        },
        remove: (...cls: string[]) => {
          const set = new Set(this.className.split(/\s+/).filter(Boolean));
          cls.forEach((c) => set.delete(c));
          this.className = Array.from(set).join(' ');
        },
        contains: (c: string) => this.className.split(/\s+/).includes(c),
      };
    }

    get innerHTML(): string {
      return this._innerHTML;
    }

    set innerHTML(html: string) {
      this._innerHTML = html;
      this.children = [];
      this.parseHtmlToChildren(html);
    }

    private parseHtmlToChildren(html: string) {
      // 簡易タグ抽出パーサー
      const tagRegex = /<([a-zA-Z0-9]+)([^>]*)>(.*?)<\/\1>|<([a-zA-Z0-9]+)([^>]*)\/?>/gs;
      let match;
      while ((match = tagRegex.exec(html)) !== null) {
        const tagName = match[1] || match[4];
        const attrStr = match[2] || match[5] || '';
        const inner = match[3] || '';
        const child = new MockElement(tagName);
        const idMatch = attrStr.match(/id=["']([^"']+)["']/);
        if (idMatch) child.id = idMatch[1];
        const classMatch = attrStr.match(/class=["']([^"']+)["']/);
        if (classMatch) child.className = classMatch[1];
        const dataIdxMatch = attrStr.match(/data-index=["']([^"']+)["']/);
        if (dataIdxMatch) child.setAttribute('data-index', dataIdxMatch[1]);
        if (inner) {
          child.innerHTML = inner;
        }
        this.children.push(child);
      }
    }

    get firstChild(): MockElement | null {
      return this.children[0] ?? null;
    }

    appendChild(child: MockElement): MockElement {
      this.children.push(child);
      return child;
    }

    insertBefore(newNode: MockElement, refNode: MockElement | null): MockElement {
      if (!refNode) {
        this.children.push(newNode);
        return newNode;
      }
      const idx = this.children.indexOf(refNode);
      if (idx >= 0) {
        this.children.splice(idx, 0, newNode);
      } else {
        this.children.push(newNode);
      }
      return newNode;
    }

    getAttribute(attr: string): string | null {
      return this.attributes[attr] ?? null;
    }

    setAttribute(attr: string, val: string): void {
      this.attributes[attr] = val;
    }

    addEventListener(event: string, fn: Function): void {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
    }

    querySelector<T = MockElement>(sel: string): T | null {
      const all = this.querySelectorAll(sel);
      return (all[0] as unknown as T) ?? null;
    }

    querySelectorAll(sel: string): MockElement[] {
      const results: MockElement[] = [];
      const check = (el: MockElement) => {
        let matched = false;
        if (sel.startsWith('#') && el.id === sel.slice(1)) matched = true;
        else if (sel.startsWith('.') && el.classList.contains(sel.slice(1))) matched = true;
        else if (sel.toUpperCase() === el.tagName) matched = true;
        if (matched) results.push(el);
        for (const c of el.children) check(c);
      };
      for (const c of this.children) check(c);
      return results;
    }

    getContext(type: string) {
      if (this.tagName === 'CANVAS') {
        return {
          imageSmoothingEnabled: false,
          clearRect: () => {},
          fillRect: () => {},
          scale: () => {},
          save: () => {},
          restore: () => {},
          fillText: () => {},
          drawImage: () => {},
        };
      }
      return null;
    }
  }

  const elementsById: Record<string, MockElement> = {};
  const mockBody = new MockElement('BODY');

  const mockDoc = {
    body: mockBody,
    createElement: (tag: string) => new MockElement(tag),
    getElementById: (id: string) => elementsById[id] ?? mockBody.querySelector('#' + id) ?? null,
  };

  (globalThis as any).document = mockDoc;

  // DOMUIManager 初期化
  const container = new MockElement('DIV');
  container.id = 'dom-ui-layer';
  elementsById['dom-ui-layer'] = container;
  mockBody.children.push(container);

  const domUI = new DOMUIManager('dom-ui-layer');

  const player = new Player({ hp: 1000, maxHp: 1000, experience: 3000, gold: 500 });
  player.magic = 500;
  const magics = MAGIC_TABLE.slice(0, 3); // JUMP (cost:100), RETURN (cost:200), MAP (cost:500)
  const targetEnemy = {
    typeId: 2,
    displayName: 'ゴブリン',
    hp: 150,
    maxHp: 200,
    atk: 30,
    def: 10,
    color: '#00ff00',
    symbol: 'G',
    frozenTimer: 0,
  };

  // 1回目の update 呼び出し
  domUI.update(player, 0.4, 'RETURN', magics, undefined, targetEnemy);

  const magicCardsContainer = container.querySelector('#dom-magic-list');
  const targetBodyContainer = container.querySelector('#dom-target-body');
  assert.ok(magicCardsContainer, 'Magic cards container must exist');
  assert.ok(targetBodyContainer, 'Target body container must exist');

  const firstMagicItems = magicCardsContainer.querySelectorAll('.magic-card-item');
  const firstTargetCard = targetBodyContainer.querySelector('.target-card');
  assert.strictEqual(firstMagicItems.length, 3, 'Should render 3 magic items initially');
  assert.ok(firstTargetCard, 'Target card should be rendered initially');

  // 2回目の update 呼び出し（同一状態・インジケーターのみ 0.4 -> 0.7 に変化）
  domUI.update(player, 0.7, 'RETURN', magics, undefined, targetEnemy);

  const secondMagicItems = magicCardsContainer.querySelectorAll('.magic-card-item');
  const secondTargetCard = targetBodyContainer.querySelector('.target-card');

  // 検証: 同一状態では DOM 要素参照が破棄・再生成されず維持されていること
  assert.strictEqual(
    secondMagicItems.length,
    3,
    'Magic items count should stay unchanged'
  );
  assert.strictEqual(
    firstMagicItems[0],
    secondMagicItems[0],
    'First magic card DOM element reference MUST persist across frames without innerHTML recreation'
  );
  assert.strictEqual(
    firstMagicItems[1],
    secondMagicItems[1],
    'Second magic card DOM element reference MUST persist across frames without innerHTML recreation'
  );
  assert.strictEqual(
    firstMagicItems[2],
    secondMagicItems[2],
    'Third magic card DOM element reference MUST persist across frames without innerHTML recreation'
  );
  assert.strictEqual(
    firstTargetCard,
    secondTargetCard,
    'Target enemy card DOM element reference MUST persist across frames without innerHTML recreation'
  );

  // インジケーターバーの width のみ 70% に軽量更新されていること
  const indicatorFill = container.querySelector('#dom-indicator-fill');
  assert.ok(indicatorFill, 'Indicator fill element must exist');
  assert.strictEqual(indicatorFill.style.width, '70%', 'Indicator bar style.width should update to 70%');

  // 3. 選択魔法を変更した場合（Dirty検知 -> 魔法カードのみ再構築）
  domUI.update(player, 0.7, 'JUMP', magics, undefined, targetEnemy);
  const thirdMagicItems = magicCardsContainer.querySelectorAll('.magic-card-item');
  const thirdTargetCard = targetBodyContainer.querySelector('.target-card');

  assert.notStrictEqual(
    firstMagicItems[0],
    thirdMagicItems[0],
    'Magic cards should be recreated when selected magic changes'
  );
  assert.strictEqual(
    firstTargetCard,
    thirdTargetCard,
    'Target card should NOT be recreated when only magic selection changes'
  );

  // 4. ターゲット敵のHPが変化した場合（Dirty検知 -> ターゲット敵カードのみ再構築）
  const damagedEnemy = { ...targetEnemy, hp: 80 };
  domUI.update(player, 0.7, 'JUMP', magics, undefined, damagedEnemy);
  const fourthMagicItems = magicCardsContainer.querySelectorAll('.magic-card-item');
  const fourthTargetCard = targetBodyContainer.querySelector('.target-card');

  assert.strictEqual(
    thirdMagicItems[0],
    fourthMagicItems[0],
    'Magic cards should NOT be recreated when only target enemy HP changes'
  );
  assert.notStrictEqual(
    thirdTargetCard,
    fourthTargetCard,
    'Target card should be recreated when enemy HP changes'
  );

  // 5. ターゲット敵が凍結状態になった場合（Dirty検知 -> ターゲット敵カード再構築＆バッジ反映）
  const frozenEnemy = { ...damagedEnemy, frozenTimer: 5 };
  domUI.update(player, 0.7, 'JUMP', magics, undefined, frozenEnemy);
  const fifthTargetCard = targetBodyContainer.querySelector('.target-card');
  assert.notStrictEqual(
    fourthTargetCard,
    fifthTargetCard,
    'Target card should be recreated when enemy frozenTimer changes'
  );

  // 6. インスペクタボタンの存在検証
  const inspectBtn = container.querySelector('#dom-inspect-btn') ?? mockBody.querySelector('#dom-inspect-btn');
  assert.ok(inspectBtn, 'Inspector button (#dom-inspect-btn) must exist in HUD header');

  // インスペクタ開閉メソッドの安全動作検証
  assert.strictEqual(typeof domUI.openInspector, 'function');
  assert.strictEqual(typeof domUI.closeInspector, 'function');
  assert.strictEqual(typeof domUI.toggleInspector, 'function');
  assert.strictEqual(typeof domUI.isInspectorOpen, 'function');

  delete (globalThis as any).document;
  console.log('✓ 2. DOMUIManager Dirty check, DOM element reference persistence, and Inspector integration verified.');
}

// Test 3: Phase 15 Seed Observatory & Challenge Catalog UI Verification
{
  console.log('Testing 3: Seed Observatory & Challenge Catalog UI integration...');

  // DOMモック環境の構築
  class MockElement {
    public tagName: string;
    public id: string = '';
    public className: string = '';
    public textContent: string = '';
    public value: string = '';
    public style: Record<string, string> = {};
    public children: MockElement[] = [];
    public attributes: Record<string, string> = {};
    public listeners: Record<string, Function[]> = {};
    public disabled: boolean = false;
    private _innerHTML: string = '';

    constructor(tagName: string) {
      this.tagName = tagName.toUpperCase();
    }

    get classList() {
      return {
        add: (...cls: string[]) => {
          const set = new Set(this.className.split(/\s+/).filter(Boolean));
          cls.forEach((c) => set.add(c));
          this.className = Array.from(set).join(' ');
        },
        remove: (...cls: string[]) => {
          const set = new Set(this.className.split(/\s+/).filter(Boolean));
          cls.forEach((c) => set.delete(c));
          this.className = Array.from(set).join(' ');
        },
        contains: (c: string) => this.className.split(/\s+/).includes(c),
      };
    }

    get innerHTML(): string {
      return this._innerHTML;
    }

    set innerHTML(html: string) {
      this._innerHTML = html;
      this.children = [];
      const tagRegex = /<([a-zA-Z0-9]+)([^>]*)>(.*?)<\/\1>|<([a-zA-Z0-9]+)([^>]*)\/?>/gs;
      let match;
      while ((match = tagRegex.exec(html)) !== null) {
        const tagName = match[1] || match[4];
        const attrStr = match[2] || match[5] || '';
        const inner = match[3] || '';
        const child = new MockElement(tagName);
        const idMatch = attrStr.match(/id=["']([^"']+)["']/);
        if (idMatch) child.id = idMatch[1];
        const classMatch = attrStr.match(/class=["']([^"']+)["']/);
        if (classMatch) child.className = classMatch[1];
        if (inner) child.innerHTML = inner;
        this.children.push(child);
      }
    }

    appendChild(child: MockElement): MockElement {
      this.children.push(child);
      return child;
    }

    getAttribute(attr: string): string | null {
      return this.attributes[attr] ?? null;
    }

    setAttribute(attr: string, val: string): void {
      this.attributes[attr] = val;
    }

    addEventListener(event: string, fn: Function): void {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
    }

    querySelector<T = MockElement>(sel: string): T | null {
      const all = this.querySelectorAll(sel);
      return (all[0] as unknown as T) ?? null;
    }

    querySelectorAll(sel: string): MockElement[] {
      const results: MockElement[] = [];
      const check = (el: MockElement) => {
        let matched = false;
        if (sel.startsWith('#') && el.id === sel.slice(1)) matched = true;
        else if (sel.startsWith('.') && el.classList.contains(sel.slice(1))) matched = true;
        else if (sel.toUpperCase() === el.tagName) matched = true;
        if (matched) results.push(el);
        for (const c of el.children) check(c);
      };
      for (const c of this.children) check(c);
      return results;
    }

    getContext() {
      return {
        imageSmoothingEnabled: false,
        clearRect: () => {},
        fillRect: () => {},
        strokeRect: () => {},
        beginPath: () => {},
        stroke: () => {},
        moveTo: () => {},
        lineTo: () => {},
        arc: () => {},
        fill: () => {},
        scale: () => {},
        save: () => {},
        restore: () => {},
        fillText: () => {},
        drawImage: () => {},
      };
    }
  }

  const elementsById: Record<string, MockElement> = {};
  const mockBody = new MockElement('BODY');

  const mockDoc = {
    body: mockBody,
    createElement: (tag: string) => new MockElement(tag),
    getElementById: (id: string) => elementsById[id] ?? mockBody.querySelector('#' + id) ?? null,
  };

  (globalThis as any).document = mockDoc;

  const container = new MockElement('DIV');
  container.id = 'dom-ui-layer-phase15';
  elementsById['dom-ui-layer-phase15'] = container;
  mockBody.children.push(container);

  const domUI = new DOMUIManager('dom-ui-layer-phase15');

  // 1. プリセット詳細カードの存在確認
  const presetDetailCard = container.querySelector('#dom-preset-detail-card');
  assert.ok(presetDetailCard, '#dom-preset-detail-card must exist in custom modal');

  // 2. 公式プリセット一覧およびカード描画
  domUI.openCustomModal();
  const presetSelect = container.querySelector('#dom-preset-select') as any;
  assert.ok(presetSelect, '#dom-preset-select must exist');
  assert.ok(presetDetailCard.innerHTML.length > 0, 'Preset detail card should be populated with HTML');

  // 3. 公式カタログ休止と保存シード管理運用への限定検証 & 詳細カード描画検証
  assert.strictEqual(CURATED_PRESETS.length, 0, 'CURATED_PRESETS should be empty until authentic curated maps are generated');

  const testUnbeatenPreset: typeof CURATED_PRESETS[0] = {
    id: 'test_unbeaten_challenge',
    name: '🤖 ボット未踏破：テスト迷宮',
    description: '未踏破テスト用プリセット',
    createdAt: Date.now(),
    isCurated: false,
    seed: 999999,
    options: {
      difficulty: 'HARD',
      pacing: 'MARATHON',
      topology: 'SPIRAL_LABYRINTH',
    },
    metrics: {
      estimatedDifficulty: 'NIGHTMARE',
      botStatus: 'UNBEATEN_BY_BOT',
      tags: ['UNBEATEN_BY_BOT', 'NIGHTMARE'],
      isUnbeatenChallenge: true,
    },
  };

  domUI.updatePresetDetailCard(testUnbeatenPreset);
  assert.ok(presetDetailCard.innerHTML.includes('ボット1600T未踏破チャレンジ'), 'Card should show unbeaten bot challenge status');
  assert.ok(presetDetailCard.innerHTML.includes('UNBEATEN_BY_BOT'), 'Card should show UNBEATEN_BY_BOT tag');
  assert.ok(presetDetailCard.innerHTML.includes('NIGHTMARE'), 'Card should display NIGHTMARE difficulty badge');

  // 4. 診断プレビューボタン (#dom-debug-preview-btn) のリアルタイム観測プロファイル実行検証
  const previewBtn = container.querySelector('#dom-debug-preview-btn') as any;
  const reportBox = container.querySelector('#dom-debug-report-box') as any;
  const randSeedBtn = container.querySelector('#dom-debug-rand-seed-btn') as any;
  const seedInput = container.querySelector('#dom-debug-seed') as any;
  assert.ok(previewBtn, '#dom-debug-preview-btn must exist');
  assert.ok(reportBox, '#dom-debug-report-box must exist');

  // プレビュー実行
  if (previewBtn.listeners['click'] && previewBtn.listeners['click'][0]) {
    previewBtn.listeners['click'][0]();
    assert.ok(reportBox.innerHTML.includes('観測プロファイル'), 'Report box should contain observation profile');
    assert.ok(reportBox.innerHTML.includes('開放度'), 'Report box should contain openness metric');
    assert.ok(reportBox.innerHTML.includes('迷路度'), 'Report box should contain maze metric');
    assert.ok(reportBox.innerHTML.includes('初期剣コスト'), 'Report box should contain sword walk distance');
  }

  // 乱数シードボタン押下による連動プレビュー実行
  if (randSeedBtn.listeners['click'] && randSeedBtn.listeners['click'][0]) {
    randSeedBtn.listeners['click'][0]();
    assert.ok(seedInput.value.length > 0, 'Seed input should receive random seed');
    assert.ok(reportBox.innerHTML.includes('Seed:'), 'Report box should update with new seed profile');
  }

  // 5. InspectorModal の Phase 15 プロファイル & Phase 14 戦術メタデータ描画検証
  const inspector = new InspectorModal();
  const testMap = new WorldMap(64, 64);
  testMap.tacticalMetadata = {
    dragonLairStyle: 'OPEN_FORTRESS',
    recommendedBotTuning: {},
    recommendedRelocateAnchors: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
    gravePuzzleHints: [{ position: { x: 5, y: 5 }, solveDirection: 'DOWN' }],
    treasureZoneHints: [{ anchor: { x: 15, y: 15 }, center: { x: 15, y: 15 }, score: 10, isEightStepOptimal: true }],
    breachShortcutPositions: [{ x: 30, y: 30 }],
  };

  const testPlayer = new Player({ hp: 1000 });
  const testDragon = new Dragon({ x: 32, y: 32 });

  inspector.open({
    map: testMap,
    player: testPlayer,
    dragon: testDragon,
    ghosts: [],
    enemies: [],
    tuningParams: TuningPresetResolver.getClassicDefault(),
    isProceduralMode: true,
    proceduralOptions: {
      seed: 833139,
      topology: 'FORTRESS_ARENA',
      difficulty: 'HARD',
      pacing: 'MARATHON',
    },
    totalTurns: 100,
  });

  const inspectorOverlay = mockBody.querySelector('#dom-inspector-modal');
  assert.ok(inspectorOverlay, 'Inspector modal overlay must exist in DOM');
  const inspectorContent = inspectorOverlay.innerHTML;

  // MapProfiler 観測プロファイルの項目が含まれていること
  assert.ok(inspectorContent.includes('GEOMETRIC METRICS'), 'Inspector must render Geometric Metrics section');
  assert.ok(inspectorContent.includes('開放度'), 'Inspector must render Openness score');
  assert.ok(inspectorContent.includes('迷路度'), 'Inspector must render Maze Index');
  assert.ok(inspectorContent.includes('初期剣到達歩数'), 'Inspector must render swordWalkDistance');

  // Phase 14 戦術メタデータが含まれていること
  assert.ok(inspectorContent.includes('PHASE 14 TACTICAL INTELLIGENCE'), 'Inspector must render Tactical Intelligence section');
  assert.ok(inspectorContent.includes('OPEN_FORTRESS'), 'Inspector must render dragonLairStyle');
  assert.ok(inspectorContent.includes('8歩周期宝物庫エリア'), 'Inspector must render treasureZoneHints count');
  assert.ok(inspectorContent.includes('我が家移転推奨アンカー'), 'Inspector must render recommendedRelocateAnchors count');

  delete (globalThis as any).document;
  console.log('✓ 3. Seed Observatory & Challenge Catalog UI integration verified successfully.');
}

console.log('--- ✓ All DOM UI Tests Passed Successfully! ---');
