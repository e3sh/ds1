import { Player } from '../models/Player.js';
import {
  GameState,
  MagicType,
  PaletteMode,
  TargetEnemyInfo,
  ThreatLevel,
} from '../models/Types.js';
import { MagicDefinition } from '../config/MagicTable.js';
import { WorldMap } from '../models/WorldMap.js';
import { SaveSummary } from '../services/SaveManager.js';
import { MonsterGraphics } from './MonsterGraphics.js';
import { TileGraphics } from './TileGraphics.js';
import { ProceduralMapOptions } from '../systems/ProceduralMapGenerator.js';
import { InspectorModal, InspectorData } from './InspectorModal.js';
import { HelpModal, HelpTabType } from './HelpModal.js';
import { CustomStageModal } from './CustomStageModal.js';
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
  onToggleHelp?: () => void;
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
  private topBarEl: HTMLElement | null = null;
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
  private clearChallengeBadgeEl: HTMLElement | null = null;
  private clearStatsEl: HTMLElement | null = null;
  private startBtnEl: HTMLButtonElement | null = null;
  private continueBtnEl: HTMLButtonElement | null = null;
  private continueSummaryEl: HTMLElement | null = null;
  private retryBtnEl: HTMLButtonElement | null = null;
  private replayBtnEl: HTMLButtonElement | null = null;
  private giveupModalEl: HTMLElement | null = null;
  private giveupConfirmBtnEl: HTMLButtonElement | null = null;
  private giveupCancelBtnEl: HTMLButtonElement | null = null;
  private inspectBtnEl: HTMLButtonElement | null = null;
  private inspectorModal: InspectorModal | null = null;
  private helpBtnEl: HTMLButtonElement | null = null;
  private titleHelpBtnEl: HTMLButtonElement | null = null;
  private helpModal: HelpModal | null = null;
  private wasTitleVisibleBeforeHelp: boolean = false;
  private demoBtnEl: HTMLButtonElement | null = null;
  private demoOverlayEl: HTMLElement | null = null;
  private demoTitleEl: HTMLElement | null = null;
  private demoTipEl: HTMLElement | null = null;
  private customStageModal: CustomStageModal | null = null;
  private openCustomBtnEl: HTMLButtonElement | null = null;
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
      if (typeof document.body?.appendChild === 'function') {
        document.body.appendChild(target);
      } else if (Array.isArray((document.body as any)?.children)) {
        (document.body as any).children.push(target);
      }
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
      if (app && app.firstChild && typeof app.insertBefore === 'function') {
        app.insertBefore(topBar, app.firstChild);
      } else if (app && typeof app.appendChild === 'function') {
        app.appendChild(topBar);
      } else if (document.body && typeof document.body.insertBefore === 'function') {
        document.body.insertBefore(topBar, document.body.firstChild ?? null);
      } else if (document.body && typeof document.body.appendChild === 'function') {
        document.body.appendChild(topBar);
      } else if (Array.isArray((document.body as any)?.children)) {
        (document.body as any).children.unshift(topBar);
      }
    }
    this.topBarEl = topBar;

    topBar.innerHTML = `
      <div class="top-bar-branding">
        <span class="game-title-logo">DS1<span class="brand-accent">ish</span></span>
      </div>
      <div class="top-bar-controls">
        <div class="top-bar-btn-group">
          <button class="hud-action-btn autoplay-toggle-btn" id="dom-autoplay-toggle-btn" title="自動自走 ⇔ 手動操作のシームレス切替 [Tab] / [P]" style="background: #263238; color: #b0bec5; border: 1px solid #455a64;">🤖 AUTO: OFF</button>
          <button class="hud-action-btn marker-toggle-btn active" id="dom-marker-btn" title="敵相対マーカー切替 [T]">🎯 TACTICAL</button>
          <button class="hud-action-btn inspect-btn" id="dom-inspect-btn" title="マップ構造＆成長パラメータインスペクタ [I]">📊 INSPECT</button>
          <button class="hud-action-btn help-btn" id="dom-help-btn" title="アイテム効果＆冒険ガイド [H]" style="background: #0c4a6e; color: #7dd3fc; border: 1px solid #0284c7;">📖 HELP</button>
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
          <div class="title-body">
          <div class="title-intro">
            <p><strong>【使命】</strong> ダンジョン奥地に潜む3首のドラゴンを討伐し、出現する4つの王冠（CROWN）を我が家へ持ち帰れ！</p>
            <p style="margin-top: 6px;"><strong>【基本操作】</strong><br>
            ・移動: 矢印キー / WASD / テンキー (斜め移動解放時は8方向)<br>
            ・SPACE: 足元アイテムの取得・交換・ドロップ・宝箱解錠 / 待機<br>
            ・M または 1〜9: 魔法選択 / X または Enter: 魔法発動<br>
            ・T: 敵相対マーカー切替 / H: ヘルプ図鑑 / Q: ギブアップ / 💾: 中断セーブ</p>
            <p style="margin-top: 6px; border-top: 1px dashed #2a3a52; padding-top: 6px;"><strong>【重要アイテム】</strong><br>
            ・<strong>[SWORD 剣]</strong>: 必須装備（未装備時はSTRに関わらず攻撃力10固定）<br>
            ・<strong>[RING 指輪]</strong>: 岩・我が家を押して移動可能（道開け・墓封鎖・家移設）<br>
            ・<strong>[CROSS 十字架]</strong>: 所持中無敵 / 死神成仏 / 床置きでゴースト侵入防止<br>
            ・<strong>[KEY 鍵]</strong>: 宝箱の上でSPACEで開錠 / <strong>[POWER STONE]</strong>: 家へ持ち帰りSTR永続上昇</p>
          </div>
          <div class="title-btn-group">
            <button class="action-btn-large" id="dom-start-btn">⚔ START GAME (標準ダンジョン開始) [SPACE / CLICK] ⚔</button>
            <button class="action-btn-large continue-btn hidden" id="dom-continue-btn">
              ▶ CONTINUE [C] <span class="continue-summary" id="dom-continue-summary"></span>
            </button>
            <button class="action-btn-large" id="dom-title-help-btn" style="background: linear-gradient(180deg, #0284c7 0%, #0369a1 100%); border-color: #38bdf8; color: #fff; margin-top: 6px;">
              📖 ADVENTURE GUIDE (アイテム・施設・基本ルール図鑑) [H]
            </button>
            <button class="action-btn-large" id="dom-demo-btn" style="background: linear-gradient(180deg, #1565c0 0%, #0d47a1 100%); border-color: #42a5f5; color: #fff; margin-top: 6px;">🎬 DEMO / チュートリアル [D]</button>
            <button class="action-btn-large" id="dom-open-custom-btn" style="background: linear-gradient(180deg, #4527a0 0%, #311b92 100%); border-color: #9575cd; color: #ede7f6; margin-top: 6px;">
              🗺️ CHALLENGE CATALOG & SEED OBSERVATORY (ステージ選択・挑戦状カタログ・シード観測)
            </button>
          </div>
          </div>
        </div>
      </div>

      ${CustomStageModal.getHtml()}

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
          <div id="dom-clear-challenge-badge" style="margin: 10px 0; font-size: 14px; font-weight: bold; color: #ffd54f;"></div>
          <div id="dom-clear-stats" style="font-size: 13px; color: #b0bec5; margin-bottom: 12px;"></div>
          <p class="clear-message">Congratulation on defeating the 3-headed Dragon!</p>
          <button class="action-btn-large" id="dom-replay-btn" style="margin-top: 16px;">👑 REPLAY STAGE</button>
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

    this.markerBtnEl = (document.getElementById('dom-marker-btn') ?? this.topBarEl?.querySelector('#dom-marker-btn') ?? this.container.querySelector('#dom-marker-btn')) as HTMLButtonElement | null;
    this.soundBtnEl = (document.getElementById('dom-sound-btn') ?? this.topBarEl?.querySelector('#dom-sound-btn') ?? this.container.querySelector('#dom-sound-btn')) as HTMLButtonElement | null;
    this.giveupBtnEl = (document.getElementById('dom-giveup-btn') ?? this.topBarEl?.querySelector('#dom-giveup-btn') ?? this.container.querySelector('#dom-giveup-btn')) as HTMLButtonElement | null;
    this.saveQuitBtnEl = (document.getElementById('dom-savequit-btn') ?? this.topBarEl?.querySelector('#dom-savequit-btn') ?? this.container.querySelector('#dom-savequit-btn')) as HTMLButtonElement | null;
    this.inspectBtnEl = (document.getElementById('dom-inspect-btn') ?? this.topBarEl?.querySelector('#dom-inspect-btn') ?? this.container.querySelector('#dom-inspect-btn')) as HTMLButtonElement | null;
    this.inspectorModal = new InspectorModal();
    this.helpBtnEl = (document.getElementById('dom-help-btn') ?? this.topBarEl?.querySelector('#dom-help-btn') ?? this.container.querySelector('#dom-help-btn')) as HTMLButtonElement | null;
    this.titleHelpBtnEl = this.container.querySelector('#dom-title-help-btn');
    this.helpModal = new HelpModal(() => {
      if (this.wasTitleVisibleBeforeHelp) {
        this.titleModalEl?.classList.remove('hidden');
        this.startIdleTimer();
      }
    });
    this.titleModalEl = this.container.querySelector('#dom-title-modal');
    this.gameoverModalEl = this.container.querySelector('#dom-gameover-modal');
    this.gameoverStatsEl = this.container.querySelector('#dom-gameover-stats');
    this.gameoverCauseMsgEl = this.container.querySelector('#dom-gameover-cause-msg');
    this.gameoverAvatarCanvasEl = this.container.querySelector('#dom-gameover-avatar-canvas');
    this.clearModalEl = this.container.querySelector('#dom-clear-modal');
    this.clearChallengeBadgeEl = this.container.querySelector('#dom-clear-challenge-badge');
    this.clearStatsEl = this.container.querySelector('#dom-clear-stats');
    this.startBtnEl = this.container.querySelector('#dom-start-btn');
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
    this.openCustomBtnEl = this.container.querySelector('#dom-open-custom-btn');
    this.customStageModal = new CustomStageModal(this.container, this.callbacks, {
      onBackToTitle: () => this.closeCustomModal(),
    });
    this.autoplayControlsEl = this.container.querySelector('#dom-autoplay-controls');
    this.autoplayToggleBtnEl = (document.getElementById('dom-autoplay-toggle-btn') ?? this.topBarEl?.querySelector('#dom-autoplay-toggle-btn') ?? this.container.querySelector('#dom-autoplay-toggle-btn')) as HTMLButtonElement | null;
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

    if (this.helpBtnEl) {
      this.helpBtnEl.addEventListener('click', () => {
        if (this.callbacks.onToggleHelp) {
          this.callbacks.onToggleHelp();
        } else {
          this.toggleHelp();
        }
      });
    }

    if (this.titleHelpBtnEl) {
      this.titleHelpBtnEl.addEventListener('click', () => {
        this.openHelp('items');
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
   * HUD/ゲームオーバー/クリア画面のマップ保存UIイベント設定
   */
  private setupPresetEventListeners(): void {
    const hudSavePresetBtn = (document.getElementById('dom-save-preset-btn') ?? this.topBarEl?.querySelector('#dom-save-preset-btn') ?? this.container?.querySelector('#dom-save-preset-btn')) as HTMLElement | null;
    const gameoverSaveBtn = this.container?.querySelector('#dom-gameover-save-preset-btn') as HTMLElement | null;
    const clearSaveBtn = this.container?.querySelector('#dom-clear-save-preset-btn') as HTMLElement | null;

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
   * プリセット選択プルダウンを更新 (CustomStageModalへの委譲)
   */
  public refreshPresetList(): void {
    this.customStageModal?.refreshPresetList();
  }

  /**
   * 現在プルダウンで選択されているプリセットの詳細カードを更新 (CustomStageModalへの委譲)
   */
  public updatePresetDetailCardFromSelected(): void {
    this.customStageModal?.updatePresetDetailCardFromSelected();
  }

  /**
   * プリセット詳細カードを動的描画 (CustomStageModalへの委譲)
   */
  public updatePresetDetailCard(preset: MapPresetData): void {
    this.customStageModal?.updatePresetDetailCard(preset);
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
      this.customStageModal?.close();
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
        if (player) {
          this.renderClearDetails(player, totalKills, totalTurns);
        }
      } else {
        this.clearModalEl.classList.add('hidden');
      }
    }
  }

  /**
   * ステージクリアモーダルの詳細情報（クリアターン数、難関シード踏破バッジ等）を描画
   */
  private renderClearDetails(player: Player, totalKills: number, totalTurns: number): void {
    if (this.clearStatsEl) {
      this.clearStatsEl.innerHTML = `
        <div>所要ターン数: <strong style="color: #81c784;">${totalTurns} ターン</strong> | 討伐数: <strong>${totalKills} 体</strong></div>
        <div style="margin-top: 4px;">最終STR: <strong>${player.strength.toLocaleString()}</strong> | 獲得ゴールド: <strong>${player.gold} G</strong></div>
      `;
    }

    if (this.clearChallengeBadgeEl) {
      // プリセット情報を照会
      const presets = MapPresetManager.getAllPresets();
      const matched = presets.find(p => p.metrics?.playerCleared || p.metrics?.clearTurns === totalTurns);

      if (matched?.metrics?.isUnbeatenChallenge || matched?.metrics?.botStatus === 'UNBEATEN_BY_BOT') {
        this.clearChallengeBadgeEl.innerHTML = `
          <div style="background: rgba(255, 215, 0, 0.15); border: 1px solid #ffd54f; border-radius: 4px; padding: 6px 10px;">
            🏆 【難関シード踏破達成！】<br>
            <span style="font-size: 12px; color: #fff9c4;">標準AutoPlayBot未踏破マップを完全攻略しました！</span>
          </div>
        `;
      } else if (
        matched?.options.difficulty === 'HARD' ||
        matched?.metrics?.estimatedDifficulty === 'HARD' ||
        matched?.metrics?.estimatedDifficulty === 'NIGHTMARE'
      ) {
        this.clearChallengeBadgeEl.innerHTML = `
          <div style="background: rgba(255, 171, 0, 0.15); border: 1px solid #ffb74d; border-radius: 4px; padding: 6px 10px;">
            🎖️ 【高難度チャレンジ制覇！】<br>
            <span style="font-size: 12px; color: #ffe0b2;">歯ごたえある難関ダンジョンを見事に踏破しました！</span>
          </div>
        `;
      } else {
        this.clearChallengeBadgeEl.innerHTML = '';
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

  /**
   * アイテム＆ルールヘルプモーダルを開く
   */
  public openHelp(tab: HelpTabType = 'items'): void {
    const isTitleVisible = this.titleModalEl ? !this.titleModalEl.classList.contains('hidden') : false;
    this.wasTitleVisibleBeforeHelp = isTitleVisible;
    if (isTitleVisible) {
      this.stopIdleTimer();
      this.titleModalEl?.classList.add('hidden');
    }
    this.helpModal?.open(tab);
  }

  /**
   * アイテム＆ルールヘルプモーダルを閉じる
   */
  public closeHelp(): void {
    this.helpModal?.close();
  }

  /**
   * アイテム＆ルールヘルプモーダルの表示・非表示をトグル
   */
  public toggleHelp(tab: HelpTabType = 'items'): void {
    if (this.helpModal?.isOpen()) {
      this.closeHelp();
    } else {
      this.openHelp(tab);
    }
  }

  /**
   * アイテム＆ルールヘルプモーダルが開いているかどうか
   */
  public isHelpOpen(): boolean {
    return this.helpModal?.isOpen() ?? false;
  }

  // ==========================================================================
  // ステージ調整・選択（カスタム）メニュー
  // ==========================================================================

  public openCustomModal(): void {
    this.stopIdleTimer();
    this.titleModalEl?.classList.add('hidden');
    this.customStageModal?.open();
  }

  public closeCustomModal(): void {
    this.customStageModal?.close();
    this.titleModalEl?.classList.remove('hidden');
    this.startIdleTimer();
  }

  public isCustomModalOpen(): boolean {
    return this.customStageModal?.isOpen() ?? false;
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
