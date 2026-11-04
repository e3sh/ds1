import { Player } from '../models/Player.js';
import {
  GameState,
  MagicType,
  PaletteMode,
  TargetEnemyInfo,
  ThreatLevel,
  DungeonTopology,
  DungeonArchetype,
  MapDifficulty,
  PlayPacingMode,
} from '../models/Types.js';
import { MagicDefinition } from '../config/MagicTable.js';
import { WorldMap } from '../models/WorldMap.js';
import { SaveSummary } from '../services/SaveManager.js';
import { MonsterGraphics } from './MonsterGraphics.js';
import { TileGraphics } from './TileGraphics.js';
import { ProceduralMapGenerator, ProceduralMapOptions } from '../systems/ProceduralMapGenerator.js';
import { InspectorModal, InspectorData } from './InspectorModal.js';
import { MapPresetData, MapPresetManager } from '../services/MapPresetManager.js';

export interface LogEntry {
  id: string;
  text: string;
  type: 'info' | 'combat' | 'magic' | 'warn' | 'success' | 'fatal';
  time: string;
}

export interface DOMUICallbacks {
  onSelectMagic?: (index: number) => void;
  onCastMagic?: () => void;
  onStartGame?: () => void;
  onStartProceduralGame?: (options?: ProceduralMapOptions) => void;
  onRestartGame?: () => void;
  onToggleSound?: () => void;
  onGiveUp?: () => void;
  onConfirmGiveUp?: () => void;
  onSaveAndQuit?: () => void;
  onContinueGame?: () => void;
  onToggleMarker?: () => void;
  onToggleInspect?: () => void;
  onSaveMapPreset?: (name?: string) => void;
  onStartPresetGame?: (preset: MapPresetData) => void;
  onStartDemo?: () => void;
  onExitDemo?: () => void;
  onStartAutoPlayVerify?: (options?: ProceduralMapOptions, preset?: MapPresetData) => void;
  onChangeAutoPlaySpeed?: (speedMultiplier: number) => void;
  onTakeoverAutoPlay?: () => void;
  onToggleAutoPlay?: () => void;
  onExitAutoPlayVerify?: () => void;
  onOpenCustomModal?: () => void;
  onCloseCustomModal?: () => void;
}

export class DOMUIManager {
  private container: HTMLElement | null = null;
  private callbacks: DOMUICallbacks = {};
  private isTacticalMarkerEnabled: boolean = true;

  // キャッシュDOM要素
  private statHpEl: HTMLElement | null = null;
  private statStrEl: HTMLElement | null = null;
  private statExpEl: HTMLElement | null = null;
  private statGoldEl: HTMLElement | null = null;
  private statMagicEl: HTMLElement | null = null;
  private statCrownEl: HTMLElement | null = null;
  private badgeItemEl: HTMLElement | null = null;
  private badgeSwordEl: HTMLElement | null = null;
  private specialStatusEl: HTMLElement | null = null;
  private indicatorFillEl: HTMLElement | null = null;
  private magicCurseBannerEl: HTMLElement | null = null;
  private magicListEl: HTMLElement | null = null;
  private magicDescBoxEl: HTMLElement | null = null;
  private castBtnEl: HTMLButtonElement | null = null;
  private logStreamEl: HTMLElement | null = null;

  // ターゲット敵（対峙モンスター）パネル
  private targetPanelEl: HTMLElement | null = null;
  private targetStatusTagEl: HTMLElement | null = null;
  private targetBodyEl: HTMLElement | null = null;

  // モーダル・UIコントロール
  private markerBtnEl: HTMLButtonElement | null = null;
  private soundBtnEl: HTMLButtonElement | null = null;
  private giveupBtnEl: HTMLButtonElement | null = null;
  private saveQuitBtnEl: HTMLButtonElement | null = null;
  private titleModalEl: HTMLElement | null = null;
  private gameoverModalEl: HTMLElement | null = null;
  private gameoverStatsEl: HTMLElement | null = null;
  private gameoverCauseMsgEl: HTMLElement | null = null;
  private gameoverAvatarCanvasEl: HTMLCanvasElement | null = null;
  private clearModalEl: HTMLElement | null = null;
  private startBtnEl: HTMLButtonElement | null = null;
  private proceduralBtnEl: HTMLButtonElement | null = null;
  private continueBtnEl: HTMLButtonElement | null = null;
  private continueSummaryEl: HTMLElement | null = null;
  private retryBtnEl: HTMLButtonElement | null = null;
  private replayBtnEl: HTMLButtonElement | null = null;
  private giveupModalEl: HTMLElement | null = null;
  private giveupConfirmBtnEl: HTMLButtonElement | null = null;
  private giveupCancelBtnEl: HTMLButtonElement | null = null;
  private inspectBtnEl: HTMLButtonElement | null = null;
  private inspectorModal: InspectorModal | null = null;
  private demoBtnEl: HTMLButtonElement | null = null;
  private demoOverlayEl: HTMLElement | null = null;
  private demoTitleEl: HTMLElement | null = null;
  private demoTipEl: HTMLElement | null = null;
  private customModalEl: HTMLElement | null = null;
  private openCustomBtnEl: HTMLButtonElement | null = null;
  private customBackBtnEl: HTMLButtonElement | null = null;
  private autoplayControlsEl: HTMLElement | null = null;
  private autoplayToggleBtnEl: HTMLButtonElement | null = null;
  private autoplaySpeedBtns: { [key: number]: HTMLButtonElement | null } = {};
  private autoplayTakeoverBtnEl: HTMLButtonElement | null = null;
  private autoplayExitBtnEl: HTMLButtonElement | null = null;
  private isAutoPlayMode: boolean = false;
  private idleTimerId: number | null = null;

  // Dirtyチェック用キャッシュ（同一状態時の不要なinnerHTML再生成およびDOM破棄の抑止）
  private lastMagicSignature: string = '';
  private lastTargetSignature: string = '';
  private lastHp: number = -1;
  private lastStr: number = -1;
  private lastExp: number = -1;
  private lastGold: number = -1;
  private lastMagic: number = -1;
  private lastCrowns: number = -1;
  private lastHoldItem: string = '';
  private lastHasSword: boolean | null = null;
  private lastSpecialStatusText: string = '';
  private lastIndicatorRatio: number = -1;

  private logs: LogEntry[] = [];
  private maxLogs: number = 20;

  constructor(
    containerId: string = 'dom-ui-layer',
    callbacksOrSelect?: ((index: number) => void) | DOMUICallbacks,
    onCastMagic?: () => void
  ) {
    if (typeof document === 'undefined') return;

    if (typeof callbacksOrSelect === 'function') {
      this.callbacks.onSelectMagic = callbacksOrSelect;
      this.callbacks.onCastMagic = onCastMagic;
    } else if (callbacksOrSelect) {
      this.callbacks = { ...callbacksOrSelect };
    }

    let target = document.getElementById(containerId);
    if (!target) {
      target = document.createElement('div');
      target.id = containerId;
      document.body.appendChild(target);
    }
    this.container = target;
    this.buildTopBar();
    this.buildTemplate();
    this.bindElements();
  }

  private buildTopBar(): void {
    let topBar = document.getElementById('game-top-bar');
    if (!topBar) {
      topBar = document.createElement('header');
      topBar.id = 'game-top-bar';
      topBar.className = 'game-top-bar';
      const app = document.getElementById('app');
      if (app && app.firstChild) {
        app.insertBefore(topBar, app.firstChild);
      } else if (app) {
        app.appendChild(topBar);
      } else {
        document.body.insertBefore(topBar, document.body.firstChild);
      }
    }

    topBar.innerHTML = `
      <div class="top-bar-branding">
        <span class="game-title-logo">DS1<span class="brand-accent">ish</span></span>
      </div>
      <div class="top-bar-controls">
        <div class="top-bar-btn-group">
          <button class="hud-action-btn autoplay-toggle-btn" id="dom-autoplay-toggle-btn" title="自動自走 ⇔ 手動操作のシームレス切替 [Tab] / [P]" style="background: #263238; color: #b0bec5; border: 1px solid #455a64;">🤖 AUTO: OFF</button>
          <button class="hud-action-btn marker-toggle-btn active" id="dom-marker-btn" title="敵相対マーカー切替 [T]">🎯 TACTICAL</button>
          <button class="hud-action-btn inspect-btn" id="dom-inspect-btn" title="マップ構造＆成長パラメータインスペクタ [I]">📊 INSPECT</button>
        </div>
        <div class="top-bar-divider"></div>
        <div class="top-bar-btn-group">
          <button class="hud-action-btn preset-save-btn" id="dom-save-preset-btn" title="現在のシードと設定をプリセット保存">★ マップ保存</button>
          <button class="hud-action-btn save-btn" id="dom-savequit-btn" title="進行状況を保存して中断">💾 セーブ中断</button>
        </div>
        <div class="top-bar-divider"></div>
        <div class="top-bar-btn-group">
          <button class="sound-toggle-btn" id="dom-sound-btn" title="サウンド切り替え">🔊 SOUND: ON</button>
          <button class="hud-action-btn giveup-btn" id="dom-giveup-btn" title="探索を断念してギブアップ [Q]">🏳️ GIVE UP</button>
        </div>
      </div>
    `;
  }

