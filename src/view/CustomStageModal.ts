import { ProceduralMapGenerator, ProceduralMapOptions } from '../systems/ProceduralMapGenerator.js';
import { MapPresetData, MapPresetManager } from '../services/MapPresetManager.js';
import { MapProfiler } from '../systems/generator/MapProfiler.js';
import { WorldMap } from '../models/WorldMap.js';
import {
  DungeonTopology,
  MapDifficulty,
  PlayPacingMode,
  DungeonArchetype,
  RuleMode,
} from '../models/Types.js';
import { DOMUICallbacks } from './DOMUIManager.js';

export class CustomStageModal {
  private container: HTMLElement | null = null;
  private callbacks: DOMUICallbacks = {};
  private customModalEl: HTMLElement | null = null;
  private onBackToTitle?: () => void;

  constructor(
    container: HTMLElement | null,
    callbacks: DOMUICallbacks = {},
    options?: { onBackToTitle?: () => void }
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.onBackToTitle = options?.onBackToTitle;
    this.initElements();
    this.setupEventListeners();
  }

  public static getHtml(): string {
    return `
      <!-- 1.5. ステージ調整・選択メニューモーダル (カスタム・プリセット・自走検証) -->
      <div class="game-modal-overlay hidden" id="dom-custom-modal">
        <div class="modal-content-box custom-modal-box" style="max-width: 1100px; width: 95%; max-height: 92vh; overflow-y: auto; border: 2px solid #7e57c2; box-shadow: 0 0 40px rgba(126, 87, 194, 0.4);">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #5e35b1; padding-bottom: 10px; margin-bottom: 14px;">
            <div>
              <h2 style="margin: 0; font-size: 18px; color: #d1c4e9; display: flex; align-items: center; gap: 8px;">[CHALLENGE CATALOG & SEED OBSERVATORY]</h2>
              <div style="font-size: 11px; color: #9fa8da; margin-top: 2px;">厳選カタログ挑戦・シード観測プロファイル・自走検証（手動プレイ or 自動自走検証）</div>
            </div>
            <button class="action-btn-secondary" id="dom-custom-back-btn" style="background: #281a4b; color: #d1c4e9; border: 1px solid #7e57c2; padding: 6px 14px; font-size: 12px; border-radius: 4px; cursor: pointer; font-weight: bold;">← タイトルへ戻る</button>
          </div>

          <!-- タイプ選択バー (セグメントタブUI) -->
          <div style="background: rgba(10, 16, 28, 0.95); border: 1px solid #2a3a52; border-radius: 8px; padding: 6px; margin-bottom: 14px; box-shadow: inset 0 2px 6px rgba(0,0,0,0.6);">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 6px;" id="dom-custom-type-group">
              <label class="custom-tab-item active" id="dom-tab-quick">
                <input type="radio" name="custom-mode-type" value="QUICK" checked id="dom-type-radio-quick" style="display: none;" />
                <span>[QUICK] クイック設定</span>
              </label>
              <label class="custom-tab-item" id="dom-tab-preset">
                <input type="radio" name="custom-mode-type" value="PRESET" id="dom-type-radio-preset" style="display: none;" />
                <span>[CATALOG] 挑戦状カタログ</span>
              </label>
              <label class="custom-tab-item" id="dom-tab-share">
                <input type="radio" name="custom-mode-type" value="SHARE_CODE" id="dom-type-radio-share" style="display: none;" />
                <span>[SHARE] 共有コード</span>
              </label>
              <label class="custom-tab-item" id="dom-tab-debug">
                <input type="radio" name="custom-mode-type" value="DEBUG" id="dom-type-radio-debug" style="display: none;" />
                <span>[OBSERVATORY] シード観測・詳細</span>
              </label>
            </div>
          </div>

          <!-- ① クイックダンジョン設定パネル -->
          <div id="dom-panel-quick" class="custom-type-panel" style="background: rgba(0, 20, 40, 0.7); border: 1px solid #1a5b8e; border-radius: 4px; padding: 12px; margin-bottom: 12px; text-align: left;">
            <div style="font-weight: bold; color: #4dd0e1; margin-bottom: 8px; font-size: 13px;">[QUICK DUNGEON PRESET] クイックダンジョン設定</div>
            
            <!-- クイックSeed設定 -->
            <div style="margin-bottom: 10px;">
              <label for="dom-proc-seed" style="font-size: 11px; color: #aaa; display: block; margin-bottom: 2px;">シード値 (Seed):</label>
              <div style="display: flex; gap: 4px;">
                <input type="number" id="dom-proc-seed" placeholder="空欄で完全ランダム生成（指定のシード番号を直接入力可能）" style="flex: 1; background: #0a1826; color: #fff; border: 1px solid #336699; padding: 5px; font-size: 12px; border-radius: 3px;" />
                <button id="dom-proc-rand-seed-btn" type="button" style="background: #1a4b6e; color: #eee; border: 1px solid #4dd0e1; font-size: 11px; padding: 2px 12px; cursor: pointer; border-radius: 3px;">乱数</button>
              </div>
            </div>

            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <div style="flex: 1; min-width: 140px;">
                <label for="dom-proc-topology" style="font-size: 11px; color: #aaa; display: block; margin-bottom: 2px;">地形 (Topology):</label>
                <select id="dom-proc-topology" style="width: 100%; background: #0a1826; color: #eee; border: 1px solid #336699; padding: 4px; border-radius: 3px; font-size: 12px;">
                  <option value="MULTI_SECTOR" selected>MULTI_SECTOR (複合セクター)</option>
                  <option value="STANDARD_ROOMS">STANDARD_ROOMS (標準部屋)</option>
                  <option value="PILLAR_GRID">PILLAR_GRID (ピラー広場)</option>
                  <option value="NARROW_MAZE">NARROW_MAZE (幅1マス迷路)</option>
                  <option value="SPIRAL_LABYRINTH">SPIRAL_LABYRINTH (渦巻き要塞)</option>
                  <option value="FORTRESS_ARENA">FORTRESS_ARENA (アリーナ要塞)</option>
                </select>
              </div>
              <div style="flex: 1; min-width: 100px;">
                <label for="dom-proc-difficulty" style="font-size: 11px; color: #aaa; display: block; margin-bottom: 2px;">難易度 (Difficulty):</label>
                <select id="dom-proc-difficulty" style="width: 100%; background: #0a1826; color: #eee; border: 1px solid #336699; padding: 4px; border-radius: 3px; font-size: 12px;">
                  <option value="NORMAL" selected>NORMAL (標準)</option>
                  <option value="EASY">EASY (易しい)</option>
                  <option value="HARD">HARD (難しい)</option>
                </select>
              </div>
              <div style="flex: 1; min-width: 120px;">
                <label for="dom-proc-pacing" style="font-size: 11px; color: #aaa; display: block; margin-bottom: 2px;">プレイ時間 (Pacing):</label>
                <select id="dom-proc-pacing" style="width: 100%; background: #0a1826; color: #eee; border: 1px solid #336699; padding: 4px; border-radius: 3px; font-size: 12px;">
                  <option value="STANDARD" selected>STANDARD (標準 15〜25分)</option>
                  <option value="BLITZ">BLITZ (短時間 5〜10分)</option>
                  <option value="MARATHON">MARATHON (長編 35〜60分)</option>
                </select>
              </div>
              <div style="flex: 1; min-width: 130px;">
                <label for="dom-proc-archetype" style="font-size: 11px; color: #aaa; display: block; margin-bottom: 2px;">テーマ (Archetype):</label>
                <select id="dom-proc-archetype" style="width: 100%; background: #0a1826; color: #eee; border: 1px solid #336699; padding: 4px; border-radius: 3px; font-size: 12px;">
                  <option value="BALANCED" selected>BALANCED (標準バランス)</option>
                  <option value="SANCTUARY">SANCTUARY (聖域・十字架多数)</option>
                  <option value="WARP_NEXUS">WARP_NEXUS (ワープ迷宮)</option>
                  <option value="ARMORY">ARMORY (武器庫・予備剣多数)</option>
                </select>
              </div>
              <div style="flex: 1; min-width: 150px;">
                <label for="dom-proc-rule-mode" style="font-size: 11px; color: #aaa; display: block; margin-bottom: 2px;">ルール体系 (Rule Mode):</label>
                <select id="dom-proc-rule-mode" style="width: 100%; background: #0a1826; color: #eee; border: 1px solid #336699; padding: 4px; border-radius: 3px; font-size: 12px;">
                  <option value="EXPONENTIAL" selected>EXPONENTIAL (指数・インフレ成長)</option>
                  <option value="CLASSIC">CLASSIC (初代完全オリジナル加算)</option>
                </select>
              </div>
            </div>
          </div>

          <!-- ② 挑戦状カタログ（プリセット）パネル -->
          <div id="dom-panel-preset" class="custom-type-panel hidden" style="background: rgba(20, 10, 40, 0.75); border: 1px solid #7e57c2; border-radius: 4px; padding: 12px; margin-bottom: 12px; text-align: left;">
            <div style="font-weight: bold; color: #b39ddb; margin-bottom: 8px; font-size: 13px;">[CHALLENGE CATALOG] 挑戦状カタログ＆保存シード</div>
            <div style="display: flex; gap: 6px; align-items: center;">
              <select id="dom-preset-select" style="flex: 1; background: #120a26; color: #eee; border: 1px solid #5e35b1; padding: 6px; border-radius: 3px; font-size: 12px;"></select>
              <button id="dom-preset-share-btn" style="background: #281a4b; color: #b39ddb; border: 1px solid #7e57c2; padding: 6px 12px; font-size: 11px; border-radius: 3px; cursor: pointer;" title="クリップボードへ共有コードをコピー">共有</button>
              <button id="dom-preset-delete-btn" style="background: #3e1b24; color: #ef9a9a; border: 1px solid #c62828; padding: 6px 10px; font-size: 11px; border-radius: 3px; cursor: pointer;" title="選択したユーザープリセットを削除">削除</button>
            </div>
            <!-- 選択中シードのプロファイル詳細カード -->
            <div id="dom-preset-detail-card" class="preset-detail-card"></div>
          </div>

          <!-- ③ 共有コードパネル -->
          <div id="dom-panel-share" class="custom-type-panel hidden" style="background: rgba(30, 15, 45, 0.75); border: 1px solid #9c27b0; border-radius: 4px; padding: 12px; margin-bottom: 12px; text-align: left;">
            <div style="font-weight: bold; color: #e1bee7; margin-bottom: 8px; font-size: 13px;">[SHARE CODE] 共有コード入力</div>
            <div style="display: flex; gap: 6px; align-items: center;">
              <input type="text" id="dom-share-code-input" placeholder="共有コード (DS1MAP:...) を貼り付けてください" style="flex: 1; background: #120a26; color: #eee; border: 1px solid #8e24aa; padding: 6px; border-radius: 3px; font-size: 11px;" />
            </div>
          </div>

          <!-- ④ マニュアル・詳細パラメータパネル（シード観測所） -->
          <div id="dom-panel-debug" class="custom-type-panel hidden" style="background: rgba(5, 15, 30, 0.95); border: 1px solid #3b7ca8; border-radius: 4px; padding: 12px; margin-bottom: 12px; text-align: left;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <div style="font-weight: bold; color: #ffb74d; font-size: 13px;">[SEED OBSERVATORY] シード観測・詳細設定</div>
              <button id="dom-debug-preview-btn" style="background: #263238; color: #80cbc4; border: 1px solid #009688; padding: 4px 10px; font-size: 11px; border-radius: 3px; cursor: pointer;">
                観測プロファイル実行
              </button>
            </div>
            
            <!-- Seed設定 -->
            <div style="margin-bottom: 8px;">
              <label style="font-size: 11px; color: #ccc;">シード値 (Seed):</label>
              <div style="display: flex; gap: 4px;">
                <input type="number" id="dom-debug-seed" placeholder="空欄でランダム生成" style="flex: 1; background: #081420; color: #fff; border: 1px solid #336699; padding: 4px; font-size: 11px;" />
                <button id="dom-debug-rand-seed-btn" style="background: #1a4b6e; color: #eee; border: 1px solid #4dd0e1; font-size: 11px; padding: 2px 10px; cursor: pointer;">乱数</button>
              </div>
            </div>

            <!-- トポロジー（テストベッド CLASSIC_FIXED 含む） -->
            <div style="display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap;">
              <div style="flex: 1; min-width: 130px;">
                <label style="font-size: 11px; color: #ccc;">地形トポロジー:</label>
                <select id="dom-debug-topology" style="width: 100%; background: #081420; color: #fff; border: 1px solid #336699; padding: 4px; font-size: 11px;">
                  <option value="MULTI_SECTOR" selected>MULTI_SECTOR (複合セクター)</option>
                  <option value="STANDARD_ROOMS">STANDARD_ROOMS (標準部屋)</option>
                  <option value="PILLAR_GRID">PILLAR_GRID (ピラー広場)</option>
                  <option value="NARROW_MAZE">NARROW_MAZE (幅1マス迷路)</option>
                  <option value="SPIRAL_LABYRINTH">SPIRAL_LABYRINTH (渦巻き要塞)</option>
                  <option value="FORTRESS_ARENA">FORTRESS_ARENA (アリーナ要塞)</option>
                  <option value="CLASSIC_FIXED">TESTBED (開発・テスト用静的マップ)</option>
                </select>
              </div>
              <div style="flex: 1; min-width: 80px;">
                <label style="font-size: 11px; color: #ccc;">難易度:</label>
                <select id="dom-debug-diff" style="width: 100%; background: #081420; color: #fff; border: 1px solid #336699; padding: 4px; font-size: 11px;">
                  <option value="NORMAL" selected>NORMAL</option>
                  <option value="EASY">EASY</option>
                  <option value="HARD">HARD</option>
                </select>
              </div>
              <div style="flex: 1; min-width: 80px;">
                <label style="font-size: 11px; color: #ccc;">ペース:</label>
                <select id="dom-debug-pacing" style="width: 100%; background: #081420; color: #fff; border: 1px solid #336699; padding: 4px; font-size: 11px;">
                  <option value="STANDARD" selected>STANDARD</option>
                  <option value="BLITZ">BLITZ</option>
                  <option value="MARATHON">MARATHON</option>
                </select>
              </div>
              <div style="flex: 1; min-width: 110px;">
                <label style="font-size: 11px; color: #ccc;">テーマ (Archetype):</label>
                <select id="dom-debug-archetype" style="width: 100%; background: #081420; color: #fff; border: 1px solid #336699; padding: 4px; font-size: 11px;">
                  <option value="BALANCED" selected>BALANCED (標準)</option>
                  <option value="SANCTUARY">SANCTUARY (聖域)</option>
                  <option value="WARP_NEXUS">WARP_NEXUS (ワープ迷宮)</option>
                  <option value="ARMORY">ARMORY (武器庫)</option>
                </select>
              </div>
              <div style="flex: 1; min-width: 130px;">
                <label style="font-size: 11px; color: #ccc;">ルールモード:</label>
                <select id="dom-debug-rule-mode" style="width: 100%; background: #081420; color: #fff; border: 1px solid #336699; padding: 4px; font-size: 11px;">
                  <option value="EXPONENTIAL" selected>EXPONENTIAL (指数成長)</option>
                  <option value="CLASSIC">CLASSIC (初代加算モード)</option>
                </select>
              </div>
            </div>

            <!-- リソース数設定 -->
            <div style="display: flex; gap: 6px; margin-bottom: 8px;">
              <div style="flex: 1;">
                <label style="font-size: 11px; color: #ccc;">目標宝箱数 (40〜200):</label>
                <input type="number" id="dom-debug-chests" min="40" max="200" value="100" style="width: 100%; background: #081420; color: #fff; border: 1px solid #336699; padding: 4px; font-size: 11px;" />
              </div>
              <div style="flex: 1;">
                <label style="font-size: 11px; color: #ccc;">墓の総数 (10〜40):</label>
                <input type="number" id="dom-debug-graves" min="10" max="40" value="20" style="width: 100%; background: #081420; color: #fff; border: 1px solid #336699; padding: 4px; font-size: 11px;" />
              </div>
            </div>

            <!-- チューニング倍率 -->
            <div style="display: flex; gap: 6px; margin-bottom: 8px;">
              <div style="flex: 1;">
                <label style="font-size: 11px; color: #ccc;">敵ATK倍率 (0.5〜2.0):</label>
                <input type="number" step="0.1" id="dom-debug-enemy-atk" min="0.5" max="2.0" value="1.0" style="width: 100%; background: #081420; color: #fff; border: 1px solid #336699; padding: 4px; font-size: 11px;" />
              </div>
              <div style="flex: 1;">
                <label style="font-size: 11px; color: #ccc;">竜DEF倍率 (0.5〜1.5):</label>
                <input type="number" step="0.1" id="dom-debug-dragon-def" min="0.5" max="1.5" value="1.0" style="width: 100%; background: #081420; color: #fff; border: 1px solid #336699; padding: 4px; font-size: 11px;" />
              </div>
            </div>

            <!-- 診断レポートプレビュー表示枠（リアルタイム観測プロファイル） -->
            <div id="dom-debug-report-box" class="hidden" style="background: rgba(0, 0, 0, 0.7); border: 1px solid #00897b; border-radius: 4px; padding: 8px; font-size: 11px; color: #e0f2f1; max-height: 320px; overflow-y: auto; margin-top: 8px;"></div>
          </div>

          <!-- テスト互換用エイリアス要素（既存テストのDOM存在確認用） -->
          <div style="display: none;">
            <button id="dom-debug-toggle-btn"></button>
            <div id="dom-debug-panel"></div>
            <button id="dom-preset-start-btn"></button>
            <button id="dom-preset-autoplay-btn"></button>
            <button id="dom-share-code-start-btn"></button>
            <button id="dom-share-code-autoplay-btn"></button>
            <button id="dom-debug-launch-btn"></button>
            <button id="dom-debug-autoplay-btn"></button>
          </div>

          <!-- 代表アクションボタングループ (画面下部に1組集約) -->
          <div style="background: rgba(10, 25, 45, 0.95); border: 2px solid #29b6f6; border-radius: 6px; padding: 12px; margin-top: 14px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.6);">
            <div id="dom-custom-action-hint" style="font-size: 12px; color: #80d8ff; margin-bottom: 8px; font-weight: bold;">
              💡 選択中のタイプ【クイック設定】でダンジョンを開始します
            </div>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
              <button class="action-btn-large" id="dom-procedural-btn" style="flex: 1; min-width: 200px; max-width: 270px; padding: 10px 16px; font-size: 13px; font-weight: bold; margin: 0; background: linear-gradient(135deg, #00aa66 0%, #008844 100%);">
                🚀 自分でプレイ開始
              </button>
              <button class="action-btn-large" id="dom-quick-autoplay-btn" style="flex: 1; min-width: 200px; max-width: 270px; padding: 10px 16px; font-size: 13px; font-weight: bold; margin: 0; background: linear-gradient(135deg, #1565c0 0%, #0d47a1 100%); border: 1px solid #42a5f5;">
                🕹️ 自動プレイで自走検証 (AUTO-PLAY)
              </button>
            </div>
          </div>

          <div style="margin-top: 14px; text-align: center;">
            <button class="action-btn-secondary" id="dom-custom-bottom-back-btn" style="background: #281a4b; color: #d1c4e9; border: 1px solid #7e57c2; padding: 8px 24px; font-size: 12px; border-radius: 4px; cursor: pointer; font-weight: bold;">← タイトル画面へ戻る</button>
          </div>
        </div>
      </div>
    `;
  }

