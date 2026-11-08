import assert from 'node:assert';
import { GameEngine } from '../src/core/GameEngine.js';
import { DOMUIManager } from '../src/view/DOMUIManager.js';
import { InputManager } from '../src/core/InputManager.js';
import { MapPresetManager } from '../src/services/MapPresetManager.js';
import { ProceduralMapOptions } from '../src/systems/ProceduralMapGenerator.js';

console.log('--- Auto-Play Verification & Title UI Slimming Verification ---');

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
  public value: string = '';
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
      toggle: (c: string) => {
        if (this.classList.contains(c)) {
          this.classList.remove(c);
        } else {
          this.classList.add(c);
        }
      },
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
      const valMatch = attrStr.match(/value=["']([^"']*)["']/);
      if (valMatch) child.value = valMatch[1];
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

  click(): void {
    const handlers = this.listeners['click'] || [];
    for (const h of handlers) {
      h();
    }
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
}

// -----------------------------------------------------------------------------
// Test 1: タイトル画面のスリム化とカスタム設定モーダルDOM要素の存在検証
// -----------------------------------------------------------------------------
console.log('Testing 1: Slimmed title modal and isolated custom tuning modal structure...');
{
  const elementsById: Record<string, MockElement> = {};
  const mockBody = new MockElement('BODY');

  const mockDoc = {
    body: mockBody,
    createElement: (tag: string) => new MockElement(tag),
    getElementById: (id: string) => elementsById[id] ?? mockBody.querySelector('#' + id) ?? null,
  };
  (globalThis as any).document = mockDoc;

  const container = new MockElement('DIV');
  container.id = 'dom-ui-layer';
  elementsById['dom-ui-layer'] = container;
  mockBody.children.push(container);

  let openedCustom = false;
  let closedCustom = false;
  const domUI = new DOMUIManager('dom-ui-layer', {
    onOpenCustomModal: () => { openedCustom = true; },
    onCloseCustomModal: () => { closedCustom = true; },
  });

  // メインタイトル画面（#dom-title-modal）の要素検証
  const titleModal = container.querySelector('#dom-title-modal');
  assert.ok(titleModal, 'Title modal element must exist');
  assert.ok(container.querySelector('#dom-start-btn'), 'Start button must exist in title modal');
  assert.ok(container.querySelector('#dom-continue-btn'), 'Continue button must exist in title modal');
  assert.ok(container.querySelector('#dom-demo-btn'), 'Demo button must exist in title modal');
  const openCustomBtn = container.querySelector('#dom-open-custom-btn');
  assert.ok(openCustomBtn, 'Open custom modal button must exist in title modal');

  // カスタム設定モーダル（#dom-custom-modal）の要素検証
  const customModal = container.querySelector('#dom-custom-modal');
  assert.ok(customModal, 'Custom modal element must exist');
  assert.ok(customModal?.classList.contains('hidden'), 'Custom modal must be hidden initially');

  // クイックダンジョン設定要素
  assert.ok(container.querySelector('#dom-proc-topology'), 'Topology select must exist in custom modal');
  assert.ok(container.querySelector('#dom-proc-difficulty'), 'Difficulty select must exist in custom modal');
  assert.ok(container.querySelector('#dom-proc-pacing'), 'Pacing select must exist in custom modal');
  assert.ok(container.querySelector('#dom-proc-archetype'), 'Archetype select must exist in custom modal');
  assert.ok(container.querySelector('#dom-proc-rule-mode'), 'Rule Mode select must exist in custom modal');
  assert.ok(container.querySelector('#dom-procedural-btn'), 'Quick play button must exist in custom modal');
  assert.ok(container.querySelector('#dom-quick-autoplay-btn'), 'Quick autoplay button must exist in custom modal');

  // プリセット＆共有コード要素
  assert.ok(container.querySelector('#dom-preset-select'), 'Preset select must exist in custom modal');
  assert.ok(container.querySelector('#dom-preset-start-btn'), 'Preset start button must exist in custom modal');
  assert.ok(container.querySelector('#dom-preset-autoplay-btn'), 'Preset autoplay button must exist in custom modal');
  assert.ok(container.querySelector('#dom-share-code-input'), 'Share code input must exist in custom modal');
  assert.ok(container.querySelector('#dom-share-code-start-btn'), 'Share code start button must exist in custom modal');
  assert.ok(container.querySelector('#dom-share-code-autoplay-btn'), 'Share code autoplay button must exist in custom modal');

  // 詳細パラメータ要素
  assert.ok(container.querySelector('#dom-debug-rule-mode'), 'Debug Rule Mode select must exist');
  assert.ok(container.querySelector('#dom-debug-toggle-btn'), 'Debug toggle button must exist');
  assert.ok(container.querySelector('#dom-debug-launch-btn'), 'Debug launch button must exist');
  assert.ok(container.querySelector('#dom-debug-autoplay-btn'), 'Debug autoplay button must exist');

  // 自走検証用オーバーレイコントロール要素
  assert.ok(container.querySelector('#dom-demo-overlay'), 'Overlay element must exist');
  assert.ok(container.querySelector('#dom-autoplay-controls'), 'Autoplay controls element must exist');
  assert.ok(container.querySelector('#dom-autoplay-takeover-btn'), 'Takeover button must exist in overlay');
  assert.ok(container.querySelector('#dom-autoplay-exit-btn'), 'Exit button must exist in overlay');

  // 画面遷移（タイトル <-> カスタム設定）のテスト
  assert.strictEqual(domUI.isCustomModalOpen(), false, 'Custom modal should be closed initially');
  openCustomBtn?.click();
  assert.strictEqual(domUI.isCustomModalOpen(), true, 'Custom modal should be open after clicking openCustomBtn');
  assert.strictEqual(openedCustom, true, 'onOpenCustomModal callback should be triggered');
  assert.ok(titleModal?.classList.contains('hidden'), 'Title modal should be hidden when custom modal opens');

  const backBtn = container.querySelector('#dom-custom-back-btn');
  backBtn?.click();
  assert.strictEqual(domUI.isCustomModalOpen(), false, 'Custom modal should be closed after clicking backBtn');
  assert.strictEqual(closedCustom, true, 'onCloseCustomModal callback should be triggered');
  assert.ok(!titleModal?.classList.contains('hidden'), 'Title modal should be visible again');

  delete (globalThis as any).document;
  console.log('✓ 1. Slimmed title modal and isolated custom tuning modal structure verified.');
}

