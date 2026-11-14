import { Position } from '../../models/Types.js';
import { ProceduralMapOptions } from '../../systems/ProceduralMapGenerator.js';
import { MapPresetData } from '../../services/MapPresetManager.js';
import { AutoPlayBot } from '../../ai/AutoPlayBot.js';
import type { GameEngine } from '../GameEngine.js';

export class DemoAndAutoPlayController {
  private engine: GameEngine;

  private isDemoMode: boolean = false;
  private isAutoPlayVerify: boolean = false;
  private autoPlaySpeed: number = 1;
  private isAutoPlayPaused: boolean = false;
  private demoBot: AutoPlayBot | null = null;
  private demoIntervalId: number | null = null;
  private demoEndDelayFrames: number = 0;
  private demoTurns: number = 0;
  private demoStuckFrames: number = 0;
  private lastDemoPos: Position | null = null;

  // Demoモード中の自動消音（Sound Off）と復元用ステート
  private savedMuteBeforeDemo: boolean | null = null;

  // 魔法発動時の演出待機ディレイタイマー (ms) および字幕
  private magicDelayTimerMs: number = 0;
  private magicSpecialNotice: string | null = null;

  constructor(engine: GameEngine) {
    this.engine = engine;

    // 魔法発動イベントの監視（RETURNやJUMP等の演出待機ディレイ制御）
    this.engine.getEventBus().on('magic:cast', (data: any) => {
      if (!this.isDemoMode || !data.success) return;
      const type = data.details?.type;
      if (type === 'RETURN') {
        this.magicDelayTimerMs = 480;
        this.magicSpecialNotice = '🏠【RETURN発動】我が家へ瞬時帰還しました！';
      } else if (type === 'JUMP') {
        this.magicDelayTimerMs = 450;
        this.magicSpecialNotice = '🌀【JUMP発動】テレポートしました！';
      } else if (type === 'FLASH') {
        this.magicDelayTimerMs = 350;
        this.magicSpecialNotice = '⚡【FLASH発動】全モンスターを一時行動停止！';
      } else if (type === 'FREEZE') {
        this.magicDelayTimerMs = 300;
        this.magicSpecialNotice = '❄️【FREEZE発動】周囲の敵を永久凍結！';
      }
    });
  }

  public getMagicDelayTimer(): number {
    return this.magicDelayTimerMs;
  }

  public isDemoActive(): boolean {
    return this.isDemoMode;
  }

  public setDemoMode(val: boolean): void {
    this.isDemoMode = val;
  }

  public getDemoTurns(): number {
    return this.demoTurns;
  }

  public setDemoTurns(val: number): void {
    this.demoTurns = val;
  }

  public getLastDemoPos(): Position | null {
    return this.lastDemoPos;
  }

  public setLastDemoPos(val: Position | null): void {
    this.lastDemoPos = val;
  }

  public getDemoStuckFrames(): number {
    return this.demoStuckFrames;
  }

  public setDemoStuckFrames(val: number): void {
    this.demoStuckFrames = val;
  }

  private createBotInstance(profile: 'NOVICE' | 'STANDARD' | 'EXPERT' = 'STANDARD'): AutoPlayBot {
    return new AutoPlayBot({ profile });
  }

  public getDemoBot(): AutoPlayBot | null {
    return this.demoBot;
  }

  public setDemoBot(bot: AutoPlayBot | null): void {
    this.demoBot = bot;
  }

  public isAutoPlayVerifyActive(): boolean {
    return this.isAutoPlayVerify;
  }

  public getAutoPlaySpeed(): number {
    return this.autoPlaySpeed;
  }

  public isAutoPlayPausedState(): boolean {
    return this.isAutoPlayPaused;
  }