  private initElements(): void {
    if (!this.container) return;
    this.customModalEl = this.container.querySelector('#dom-custom-modal');
  }

  public open(): void {
    if (!this.customModalEl) this.initElements();
    this.customModalEl?.classList.remove('hidden');
    this.refreshPresetList();
    if (this.callbacks.onOpenCustomModal) {
      this.callbacks.onOpenCustomModal();
    }
  }

  public close(): void {
    this.customModalEl?.classList.add('hidden');
    if (this.callbacks.onCloseCustomModal) {
      this.callbacks.onCloseCustomModal();
    }
  }

  public isOpen(): boolean {
    return this.customModalEl !== null && !this.customModalEl.classList.contains('hidden');
  }

  public setupEventListeners(): void {
    if (!this.container) return;

    // 戻るボタン
    const customBackBtn = this.container.querySelector('#dom-custom-back-btn');
    if (customBackBtn) {
      customBackBtn.addEventListener('click', () => {
        if (this.onBackToTitle) {
          this.onBackToTitle();
        } else {
          this.close();
        }
      });
    }

    const customBottomBackBtn = this.container.querySelector('#dom-custom-bottom-back-btn');
    if (customBottomBackBtn) {
      customBottomBackBtn.addEventListener('click', () => {
        if (this.onBackToTitle) {
          this.onBackToTitle();
        } else {
          this.close();
        }
      });
    }

    // デバッグパネル開閉トグル
    const debugToggleBtn = this.container.querySelector('#dom-debug-toggle-btn') as HTMLElement | null;
    const debugPanel = this.container.querySelector('#dom-debug-panel') as HTMLElement | null;
    if (debugToggleBtn && debugPanel) {
      debugToggleBtn.addEventListener('click', () => {
        debugPanel.classList.toggle('hidden');
        const isHidden = debugPanel.classList.contains('hidden');
        debugToggleBtn.textContent = isHidden
          ? 'ADVANCED DEBUG & CUSTOM GENERATOR (詳細パラメータ設定) ▼'
          : 'ADVANCED DEBUG & CUSTOM GENERATOR (詳細パラメータ設定) ▲';
      });
    }

    // ランダムシード生成ボタン & 観測プロファイル
    const randSeedBtn = this.container.querySelector('#dom-debug-rand-seed-btn') as HTMLElement | null;
    const seedInput = this.container.querySelector('#dom-debug-seed') as HTMLInputElement | null;
    const previewBtn = this.container.querySelector('#dom-debug-preview-btn') as HTMLElement | null;
    const reportBox = this.container.querySelector('#dom-debug-report-box') as HTMLElement | null;

    const executeObservatoryPreview = () => {
      if (!reportBox) return;
      const topoSelect = this.container?.querySelector('#dom-debug-topology') as HTMLSelectElement | null;
      const diffSelect = this.container?.querySelector('#dom-debug-diff') as HTMLSelectElement | null;
      const paceSelect = this.container?.querySelector('#dom-debug-pacing') as HTMLSelectElement | null;
      const archSelect = this.container?.querySelector('#dom-debug-archetype') as HTMLSelectElement | null;
      const ruleSelect = this.container?.querySelector('#dom-debug-rule-mode') as HTMLSelectElement | null;
      const chestsInput = this.container?.querySelector('#dom-debug-chests') as HTMLInputElement | null;
      const gravesInput = this.container?.querySelector('#dom-debug-graves') as HTMLInputElement | null;
      const enemyAtkInput = this.container?.querySelector('#dom-debug-enemy-atk') as HTMLInputElement | null;
      const dragonDefInput = this.container?.querySelector('#dom-debug-dragon-def') as HTMLInputElement | null;

      const topo = (topoSelect?.value as DungeonTopology) ?? 'MULTI_SECTOR';
      const diff = (diffSelect?.value as MapDifficulty) ?? 'NORMAL';
      const pace = (paceSelect?.value as PlayPacingMode) ?? 'STANDARD';
      const arch = (archSelect?.value as DungeonArchetype) ?? 'BALANCED';
      const rule = (ruleSelect?.value as RuleMode) ?? 'EXPONENTIAL';
      const seedVal = seedInput?.value ? parseInt(seedInput.value, 10) : 123456;
      const chestsVal = chestsInput?.value ? parseInt(chestsInput.value, 10) : 100;
      const gravesVal = gravesInput?.value ? parseInt(gravesInput.value, 10) : 20;
      const enemyAtk = enemyAtkInput?.value ? parseFloat(enemyAtkInput.value) : 1.0;
      const dragonDef = dragonDefInput?.value ? parseFloat(dragonDefInput.value) : 1.0;

      reportBox.classList.remove('hidden');

      if (topo === 'CLASSIC_FIXED') {
        const map = new WorldMap(64, 64);
        const report = ProceduralMapGenerator.validateSolvability(map);
        const profile = MapProfiler.profile(map, { seed: 0, topology: 'CLASSIC_FIXED' });
        const diffClass = `diff-badge diff-badge-${profile.estimatedDifficulty.toLowerCase()}`;
        const tagBadges = profile.tags.map(t => `<span class="preset-tag-chip">${t}</span>`).join(' ');

        reportBox.innerHTML = `
          <div class="observatory-report-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="color: #64b5f6; font-weight: bold; font-size: 12px;">[CLASSIC FIXED TESTBED]</span>
              <span class="${diffClass}">${profile.estimatedDifficulty}</span>
            </div>
            <div style="margin-bottom: 6px;">物理解法性: <strong style="color: ${report.isSolvable ? '#81c784' : '#e57373'}">${report.isSolvable ? 'PASS (100%保証)' : 'FAIL'}</strong> | 難易度指数: <strong style="color: #ffb74d;">${profile.challengeRating}/100</strong></div>
            <div class="observatory-metrics-grid">
              <div class="observatory-metric-box"><div class="observatory-metric-label">開放度 (Openness)</div><div class="observatory-metric-val">${(profile.metrics.opennessScore * 100).toFixed(1)}%</div></div>
              <div class="observatory-metric-box"><div class="observatory-metric-label">迷路度 (Maze)</div><div class="observatory-metric-val">${(profile.metrics.mazeIndex * 100).toFixed(1)}%</div></div>
              <div class="observatory-metric-box"><div class="observatory-metric-label">独立部屋数</div><div class="observatory-metric-val">${profile.metrics.roomCount}室</div></div>
              <div class="observatory-metric-box"><div class="observatory-metric-label">初期剣コスト</div><div class="observatory-metric-val">${profile.metrics.swordWalkDistance}歩</div></div>
              <div class="observatory-metric-box"><div class="observatory-metric-label">家周囲未封鎖墓</div><div class="observatory-metric-val">${profile.metrics.nearHomeGraves}基</div></div>
              <div class="observatory-metric-box"><div class="observatory-metric-label">竜要塞侵入路</div><div class="observatory-metric-val">${profile.metrics.lairAccessibility.entranceCount}箇所</div></div>
            </div>
            <div style="font-size: 10px; color: #b0bec5; margin-top: 4px;">宝箱: ${report.counts.chests}個 | 墓: ${report.counts.graves}基 (開口: ${report.counts.openGraves}) | 想定到達STR: ${report.estimatedMaxStr.toLocaleString()}</div>
            <div class="preset-tag-list" style="margin-top: 6px;">${tagBadges}</div>
          </div>
        `;
      } else {
        const map = new WorldMap(64, 64);
        const options: ProceduralMapOptions = {
          seed: seedVal,
          topology: topo,
          difficulty: diff,
          pacing: pace,
          archetype: arch,
          ruleMode: rule,
          chestCount: chestsVal,
          graveCount: gravesVal,
          tuningParams: {
            progressionConfig: {
              enemyAtkRatio: enemyAtk,
              dragonDefRatio: dragonDef,
            },
          },
        };

        const report = ProceduralMapGenerator.generateDungeon(map, options);
        const profile = MapProfiler.profile(map, { seed: report.seed, topology: topo });
        const diffClass = `diff-badge diff-badge-${profile.estimatedDifficulty.toLowerCase()}`;
        const tagBadges = profile.tags.map(t => `<span class="preset-tag-chip ${t === 'UNBEATEN_BY_BOT' ? 'unbeaten' : ''}">${t}</span>`).join(' ');

        reportBox.innerHTML = `
          <div class="observatory-report-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; border-bottom: 1px solid rgba(0, 150, 136, 0.4); padding-bottom: 4px;">
              <span style="color: #4db6ac; font-weight: bold; font-size: 12px;">観測プロファイル (Seed: ${report.seed})</span>
              <div style="display: flex; gap: 4px; align-items: center;">
                <span class="${diffClass}">${profile.estimatedDifficulty}</span>
                <span style="font-size: 11px; font-weight: bold; color: #ffb74d;">★ ${profile.challengeRating}/100</span>
              </div>
            </div>
            <div style="margin-bottom: 6px; font-size: 11px;">
              解法性: <strong style="color: ${report.isSolvable ? '#81c784' : '#e57373'}">${report.isSolvable ? 'PASS (100%保証)' : 'FAIL'}</strong> |
              トポロジー推定: <strong style="color: #80d8ff;">${profile.estimatedTopology}</strong> |
              ペーシング: <strong style="color: #ce93d8;">${profile.estimatedPacing}</strong>
            </div>

            <!-- 幾何メトリクスグリッド -->
            <div class="observatory-metrics-grid">
              <div class="observatory-metric-box">
                <div class="observatory-metric-label">開放度 (Openness)</div>
                <div class="observatory-metric-val">${(profile.metrics.opennessScore * 100).toFixed(1)}%</div>
              </div>
              <div class="observatory-metric-box">
                <div class="observatory-metric-label">迷路度 (Maze)</div>
                <div class="observatory-metric-val">${(profile.metrics.mazeIndex * 100).toFixed(1)}%</div>
              </div>
              <div class="observatory-metric-box">
                <div class="observatory-metric-label">独立部屋数</div>
                <div class="observatory-metric-val">${profile.metrics.roomCount}室</div>
              </div>
              <div class="observatory-metric-box">
                <div class="observatory-metric-label">初期剣コスト</div>
                <div class="observatory-metric-val">${profile.metrics.swordWalkDistance}歩</div>
              </div>
              <div class="observatory-metric-box">
                <div class="observatory-metric-label">家周辺12マス墓</div>
                <div class="observatory-metric-val">${profile.metrics.nearHomeGraves}基</div>
              </div>
              <div class="observatory-metric-box">
                <div class="observatory-metric-label">要塞アクセス</div>
                <div class="observatory-metric-val">開口${profile.metrics.lairAccessibility.entranceCount} / 安${profile.metrics.lairAccessibility.safeSpacesCount}</div>
              </div>
              <div class="observatory-metric-box">
                <div class="observatory-metric-label">セクター分断度</div>
                <div class="observatory-metric-val">${(profile.metrics.sectorPartitionScore * 100).toFixed(1)}%</div>
              </div>
              <div class="observatory-metric-box">
                <div class="observatory-metric-label">宝箱 / 墓数</div>
                <div class="observatory-metric-val">${report.counts.chests}個 / ${report.counts.graves}基</div>
              </div>
            </div>

            <div style="font-size: 10px; color: #80cbc4; margin: 4px 0;">
              想定到達STR: ${report.estimatedMaxStr.toLocaleString()} (中首撃破基準) | 重複ゼロ: ${report.hasZeroOverlaps ? 'OK' : 'FAIL'} | 内部壁BLOCK化: ${report.internalWallsAreBlocks ? 'OK' : 'FAIL'}
            </div>
            ${report.issues.length > 0 ? `<div style="color: #ef5350; font-size: 10px;">Issues: ${report.issues.join(', ')}</div>` : ''}

            <!-- 特徴タグ一覧 -->
            <div class="preset-tag-list" style="margin-top: 6px;">
              ${tagBadges}
            </div>
          </div>
        `;
      }
    };

    if (randSeedBtn && seedInput) {
      randSeedBtn.addEventListener('click', () => {
        seedInput.value = String(Math.floor(Math.random() * 900000) + 100000);
        executeObservatoryPreview();
      });

      let seedInputDebounceTimer: any = null;
      seedInput.addEventListener('input', () => {
        if (seedInputDebounceTimer) clearTimeout(seedInputDebounceTimer);
        seedInputDebounceTimer = setTimeout(() => {
          executeObservatoryPreview();
        }, 300);
      });
    }

    // クイック設定の乱数シードボタン
    const procRandSeedBtn = this.container.querySelector('#dom-proc-rand-seed-btn') as HTMLElement | null;
    const procSeedInput = this.container.querySelector('#dom-proc-seed') as HTMLInputElement | null;
    if (procRandSeedBtn && procSeedInput) {
      procRandSeedBtn.addEventListener('click', () => {
        procSeedInput.value = String(Math.floor(Math.random() * 900000) + 100000);
      });
    }

    // 診断プレビューボタン
    if (previewBtn) {
      previewBtn.addEventListener('click', executeObservatoryPreview);
    }

    // 設定タイプ切り替え（セグメントタブUI連動）
    const typeRadios = this.container.querySelectorAll('input[name="custom-mode-type"]');
    const tabQuick = this.container.querySelector('#dom-tab-quick') as HTMLElement | null;
    const tabPreset = this.container.querySelector('#dom-tab-preset') as HTMLElement | null;
    const tabShare = this.container.querySelector('#dom-tab-share') as HTMLElement | null;
    const tabDebug = this.container.querySelector('#dom-tab-debug') as HTMLElement | null;
    const panelQuick = this.container.querySelector('#dom-panel-quick') as HTMLElement | null;
    const panelPreset = this.container.querySelector('#dom-panel-preset') as HTMLElement | null;
    const panelShare = this.container.querySelector('#dom-panel-share') as HTMLElement | null;
    const panelDebug = this.container.querySelector('#dom-panel-debug') as HTMLElement | null;
    const actionHint = this.container.querySelector('#dom-custom-action-hint') as HTMLElement | null;

    const updateSelectedTypePanel = (val: string) => {
      tabQuick?.classList.remove('active');
      tabPreset?.classList.remove('active');
      tabShare?.classList.remove('active');
      tabDebug?.classList.remove('active');

      panelQuick?.classList.add('hidden');
      panelPreset?.classList.add('hidden');
      panelShare?.classList.add('hidden');
      panelDebug?.classList.add('hidden');

      if (val === 'QUICK') {
        tabQuick?.classList.add('active');
        panelQuick?.classList.remove('hidden');
        if (actionHint) actionHint.textContent = '💡 選択中のタイプ【クイック設定】でダンジョンを開始します';
      } else if (val === 'PRESET') {
        tabPreset?.classList.add('active');
        panelPreset?.classList.remove('hidden');
        if (actionHint) actionHint.textContent = '💡 選択中のタイプ【マッププリセット】でダンジョンを開始します';
      } else if (val === 'SHARE_CODE') {
        tabShare?.classList.add('active');
        panelShare?.classList.remove('hidden');
        if (actionHint) actionHint.textContent = '💡 選択中のタイプ【共有コード】でダンジョンを開始します';
      } else if (val === 'DEBUG') {
        tabDebug?.classList.add('active');
        panelDebug?.classList.remove('hidden');
        if (actionHint) actionHint.textContent = '💡 選択中のタイプ【詳細パラメータ】でダンジョンを開始します';
      }
    };

    if (typeRadios) {
      typeRadios.forEach((r) => {
        r.addEventListener('change', () => {
          const radio = r as HTMLInputElement;
          if (radio.checked) {
            updateSelectedTypePanel(radio.value);
          }
        });
      });
    }

    const tabMap: { el: HTMLElement | null; val: string }[] = [
      { el: tabQuick, val: 'QUICK' },
      { el: tabPreset, val: 'PRESET' },
      { el: tabShare, val: 'SHARE_CODE' },
      { el: tabDebug, val: 'DEBUG' },
    ];
    tabMap.forEach(({ el, val }) => {
      el?.addEventListener('click', () => {
        const radio = el.querySelector('input[type="radio"]') as HTMLInputElement | null;
        if (radio) {
          radio.checked = true;
        }
        updateSelectedTypePanel(val);
      });
    });

    const getSelectedCustomType = (): string => {
      const checkedRadio = this.container?.querySelector('input[name="custom-mode-type"]:checked') as HTMLInputElement | null;
      return checkedRadio?.value ?? 'QUICK';
    };

    // 代表ボタン: 自分でプレイ開始
    const handlePlayCurrentType = () => {
      const type = getSelectedCustomType();
      if (type === 'QUICK') {
        if (this.callbacks.onStartProceduralGame) {
          const topoSelect = this.container?.querySelector('#dom-proc-topology') as HTMLSelectElement | null;
          const diffSelect = this.container?.querySelector('#dom-proc-difficulty') as HTMLSelectElement | null;
          const paceSelect = this.container?.querySelector('#dom-proc-pacing') as HTMLSelectElement | null;
          const archSelect = this.container?.querySelector('#dom-proc-archetype') as HTMLSelectElement | null;
          const ruleSelect = this.container?.querySelector('#dom-proc-rule-mode') as HTMLSelectElement | null;
          const procSeedInput = this.container?.querySelector('#dom-proc-seed') as HTMLInputElement | null;
          const options: ProceduralMapOptions = {
            seed: procSeedInput?.value ? parseInt(procSeedInput.value, 10) : undefined,
            topology: (topoSelect?.value as DungeonTopology) ?? 'MULTI_SECTOR',
            difficulty: (diffSelect?.value as MapDifficulty) ?? 'NORMAL',
            pacing: (paceSelect?.value as PlayPacingMode) ?? 'STANDARD',
            archetype: (archSelect?.value as DungeonArchetype) ?? 'BALANCED',
            ruleMode: (ruleSelect?.value as RuleMode) ?? 'EXPONENTIAL',
          };
          this.close();
          this.callbacks.onStartProceduralGame(options);
        }
      } else if (type === 'PRESET') {
        const presetSelect = this.container?.querySelector('#dom-preset-select') as HTMLSelectElement | null;
        const presets = MapPresetManager.getAllPresets();
        const selected = presets.find(p => p.id === presetSelect?.value);
        if (selected && this.callbacks.onStartPresetGame) {
          this.close();
          this.callbacks.onStartPresetGame(selected);
        }
      } else if (type === 'SHARE_CODE') {
        const shareInput = this.container?.querySelector('#dom-share-code-input') as HTMLInputElement | null;
        const code = shareInput?.value.trim();
        if (!code) {
          alert('共有コードを入力してください。');
          return;
        }
        const imported = MapPresetManager.importShareCode(code);
        if (!imported) {
          alert('無効な共有コードです。形式を確認してください。');
          return;
        }
        if (this.callbacks.onStartPresetGame) {
          this.close();
          this.callbacks.onStartPresetGame(imported);
        }
      } else if (type === 'DEBUG') {
        if (this.callbacks.onStartProceduralGame) {
          const topoSelect = this.container?.querySelector('#dom-debug-topology') as HTMLSelectElement | null;
          const diffSelect = this.container?.querySelector('#dom-debug-diff') as HTMLSelectElement | null;
          const paceSelect = this.container?.querySelector('#dom-debug-pacing') as HTMLSelectElement | null;
          const archSelect = this.container?.querySelector('#dom-debug-archetype') as HTMLSelectElement | null;
          const ruleSelect = this.container?.querySelector('#dom-debug-rule-mode') as HTMLSelectElement | null;
          const chestsInput = this.container?.querySelector('#dom-debug-chests') as HTMLInputElement | null;
          const gravesInput = this.container?.querySelector('#dom-debug-graves') as HTMLInputElement | null;
          const enemyAtkInput = this.container?.querySelector('#dom-debug-enemy-atk') as HTMLInputElement | null;
          const dragonDefInput = this.container?.querySelector('#dom-debug-dragon-def') as HTMLInputElement | null;

          const options: ProceduralMapOptions = {
            seed: seedInput?.value ? parseInt(seedInput.value, 10) : undefined,
            topology: (topoSelect?.value as DungeonTopology) ?? 'MULTI_SECTOR',
            difficulty: (diffSelect?.value as MapDifficulty) ?? 'NORMAL',
            pacing: (paceSelect?.value as PlayPacingMode) ?? 'STANDARD',
            archetype: (archSelect?.value as DungeonArchetype) ?? 'BALANCED',
            ruleMode: (ruleSelect?.value as RuleMode) ?? 'EXPONENTIAL',
            chestCount: chestsInput?.value ? parseInt(chestsInput.value, 10) : undefined,
            graveCount: gravesInput?.value ? parseInt(gravesInput.value, 10) : undefined,
            tuningParams: (enemyAtkInput?.value || dragonDefInput?.value) ? {
              progressionConfig: {
                enemyAtkRatio: enemyAtkInput?.value ? parseFloat(enemyAtkInput.value) : undefined,
                dragonDefRatio: dragonDefInput?.value ? parseFloat(dragonDefInput.value) : undefined,
              },
            } : undefined,
          };
          this.close();
          this.callbacks.onStartProceduralGame(options);
        }
      }
    };

    // 代表ボタン: 自動プレイで自走検証 (AUTO-PLAY)
    const handleAutoPlayCurrentType = () => {
      const type = getSelectedCustomType();
      if (type === 'QUICK') {
        if (this.callbacks.onStartAutoPlayVerify) {
          const topoSelect = this.container?.querySelector('#dom-proc-topology') as HTMLSelectElement | null;
          const diffSelect = this.container?.querySelector('#dom-proc-difficulty') as HTMLSelectElement | null;
          const paceSelect = this.container?.querySelector('#dom-proc-pacing') as HTMLSelectElement | null;
          const archSelect = this.container?.querySelector('#dom-proc-archetype') as HTMLSelectElement | null;
          const ruleSelect = this.container?.querySelector('#dom-proc-rule-mode') as HTMLSelectElement | null;
          const procSeedInput = this.container?.querySelector('#dom-proc-seed') as HTMLInputElement | null;
          const options: ProceduralMapOptions = {
            seed: procSeedInput?.value ? parseInt(procSeedInput.value, 10) : undefined,
            topology: (topoSelect?.value as DungeonTopology) ?? 'MULTI_SECTOR',
            difficulty: (diffSelect?.value as MapDifficulty) ?? 'NORMAL',
            pacing: (paceSelect?.value as PlayPacingMode) ?? 'STANDARD',
            archetype: (archSelect?.value as DungeonArchetype) ?? 'BALANCED',
            ruleMode: (ruleSelect?.value as RuleMode) ?? 'EXPONENTIAL',
          };
          this.close();
          this.callbacks.onStartAutoPlayVerify(options);
        }
      } else if (type === 'PRESET') {
        const presetSelect = this.container?.querySelector('#dom-preset-select') as HTMLSelectElement | null;
        const presets = MapPresetManager.getAllPresets();
        const selected = presets.find(p => p.id === presetSelect?.value);
        if (selected && this.callbacks.onStartAutoPlayVerify) {
          this.close();
          this.callbacks.onStartAutoPlayVerify(undefined, selected);
        }
      } else if (type === 'SHARE_CODE') {
        const shareInput = this.container?.querySelector('#dom-share-code-input') as HTMLInputElement | null;
        const code = shareInput?.value.trim();
        if (!code) {
          alert('共有コードを入力してください。');
          return;
        }
        const imported = MapPresetManager.importShareCode(code);
        if (!imported) {
          alert('無効な共有コードです。形式を確認してください。');
          return;
        }
        if (this.callbacks.onStartAutoPlayVerify) {
          this.close();
          this.callbacks.onStartAutoPlayVerify(undefined, imported);
        }
      } else if (type === 'DEBUG') {
        if (this.callbacks.onStartAutoPlayVerify) {
          const topoSelect = this.container?.querySelector('#dom-debug-topology') as HTMLSelectElement | null;
          const diffSelect = this.container?.querySelector('#dom-debug-diff') as HTMLSelectElement | null;
          const paceSelect = this.container?.querySelector('#dom-debug-pacing') as HTMLSelectElement | null;
          const archSelect = this.container?.querySelector('#dom-debug-archetype') as HTMLSelectElement | null;
          const ruleSelect = this.container?.querySelector('#dom-debug-rule-mode') as HTMLSelectElement | null;
          const chestsInput = this.container?.querySelector('#dom-debug-chests') as HTMLInputElement | null;
          const gravesInput = this.container?.querySelector('#dom-debug-graves') as HTMLInputElement | null;
          const enemyAtkInput = this.container?.querySelector('#dom-debug-enemy-atk') as HTMLInputElement | null;
          const dragonDefInput = this.container?.querySelector('#dom-debug-dragon-def') as HTMLInputElement | null;

          const options: ProceduralMapOptions = {
            seed: seedInput?.value ? parseInt(seedInput.value, 10) : undefined,
            topology: (topoSelect?.value as DungeonTopology) ?? 'MULTI_SECTOR',
            difficulty: (diffSelect?.value as MapDifficulty) ?? 'NORMAL',
            pacing: (paceSelect?.value as PlayPacingMode) ?? 'STANDARD',
            archetype: (archSelect?.value as DungeonArchetype) ?? 'BALANCED',
            ruleMode: (ruleSelect?.value as RuleMode) ?? 'EXPONENTIAL',
            chestCount: chestsInput?.value ? parseInt(chestsInput.value, 10) : undefined,
            graveCount: gravesInput?.value ? parseInt(gravesInput.value, 10) : undefined,
            tuningParams: (enemyAtkInput?.value || dragonDefInput?.value) ? {
              progressionConfig: {
                enemyAtkRatio: enemyAtkInput?.value ? parseFloat(enemyAtkInput.value) : undefined,
                dragonDefRatio: dragonDefInput?.value ? parseFloat(dragonDefInput.value) : undefined,
              },
            } : undefined,
          };
          this.close();
          this.callbacks.onStartAutoPlayVerify(options);
        }
      }
    };

    // 代表ボタンへのバインド
    const proceduralBtn = this.container.querySelector('#dom-procedural-btn');
    if (proceduralBtn) {
      proceduralBtn.addEventListener('click', handlePlayCurrentType);
    }
    const quickAutoplayBtn = this.container.querySelector('#dom-quick-autoplay-btn');
    if (quickAutoplayBtn) {
      quickAutoplayBtn.addEventListener('click', handleAutoPlayCurrentType);
    }

    // 互換用ボタンのバインド
    const debugLaunchBtn = this.container.querySelector('#dom-debug-launch-btn');
    if (debugLaunchBtn) debugLaunchBtn.addEventListener('click', handlePlayCurrentType);
    const debugAutoplayBtn = this.container.querySelector('#dom-debug-autoplay-btn');
    if (debugAutoplayBtn) debugAutoplayBtn.addEventListener('click', handleAutoPlayCurrentType);

    this.setupPresetEventListeners();
  }