// -----------------------------------------------------------------------------
// Test 2: クイック設定・プリセット・共有コードからの自走検証モード起動
// -----------------------------------------------------------------------------
console.log('Testing 2: Auto-play verify launch from quick, preset, share-code & debug...');
{
  const engine = new GameEngine(null, { seed: 10101 });
  assert.strictEqual(engine.getState(), 'TITLE');
  assert.strictEqual(engine.isAutoPlayVerifyActive(), false);

  // 1. クイック設定からの自走検証
  engine.startAutoPlayVerifyMode({
    topology: 'PILLAR_GRID',
    difficulty: 'HARD',
    pacing: 'BLITZ',
    archetype: 'SANCTUARY',
  });
  assert.strictEqual(engine.isDemoActive(), true, 'Demo mode flag must be true during auto-play');
  assert.strictEqual(engine.isAutoPlayVerifyActive(), true, 'Auto-play verify flag must be true');
  assert.strictEqual(engine.getState(), 'PLAYING', 'Game state must be PLAYING');
  assert.strictEqual(engine.getProceduralOptions()?.topology, 'PILLAR_GRID');
  assert.strictEqual(engine.getProceduralOptions()?.archetype, 'SANCTUARY');

  // 終了
  engine.stopAutoPlayVerifyMode(false);
  assert.strictEqual(engine.isAutoPlayVerifyActive(), false);
  assert.strictEqual(engine.isDemoActive(), false);
  assert.strictEqual(engine.getState(), 'TITLE');

  // 2. プリセットからの自走検証
  const preset = MapPresetManager.savePreset({
    name: '自走検証用プリセット',
    seed: 888888,
    options: {
      topology: 'MULTI_SECTOR',
    },
  });
  assert.ok(preset, 'Saved preset must exist');
  engine.startAutoPlayVerifyMode(undefined, preset);
  assert.strictEqual(engine.isAutoPlayVerifyActive(), true);
  assert.strictEqual(engine.getState(), 'PLAYING');
  assert.strictEqual(engine.getProceduralOptions()?.topology, preset.options.topology);

  engine.stopAutoPlayVerifyMode(false);
  assert.strictEqual(engine.isAutoPlayVerifyActive(), false);
  console.log('✓ 2. Auto-play verify launch from quick & preset verified.');
}