  private buildTemplate(): void {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="dom-hud-container">
        <!-- デモ・チュートリアル＆自走検証オーバーレイ -->
        <div id="dom-demo-overlay" class="hidden" style="position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 99999; background: rgba(5, 15, 30, 0.94); border: 2px solid #ffca28; border-radius: 8px; padding: 10px 24px; color: #fff; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.85); max-width: 90%; min-width: 340px;">
          <div id="dom-demo-title" style="font-size: 11px; color: #ffca28; font-weight: bold; margin-bottom: 4px; letter-spacing: 1px;">🎬 DEMO PLAYING（クリックまたは任意のキーでタイトルへ復帰）</div>
          <div id="dom-demo-tip" style="font-size: 14px; font-weight: bold; color: #ffffff; text-shadow: 0 0 8px rgba(255,202,40,0.8);">チュートリアルメッセージ</div>
          
          <!-- 自走検証用コントロールバー (自走検証時のみ表示) -->
          <div id="dom-autoplay-controls" class="hidden" style="display: flex; gap: 8px; justify-content: center; align-items: center; margin-top: 8px; flex-wrap: wrap; border-top: 1px solid rgba(255, 202, 40, 0.3); padding-top: 8px;">
            <div style="display: flex; gap: 4px; align-items: center;">
              <span style="font-size: 10px; color: #aaa; margin-right: 2px;">速度:</span>
              <button id="dom-autoplay-spd-1" class="autoplay-spd-btn active" style="background: #2e7d32; color: #fff; border: 1px solid #81c784; padding: 2px 8px; font-size: 11px; border-radius: 3px; cursor: pointer; font-weight: bold;">1x 標準</button>
              <button id="dom-autoplay-spd-2" class="autoplay-spd-btn" style="background: #263238; color: #ccc; border: 1px solid #546e7a; padding: 2px 8px; font-size: 11px; border-radius: 3px; cursor: pointer;">2x 倍速</button>
              <button id="dom-autoplay-spd-5" class="autoplay-spd-btn" style="background: #263238; color: #ccc; border: 1px solid #546e7a; padding: 2px 8px; font-size: 11px; border-radius: 3px; cursor: pointer;">5x 高速</button>
              <button id="dom-autoplay-spd-0" class="autoplay-spd-btn" style="background: #263238; color: #ccc; border: 1px solid #546e7a; padding: 2px 8px; font-size: 11px; border-radius: 3px; cursor: pointer;">⏸ 一時停止</button>
            </div>
            <button id="dom-autoplay-takeover-btn" style="background: linear-gradient(180deg, #1565c0 0%, #0d47a1 100%); color: #fff; border: 1px solid #64b5f6; padding: 3px 10px; font-size: 11px; font-weight: bold; border-radius: 3px; cursor: pointer;">⚔ 手動操作に切替 [ENTER / Tab]</button>
            <button id="dom-autoplay-exit-btn" style="background: #3e1b24; color: #ef9a9a; border: 1px solid #c62828; padding: 3px 8px; font-size: 11px; border-radius: 3px; cursor: pointer;">🚪 終了 [ESC]</button>
          </div>
        </div>

        <!-- 上部・横並びステータスバー -->
        <div class="hud-panel status-panel">
          <div class="panel-header">
            <span class="panel-title">HERO STATUS</span>
            <span class="panel-hotkey-guide">PLAYER ATTRIBUTES</span>
          </div>

          <div class="stats-grid">
            <div class="stat-box hp-box" id="dom-stat-hp-box">
              <span class="stat-label">HITPOINTS</span>
              <span class="stat-value" id="dom-stat-hp">1000</span>
            </div>
            <div class="stat-box">
              <span class="stat-label">STRENGTH</span>
              <span class="stat-value" id="dom-stat-str">10</span>
            </div>
            <div class="stat-box">
              <span class="stat-label">EXPERIENCE</span>
              <span class="stat-value" id="dom-stat-exp">1000</span>
            </div>
            <div class="stat-box">
              <span class="stat-label">GOLD</span>
              <span class="stat-value" id="dom-stat-gold">0</span>
            </div>
            <div class="stat-box magic-stock-box">
              <span class="stat-label">MAGIC</span>
              <span class="stat-value" id="dom-stat-magic">0</span>
            </div>
            <div class="stat-box crown-box">
              <span class="stat-label">CROWNS</span>
              <span class="stat-value" id="dom-stat-crown">0 / 4</span>
            </div>
          </div>
        </div>

        <!-- インジケーター (ターン制限タイムバー) -->
        <div class="hud-panel indicator-panel">
          <div class="indicator-header">
            <span class="indicator-label">STEP TIME LIMIT (TURN INDICATOR)</span>
            <span class="indicator-hint">Space: Take / Drop / Wait</span>
          </div>
          <div class="indicator-gauge-track">
            <div class="indicator-gauge-bar" id="dom-indicator-fill"></div>
          </div>
        </div>

        <!-- 対峙モンスター情報パネル (TARGET ENEMY) -->
        <div class="hud-panel target-enemy-panel" id="dom-target-panel">
          <div class="panel-header">
            <span class="panel-title">TARGET ENEMY (対峙モンスター)</span>
            <span class="target-status-tag no-target" id="dom-target-status-tag">NO TARGET</span>
          </div>
          <div class="target-body" id="dom-target-body">
            <div class="no-target-msg">敵と接触するとリアルタイムでステータスが表示されます</div>
          </div>
        </div>

        <!-- 魔法スペルパネル -->
        <div class="hud-panel magic-panel">
          <div class="panel-header">
            <span class="panel-title">LEARNED SPELLS</span>
            <span class="panel-hotkey-guide">Select: [M] or [1-9] / Cast: [X] or [Enter]</span>
          </div>
          <div class="magic-restriction-banner hidden" id="dom-magic-curse-banner" style="display: none;"></div>
          <div class="magic-cards-container" id="dom-magic-list"></div>
          <div class="selected-magic-desc-box" id="dom-magic-desc-box" style="display: none;"></div>
          <button class="cast-action-btn" id="dom-cast-btn">
            ⚡ CAST SELECTED SPELL [X]
          </button>
        </div>

        <!-- リアルタイム・ログストリーム -->
        <div class="hud-panel log-panel">
          <div class="panel-header">
            <span class="panel-title">TACTICAL ACTION LOG</span>
          </div>
          <div class="log-entries-feed" id="dom-log-stream"></div>
        </div>
      </div>

      <!-- 1. メインタイトルモーダルオーバーレイ (スリム化・シンプル構成) -->
      <div class="game-modal-overlay" id="dom-title-modal">
        <div class="modal-content-box title-modal-box">
          <h1 class="title-logo">⚔ DS1ish ⚔</h1>
          <div class="title-subver">A Retro & Modern Dragon Slayer-like Action-Puzzle RPG</div>
          <div class="title-intro">
            <p><strong>【使命】</strong> ダンジョン奥地に潜む3首のドラゴンを討伐し、出現する4つの王冠（CROWN）を我が家へ持ち帰れ！</p>
            <p style="margin-top: 6px;"><strong>【基本操作】</strong><br>
            ・移動: 矢印キー / WASD / テンキー (斜め移動解放時は8方向)<br>
            ・SPACE: 足元アイテムの取得・交換・ドロップ・宝箱解錠 / 待機<br>
            ・M または 1〜9: 魔法選択 / X または Enter: 魔法発動<br>
            ・T: 敵相対マーカー切替 (TACTICAL / RETRO)<br>
            ・Q: ギブアップ / 💾: 中断セーブ<br>
            ・指輪（RING）所持で岩・我が家を押して移動可能</p>
          </div>
          <div class="title-btn-group">
            <button class="action-btn-large" id="dom-start-btn">⚔ START GAME (標準ダンジョン開始) [SPACE / CLICK] ⚔</button>
            <button class="action-btn-large continue-btn hidden" id="dom-continue-btn">
              ▶ CONTINUE [C] <span class="continue-summary" id="dom-continue-summary"></span>
            </button>
            <button class="action-btn-large" id="dom-demo-btn" style="background: linear-gradient(180deg, #1565c0 0%, #0d47a1 100%); border-color: #42a5f5; color: #fff; margin-top: 6px;">🎬 DEMO / チュートリアル [D]</button>
            <button class="action-btn-large" id="dom-open-custom-btn" style="background: linear-gradient(180deg, #4527a0 0%, #311b92 100%); border-color: #9575cd; color: #ede7f6; margin-top: 6px;">
              ⚙️ STAGE SELECT & CUSTOM (面の調整・プリセット・自走検証)
            </button>
          </div>
        </div>
      </div>

      <!-- 1.5. ステージ調整・選択メニューモーダル (カスタム・プリセット・自走検証) -->
      <div class="game-modal-overlay hidden" id="dom-custom-modal">
        <div class="modal-content-box custom-modal-box" style="max-width: 680px; width: 92%; max-height: 90vh; overflow-y: auto; border: 2px solid #7e57c2; box-shadow: 0 0 40px rgba(126, 87, 194, 0.4);">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #5e35b1; padding-bottom: 10px; margin-bottom: 14px;">
            <div>
              <h2 style="margin: 0; font-size: 18px; color: #d1c4e9; display: flex; align-items: center; gap: 8px;">⚙️ STAGE SELECT & CUSTOM TUNING</h2>
              <div style="font-size: 11px; color: #9fa8da; margin-top: 2px;">タイプを選んで画面下の代表ボタンから開始（手動プレイ or 自動自走検証）</div>
            </div>
            <button class="action-btn-secondary" id="dom-custom-back-btn" style="background: #281a4b; color: #d1c4e9; border: 1px solid #7e57c2; padding: 6px 14px; font-size: 12px; border-radius: 4px; cursor: pointer; font-weight: bold;">← タイトルへ戻る</button>
          </div>

          <!-- タイプ選択バー (セグメントタブUI) -->
          <div style="background: rgba(10, 16, 28, 0.95); border: 1px solid #2a3a52; border-radius: 8px; padding: 6px; margin-bottom: 14px; box-shadow: inset 0 2px 6px rgba(0,0,0,0.6);">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 6px;" id="dom-custom-type-group">
              <label class="custom-tab-item active" id="dom-tab-quick">
                <input type="radio" name="custom-mode-type" value="QUICK" checked id="dom-type-radio-quick" style="display: none;" />
                <span>🎲 クイック設定</span>
              </label>
              <label class="custom-tab-item" id="dom-tab-preset">
                <input type="radio" name="custom-mode-type" value="PRESET" id="dom-type-radio-preset" style="display: none;" />
                <span>🗺️ プリセット</span>
              </label>
              <label class="custom-tab-item" id="dom-tab-share">
                <input type="radio" name="custom-mode-type" value="SHARE_CODE" id="dom-type-radio-share" style="display: none;" />
                <span>📋 共有コード</span>
              </label>
              <label class="custom-tab-item" id="dom-tab-debug">
                <input type="radio" name="custom-mode-type" value="DEBUG" id="dom-type-radio-debug" style="display: none;" />
                <span>🛠️ 詳細設定</span>
              </label>
            </div>
          </div>

          <!-- ① クイックダンジョン設定パネル -->
          <div id="dom-panel-quick" class="custom-type-panel" style="background: rgba(0, 20, 40, 0.7); border: 1px solid #1a5b8e; border-radius: 4px; padding: 12px; margin-bottom: 12px; text-align: left;">
            <div style="font-weight: bold; color: #4dd0e1; margin-bottom: 8px; font-size: 13px;">🎲 QUICK DUNGEON PRESET (クイックダンジョン設定)</div>
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
            </div>
          </div>

          <!-- ② マッププリセットパネル -->
          <div id="dom-panel-preset" class="custom-type-panel hidden" style="background: rgba(20, 10, 40, 0.75); border: 1px solid #7e57c2; border-radius: 4px; padding: 12px; margin-bottom: 12px; text-align: left;">
            <div style="font-weight: bold; color: #b39ddb; margin-bottom: 8px; font-size: 13px;">🗺️ MAP PRESETS (保存済み＆公式プリセット)</div>
            <div style="display: flex; gap: 6px; align-items: center;">
              <select id="dom-preset-select" style="flex: 1; background: #120a26; color: #eee; border: 1px solid #5e35b1; padding: 6px; border-radius: 3px; font-size: 12px;"></select>
              <button id="dom-preset-share-btn" style="background: #281a4b; color: #b39ddb; border: 1px solid #7e57c2; padding: 6px 12px; font-size: 11px; border-radius: 3px; cursor: pointer;" title="クリップボードへ共有コードをコピー">📋 共有</button>
              <button id="dom-preset-delete-btn" style="background: #3e1b24; color: #ef9a9a; border: 1px solid #c62828; padding: 6px 10px; font-size: 11px; border-radius: 3px; cursor: pointer;" title="選択したユーザープリセットを削除">🗑️</button>
            </div>
          </div>

          <!-- ③ 共有コードパネル -->
          <div id="dom-panel-share" class="custom-type-panel hidden" style="background: rgba(30, 15, 45, 0.75); border: 1px solid #9c27b0; border-radius: 4px; padding: 12px; margin-bottom: 12px; text-align: left;">
            <div style="font-weight: bold; color: #e1bee7; margin-bottom: 8px; font-size: 13px;">📋 SHARE CODE (共有コード入力)</div>
            <div style="display: flex; gap: 6px; align-items: center;">
              <input type="text" id="dom-share-code-input" placeholder="共有コード (DS1MAP:...) を貼り付けてください" style="flex: 1; background: #120a26; color: #eee; border: 1px solid #8e24aa; padding: 6px; border-radius: 3px; font-size: 11px;" />
            </div>
          </div>

          <!-- ④ マニュアル・詳細パラメータパネル -->
          <div id="dom-panel-debug" class="custom-type-panel hidden" style="background: rgba(5, 15, 30, 0.95); border: 1px solid #3b7ca8; border-radius: 4px; padding: 12px; margin-bottom: 12px; text-align: left;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <div style="font-weight: bold; color: #ffb74d; font-size: 13px;">⚙️ MANUAL & DEBUG GENERATOR (詳細パラメータ設定)</div>
              <button id="dom-debug-preview-btn" style="background: #263238; color: #80cbc4; border: 1px solid #009688; padding: 4px 10px; font-size: 11px; border-radius: 3px; cursor: pointer;">
                🔍 診断プレビュー
              </button>
            </div>
            
            <!-- Seed設定 -->
            <div style="margin-bottom: 8px;">
              <label style="font-size: 11px; color: #ccc;">シード値 (Seed):</label>
              <div style="display: flex; gap: 4px;">
                <input type="number" id="dom-debug-seed" placeholder="空欄でランダム生成" style="flex: 1; background: #081420; color: #fff; border: 1px solid #336699; padding: 4px; font-size: 11px;" />
                <button id="dom-debug-rand-seed-btn" style="background: #1a4b6e; color: #eee; border: 1px solid #4dd0e1; font-size: 11px; padding: 2px 10px; cursor: pointer;">🎲 乱数</button>
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
                  <option value="CLASSIC_FIXED">🔧 TESTBED (開発・テスト用静的マップ)</option>
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

            <!-- 診断レポートプレビュー表示枠 -->
            <div id="dom-debug-report-box" class="hidden" style="background: rgba(0, 0, 0, 0.6); border: 1px solid #444; border-radius: 3px; padding: 6px; font-size: 10px; font-family: monospace; color: #a5d6a7; max-height: 120px; overflow-y: auto;"></div>
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

      <!-- 2. ゲームオーバーモーダルオーバーレイ -->
      <div class="game-modal-overlay hidden" id="dom-gameover-modal">
        <div class="modal-content-box gameover-modal-box">
          <h1 class="gameover-title">☠ GAME OVER ☠</h1>
          <div class="gameover-cause-card" id="dom-gameover-cause-card">
            <div class="gameover-avatar-wrap">
              <canvas id="dom-gameover-avatar-canvas" width="64" height="64" class="gameover-avatar-canvas"></canvas>
            </div>
            <div class="gameover-cause-details">
              <div class="gameover-cause-label">💀 CAUSE OF DEATH (致命傷)</div>
              <div class="gameover-cause-message" id="dom-gameover-cause-msg">力尽き、ダンジョンの闇に呑まれた…</div>
            </div>
          </div>
          <div class="gameover-stats" id="dom-gameover-stats"></div>
          <button class="action-btn-large retry-btn" id="dom-retry-btn">🔄 RETRY GAME [R / CLICK]</button>
          <button class="action-btn-secondary" id="dom-gameover-save-preset-btn" style="margin-top: 8px; width: 100%; border: 1px solid #7e57c2; background: #261642; color: #d1c4e9; padding: 8px; font-size: 12px; cursor: pointer;">★ このマップ（シードと設定）をプリセット保存</button>
        </div>
      </div>

      <!-- 3. クリアモーダルオーバーレイ -->
      <div class="clear-modal-overlay hidden" id="dom-clear-modal">
        <div class="clear-modal-content">
          <h1 class="clear-title">★ STAGE CLEAR ★</h1>
          <p class="clear-subtitle">ドラゴンの4つの王冠をすべて我が家へ持ち帰りました！</p>
          <div class="clear-crowns-display">👑 👑 👑 👑</div>
          <p class="clear-message">Congratulation on defeating the 3-headed Dragon!</p>
          <button class="action-btn-large" id="dom-replay-btn" style="margin-top: 24px;">👑 REPLAY STAGE</button>
          <button class="action-btn-secondary" id="dom-clear-save-preset-btn" style="margin-top: 8px; width: 100%; border: 1px solid #ffd54f; background: #3e2723; color: #ffe082; padding: 8px; font-size: 12px; cursor: pointer;">★ このマップ（シードと設定）をプリセット保存</button>
        </div>
      </div>

      <!-- 4. ギブアップ確認ダイアログオーバーレイ -->
      <div class="game-modal-overlay hidden" id="dom-giveup-modal">
        <div class="modal-content-box giveup-modal-box">
          <h2 class="giveup-title">🏳️ GIVE UP (探索断念) 🏳️</h2>
          <p class="giveup-desc">探索を断念してギブアップしますか？<br><span class="giveup-subtext">※現在の冒険はゲームオーバーとなり、リザルト画面が表示されます。</span></p>
          <div class="giveup-btn-group">
            <button class="action-btn-danger" id="dom-giveup-confirm-btn">💀 諦める [Y]</button>
            <button class="action-btn-cancel" id="dom-giveup-cancel-btn">🛡️ 続ける [N / ESC]</button>
          </div>
        </div>
      </div>
    `;
  }

  private bindElements(): void {
    if (!this.container) return;

    this.statHpEl = this.container.querySelector('#dom-stat-hp');
    this.statStrEl = this.container.querySelector('#dom-stat-str');
    this.statExpEl = this.container.querySelector('#dom-stat-exp');
    this.statGoldEl = this.container.querySelector('#dom-stat-gold');
    this.statMagicEl = this.container.querySelector('#dom-stat-magic');
    this.statCrownEl = this.container.querySelector('#dom-stat-crown');
    this.badgeItemEl = document.getElementById('dom-badge-item') ?? this.container.querySelector('#dom-badge-item');
    this.badgeSwordEl = document.getElementById('dom-badge-sword') ?? this.container.querySelector('#dom-badge-sword');
    this.specialStatusEl = document.getElementById('dom-special-status') ?? this.container.querySelector('#dom-special-status');
    this.indicatorFillEl = this.container.querySelector('#dom-indicator-fill');
    this.magicCurseBannerEl = this.container.querySelector('#dom-magic-curse-banner');
    this.magicListEl = this.container.querySelector('#dom-magic-list');
    this.magicDescBoxEl = this.container.querySelector('#dom-magic-desc-box');
    this.castBtnEl = this.container.querySelector('#dom-cast-btn');
    this.logStreamEl = this.container.querySelector('#dom-log-stream');
    this.targetPanelEl = this.container.querySelector('#dom-target-panel');
    this.targetStatusTagEl = this.container.querySelector('#dom-target-status-tag');
    this.targetBodyEl = this.container.querySelector('#dom-target-body');

    this.markerBtnEl = (document.getElementById('dom-marker-btn') ?? this.container.querySelector('#dom-marker-btn')) as HTMLButtonElement | null;
    this.soundBtnEl = (document.getElementById('dom-sound-btn') ?? this.container.querySelector('#dom-sound-btn')) as HTMLButtonElement | null;
    this.giveupBtnEl = (document.getElementById('dom-giveup-btn') ?? this.container.querySelector('#dom-giveup-btn')) as HTMLButtonElement | null;
    this.saveQuitBtnEl = (document.getElementById('dom-savequit-btn') ?? this.container.querySelector('#dom-savequit-btn')) as HTMLButtonElement | null;
    this.inspectBtnEl = (document.getElementById('dom-inspect-btn') ?? this.container.querySelector('#dom-inspect-btn')) as HTMLButtonElement | null;
    this.inspectorModal = new InspectorModal();
    this.titleModalEl = this.container.querySelector('#dom-title-modal');
    this.gameoverModalEl = this.container.querySelector('#dom-gameover-modal');
    this.gameoverStatsEl = this.container.querySelector('#dom-gameover-stats');
    this.gameoverCauseMsgEl = this.container.querySelector('#dom-gameover-cause-msg');
    this.gameoverAvatarCanvasEl = this.container.querySelector('#dom-gameover-avatar-canvas');
    this.clearModalEl = this.container.querySelector('#dom-clear-modal');
    this.startBtnEl = this.container.querySelector('#dom-start-btn');
    this.proceduralBtnEl = this.container.querySelector('#dom-procedural-btn');
    this.continueBtnEl = this.container.querySelector('#dom-continue-btn');
    this.continueSummaryEl = this.container.querySelector('#dom-continue-summary');
    this.retryBtnEl = this.container.querySelector('#dom-retry-btn');
    this.replayBtnEl = this.container.querySelector('#dom-replay-btn');
    this.giveupModalEl = this.container.querySelector('#dom-giveup-modal');
    this.giveupConfirmBtnEl = this.container.querySelector('#dom-giveup-confirm-btn');
    this.giveupCancelBtnEl = this.container.querySelector('#dom-giveup-cancel-btn');
    this.demoBtnEl = this.container.querySelector('#dom-demo-btn');
    this.demoOverlayEl = this.container.querySelector('#dom-demo-overlay');
    this.demoTitleEl = this.container.querySelector('#dom-demo-title');
    this.demoTipEl = this.container.querySelector('#dom-demo-tip');
    this.customModalEl = this.container.querySelector('#dom-custom-modal');
    this.openCustomBtnEl = this.container.querySelector('#dom-open-custom-btn');
    this.customBackBtnEl = this.container.querySelector('#dom-custom-back-btn');
    this.autoplayControlsEl = this.container.querySelector('#dom-autoplay-controls');
    this.autoplayToggleBtnEl = (document.getElementById('dom-autoplay-toggle-btn') ?? this.container.querySelector('#dom-autoplay-toggle-btn')) as HTMLButtonElement | null;
    this.autoplayTakeoverBtnEl = this.container.querySelector('#dom-autoplay-takeover-btn');
    this.autoplayExitBtnEl = this.container.querySelector('#dom-autoplay-exit-btn');
    this.autoplaySpeedBtns[1] = this.container.querySelector('#dom-autoplay-spd-1');
    this.autoplaySpeedBtns[2] = this.container.querySelector('#dom-autoplay-spd-2');
    this.autoplaySpeedBtns[5] = this.container.querySelector('#dom-autoplay-spd-5');
    this.autoplaySpeedBtns[0] = this.container.querySelector('#dom-autoplay-spd-0');

    // イベントリスナーのバインド
    if (this.castBtnEl) {
      this.castBtnEl.addEventListener('click', () => {
        if (this.callbacks.onCastMagic) this.callbacks.onCastMagic();
      });
    }

    if (this.markerBtnEl) {
      this.markerBtnEl.addEventListener('click', () => {
        if (this.callbacks.onToggleMarker) this.callbacks.onToggleMarker();
      });
    }

    if (this.inspectBtnEl) {
      this.inspectBtnEl.addEventListener('click', () => {
        if (this.callbacks.onToggleInspect) this.callbacks.onToggleInspect();
      });
    }

    if (this.soundBtnEl) {
      this.soundBtnEl.addEventListener('click', () => {
        if (this.callbacks.onToggleSound) this.callbacks.onToggleSound();
      });
    }

    if (this.giveupBtnEl) {
      this.giveupBtnEl.addEventListener('click', () => {
        if (this.callbacks.onGiveUp) this.callbacks.onGiveUp();
      });
    }

    if (this.saveQuitBtnEl) {
      this.saveQuitBtnEl.addEventListener('click', () => {
        if (this.callbacks.onSaveAndQuit) this.callbacks.onSaveAndQuit();
      });
    }

    // メインタイトル: 標準設定でダンジョン開始
    if (this.startBtnEl) {
      this.startBtnEl.addEventListener('click', () => {
        if (this.callbacks.onStartProceduralGame) {
          const options: ProceduralMapOptions = {
            topology: 'MULTI_SECTOR',
            difficulty: 'NORMAL',
            pacing: 'STANDARD',
            archetype: 'BALANCED',
          };
          this.callbacks.onStartProceduralGame(options);
        } else if (this.callbacks.onStartGame) {
          this.callbacks.onStartGame();
        }
      });
    }

    // メインタイトル: カスタムモーダルを開く
    if (this.openCustomBtnEl) {
      this.openCustomBtnEl.addEventListener('click', () => {
        this.openCustomModal();
      });
    }

    // カスタムモーダル: タイトルへ戻る
    if (this.customBackBtnEl) {
      this.customBackBtnEl.addEventListener('click', () => {
        this.closeCustomModal();
      });
    }
    const customBottomBackBtn = this.container.querySelector('#dom-custom-bottom-back-btn');
    if (customBottomBackBtn) {
      customBottomBackBtn.addEventListener('click', () => {
        this.closeCustomModal();
      });
    }

    if (this.demoBtnEl) {
      this.demoBtnEl.addEventListener('click', () => {
        if (this.callbacks.onStartDemo) {
          this.callbacks.onStartDemo();
        }
      });
    }

    // デモ再生中に画面をクリックした場合にタイトル復帰 (自走検証中はボタン操作を許容するため終了させない)
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', () => {
        if (this.isAutoPlayMode) return; // 自走検証モード中は画面クリックでの強制中断をスキップ
        // デモオーバーレイ表示中なら即座にデモ終了通知
        if (this.callbacks.onExitDemo && this.demoOverlayEl && !this.demoOverlayEl.classList.contains('hidden')) {
          this.callbacks.onExitDemo();
        }
      });
    }

    // 自走検証用コントロールバーのリスナー
    [1, 2, 5, 0].forEach((spd) => {
      const btn = this.autoplaySpeedBtns[spd];
      if (btn) {
        btn.addEventListener('click', () => {
          this.updateAutoPlaySpeedUI(spd);
          if (this.callbacks.onChangeAutoPlaySpeed) {
            this.callbacks.onChangeAutoPlaySpeed(spd);
          }
        });
      }
    });

    if (this.autoplayToggleBtnEl) {
      this.autoplayToggleBtnEl.addEventListener('click', () => {
        if (this.callbacks.onToggleAutoPlay) {
          this.callbacks.onToggleAutoPlay();
        }
      });
    }

    if (this.autoplayTakeoverBtnEl) {
      this.autoplayTakeoverBtnEl.addEventListener('click', () => {
        if (this.callbacks.onTakeoverAutoPlay) {
          this.callbacks.onTakeoverAutoPlay();
        }
      });
    }

    if (this.autoplayExitBtnEl) {
      this.autoplayExitBtnEl.addEventListener('click', () => {
        if (this.callbacks.onExitAutoPlayVerify) {
          this.callbacks.onExitAutoPlayVerify();
        }
      });
    }

    // デバッグパネル開閉トグル
    const debugToggleBtn = this.container?.querySelector('#dom-debug-toggle-btn') as HTMLElement | null;
    const debugPanel = this.container?.querySelector('#dom-debug-panel') as HTMLElement | null;
    if (debugToggleBtn && debugPanel) {
      debugToggleBtn.addEventListener('click', () => {
        debugPanel.classList.toggle('hidden');
        const isHidden = debugPanel.classList.contains('hidden');
        debugToggleBtn.textContent = isHidden
          ? '🛠️ ADVANCED DEBUG & CUSTOM GENERATOR (詳細パラメータ設定) ▼'
          : '🛠️ ADVANCED DEBUG & CUSTOM GENERATOR (詳細パラメータ設定) ▲';
      });
    }

    // ランダムシード生成ボタン
    const randSeedBtn = this.container?.querySelector('#dom-debug-rand-seed-btn') as HTMLElement | null;
    const seedInput = this.container?.querySelector('#dom-debug-seed') as HTMLInputElement | null;
    if (randSeedBtn && seedInput) {
      randSeedBtn.addEventListener('click', () => {
        seedInput.value = String(Math.floor(Math.random() * 900000) + 100000);
      });
    }

    // 診断プレビューボタン
    const previewBtn = this.container?.querySelector('#dom-debug-preview-btn') as HTMLElement | null;
    const reportBox = this.container?.querySelector('#dom-debug-report-box') as HTMLElement | null;
    if (previewBtn && reportBox) {
      previewBtn.addEventListener('click', () => {
        const topoSelect = this.container?.querySelector('#dom-debug-topology') as HTMLSelectElement | null;
        const diffSelect = this.container?.querySelector('#dom-debug-diff') as HTMLSelectElement | null;
        const paceSelect = this.container?.querySelector('#dom-debug-pacing') as HTMLSelectElement | null;
        const archSelect = this.container?.querySelector('#dom-debug-archetype') as HTMLSelectElement | null;
        const chestsInput = this.container?.querySelector('#dom-debug-chests') as HTMLInputElement | null;
        const gravesInput = this.container?.querySelector('#dom-debug-graves') as HTMLInputElement | null;
        const enemyAtkInput = this.container?.querySelector('#dom-debug-enemy-atk') as HTMLInputElement | null;
        const dragonDefInput = this.container?.querySelector('#dom-debug-dragon-def') as HTMLInputElement | null;

        const topo = (topoSelect?.value as DungeonTopology) ?? 'MULTI_SECTOR';
        const diff = (diffSelect?.value as MapDifficulty) ?? 'NORMAL';
        const pace = (paceSelect?.value as PlayPacingMode) ?? 'STANDARD';
        const arch = (archSelect?.value as DungeonArchetype) ?? 'BALANCED';
        const seedVal = seedInput?.value ? parseInt(seedInput.value, 10) : 123456;
        const chestsVal = chestsInput?.value ? parseInt(chestsInput.value, 10) : 100;
        const gravesVal = gravesInput?.value ? parseInt(gravesInput.value, 10) : 20;
        const enemyAtk = enemyAtkInput?.value ? parseFloat(enemyAtkInput.value) : 1.0;
        const dragonDef = dragonDefInput?.value ? parseFloat(dragonDefInput.value) : 1.0;

        reportBox.classList.remove('hidden');
        if (topo === 'CLASSIC_FIXED') {
          const map = new WorldMap(64, 64);
          const report = ProceduralMapGenerator.validateSolvability(map);
          reportBox.innerHTML = `
            <div style="color: #64b5f6; font-weight: bold;">[TESTBED MAP REPORT]</div>
            <div>Solvable: <strong style="color: ${report.isSolvable ? '#81c784' : '#e57373'}">${report.isSolvable ? 'PASS (クリア可能)' : 'FAIL'}</strong></div>
            <div>宝箱: ${report.counts.chests}個 | 墓: ${report.counts.graves}基 (開口: ${report.counts.openGraves})</div>
            <div>想定到達STR: ${report.estimatedMaxStr.toLocaleString()}</div>
          `;
        } else {
          const map = new WorldMap(64, 64);
          const options: ProceduralMapOptions = {
            seed: seedVal,
            topology: topo,
            difficulty: diff,
            pacing: pace,
            archetype: arch,
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
          reportBox.innerHTML = `
            <div style="color: #ffd54f; font-weight: bold;">[PROCEDURAL SOLVABILITY REPORT]</div>
            <div>Seed: ${report.seed} | Topo: ${topo} | Diff: ${diff} | Arch: ${arch}</div>
            <div>Solvable: <strong style="color: ${report.isSolvable ? '#81c784' : '#e57373'}">${report.isSolvable ? 'PASS (クリア可能)' : 'FAIL'}</strong></div>
            <div>宝箱: ${report.counts.chests}個 | 墓: ${report.counts.graves}基 (開口: ${report.counts.openGraves})</div>
            <div>重複ゼロ: ${report.hasZeroOverlaps ? 'OK' : 'FAIL'} | 内部壁BLOCK化: ${report.internalWallsAreBlocks ? 'OK' : 'FAIL'}</div>
            <div>想定到達STR: ${report.estimatedMaxStr.toLocaleString()} (中首突破基準)</div>
            ${report.issues.length > 0 ? `<div style="color: #e57373;">Issue: ${report.issues.join('<br>')}</div>` : ''}
          `;
        }
      });
    }

    // 設定タイプ切り替え（セグメントタブUI連動）
    const typeRadios = this.container?.querySelectorAll('input[name="custom-mode-type"]');
    const tabQuick = this.container?.querySelector('#dom-tab-quick') as HTMLElement | null;
    const tabPreset = this.container?.querySelector('#dom-tab-preset') as HTMLElement | null;
    const tabShare = this.container?.querySelector('#dom-tab-share') as HTMLElement | null;
    const tabDebug = this.container?.querySelector('#dom-tab-debug') as HTMLElement | null;
    const panelQuick = this.container?.querySelector('#dom-panel-quick') as HTMLElement | null;
    const panelPreset = this.container?.querySelector('#dom-panel-preset') as HTMLElement | null;
    const panelShare = this.container?.querySelector('#dom-panel-share') as HTMLElement | null;
    const panelDebug = this.container?.querySelector('#dom-panel-debug') as HTMLElement | null;
    const actionHint = this.container?.querySelector('#dom-custom-action-hint') as HTMLElement | null;

    const updateSelectedTypePanel = (val: string) => {
      // 全タブのアクティブ状態リセット
      tabQuick?.classList.remove('active');
      tabPreset?.classList.remove('active');
      tabShare?.classList.remove('active');
      tabDebug?.classList.remove('active');

      // 全パネルを非表示
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

    // タブラベル自体の直接クリック対応
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
          const options: ProceduralMapOptions = {
            topology: (topoSelect?.value as DungeonTopology) ?? 'MULTI_SECTOR',
            difficulty: (diffSelect?.value as MapDifficulty) ?? 'NORMAL',
            pacing: (paceSelect?.value as PlayPacingMode) ?? 'STANDARD',
            archetype: (archSelect?.value as DungeonArchetype) ?? 'BALANCED',
          };
          this.closeCustomModal();
          this.callbacks.onStartProceduralGame(options);
        }
      } else if (type === 'PRESET') {
        const presetSelect = this.container?.querySelector('#dom-preset-select') as HTMLSelectElement | null;
        const presets = MapPresetManager.getAllPresets();
        const selected = presets.find(p => p.id === presetSelect?.value);
        if (selected && this.callbacks.onStartPresetGame) {
          this.closeCustomModal();
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
          this.closeCustomModal();
          this.callbacks.onStartPresetGame(imported);
        }
      } else if (type === 'DEBUG') {
        if (this.callbacks.onStartProceduralGame) {
          const topoSelect = this.container?.querySelector('#dom-debug-topology') as HTMLSelectElement | null;
          const diffSelect = this.container?.querySelector('#dom-debug-diff') as HTMLSelectElement | null;
          const paceSelect = this.container?.querySelector('#dom-debug-pacing') as HTMLSelectElement | null;
          const archSelect = this.container?.querySelector('#dom-debug-archetype') as HTMLSelectElement | null;
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
            chestCount: chestsInput?.value ? parseInt(chestsInput.value, 10) : undefined,
            graveCount: gravesInput?.value ? parseInt(gravesInput.value, 10) : undefined,
            tuningParams: (enemyAtkInput?.value || dragonDefInput?.value) ? {
              progressionConfig: {
                enemyAtkRatio: enemyAtkInput?.value ? parseFloat(enemyAtkInput.value) : undefined,
                dragonDefRatio: dragonDefInput?.value ? parseFloat(dragonDefInput.value) : undefined,
              },
            } : undefined,
          };
          this.closeCustomModal();
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
          const options: ProceduralMapOptions = {
            topology: (topoSelect?.value as DungeonTopology) ?? 'MULTI_SECTOR',
            difficulty: (diffSelect?.value as MapDifficulty) ?? 'NORMAL',
            pacing: (paceSelect?.value as PlayPacingMode) ?? 'STANDARD',
            archetype: (archSelect?.value as DungeonArchetype) ?? 'BALANCED',
          };
          this.closeCustomModal();
          this.callbacks.onStartAutoPlayVerify(options);
        }
      } else if (type === 'PRESET') {
        const presetSelect = this.container?.querySelector('#dom-preset-select') as HTMLSelectElement | null;
        const presets = MapPresetManager.getAllPresets();
        const selected = presets.find(p => p.id === presetSelect?.value);
        if (selected && this.callbacks.onStartAutoPlayVerify) {
          this.closeCustomModal();
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
          this.closeCustomModal();
          this.callbacks.onStartAutoPlayVerify(undefined, imported);
        }
      } else if (type === 'DEBUG') {
        if (this.callbacks.onStartAutoPlayVerify) {
          const topoSelect = this.container?.querySelector('#dom-debug-topology') as HTMLSelectElement | null;
          const diffSelect = this.container?.querySelector('#dom-debug-diff') as HTMLSelectElement | null;
          const paceSelect = this.container?.querySelector('#dom-debug-pacing') as HTMLSelectElement | null;
          const archSelect = this.container?.querySelector('#dom-debug-archetype') as HTMLSelectElement | null;
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
            chestCount: chestsInput?.value ? parseInt(chestsInput.value, 10) : undefined,
            graveCount: gravesInput?.value ? parseInt(gravesInput.value, 10) : undefined,
            tuningParams: (enemyAtkInput?.value || dragonDefInput?.value) ? {
              progressionConfig: {
                enemyAtkRatio: enemyAtkInput?.value ? parseFloat(enemyAtkInput.value) : undefined,
                dragonDefRatio: dragonDefInput?.value ? parseFloat(dragonDefInput.value) : undefined,
              },
            } : undefined,
          };
          this.closeCustomModal();
          this.callbacks.onStartAutoPlayVerify(options);
        }
      }
    };

    // 代表ボタンへのバインド
    if (this.proceduralBtnEl) {
      this.proceduralBtnEl.addEventListener('click', handlePlayCurrentType);
    }
    const quickAutoplayBtn = this.container?.querySelector('#dom-quick-autoplay-btn') as HTMLElement | null;
    if (quickAutoplayBtn) {
      quickAutoplayBtn.addEventListener('click', handleAutoPlayCurrentType);
    }

    // 互換用ボタンのバインド
    const debugLaunchBtn = this.container?.querySelector('#dom-debug-launch-btn') as HTMLElement | null;
    if (debugLaunchBtn) debugLaunchBtn.addEventListener('click', handlePlayCurrentType);
    const debugAutoplayBtn = this.container?.querySelector('#dom-debug-autoplay-btn') as HTMLElement | null;
    if (debugAutoplayBtn) debugAutoplayBtn.addEventListener('click', handleAutoPlayCurrentType);

    if (this.continueBtnEl) {
      this.continueBtnEl.addEventListener('click', () => {
        if (this.callbacks.onContinueGame) this.callbacks.onContinueGame();
      });
    }

    if (this.giveupConfirmBtnEl) {
      this.giveupConfirmBtnEl.addEventListener('click', () => {
        if (this.callbacks.onConfirmGiveUp) this.callbacks.onConfirmGiveUp();
      });
    }

    if (this.giveupCancelBtnEl) {
      this.giveupCancelBtnEl.addEventListener('click', () => {
        this.hideGiveUpConfirm();
      });
    }

    if (this.retryBtnEl) {
      this.retryBtnEl.addEventListener('click', () => {
        if (this.callbacks.onRestartGame) this.callbacks.onRestartGame();
      });
    }

    if (this.replayBtnEl) {
      this.replayBtnEl.addEventListener('click', () => {
        if (this.callbacks.onRestartGame) this.callbacks.onRestartGame();
      });
    }

    // プリセットUIリスナー設定
    this.setupPresetEventListeners();

    // 初期ログの投入
    this.addLog('Game Initialized. DS1ish engine ready.', 'info');
  }

  /**
   * プリセット管理UIのイベント設定
   */
  private setupPresetEventListeners(): void {
    const presetSelect = this.container?.querySelector('#dom-preset-select') as HTMLSelectElement | null;
    const presetStartBtn = this.container?.querySelector('#dom-preset-start-btn') as HTMLElement | null;
    const presetShareBtn = this.container?.querySelector('#dom-preset-share-btn') as HTMLElement | null;
    const presetDeleteBtn = this.container?.querySelector('#dom-preset-delete-btn') as HTMLElement | null;
    const shareInput = this.container?.querySelector('#dom-share-code-input') as HTMLInputElement | null;
    const shareStartBtn = this.container?.querySelector('#dom-share-code-start-btn') as HTMLElement | null;

    const hudSavePresetBtn = (document.getElementById('dom-save-preset-btn') ?? this.container?.querySelector('#dom-save-preset-btn')) as HTMLElement | null;
    const gameoverSaveBtn = this.container?.querySelector('#dom-gameover-save-preset-btn') as HTMLElement | null;
    const clearSaveBtn = this.container?.querySelector('#dom-clear-save-preset-btn') as HTMLElement | null;

    // プリセット一覧の描画
    this.refreshPresetList();

    const presetAutoplayBtn = this.container?.querySelector('#dom-preset-autoplay-btn') as HTMLElement | null;
    const shareCodeAutoplayBtn = this.container?.querySelector('#dom-share-code-autoplay-btn') as HTMLElement | null;

    // プリセット開始ボタン (自分でプレイ)
    if (presetStartBtn && presetSelect) {
      presetStartBtn.addEventListener('click', () => {
        const presets = MapPresetManager.getAllPresets();
        const selected = presets.find(p => p.id === presetSelect.value);
        if (selected && this.callbacks.onStartPresetGame) {
          this.closeCustomModal();
          this.callbacks.onStartPresetGame(selected);
        }
      });
    }

    // プリセット自走検証ボタン (AUTO-PLAY)
    if (presetAutoplayBtn && presetSelect) {
      presetAutoplayBtn.addEventListener('click', () => {
        const presets = MapPresetManager.getAllPresets();
        const selected = presets.find(p => p.id === presetSelect.value);
        if (selected && this.callbacks.onStartAutoPlayVerify) {
          this.closeCustomModal();
          this.callbacks.onStartAutoPlayVerify(undefined, selected);
        }
      });
    }

    // 共有コードクリップボードコピー
    if (presetShareBtn && presetSelect) {
      presetShareBtn.addEventListener('click', () => {
        const presets = MapPresetManager.getAllPresets();
        const selected = presets.find(p => p.id === presetSelect.value);
        if (selected) {
          const code = MapPresetManager.exportShareCode(selected);
          if (navigator?.clipboard?.writeText) {
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

    // プリセット削除
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

    // 共有コードから直接開始 (自分でプレイ)
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
          this.closeCustomModal();
          this.callbacks.onStartPresetGame(imported);
        }
      });
    }

    // 共有コード自走検証ボタン (AUTO-PLAY)
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
          this.closeCustomModal();
          this.callbacks.onStartAutoPlayVerify(undefined, imported);
        }
      });
    }

    // マップ保存ハンドラー
    const handleSaveCurrentMap = () => {
      const name = prompt('保存するマッププリセットの名前を入力してください:', 'お気に入りダンジョン');
      if (name !== null && this.callbacks.onSaveMapPreset) {
        this.callbacks.onSaveMapPreset(name);
        this.refreshPresetList();
      }
    };

    if (hudSavePresetBtn) hudSavePresetBtn.addEventListener('click', handleSaveCurrentMap);
    if (gameoverSaveBtn) gameoverSaveBtn.addEventListener('click', handleSaveCurrentMap);
    if (clearSaveBtn) clearSaveBtn.addEventListener('click', handleSaveCurrentMap);
  }

  /**
   * プリセット選択プルダウンを更新
   */
  public refreshPresetList(): void {
    const presetSelect = this.container?.querySelector('#dom-preset-select') as HTMLSelectElement | null;
    if (!presetSelect) return;

    const presets = MapPresetManager.getAllPresets();
    presetSelect.innerHTML = presets.map(p => {
      const tag = p.isCurated ? '★ [公式]' : '💾 [保存]';
      return `<option value="${p.id}">${tag} ${p.name} (Seed: ${p.seed})</option>`;
    }).join('');
  }

  /**
   * サウンド状態のUI反映
   */
  public updateSoundStatus(muted: boolean): void {
    if (!this.soundBtnEl) return;
    if (muted) {
      this.soundBtnEl.textContent = '🔇 SOUND: OFF';
      this.soundBtnEl.classList.add('muted');
    } else {
      this.soundBtnEl.textContent = '🔊 SOUND: ON';
      this.soundBtnEl.classList.remove('muted');
    }
  }

  /**
   * 敵相対マーカー表示状態（TACTICAL / RETRO）のUI反映
   */
  public updateMarkerStatus(isTactical: boolean): void {
    this.isTacticalMarkerEnabled = isTactical;
    if (!this.markerBtnEl) return;
    if (isTactical) {
      this.markerBtnEl.textContent = '🎯 TACTICAL';
      this.markerBtnEl.className = 'hud-action-btn marker-toggle-btn active';
      this.markerBtnEl.title = '敵相対マーカー表示中 (クリックまたは [T] でRETRO切替)';
    } else {
      this.markerBtnEl.textContent = '📜 RETRO';
      this.markerBtnEl.className = 'hud-action-btn marker-toggle-btn retro';
      this.markerBtnEl.title = 'クラシック黒シャドウ表示中 (クリックまたは [T] でTACTICAL切替)';
    }
  }

  public isTactical(): boolean {
    return this.isTacticalMarkerEnabled;
  }

  /**
   * ゲームパレット（テーマ）の同期
   */
  public syncPalette(mode: PaletteMode): void {
    if (typeof document === 'undefined') return;
    const body = document.body;
    body.classList.remove('theme-normal', 'theme-pinch', 'theme-dark');

    switch (mode) {
      case 'PINCH':
        body.classList.add('theme-pinch');
        break;
      case 'DARK':
        body.classList.add('theme-dark');
        break;
      case 'NORMAL':
      default:
        body.classList.add('theme-normal');
        break;
    }
  }

  /**
   * 内部キャッシュを無効化（次回update時に強制再描画）
   */
  public invalidateCache(): void {
    this.lastMagicSignature = '';
    this.lastTargetSignature = '';
    this.lastHp = -1;
    this.lastStr = -1;
    this.lastExp = -1;
    this.lastGold = -1;
    this.lastMagic = -1;
    this.lastCrowns = -1;
    this.lastHoldItem = '';
    this.lastHasSword = null;
    this.lastSpecialStatusText = '';
    this.lastIndicatorRatio = -1;
  }

  /**
   * ゲーム状態（TITLE, PLAYING, GAMEOVER, STAGECLEAR）に応じた画面切り替え
   */
  public setGameState(state: GameState, player?: Player, totalKills: number = 0, totalTurns: number = 0): void {
    if (!this.container) return;

    this.invalidateCache();
    this.hideGiveUpConfirm();
    if (state !== 'TITLE') {
      this.customModalEl?.classList.add('hidden');
    }

    // プレイ中のみ上部の中断セーブ・ギブアップボタンを活性化
    if (this.giveupBtnEl) {
      this.giveupBtnEl.style.display = state === 'PLAYING' ? 'inline-block' : 'none';
    }
    if (this.saveQuitBtnEl) {
      this.saveQuitBtnEl.style.display = state === 'PLAYING' ? 'inline-block' : 'none';
    }

    if (this.titleModalEl) {
      if (state === 'TITLE') {
        this.titleModalEl.classList.remove('hidden');
        this.startIdleTimer();
      } else {
        this.titleModalEl.classList.add('hidden');
        this.stopIdleTimer();
      }
    }

    if (this.gameoverModalEl) {
      if (state === 'GAMEOVER') {
        this.gameoverModalEl.classList.remove('hidden');
        if (player) {
          this.renderGameOverDetails(player, totalKills, totalTurns);
        }
      } else {
        this.gameoverModalEl.classList.add('hidden');
      }
    }

    if (this.clearModalEl) {
      if (state === 'STAGECLEAR') {
        this.clearModalEl.classList.remove('hidden');
      } else {
        this.clearModalEl.classList.add('hidden');
      }
    }
  }

  /**
   * ゲームオーバーモーダルの詳細情報（死因メッセージ、トドメ敵グラフィック、最終探索スタッツ）を描画
   */
  private renderGameOverDetails(player: Player, totalKills: number, totalTurns: number): void {
    const death = player.deathInfo;

    // 1. 死因メッセージの反映
    if (this.gameoverCauseMsgEl) {
      this.gameoverCauseMsgEl.textContent = death?.message ?? '力尽き、ダンジョンの闇に呑まれた…';
    }

    // 2. トドメ敵 / 死因グラフィックの描画 (64x64 Canvas)
    if (this.gameoverAvatarCanvasEl && typeof this.gameoverAvatarCanvasEl.getContext === 'function') {
      const ctx = this.gameoverAvatarCanvasEl.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 64, 64);
        ctx.save();
        ctx.imageSmoothingEnabled = false;

        if (death?.enemyTypeId !== undefined && death.enemyTypeId >= 1 && death.enemyTypeId <= 32) {
          // 32x32 を 2倍スケールで描画
          ctx.scale(2, 2);
          MonsterGraphics.drawMonsterById(ctx, death.enemyTypeId, 0, 0, death.enemyColor);
        } else if (death?.cause === 'DRAGON_HEAD') {
          ctx.scale(2, 2);
          TileGraphics.drawDragonPart(
            ctx,
            {
              type: death.dragonPartType ?? 'CENTER_HEAD',
              pos: { x: 0, y: 0 },
              hp: 0,
              maxHp: 5000,
              atk: 500,
              def: 500,
              isAlive: true,
              facingDir: 'DOWN',
            },
            0,
            0
          );
        } else if (death?.cause === 'FIREBALL') {
          ctx.scale(2, 2);
          TileGraphics.drawFireball(
            ctx,
            {
              id: 'fb_death',
              pos: { x: 0, y: 0 },
              dir: 'DOWN',
              damage: death.damage,
              isAlive: true,
            },
            0,
            0
          );
        } else if (death?.cause === 'GIVE_UP') {
          ctx.scale(2, 2);
          TileGraphics.drawDeathFollower(ctx, 0, 0);
        } else {
          // デフォルトドクロ
          ctx.scale(2, 2);
          TileGraphics.drawDeathFollower(ctx, 0, 0);
        }
        ctx.restore();
      }
    }

    // 3. 探索スタッツグリッドの反映
    if (this.gameoverStatsEl) {
      const itemText = player.holdItem === 'NONE' ? 'なし' : player.holdItem;
      const swordText = player.hasSword ? '所持 (YES)' : '未所持 (NO)';
      this.gameoverStatsEl.innerHTML = `
        <div class="gameover-stats-grid">
          <div class="stat-cell"><span class="stat-name">SURVIVED TURNS</span><span class="stat-val highlight">${totalTurns} ターン</span></div>
          <div class="stat-cell"><span class="stat-name">TOTAL KILLS</span><span class="stat-val">${totalKills} 体</span></div>
          <div class="stat-cell"><span class="stat-name">FINAL EXP</span><span class="stat-val highlight">${player.experience.toLocaleString()}</span></div>
          <div class="stat-cell"><span class="stat-name">GOLD</span><span class="stat-val">${player.gold.toLocaleString()} G</span></div>
          <div class="stat-cell"><span class="stat-name">CROWNS</span><span class="stat-val highlight">${player.crowns} / 4</span></div>
          <div class="stat-cell"><span class="stat-name">HOLD ITEM</span><span class="stat-val">${itemText}</span></div>
          <div class="stat-cell span-2"><span class="stat-name">SWORD</span><span class="stat-val">${swordText}</span></div>
        </div>
      `;
    }
  }

  /**
   * ギブアップ確認ダイアログの表示
   */
  public showGiveUpConfirm(): void {
    if (this.giveupModalEl) {
      this.giveupModalEl.classList.remove('hidden');
    }
  }

  /**
   * ギブアップ確認ダイアログの非表示
   */
  public hideGiveUpConfirm(): void {
    if (this.giveupModalEl) {
      this.giveupModalEl.classList.add('hidden');
    }
  }

  /**
   * ギブアップ確認ダイアログが開いているか
   */
  public isGiveUpConfirmOpen(): boolean {
    return !!this.giveupModalEl && !this.giveupModalEl.classList.contains('hidden');
  }

  /**
   * CONTINUEボタンの表示更新
   */
  public updateContinueButton(summary: SaveSummary | null): void {
    if (!this.continueBtnEl) return;
    if (summary) {
      this.continueBtnEl.classList.remove('hidden');
      if (this.continueSummaryEl) {
        this.continueSummaryEl.textContent = `(${summary.formattedTime} HP:${summary.hp.toLocaleString()} 👑:${summary.crowns})`;
      }
    } else {
      this.continueBtnEl.classList.add('hidden');
    }
  }

  /**
   * 毎フレームまたは毎ターンのDOM更新
   * 主要ステータス、魔法一覧カード、対峙モンスターパネルにDirtyチェックを導入し、
   * 値や状態が変化した時のみDOM更新およびCanvas描画を実行します。
   */
  public update(
    player: Player,
    indicatorRatio: number,
    selectedMagic?: MagicType,
    unlockedMagics: MagicDefinition[] = [],
    map?: WorldMap,
    targetEnemy?: TargetEnemyInfo | null,
    targetEnemyThreatLevel?: ThreatLevel
  ): void {
    if (!this.container) return;

    // 1. ステータス数値更新（Dirtyチェック）
    if (this.statHpEl && this.lastHp !== player.hp) {
      this.lastHp = player.hp;
      this.statHpEl.textContent = player.hp.toLocaleString();
      const hpBox = this.container.querySelector('#dom-stat-hp-box');
      if (hpBox) {
        if (player.hp < 500 && player.hp > 0) {
          hpBox.classList.add('pinch-alert');
        } else {
          hpBox.classList.remove('pinch-alert');
        }
      }
    }
    if (this.statStrEl && this.lastStr !== player.strength) {
      this.lastStr = player.strength;
      this.statStrEl.textContent = player.strength.toLocaleString();
    }
    if (this.statExpEl && this.lastExp !== player.experience) {
      this.lastExp = player.experience;
      this.statExpEl.textContent = player.experience.toLocaleString();
    }
    if (this.statGoldEl && this.lastGold !== player.gold) {
      this.lastGold = player.gold;
      this.statGoldEl.textContent = player.gold.toLocaleString();
    }
    if (this.statMagicEl && this.lastMagic !== player.magic) {
      this.lastMagic = player.magic;
      this.statMagicEl.textContent = player.magic.toLocaleString();
    }

    // 2. クラウン所持数（Dirtyチェック）
    if (this.statCrownEl && this.lastCrowns !== player.crowns) {
      this.lastCrowns = player.crowns;
      this.statCrownEl.textContent = `${player.crowns} / 4`;
      if (player.crowns === 4) {
        this.statCrownEl.classList.add('crown-complete');
      } else {
        this.statCrownEl.classList.remove('crown-complete');
      }
    }

    // 3. 携帯アイテムバッジ（Dirtyチェック）
    if (this.badgeItemEl && this.lastHoldItem !== player.holdItem) {
      this.lastHoldItem = player.holdItem;
      let itemLabel = 'ITEM: EMPTY';
      switch (player.holdItem) {
        case 'RING':
          itemLabel = '💍 RING (岩押し可)';
          break;
        case 'CROSS':
          itemLabel = '✝️ CROSS (無敵/聖域)';
          break;
        case 'POWER_STONE':
          itemLabel = '💎 POWER STONE';
          break;
        case 'KEY':
          itemLabel = '🔑 KEY (宝箱解錠)';
          break;
        default:
          itemLabel = 'ITEM: NONE';
          break;
      }
      this.badgeItemEl.textContent = itemLabel;
      this.badgeItemEl.className = `tag-badge item-type-${player.holdItem.toLowerCase()}`;
    }

    // 4. 剣の所持状態（Dirtyチェック）
    if (this.badgeSwordEl && this.lastHasSword !== player.hasSword) {
      this.lastHasSword = player.hasSword;
      if (player.hasSword) {
        this.badgeSwordEl.textContent = '⚔ SWORD EQUIPPED';
        this.badgeSwordEl.classList.add('sword-ok');
        this.badgeSwordEl.classList.remove('no-sword');
      } else {
        this.badgeSwordEl.textContent = 'NO SWORD (ATK: 10)';
        this.badgeSwordEl.classList.add('no-sword');
        this.badgeSwordEl.classList.remove('sword-ok');
      }
    }

    // 5. 特殊ステータス (FLY, DEATH, DIAGONAL) および 足元アイテムガイド（Dirtyチェック）
    if (this.specialStatusEl) {
      const tags: string[] = [];
      if (player.isFlying) {
        tags.push(`🕊 FLYING (${player.flyTimer})`);
      }
      if (player.hasDeath) {
        tags.push('☠ CURSED');
      }
      if (player.canDiagonal) {
        tags.push('✦ 8-DIR MOVE');
      }

      // 足元の情報（我が家またはアイテム）
      if (map) {
        if (map.getBaseTile(player.pos) === 'HOME') {
          tags.push('🏠 HOME (我が家: アイテム設置不可)');
        } else {
          const floorItem = map.getItem(player.pos);
          if (floorItem !== 'NONE') {
            tags.push(`👟 ON FLOOR: [${floorItem}] (SPACEで拾う/交換)`);
          } else if (player.holdItem !== 'NONE') {
            tags.push(`[Space] 足元に置く: [${player.holdItem}]`);
          }
        }
      }

      const statusText = tags.join(' | ');
      if (this.lastSpecialStatusText !== statusText) {
        this.lastSpecialStatusText = statusText;
        this.specialStatusEl.textContent = statusText;
        if (tags.length > 0) {
          this.specialStatusEl.style.display = 'inline-block';
        } else {
          this.specialStatusEl.style.display = 'none';
        }
      }
    }

    // 6. インジケータープログレスバー（毎フレームの軽量スタイル更新）
    if (this.indicatorFillEl) {
      const pct = Math.min(100, Math.max(0, indicatorRatio * 100));
      this.indicatorFillEl.style.width = `${pct}%`;
      const isWarning = indicatorRatio > 0.8;
      if ((this.lastIndicatorRatio > 0.8) !== isWarning) {
        if (isWarning) {
          this.indicatorFillEl.classList.add('gauge-warning');
        } else {
          this.indicatorFillEl.classList.remove('gauge-warning');
        }
      }
      this.lastIndicatorRatio = indicatorRatio;
    }

    // 7. 魔法一覧カード描画（Dirtyチェック）
    this.renderMagicCards(unlockedMagics, selectedMagic, player);

    // 8. 対峙モンスター情報更新（Dirtyチェック）
    if (targetEnemy !== undefined) {
      this.updateTargetEnemy(targetEnemy, targetEnemyThreatLevel);
    }
  }

  /**
   * 対峙モンスター（TARGET ENEMY）情報のリアルタイム更新
   * シグネチャ比較によるDirtyチェックを行い、状態変化時のみinnerHTML再構築とCanvas描画を実行
   */
  public updateTargetEnemy(target: TargetEnemyInfo | null, threatLevel?: ThreatLevel): void {
    if (!this.targetBodyEl || !this.targetStatusTagEl) return;

    if (!target || target.hp <= 0) {
      if (this.lastTargetSignature === 'NO_TARGET') {
        return;
      }
      this.lastTargetSignature = 'NO_TARGET';
      if (this.targetPanelEl) {
        this.targetPanelEl.classList.remove('is-active');
      }
      this.targetStatusTagEl.textContent = 'NO TARGET';
      this.targetStatusTagEl.className = 'target-status-tag no-target';
      this.targetBodyEl.innerHTML = `<div class="no-target-msg">敵と接触するとリアルタイムでステータスが表示されます</div>`;
      return;
    }

    const effectiveThreat = threatLevel ?? target.threatLevel;
    const isFrozen = !!target.isPermanentlyFrozen || (target.frozenTimer ?? 0) > 0;
    const details = target.threatDetails;
    const targetSig = [
      target.typeId ?? (target as any).id ?? 'BOSS',
      target.displayName,
      target.hp,
      target.maxHp,
      target.atk,
      target.def,
      target.frozenTimer ?? 0,
      target.isPermanentlyFrozen ? 1 : 0,
      target.drainAtk ?? 0,
      target.drainExp ?? 0,
      target.stealPotion ? 1 : 0,
      target.isDragon ? 1 : 0,
      target.color ?? '',
      this.isTacticalMarkerEnabled ? (effectiveThreat ?? '') : 'RETRO',
      details?.isLethalOneShot ? 'LETHAL_1S' : details?.isRiskyOneShot ? 'RISKY_1S' : '',
    ].join('|');

    if (this.lastTargetSignature === targetSig) {
      return;
    }
    this.lastTargetSignature = targetSig;

    if (this.targetPanelEl) {
      this.targetPanelEl.classList.add('is-active');
    }

    const hpPercent = Math.max(0, Math.min(100, (target.hp / target.maxHp) * 100));
    let hpColorClass = 'hp-full';
    if (hpPercent <= 25) {
      hpColorClass = 'hp-danger';
    } else if (hpPercent <= 50) {
      hpColorClass = 'hp-warning';
    }

    const badges: string[] = [];
    if (this.isTacticalMarkerEnabled && effectiveThreat) {
      switch (effectiveThreat) {
        case 'ONE_SHOT':
          if (target.threatDetails?.isLethalOneShot) {
            badges.push(`<span class="enemy-badge badge-threat badge-threat-lethal-oneshot" title="一撃撃破可能だが、敵先制攻撃で即死（ガラスの剣・先手必須）">⚡💀 1-SHOT (LETHAL)</span>`);
          } else if (target.threatDetails?.isRiskyOneShot) {
            badges.push(`<span class="enemy-badge badge-threat badge-threat-risky-oneshot" title="一撃撃破可能だが、追走時等の被弾・能力吸収あり">⚡⚠️ 1-SHOT (RISKY)</span>`);
          } else {
            badges.push(`<span class="enemy-badge badge-threat badge-threat-oneshot" title="一撃撃破可能 (先制被弾なし・完全安全)">⚡ ONE-SHOT (SAFE)</span>`);
          }
          break;
        case 'SAFE':
          badges.push(`<span class="enemy-badge badge-threat badge-threat-safe" title="有効打あり・被ダメ0">🛡️ SAFE</span>`);
          break;
        case 'STALEMATE':
          badges.push(`<span class="enemy-badge badge-threat badge-threat-stalemate" title="膠着またはHPトレード">⚠️ TRADE</span>`);
          break;
        case 'DANGER':
          badges.push(`<span class="enemy-badge badge-threat badge-threat-danger" title="被ダメージまたは能力吸収被害あり">🔥 DANGER</span>`);
          break;
        case 'LETHAL':
          badges.push(`<span class="enemy-badge badge-threat badge-threat-lethal" title="反撃1発で即死する致命的危険">💀 LETHAL</span>`);
          break;
      }
    }
    if (isFrozen) {
      if (target.isPermanentlyFrozen || target.frozenTimer === Infinity) {
        badges.push(`<span class="enemy-badge badge-frozen">❄️ FROZEN (PERM)</span>`);
      } else {
        badges.push(`<span class="enemy-badge badge-frozen">❄️ FLASH (${target.frozenTimer})</span>`);
      }
    }
    if (target.drainAtk && target.drainAtk > 0) {
      badges.push(`<span class="enemy-badge badge-drain-atk">⚡ STR吸収 (-${target.drainAtk})</span>`);
    }
    if (target.drainExp && target.drainExp > 0) {
      badges.push(`<span class="enemy-badge badge-drain-exp">🔮 EXP吸収 (-${target.drainExp})</span>`);
    }
    if (target.stealPotion) {
      badges.push(`<span class="enemy-badge badge-steal-potion">🧪 壺強奪</span>`);
    }
    if (target.isDragon) {
      badges.push(`<span class="enemy-badge badge-boss">👑 BOSS</span>`);
    }

    const numLabel = target.typeId !== undefined ? `NO.${target.typeId.toString().padStart(2, '0')}` : 'BOSS';

    this.targetStatusTagEl.textContent = isFrozen ? 'FROZEN' : 'ENGAGED';
    this.targetStatusTagEl.className = `target-status-tag ${isFrozen ? 'frozen' : 'engaged'}`;

    this.targetBodyEl.innerHTML = `
      <div class="target-card">
        <div class="target-top-row">
          <div class="target-avatar" style="border-color: ${isFrozen ? '#ffffff' : target.color};">
            <canvas class="target-avatar-canvas" id="dom-target-avatar-canvas" width="32" height="32">${target.symbol}</canvas>
          </div>
          <div class="target-info-col">
            <div class="target-name-row">
              <span class="target-id-label">${numLabel}</span>
              <span class="target-name">${target.displayName}</span>
            </div>
            <div class="target-badges-row">
              ${badges.length > 0 ? badges.join('') : '<span class="enemy-badge badge-normal">STANDARD</span>'}
            </div>
          </div>
        </div>

        <div class="target-hp-row">
          <div class="target-hp-labels">
            <span class="target-hp-title">HP</span>
            <span class="target-hp-val">${target.hp.toLocaleString()} / ${target.maxHp.toLocaleString()}</span>
          </div>
          <div class="target-hp-track">
            <div class="target-hp-fill ${hpColorClass}" style="width: ${hpPercent}%"></div>
          </div>
        </div>

        <div class="target-stats-grid">
          <div class="target-stat-item">
            <span class="target-stat-label">ATK</span>
            <span class="target-stat-num">${target.atk.toLocaleString()}</span>
          </div>
          <div class="target-stat-item">
            <span class="target-stat-label">DEF</span>
            <span class="target-stat-num">${target.def.toLocaleString()}</span>
          </div>
        </div>
      </div>
    `;

    // TARGET ENEMY アバター Canvas にモンスターのドット絵を描画
    const canvas = this.targetBodyEl.querySelector<HTMLCanvasElement>('#dom-target-avatar-canvas');
    if (canvas && typeof canvas.getContext === 'function') {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 32, 32);
        if (target.typeId !== undefined && target.typeId >= 1 && target.typeId <= 32) {
          MonsterGraphics.drawMonsterById(ctx, target.typeId, 0, 0, target.color, isFrozen);
        } else if (target.isDragon) {
          TileGraphics.drawDragonPart(
            ctx,
            {
              type: 'CENTER_HEAD',
              pos: { x: 0, y: 0 },
              hp: target.hp,
              maxHp: target.maxHp,
              atk: target.atk,
              def: target.def,
              isAlive: true,
              facingDir: 'UP',
            },
            0,
            0
          );
        } else {
          // フォールバックテキスト
          ctx.fillStyle = target.color;
          ctx.font = 'bold 16px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(target.symbol, 16, 16);
        }
      }
    }
  }

  private renderMagicCards(
    unlockedMagics: MagicDefinition[],
    selectedMagic?: MagicType,
    player?: Player
  ): void {
    if (!this.magicListEl) return;

    if (this.magicCurseBannerEl) {
      if (player?.hasDeath) {
        this.magicCurseBannerEl.className = 'magic-restriction-banner banner-curse';
        this.magicCurseBannerEl.innerHTML = `<span class="curse-icon">☠</span> <strong>DEATH CURSED</strong>: 死神の呪いにより魔法詠唱不可（十字架で浄化）`;
        this.magicCurseBannerEl.style.display = 'block';
      } else if (player?.holdItem === 'CROWN') {
        this.magicCurseBannerEl.className = 'magic-restriction-banner banner-crown';
        this.magicCurseBannerEl.innerHTML = `<span class="curse-icon">👑</span> <strong>CROWN HELD</strong>: 王冠所持中は魔法詠唱不可（我が家へ運べ）`;
        this.magicCurseBannerEl.style.display = 'block';
      } else if (player?.holdItem === 'CROSS') {
        this.magicCurseBannerEl.className = 'magic-restriction-banner banner-cross';
        this.magicCurseBannerEl.innerHTML = `<span class="curse-icon">✝</span> <strong>CROSS HELD</strong>: 聖なる十字架所持中は魔法詠唱不可`;
        this.magicCurseBannerEl.style.display = 'block';
      } else {
        this.magicCurseBannerEl.className = 'magic-restriction-banner hidden';
        this.magicCurseBannerEl.innerHTML = '';
        this.magicCurseBannerEl.style.display = 'none';
      }
    }

    if (unlockedMagics.length === 0) {
      if (this.magicDescBoxEl) {
        this.magicDescBoxEl.style.display = 'none';
      }
      if (this.lastMagicSignature === 'EMPTY') {
        return;
      }
      this.lastMagicSignature = 'EMPTY';
      this.magicListEl.innerHTML = `<div class="empty-magic-tip">No spells unlocked yet (Increase EXPERIENCE)</div>`;
      if (this.castBtnEl) {
        this.castBtnEl.disabled = true;
        this.castBtnEl.textContent = '⚡ CAST SELECTED SPELL [X]';
      }
      return;
    }

    const canCastGeneral = player
      ? !player.hasDeath && player.holdItem !== 'CROWN' && player.holdItem !== 'CROSS'
      : true;

    if (this.castBtnEl) {
      if (player?.hasDeath) {
        this.castBtnEl.disabled = true;
        this.castBtnEl.textContent = '☠ 呪縛中: 魔法詠唱不可';
      } else if (player?.holdItem === 'CROSS') {
        this.castBtnEl.disabled = true;
        this.castBtnEl.textContent = '✝ 十字架所持中: 魔法詠唱不可';
      } else if (player?.holdItem === 'CROWN') {
        this.castBtnEl.disabled = true;
        this.castBtnEl.textContent = '👑 王冠所持中: 魔法詠唱不可';
      } else {
        this.castBtnEl.disabled = false;
        this.castBtnEl.textContent = '⚡ CAST SELECTED SPELL [X]';
      }
    }

    // 各魔法の詠唱可否状態・選択状態・コストからDirty判定用シグネチャを生成
    const spellsPart = unlockedMagics
      .map((m) => {
        const canAfford = player ? player.magic >= (m.cost || 0) : true;
        const canCast = canCastGeneral && canAfford;
        return `${m.type}:${m.cost}:${canCast ? 1 : 0}`;
      })
      .join(',');

    const magicSig = `${selectedMagic ?? 'NONE'}|${canCastGeneral ? 1 : 0}|${spellsPart}`;

    if (this.lastMagicSignature === magicSig) {
      return;
    }
    this.lastMagicSignature = magicSig;

    // 選択中の魔法説明文を専用ボックスへ表示（各カード行数を削減しスクロールを解消）
    if (this.magicDescBoxEl) {
      const selectedDef = unlockedMagics.find((m) => m.type === selectedMagic);
      if (selectedDef) {
        this.magicDescBoxEl.innerHTML = `<span class="desc-spell-badge">[${selectedDef.name}]</span> <span class="desc-spell-text">${selectedDef.description}</span>`;
        this.magicDescBoxEl.style.display = 'flex';
      } else {
        this.magicDescBoxEl.innerHTML = '<span class="desc-spell-text" style="color: #617387;">魔法を選択してください [M / 1〜9]</span>';
        this.magicDescBoxEl.style.display = 'flex';
      }
    }

    const html = unlockedMagics
      .map((magic, idx) => {
        const isSelected = magic.type === selectedMagic;
        const selectedClass = isSelected ? 'selected-spell' : '';
        const canAfford = player ? player.magic >= (magic.cost || 0) : true;
        const canCast = canCastGeneral && canAfford;
        const disabledClass = canCast ? '' : 'spell-disabled';

        return `
          <div class="magic-card-item ${selectedClass} ${disabledClass}" data-index="${idx}">
            <div class="magic-card-left">
              <span class="magic-num">${idx + 1}</span>
              <span class="magic-name">${magic.name}</span>
            </div>
            <div class="magic-cost">COST:${magic.cost}</div>
          </div>
        `;
      })
      .join('');

    this.magicListEl.innerHTML = html;

    // クリックで選択
    const items = this.magicListEl.querySelectorAll('.magic-card-item');
    items.forEach((item) => {
      item.addEventListener('click', () => {
        const indexStr = item.getAttribute('data-index');
        if (indexStr !== null && this.callbacks.onSelectMagic) {
          this.callbacks.onSelectMagic(parseInt(indexStr, 10));
        }
      });
    });
  }

  /**
   * リアルタイムログフィードへのメッセージ追加
   */
  public addLog(
    text: string,
    type: 'info' | 'combat' | 'magic' | 'warn' | 'success' | 'fatal' = 'info'
  ): void {
    if (!this.container) return;

    const timeStr = new Date().toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const entry: LogEntry = {
      id: `log_${Date.now()}_${Math.random()}`,
      text,
      type,
      time: timeStr,
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    if (this.logStreamEl) {
      this.logStreamEl.innerHTML = this.logs
        .map(
          (log) => `
          <div class="log-item log-type-${log.type}">
            <span class="log-timestamp">[${log.time}]</span>
            <span class="log-text">${log.text}</span>
          </div>
        `
        )
        .join('');
    }
  }

  /**
   * インスペクタモーダルを開く
   */
  public openInspector(data: InspectorData): void {
    this.inspectorModal?.open(data);
  }

  /**
   * インスペクタモーダルを閉じる
   */
  public closeInspector(): void {
    this.inspectorModal?.close();
  }

  /**
   * インスペクタモーダルの表示・非表示をトグル
   */
  public toggleInspector(data: InspectorData): void {
    if (this.inspectorModal?.isOpen()) {
      this.inspectorModal.close();
    } else {
      this.inspectorModal?.open(data);
    }
  }

  /**
   * インスペクタモーダルが開いているかどうか
   */
  public isInspectorOpen(): boolean {
    return this.inspectorModal?.isOpen() ?? false;
  }

  // ==========================================================================
  // ステージ調整・選択（カスタム）メニュー
  // ==========================================================================

  public openCustomModal(): void {
    this.stopIdleTimer();
    this.titleModalEl?.classList.add('hidden');
    this.customModalEl?.classList.remove('hidden');
    this.refreshPresetList();
    if (this.callbacks.onOpenCustomModal) {
      this.callbacks.onOpenCustomModal();
    }
  }

  public closeCustomModal(): void {
    this.customModalEl?.classList.add('hidden');
    this.titleModalEl?.classList.remove('hidden');
    this.startIdleTimer();
    if (this.callbacks.onCloseCustomModal) {
      this.callbacks.onCloseCustomModal();
    }
  }

  public isCustomModalOpen(): boolean {
    return !!this.customModalEl && !this.customModalEl.classList.contains('hidden');
  }

  // ==========================================================================
  // アトラクトデモ & 自走検証（オートプレイ）関連UI
  // ==========================================================================

  public startIdleTimer(): void {
    this.stopIdleTimer();
    if (typeof window === 'undefined') return;
    this.idleTimerId = window.setTimeout(() => {
      if (this.callbacks.onStartDemo) {
        this.callbacks.onStartDemo();
      }
    }, 7000); // 7秒放置でデモ自動再生
  }

  public resetIdleTimer(): void {
    if (this.titleModalEl && !this.titleModalEl.classList.contains('hidden')) {
      this.startIdleTimer();
    } else if (this.idleTimerId !== null) {
      this.startIdleTimer();
    }
  }

  public stopIdleTimer(): void {
    if (this.idleTimerId !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.idleTimerId);
      this.idleTimerId = null;
    }
  }

  public showDemoOverlay(message: string): void {
    this.isAutoPlayMode = false;
    if (this.demoTitleEl) {
      this.demoTitleEl.textContent = '🎬 DEMO PLAYING（クリックまたは任意のキーでタイトルへ復帰）';
    }
    if (this.autoplayControlsEl) {
      this.autoplayControlsEl.classList.add('hidden');
    }
    if (this.demoOverlayEl) {
      this.demoOverlayEl.style.pointerEvents = 'none';
      this.demoOverlayEl.classList.remove('hidden');
    }
    this.setDemoMessage(message);
  }

  public showAutoPlayOverlay(message: string, currentSpeed: number = 1): void {
    this.isAutoPlayMode = true;
    if (this.demoTitleEl) {
      this.demoTitleEl.textContent = '🕹️ 自走検証中（オートプレイ観戦モード）';
    }
    if (this.autoplayControlsEl) {
      this.autoplayControlsEl.classList.remove('hidden');
    }
    if (this.demoOverlayEl) {
      this.demoOverlayEl.style.pointerEvents = 'auto';
      this.demoOverlayEl.classList.remove('hidden');
    }
    this.updateAutoPlaySpeedUI(currentSpeed);
    this.updateAutoPlayToggleStatus(true);
    this.setDemoMessage(message);
  }

  public hideDemoOverlay(): void {
    this.isAutoPlayMode = false;
    if (this.demoOverlayEl) {
      this.demoOverlayEl.classList.add('hidden');
    }
    if (this.autoplayControlsEl) {
      this.autoplayControlsEl.classList.add('hidden');
    }
    this.updateAutoPlayToggleStatus(false);
  }

  public updateAutoPlayToggleStatus(isActive: boolean): void {
    if (this.autoplayToggleBtnEl) {
      if (isActive) {
        this.autoplayToggleBtnEl.textContent = '🤖 AUTO: ON [Tab]';
        this.autoplayToggleBtnEl.style.background = '#2e7d32';
        this.autoplayToggleBtnEl.style.color = '#fff';
        this.autoplayToggleBtnEl.style.borderColor = '#81c784';
        this.autoplayToggleBtnEl.style.fontWeight = 'bold';
      } else {
        this.autoplayToggleBtnEl.textContent = '🤖 AUTO: OFF [Tab]';
        this.autoplayToggleBtnEl.style.background = '#263238';
        this.autoplayToggleBtnEl.style.color = '#b0bec5';
        this.autoplayToggleBtnEl.style.borderColor = '#455a64';
        this.autoplayToggleBtnEl.style.fontWeight = 'normal';
      }
    }
  }

  public hideAutoPlayOverlay(): void {
    this.hideDemoOverlay();
  }

  public updateAutoPlaySpeedUI(speedMultiplier: number): void {
    [1, 2, 5, 0].forEach((spd) => {
      const btn = this.autoplaySpeedBtns[spd];
      if (btn) {
        if (spd === speedMultiplier) {
          btn.style.background = '#2e7d32';
          btn.style.color = '#fff';
          btn.style.borderColor = '#81c784';
          btn.style.fontWeight = 'bold';
        } else {
          btn.style.background = '#263238';
          btn.style.color = '#ccc';
          btn.style.borderColor = '#546e7a';
          btn.style.fontWeight = 'normal';
        }
      }
    });
  }

  public setDemoMessage(message: string): void {
    if (this.demoTipEl) {
      this.demoTipEl.textContent = message;
    }
  }

  public isDemoActive(): boolean {
    return this.demoOverlayEl ? !this.demoOverlayEl.classList.contains('hidden') : false;
  }

  public isAutoPlayActive(): boolean {
    return this.isAutoPlayMode && this.isDemoActive();
  }
}