  private setupPresetEventListeners(): void {
    if (!this.container) return;
    const presetSelect = this.container.querySelector('#dom-preset-select') as HTMLSelectElement | null;
    const presetStartBtn = this.container.querySelector('#dom-preset-start-btn');
    const presetShareBtn = this.container.querySelector('#dom-preset-share-btn');
    const presetDeleteBtn = this.container.querySelector('#dom-preset-delete-btn');
    const shareInput = this.container.querySelector('#dom-share-code-input') as HTMLInputElement | null;
    const shareStartBtn = this.container.querySelector('#dom-share-code-start-btn');

    this.refreshPresetList();

    if (presetSelect) {
      presetSelect.addEventListener('change', () => {
        this.updatePresetDetailCardFromSelected();
      });
    }

    const presetAutoplayBtn = this.container.querySelector('#dom-preset-autoplay-btn');
    const shareCodeAutoplayBtn = this.container.querySelector('#dom-share-code-autoplay-btn');

    if (presetStartBtn && presetSelect) {
      presetStartBtn.addEventListener('click', () => {
        const presets = MapPresetManager.getAllPresets();
        const selected = presets.find(p => p.id === presetSelect.value);
        if (selected && this.callbacks.onStartPresetGame) {
          this.close();
          this.callbacks.onStartPresetGame(selected);
        }
      });
    }

    if (presetAutoplayBtn && presetSelect) {
      presetAutoplayBtn.addEventListener('click', () => {
        const presets = MapPresetManager.getAllPresets();
        const selected = presets.find(p => p.id === presetSelect.value);
        if (selected && this.callbacks.onStartAutoPlayVerify) {
          this.close();
          this.callbacks.onStartAutoPlayVerify(undefined, selected);
        }
      });
    }

    if (presetShareBtn && presetSelect) {
      presetShareBtn.addEventListener('click', () => {
        const presets = MapPresetManager.getAllPresets();
        const selected = presets.find(p => p.id === presetSelect.value);
        if (selected) {
          const code = MapPresetManager.exportShareCode(selected);
          if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(code).then(() => {
              alert(`共有コードをクリップボードにコピーしました！\n${code}`);
            }).catch(() => {
              prompt('共有コード:', code);
            });
          } else {
            prompt('共有コード:', code);
          }
        }
      });
    }