// -----------------------------------------------------------------------------
// Test 3: 自走検証中の速度変更（1x, 2x, 5x, 0=一時停止）
// -----------------------------------------------------------------------------
console.log('Testing 3: Speed control (1x, 2x, 5x, pause) during auto-play verification...');
{
  const engine = new GameEngine(null, { seed: 20202 });
  engine.startAutoPlayVerifyMode({ topology: 'STANDARD_ROOMS' });

  assert.strictEqual(engine.getAutoPlaySpeed(), 1, 'Default speed must be 1x');
  assert.strictEqual(engine.isAutoPlayPausedState(), false, 'Should not be paused initially');

  // 2x 変更
  engine.setAutoPlaySpeed(2);
  assert.strictEqual(engine.getAutoPlaySpeed(), 2, 'Speed should be 2x');
  assert.strictEqual(engine.isAutoPlayPausedState(), false);

  // 5x 変更
  engine.setAutoPlaySpeed(5);
  assert.strictEqual(engine.getAutoPlaySpeed(), 5, 'Speed should be 5x');
  assert.strictEqual(engine.isAutoPlayPausedState(), false);

  // 0: 一時停止
  engine.setAutoPlaySpeed(0);
  assert.strictEqual(engine.getAutoPlaySpeed(), 0);
  assert.strictEqual(engine.isAutoPlayPausedState(), true, 'Should be paused');

  // 一時停止中は stepDemo を呼んでもターンが進まないこと
  const curPos = { ...engine.getPlayer().pos };
  engine.stepDemo();
  assert.strictEqual(engine.getPlayer().pos.x, curPos.x, 'Position must not change while paused');

  // 再開 (1x)
  engine.setAutoPlaySpeed(1);
  assert.strictEqual(engine.isAutoPlayPausedState(), false);

  engine.stopAutoPlayVerifyMode(false);
  console.log('✓ 3. Speed control & pause mechanism verified.');
}

// -----------------------------------------------------------------------------
// Test 4: 自走検証中の操作引き継ぎ（Takeover）による通常プレイへのシームレス移行
// -----------------------------------------------------------------------------
console.log('Testing 4: Seamless player takeover from auto-play...');
{
  const engine = new GameEngine(null, { seed: 30303 });
  engine.startAutoPlayVerifyMode({ topology: 'MULTI_SECTOR' });

  // 何ステップか自走進行
  for (let i = 0; i < 5; i++) {
    engine.stepDemo();
  }
  assert.strictEqual(engine.isAutoPlayVerifyActive(), true);
  assert.strictEqual(engine.getState(), 'PLAYING');

  const playerHp = engine.getPlayer().hp;
  const playerExp = engine.getPlayer().experience;

  // プレイヤーが操作を引き継ぐ (Takeover)
  engine.takeoverAutoPlay();

  // 検証:
  // 1. 自走検証・デモモードは解除されている
  assert.strictEqual(engine.isAutoPlayVerifyActive(), false, 'Auto-play must be deactivated');
  assert.strictEqual(engine.isDemoActive(), false, 'Demo mode must be deactivated');
  // 2. ゲーム状態は PLAYING のまま継続し、プレイヤーのステータスが維持されている
  assert.strictEqual(engine.getState(), 'PLAYING', 'Game state must continue in PLAYING');
  assert.strictEqual(engine.getPlayer().hp, playerHp, 'Player HP must be preserved');
  assert.strictEqual(engine.getPlayer().experience, playerExp, 'Player EXP must be preserved');

  // 3. プレイヤーの手動操作入力が受け付けられること
  const initialTurn = (engine as any).totalTurns;
  engine.executeTurn(null); // Space: 待機
  assert.strictEqual((engine as any).totalTurns, initialTurn + 1, 'Manual turn execution should advance turns');

  console.log('✓ 4. Seamless player takeover verified successfully.');
}