  /**
   * アトラクトデモ（動くチュートリアル）の開始
   */
  public startDemoMode(): void {
    if (this.isDemoMode) return;

    const audio = this.engine.getAudio();
    const domUI = this.engine.getDomUI();

    // Demoモード開始前のサウンド状態（Mute ON/OFF）を退避
    if (this.savedMuteBeforeDemo === null) {
      this.savedMuteBeforeDemo = audio.isMuted();
    }
    // Demoモード中は自動消音（Sound Off / Mute）
    audio.setMuted(true);

    this.isDemoMode = true;
    this.isAutoPlayVerify = false;
    this.autoPlaySpeed = 1;
    this.isAutoPlayPaused = false;
    this.demoEndDelayFrames = 0;
    this.demoTurns = 0;
    this.demoStuckFrames = 0;
    this.lastDemoPos = null;
    this.magicDelayTimerMs = 0;
    this.magicSpecialNotice = null;

    // テンポの良い標準設定でデモ用ゲームを開始
    this.engine.startProceduralGame({
      topology: 'STANDARD_ROOMS',
      difficulty: 'EASY',
      pacing: 'BLITZ',
    });
    this.demoBot = this.createBotInstance('STANDARD');

    // デモ用字幕オーバーレイ表示
    const initialTip = this.demoBot.getTutorialMessage();
    domUI?.showDemoOverlay(initialTip);

    // デモ実行ループ (約180msごとに1ターン進行)
    this.setupAutoPlayInterval(180);
  }

  /**
   * 指定された設定／プリセットで生成したマップの自走検証（オートプレイ）モードを開始
   */
  public startAutoPlayVerifyMode(options?: ProceduralMapOptions, preset?: MapPresetData): void {
    if (this.isDemoMode) {
      this.stopDemoMode();
    }

    if (preset) {
      this.engine.startPresetGame(preset);
    } else {
      this.engine.startProceduralGame(options ?? {
        topology: 'MULTI_SECTOR',
        difficulty: 'NORMAL',
        pacing: 'STANDARD',
        archetype: 'BALANCED',
      });
    }

    this.isDemoMode = true;
    this.isAutoPlayVerify = true;
    this.autoPlaySpeed = 1;
    this.isAutoPlayPaused = false;
    this.demoEndDelayFrames = 0;
    this.demoTurns = 0;
    this.demoStuckFrames = 0;
    this.lastDemoPos = null;
    this.magicDelayTimerMs = 0;
    this.magicSpecialNotice = null;

    this.demoBot = this.createBotInstance('STANDARD');

    // 自走検証用オーバーレイ表示
    const domUI = this.engine.getDomUI();
    const initialTip = `【自走検証開始】Phase: ${this.demoBot.currentPhase} | マップ探索を開始します`;
    domUI?.showAutoPlayOverlay(initialTip, 1);
    domUI?.updateAutoPlayToggleStatus(true);
    domUI?.addLog('🕹️ 自走検証（オートプレイ）を開始しました。画面上のボタンまたはESCで終了・操作引き継ぎが可能です。', 'info');

    this.setupAutoPlayInterval(180);
  }

  /**
   * 自走検証の進行速度を設定（1x, 2x, 5x, 0=一時停止）
   */
  public setAutoPlaySpeed(multiplier: number): void {
    this.autoPlaySpeed = multiplier;
    const domUI = this.engine.getDomUI();
    if (multiplier === 0) {
      this.isAutoPlayPaused = true;
      this.setupAutoPlayInterval(0);
      domUI?.addLog('⏸ 自走検証を一時停止しました。', 'info');
    } else {
      this.isAutoPlayPaused = false;
      const ms = Math.max(20, Math.round(180 / multiplier));
      this.setupAutoPlayInterval(ms);
      domUI?.addLog(`⏩ 自走検証速度を ${multiplier}x に変更しました。`, 'info');
    }
    domUI?.updateAutoPlaySpeedUI(multiplier);
  }

  /**
   * 自走検証インターバルの再構築
   */
  public setupAutoPlayInterval(intervalMs: number): void {
    if (typeof window !== 'undefined') {
      if (this.demoIntervalId !== null) {
        window.clearInterval(this.demoIntervalId);
        this.demoIntervalId = null;
      }
      if (intervalMs > 0 && !this.isAutoPlayPaused) {
        this.demoIntervalId = window.setInterval(() => {
          this.stepDemo();
        }, intervalMs);
      }
    }
  }

  /**
   * 自走検証からプレイヤー手動操作へシームレスに操作権を引き継ぐ (Takeover)
   */
  public takeoverAutoPlay(): void {
    if (!this.isAutoPlayVerify) return;

    if (this.demoIntervalId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.demoIntervalId);
      this.demoIntervalId = null;
    }
    this.isDemoMode = false;
    this.isAutoPlayVerify = false;
    this.demoBot = null;
    this.isAutoPlayPaused = false;
    this.magicDelayTimerMs = 0;
    this.magicSpecialNotice = null;