    if (presetDeleteBtn && presetSelect) {
      presetDeleteBtn.addEventListener('click', () => {
        const presets = MapPresetManager.getAllPresets();
        const selected = presets.find(p => p.id === presetSelect.value);
        if (!selected) return;
        if (selected.isCurated) {
          alert('公式おすすめプリセットは削除できません。');
          return;
        }
        if (confirm(`プリセット「${selected.name}」を削除しますか？`)) {
          MapPresetManager.deletePreset(selected.id);
          this.refreshPresetList();
        }
      });
    }

    if (shareStartBtn && shareInput) {
      shareStartBtn.addEventListener('click', () => {
        const code = shareInput.value.trim();
        if (!code) {
          alert('共有コードを入力してください。');
          return;
        }
        const imported = MapPresetManager.importShareCode(code);
        if (!imported) {
          alert('無効な共有コードです。形式を確認してください。');
          return;
        }
        if (this.callbacks.onStartPresetGame) {
          this.close();
          this.callbacks.onStartPresetGame(imported);
        }
      });
    }

    if (shareCodeAutoplayBtn && shareInput) {
      shareCodeAutoplayBtn.addEventListener('click', () => {
        const code = shareInput.value.trim();
        if (!code) {
          alert('共有コードを入力してください。');
          return;
        }
        const imported = MapPresetManager.importShareCode(code);
        if (!imported) {
          alert('無効な共有コードです。形式を確認してください。');
          return;
        }
        if (this.callbacks.onStartAutoPlayVerify) {
          this.close();
          this.callbacks.onStartAutoPlayVerify(undefined, imported);
        }
      });
    }
  }

  public refreshPresetList(): void {
    const presetSelect = this.container?.querySelector('#dom-preset-select') as HTMLSelectElement | null;
    if (!presetSelect) return;

    const presets = MapPresetManager.getAllPresets();
    presetSelect.innerHTML = presets.map(p => {
      let tag = p.isCurated ? '★ [公式]' : '💾 [保存]';
      if (p.metrics?.playerCleared) {
        tag = '🏆 [踏破済]';
      } else if (p.metrics?.isUnbeatenChallenge || p.metrics?.botStatus === 'UNBEATEN_BY_BOT') {
        tag = '🤖 [未踏破]';
      }
      const diffTag = p.metrics?.estimatedDifficulty ? ` [${p.metrics.estimatedDifficulty}]` : '';
      return `<option value="${p.id}">${tag}${diffTag} ${p.name} (Seed: ${p.seed})</option>`;
    }).join('');

    this.updatePresetDetailCardFromSelected();
  }

  public updatePresetDetailCardFromSelected(): void {
    const presetSelect = this.container?.querySelector('#dom-preset-select') as HTMLSelectElement | null;
    if (!presetSelect) return;
    const presets = MapPresetManager.getAllPresets();
    const selected = presets.find(p => p.id === presetSelect.value) ?? presets[0];
    if (selected) {
      this.updatePresetDetailCard(selected);
    }
  }

  public updatePresetDetailCard(preset: MapPresetData): void {
    const cardEl = this.container?.querySelector('#dom-preset-detail-card') as HTMLElement | null;
    if (!cardEl) return;

    const m = preset.metrics;
    const difficulty = m?.estimatedDifficulty ?? preset.options.difficulty ?? 'NORMAL';
    const topology = m?.estimatedTopology ?? preset.options.topology ?? 'MULTI_SECTOR';
    const pacing = m?.estimatedPacing ?? preset.options.pacing ?? 'STANDARD';

    const challengeRating = m?.challengeRating ?? (
      difficulty === 'NIGHTMARE' ? 92 :
      difficulty === 'HARD' ? 68 :
      difficulty === 'NORMAL' ? 42 : 22
    );

    const ratingColor = challengeRating >= 80 ? '#f44336' : challengeRating >= 50 ? '#ff9800' : '#4caf50';

    let botStatusHtml = '';
    if (m?.isUnbeatenChallenge || m?.botStatus === 'UNBEATEN_BY_BOT') {
      botStatusHtml = '<span style="color: #ff5252; font-weight: bold;">🤖 ボット1600T未踏破チャレンジ！</span>';
    } else if (m?.botStatus === 'CLEARED' && m.botTurns) {
      botStatusHtml = `<span style="color: #69f0ae;">🤖 ボット基準クリア: <strong>${m.botTurns}</strong> ターン</span>`;
    } else if (preset.isCurated) {
      botStatusHtml = '<span style="color: #80d8ff;">🤖 ボット基準クリア検証済</span>';
    } else {
      botStatusHtml = '<span style="color: #b0bec5;">🤖 ボット観測: 未測定</span>';
    }

    let playerClearHtml = '';
    if (m?.playerCleared) {
      const turns = m.playerClearTurns ?? m.clearTurns ?? '---';
      playerClearHtml = `<span style="color: #ffd700; font-weight: bold;">🏆 踏破済: 最速 ${turns} ターン</span>`;
    } else {
      playerClearHtml = '<span style="color: #9e9e9e;">⚪ 未踏破（挑戦求む！）</span>';
    }

    const tags = m?.tags && m.tags.length > 0
      ? m.tags
      : [topology, difficulty, pacing];

    const tagBadgesHtml = tags.map(t => {
      const isUnbeaten = t === 'UNBEATEN_BY_BOT';
      return `<span class="preset-tag-chip ${isUnbeaten ? 'unbeaten' : ''}">${t}</span>`;
    }).join(' ');

    const diffBadgeClass = `diff-badge diff-badge-${difficulty.toLowerCase()}`;

    cardEl.innerHTML = `
      <div class="preset-card-header">
        <div>
          <div class="preset-card-title">${preset.name}</div>
          <div style="font-size: 10px; color: #7986cb; font-family: monospace;">Seed: ${preset.seed} | ID: ${preset.id}</div>
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
          <span class="${diffBadgeClass}">${difficulty}</span>
          <span style="font-size: 11px; font-weight: bold; color: ${ratingColor};">★ ${challengeRating}/100</span>
        </div>
      </div>

      <div class="preset-card-desc">
        ${preset.description ?? 'カスタムダンジョンシード。事後観測による地形プロファイルが適用されています。'}
      </div>

      <div class="preset-metrics-grid">
        <div class="preset-metric-item">
          <div class="preset-metric-label">推定トポロジー</div>
          <div class="preset-metric-val" style="color: #80d8ff;">${topology}</div>
        </div>
        <div class="preset-metric-item">
          <div class="preset-metric-label">ペース配分</div>
          <div class="preset-metric-val" style="color: #ce93d8;">${pacing}</div>
        </div>
        <div class="preset-metric-item">
          <div class="preset-metric-label">チャレンジ指数</div>
          <div class="preset-metric-val">
            <div class="challenge-rating-container">
              <div class="challenge-rating-track">
                <div class="challenge-rating-fill" style="width: ${challengeRating}%; background: ${ratingColor};"></div>
              </div>
              <span style="font-size: 10px; color: ${ratingColor};">${challengeRating}</span>
            </div>
          </div>
        </div>
        <div class="preset-metric-item">
          <div class="preset-metric-label">ボット観測ステータス</div>
          <div class="preset-metric-val" style="font-size: 11px;">${botStatusHtml}</div>
        </div>
        <div class="preset-metric-item">
          <div class="preset-metric-label">プレイヤー踏破記録</div>
          <div class="preset-metric-val" style="font-size: 11px;">${playerClearHtml}</div>
        </div>
      </div>

      <div style="margin-top: 6px;">
        <div style="font-size: 10px; color: #9fa8da; margin-bottom: 3px;">特徴タグ (Tags):</div>
        <div class="preset-tag-list">${tagBadgesHtml}</div>
      </div>
    `;
  }
}