// -----------------------------------------------------------------------------
// Test 5: 自走検証中のESC終了および任意キーによる誤終了防止
// -----------------------------------------------------------------------------
console.log('Testing 5: Key handling (ESC to exit, accidental key protection)...');
{
  const engine = new GameEngine(null, { seed: 40404 });
  engine.startAutoPlayVerifyMode({ topology: 'STANDARD_ROOMS' });

  const input = (engine as any).inputManager as InputManager;

  // 通常デモであれば即座に終了するはずのキー（Space, ArrowUp, KeyM 等）を押下
  const nonInterruptKeys = ['Space', 'ArrowUp', 'KeyM', 'KeyD', 'KeyX', 'KeyA'];
  for (const code of nonInterruptKeys) {
    (input as any).handleKeyDown({
      code,
      preventDefault: () => {},
    });
    (input as any).handleKeyUp({ code });

    // 検証: 自走検証は勝手に終了しない！
    assert.strictEqual(engine.isAutoPlayVerifyActive(), true, `Key ${code} must NOT interrupt auto-play verify`);
    assert.strictEqual(engine.getState(), 'PLAYING');
  }

  // Enterキーを押下すると操作引き継ぎ（Takeover）になること
  (input as any).handleKeyDown({
    code: 'Enter',
    preventDefault: () => {},
  });
  (input as any).handleKeyUp({ code: 'Enter' });
  assert.strictEqual(engine.isAutoPlayVerifyActive(), false, 'Enter key must trigger takeover');
  assert.strictEqual(engine.getState(), 'PLAYING', 'Game remains PLAYING after Enter takeover');

  // 再び自走検証を開始
  engine.startAutoPlayVerifyMode({ topology: 'STANDARD_ROOMS' });
  assert.strictEqual(engine.isAutoPlayVerifyActive(), true);

  // Escapeキーを押下すると自走検証が終了すること
  (input as any).handleKeyDown({
    code: 'Escape',
    preventDefault: () => {},
  });
  (input as any).handleKeyUp({ code: 'Escape' });

  assert.strictEqual(engine.isAutoPlayVerifyActive(), false, 'Escape key must stop auto-play verify');
  assert.strictEqual(engine.getState(), 'TITLE', 'State should return to TITLE after Escape');

  console.log('✓ 5. Accidental key protection & ESC termination verified.');
}

// -----------------------------------------------------------------------------
// Test 6: ターン制限の大幅緩和（500ターンを超えても自走検証が継続すること）
// -----------------------------------------------------------------------------
console.log('Testing 6: Relaxed turn limit (exceeding 500 turns without termination)...');
{
  const engine = new GameEngine(null, { seed: 50505 });
  engine.startAutoPlayVerifyMode({ topology: 'STANDARD_ROOMS' });

  // 途中で死亡してゲームオーバーにならないようHPを十分に確保
  engine.getPlayer().hp = 999999;
  engine.getPlayer().maxHp = 999999;

  // 520ターンまで進行（通常デモなら500ターンでTIME OVERになる）
  for (let i = 0; i < 520; i++) {
    if (engine.getState() !== 'PLAYING') break;
    engine.getPlayer().hp = 999999; // HP維持
    engine.stepDemo();
  }

  // 500ターンを超えても自走検証が継続していること（3000ターンまで許容）
  assert.strictEqual(engine.isAutoPlayVerifyActive(), true, 'Auto-play verify must remain active past 500 turns');
  assert.ok((engine as any).demoTurns >= 500, `demoTurns (${(engine as any).demoTurns}) must exceed 500`);

  engine.stopAutoPlayVerifyMode(false);
  console.log('✓ 6. Relaxed turn limit (3000 turns) verified successfully.');
}

console.log('--- ✓ All Auto-Play Verification & Title UI Slimming Tests Passed! ---');