    const domUI = this.engine.getDomUI();
    domUI?.hideAutoPlayOverlay();
    domUI?.hideDemoOverlay();
    domUI?.updateAutoPlayToggleStatus(false);

    // 手動引き継ぎ時に元のサウンド状態を復元し、BGMを再開
    this.restoreSoundAfterDemo(true);

    domUI?.addLog('⚔ 手動操作に切り替えました！[A] または [Tab] キーでいつでも自動自走を再開できます。', 'success');
  }

  /**
   * 現在のゲーム状態（マップ・プレイヤー座標・所持品）を維持したまま自走モードを開始／再開
   */
  public startAutoPlayFromCurrentState(): void {
    if (this.engine.getState() !== 'PLAYING') return;

    if (this.demoIntervalId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.demoIntervalId);
      this.demoIntervalId = null;
    }

    this.isDemoMode = true;
    this.isAutoPlayVerify = true;
    this.autoPlaySpeed = this.autoPlaySpeed || 1;
    this.isAutoPlayPaused = false;
    this.demoEndDelayFrames = 0;
    this.demoStuckFrames = 0;
    this.lastDemoPos = { ...this.engine.getPlayer().pos };

    // 新たなAutoPlayBotインスタンスを生成（現在の状態から最適行動を自律判断）
    this.demoBot = this.createBotInstance('STANDARD');

    // 自走検証用オーバーレイ表示
    const domUI = this.engine.getDomUI();
    const initialTip = `【自走再開】Phase: ${this.demoBot.currentPhase} | 自動自走を再開しました [A / Tab / Enterで手動切替]`;
    domUI?.showAutoPlayOverlay(initialTip, this.autoPlaySpeed);
    domUI?.updateAutoPlayToggleStatus(true);
    domUI?.addLog('🤖 自動自走（Auto-Play）を再開しました。[A] / [Tab] / [Enter] キーでいつでも手動操作に戻せます。', 'info');

    const ms = Math.max(20, Math.round(180 / this.autoPlaySpeed));
    this.setupAutoPlayInterval(ms);
  }

  /**
   * 自動自走（Auto-Play） ⇔ 手動操作 のシームレス・トグル切り替え
   */
  public toggleAutoPlay(): void {
    if (this.engine.getState() !== 'PLAYING') return;

    if (this.isAutoPlayVerify) {
      this.takeoverAutoPlay();
    } else {
      this.startAutoPlayFromCurrentState();
    }
  }

  /**
   * 自走検証の終了（設定画面またはタイトル画面へ復帰）
   */
  public stopAutoPlayVerifyMode(returnToCustom: boolean = true): void {
    if (!this.isDemoMode) return;
    this.isAutoPlayVerify = false;
    this.isAutoPlayPaused = false;
    this.stopDemoMode();
    if (returnToCustom) {
      this.engine.getDomUI()?.openCustomModal();
    }
  }

  /**
   * デモ／自走検証モードの1ステップ進行（テスト・インターバル共通）
   */
  public stepDemo(): void {
    if (!this.isDemoMode || !this.demoBot) return;
    if (this.isAutoPlayPaused) return;

    const domUI = this.engine.getDomUI();

    // ゲームオーバーまたはステージクリア時は演出を少し見せてから終了
    if (this.engine.getState() !== 'PLAYING') {
      this.demoEndDelayFrames++;
      // 約2秒（180ms * 12フレーム ≈ 2.16秒）ウェイト後に復帰
      if (this.demoEndDelayFrames >= 12) {
        if (this.isAutoPlayVerify) {
          this.stopAutoPlayVerifyMode(true);
        } else {
          this.stopDemoMode();
        }
      }
      return;
    }
    this.demoEndDelayFrames = 0;

    // 魔法演出ディレイ待機（RETURN, JUMP発動時に約400〜500ms待機して視覚認識を保証）
    if (this.magicDelayTimerMs > 0) {
      const stepDuration = this.autoPlaySpeed > 0 ? Math.max(20, Math.round(180 / this.autoPlaySpeed)) : 180;
      this.magicDelayTimerMs = Math.max(0, this.magicDelayTimerMs - stepDuration);
      this.engine.stepFrame(stepDuration);
      if (this.magicSpecialNotice) {
        if (this.isAutoPlayVerify) {
          const statusText = `T:${this.demoTurns} | ${this.magicSpecialNotice} (演出待機中)`;
          domUI?.setDemoMessage(statusText);
        } else {
          domUI?.setDemoMessage(this.magicSpecialNotice);
        }
      }
      return;
    }
    this.magicSpecialNotice = null;

    this.demoTurns++;
    // 1. 最大ターン数制限（通常デモ: 500ターン / 自走検証: タイムアウト完全廃止で無制限）
    if (!this.isAutoPlayVerify) {
      const maxTurns = 500;
      if (this.demoTurns >= maxTurns) {
        const timeoutMsg = '⏱️【TIME OVER】デモプレイを終了しタイトル画面へ戻ります';
        domUI?.setDemoMessage(timeoutMsg);
        this.stopDemoMode();
        return;
      }
    }

    // 2. 身動き不能（スタック）早期タイムオーバー（通常デモ: 60フレーム / 自走検証: タイムアウト終了せずボット側自力脱出）
    const player = this.engine.getPlayer();
    const curPos = player.pos;
    if (this.lastDemoPos && curPos.x === this.lastDemoPos.x && curPos.y === this.lastDemoPos.y) {
      this.demoStuckFrames++;
      if (!this.isAutoPlayVerify) {
        const maxStuck = 60;
        if (this.demoStuckFrames >= maxStuck) {
          const stuckMsg = '⚠️【STUCK TIMEOUT】身動き不能のためデモを終了します';
          domUI?.setDemoMessage(stuckMsg);
          this.stopDemoMode();
          return;
        }
      } else {
        // 自走検証モード: 終了させず、ボットにスタック状態を通知してターゲットロック解除や自力脱出（安全徘徊）を促す
        if (this.demoStuckFrames >= 20) {
          this.demoBot.handleStuckRescue?.();
        }
      }
    } else {
      this.lastDemoPos = { ...curPos };
      this.demoStuckFrames = 0;
    }

    // リアルタイムタイマー更新 & Bot行動
    this.engine.stepFrame(100);
    this.demoBot.step(this.engine);

    // チュートリアルTips & 検証ステータス字幕更新
    if (this.isAutoPlayVerify) {
      const map = this.engine.getMap ? this.engine.getMap() : (this.engine as any).getWorldMap();
      const statusText = this.demoBot.getTelemetryStatus(player, map, this.demoTurns);
      domUI?.setDemoMessage(statusText);
    } else {
      const tip = this.demoBot.getTutorialMessage();
      domUI?.setDemoMessage(tip);
    }
  }

  /**
   * アトラクトデモ／自走検証の終了（タイトル画面へ復帰）
   */
  public stopDemoMode(): void {
    if (!this.isDemoMode) return;
    this.isDemoMode = false;
    this.isAutoPlayVerify = false;
    this.isAutoPlayPaused = false;
    this.autoPlaySpeed = 1;
    this.demoEndDelayFrames = 0;
    this.demoTurns = 0;
    this.demoStuckFrames = 0;
    this.lastDemoPos = null;
    this.magicDelayTimerMs = 0;
    this.magicSpecialNotice = null;

    if (this.demoIntervalId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.demoIntervalId);
      this.demoIntervalId = null;
    }
    this.demoBot = null;
    const domUI = this.engine.getDomUI();
    domUI?.hideDemoOverlay();
    domUI?.hideAutoPlayOverlay();
    domUI?.updateAutoPlayToggleStatus(false);

    this.engine.getAudio().stopBGM();

    // Demoモード終了時に元のサウンド状態を復元（タイトル画面ではBGMは停止維持）
    this.restoreSoundAfterDemo(false);

    // タイトル画面へ復帰
    this.engine.setState('TITLE');
    domUI?.setGameState('TITLE');
  }

  /**
   * Demoモード終了時・通常ゲーム開始時のサウンド状態復元
   */
  public restoreSoundAfterDemo(resumeBGM: boolean = false): void {
    if (this.savedMuteBeforeDemo !== null) {
      const originalMute = this.savedMuteBeforeDemo;
      this.savedMuteBeforeDemo = null;
      const audio = this.engine.getAudio();
      audio.setMuted(originalMute);
      this.engine.getDomUI()?.updateSoundStatus(originalMute);
      if (resumeBGM && !originalMute && this.engine.getState() === 'PLAYING') {
        audio.startBGM();
      }
    }
  }
}
