import { DOMUIManager } from '../../view/DOMUIManager.js';
import { InputManager } from '../InputManager.js';
import { InspectorData } from '../../view/InspectorModal.js';
import { MagicSystem } from '../../systems/MagicSystem.js';
import { ProceduralMapOptions } from '../../systems/ProceduralMapGenerator.js';
import { MapPresetData } from '../../services/MapPresetManager.js';
import type { GameEngine } from '../GameEngine.js';

export class EngineUIAndInputBinder {
  private engine: GameEngine;
  private isTacticalMarkerEnabled: boolean = true;

  constructor(engine: GameEngine) {
    this.engine = engine;
  }

  public isMarkerEnabled(): boolean {
    return this.isTacticalMarkerEnabled;
  }

  /**
   * DOMUIManager を生成し、全イベントコールバックをバインド
   */
  public bindDOMUI(containerId: string = 'dom-ui-layer'): DOMUIManager {
    const domUI = new DOMUIManager(containerId, {
      onSelectMagic: (idx) => {
        if (this.engine.isDemoActive()) {
          this.engine.stopDemoMode();
          return;
        }
        this.engine.setSelectedMagicIndex(idx);
      },
      onCastMagic: () => {
        if (this.engine.isDemoActive()) {
          this.engine.stopDemoMode();
          return;
        }
        this.engine.castSelectedMagic();
      },
      onStartGame: () => {
        if (this.engine.isDemoActive()) {
          this.engine.stopDemoMode();
          return;
        }
        this.engine.startGame();
      },
      onStartProceduralGame: (options?: ProceduralMapOptions) => {
        if (this.engine.isDemoActive()) {
          this.engine.stopDemoMode();
          return;
        }
        this.engine.startProceduralGame(options);
      },
      onRestartGame: () => {
        if (this.engine.isDemoActive()) {
          this.engine.stopDemoMode();
          return;
        }
        this.engine.resetGame();
      },
      onToggleSound: () => {
        this.engine.toggleSound();
      },
      onGiveUp: () => {
        if (this.engine.isDemoActive()) {
          this.engine.stopDemoMode();
          return;
        }
        this.engine.promptGiveUp();
      },
      onConfirmGiveUp: () => {
        this.engine.handleGiveUp();
      },
      onSaveAndQuit: () => {
        this.engine.saveAndQuit();
      },
      onContinueGame: () => {
        if (this.engine.isDemoActive()) {
          this.engine.stopDemoMode();
          return;
        }
        this.engine.continueGame();
      },
      onToggleMarker: () => {
        if (this.engine.isDemoActive()) {
          this.engine.stopDemoMode();
          return;
        }
        this.toggleMarker();
      },
      onToggleInspect: () => {
        if (this.engine.isDemoActive()) {
          this.engine.stopDemoMode();
          return;
        }
        this.toggleInspector();
      },
      onToggleHelp: () => {
        if (this.engine.isDemoActive()) {
          this.engine.stopDemoMode();
          return;
        }
        this.toggleHelp();
      },
      onSaveMapPreset: (name?: string) => {
        this.engine.saveCurrentMapAsPreset(name);
      },
      onStartPresetGame: (preset: MapPresetData) => {
        if (this.engine.isDemoActive()) {
          this.engine.stopDemoMode();
          return;
        }
        this.engine.startPresetGame(preset);
      },
      onStartDemo: () => {
        this.engine.startDemoMode();
      },
      onExitDemo: () => {
        this.engine.stopDemoMode();
      },
      onStartAutoPlayVerify: (options?: ProceduralMapOptions, preset?: MapPresetData) => {
        this.engine.startAutoPlayVerifyMode(options, preset);
      },
      onChangeAutoPlaySpeed: (multiplier: number) => {
        this.engine.setAutoPlaySpeed(multiplier);
      },
      onTakeoverAutoPlay: () => {
        this.engine.takeoverAutoPlay();
      },
      onToggleAutoPlay: () => {
        this.engine.toggleAutoPlay();
      },
      onExitAutoPlayVerify: () => {
        this.engine.stopAutoPlayVerifyMode(true);
      },
    });

    return domUI;
  }

  /**
   * InputManager の各キー入力イベントをバインド
   */
  public bindInputHandlers(inputManager: InputManager): void {
    // ターンタイムアウト時のコールバック
    this.engine.getTurnManager().setOnTurnTimeout(() => {
      if (this.engine.getState() === 'PLAYING') {
        this.engine.executeTurn(null, true);
      }
    });

    // 方向キー・スペース入力時のコールバック
    inputManager.setOnAction((dir) => {
      // デモ再生中は任意の入力でデモを中断しタイトルへ復帰
      if (this.engine.isDemoActive()) {
        this.engine.stopDemoMode();
        return;
      }

      if (this.engine.getState() === 'TITLE') {
        // スペースまたはEnterで開始
        if (dir === null) {
          this.engine.startGame();
        }
        return;
      }

      if (this.engine.getState() === 'GAMEOVER' || this.engine.getState() === 'STAGECLEAR') {
        if (dir === null) {
          this.engine.resetGame();
        }
        return;
      }

      if (this.engine.getState() === 'PLAYING') {
        // ミニマップが開いている場合は閉じる
        if (this.engine.getShowMiniMap()) {
          this.engine.setShowMiniMap(false);
        }
        this.engine.executeTurn(dir);
      }
    });

    // リトライ (R キー)
    inputManager.setOnRestart(() => {
      if (this.engine.isDemoActive()) {
        this.engine.stopDemoMode();
        return;
      }
      if (this.engine.getState() === 'GAMEOVER' || this.engine.getState() === 'STAGECLEAR') {
        this.engine.resetGame();
      }
    });

    // 魔法選択コールバック
    inputManager.setOnMagicSelect((index) => {
      if (this.engine.isDemoActive()) {
        this.engine.stopDemoMode();
        return;
      }
      if (this.engine.getState() !== 'PLAYING') return;

      const player = this.engine.getPlayer();
      const unlocked = MagicSystem.getUnlockedMagics(player);
      if (unlocked.length === 0) return;

      if (index !== undefined) {
        if (index < unlocked.length) {
          this.engine.setSelectedMagicIndex(index);
        }
      } else {
        const curIdx = this.engine.getSelectedMagicIndex();
        this.engine.setSelectedMagicIndex((curIdx + 1) % unlocked.length);
      }
    });

    // 魔法発動コールバック
    inputManager.setOnMagicCast(() => {
      if (this.engine.isDemoActive()) {
        this.engine.stopDemoMode();
        return;
      }
      if (this.engine.getState() === 'TITLE') {
        this.engine.startGame();
        return;
      }
      if (this.engine.getState() === 'GAMEOVER' || this.engine.getState() === 'STAGECLEAR') {
        this.engine.resetGame();
        return;
      }
      if (this.engine.getState() === 'PLAYING') {
        this.engine.castSelectedMagic();
      }
    });

    // ミニマップ切り替えコールバック
    inputManager.setOnToggleMap(() => {
      if (this.engine.isDemoActive()) {
        this.engine.stopDemoMode();
        return;
      }
      if (this.engine.getState() === 'PLAYING') {
        this.engine.setShowMiniMap(!this.engine.getShowMiniMap());
      }
    });

    // 敵相対マーカー表示切り替えコールバック (T キー)
    inputManager.setOnToggleMarker(() => {
      if (this.engine.isDemoActive()) {
        this.engine.stopDemoMode();
        return;
      }
      this.toggleMarker();
    });

    // インスペクタ表示切り替えコールバック (I キー)
    inputManager.setOnToggleInspect(() => {
      if (this.engine.isDemoActive()) {
        this.engine.stopDemoMode();
        return;
      }
      this.toggleInspector();
    });

    // アイテム＆ルールヘルプ表示切り替えコールバック (H キー)
    inputManager.setOnToggleHelp(() => {
      if (this.engine.isDemoActive()) {
        this.engine.stopDemoMode();
        return;
      }
      this.toggleHelp();
    });

    // ギブアップ (Q キー) コールバック
    inputManager.setOnGiveUp(() => {
      if (this.engine.isDemoActive()) {
        this.engine.stopDemoMode();
        return;
      }
      if (this.engine.getState() === 'PLAYING') {
        this.engine.promptGiveUp();
      }
    });

    // コンティニュー (C キー) コールバック
    inputManager.setOnContinue(() => {
      if (this.engine.isDemoActive()) {
        this.engine.stopDemoMode();
        return;
      }
      if (this.engine.getState() === 'TITLE') {
        this.engine.continueGame();
      }
    });

    // ギブアップ確認ダイアログ用 [Y] / [N]
    inputManager.setOnConfirmYes(() => {
      if (this.engine.getDomUI()?.isGiveUpConfirmOpen()) {
        this.engine.handleGiveUp();
      }
    });
    inputManager.setOnConfirmNo(() => {
      if (this.engine.getDomUI()?.isGiveUpConfirmOpen()) {
        this.engine.getDomUI()?.hideGiveUpConfirm();
      }
    });

    // デモ・チュートリアル起動 (D キー)
    inputManager.setOnDemo(() => {
      if (this.engine.isDemoActive()) {
        this.engine.stopDemoMode();
        return;
      }
      if (this.engine.getState() === 'TITLE') {
        this.engine.startDemoMode();
      }
    });

    // 自動自走 ⇔ 手動操作のシームレス切替 (Tab キー または P キー)
    inputManager.setOnToggleAutoPlay(() => {
      this.engine.toggleAutoPlay();
    });

    // 任意のキー押下通知（デモ中断、自走検証キー操作、または放置タイマーリセット）
    inputManager.setOnAnyKey((code?: string) => {
      if (this.engine.isDemoActive()) {
        if (this.engine.isAutoPlayVerifyActive()) {
          // 自走検証モード時: ESCキーで終了、Enter/Tab/Pキーで操作引き継ぎ、それ以外のキーは誤操作防止のため消費
          if (code === 'Escape') {
            this.engine.stopAutoPlayVerifyMode(true);
            return true;
          }
          if (code === 'Enter' || code === 'Tab' || code === 'KeyP') {
            this.engine.takeoverAutoPlay();
            return true;
          }
          return true;
        }
        // 通常アトラクトデモ時: 任意のキーでタイトル画面へ即復帰
        this.engine.stopDemoMode();
        return true;
      } else if (this.engine.getState() === 'TITLE') {
        this.engine.getDomUI()?.resetIdleTimer();
      }
      return false;
    });
  }

  /**
   * 敵相対5段階マーカーの表示切り替え（TACTICAL / RETRO）
   */
  public toggleMarker(): void {
    this.isTacticalMarkerEnabled = !this.isTacticalMarkerEnabled;
    const renderer = this.engine.getRenderer();
    if (renderer) {
      renderer.setTacticalMarker(this.isTacticalMarkerEnabled);
    }
    const domUI = this.engine.getDomUI();
    if (domUI) {
      domUI.updateMarkerStatus(this.isTacticalMarkerEnabled);
      domUI.addLog(
        this.isTacticalMarkerEnabled
          ? '🎯 敵相対マーカー: TACTICAL表示（5段階評価）に切り替えました。'
          : '📜 敵相対マーカー: RETRO表示（原作再現・黒シャドウ）に切り替えました。',
        'info'
      );
    }
  }

  /**
   * ダンジョン構造＆成長パラメータインスペクタの表示切り替え
   */
  public toggleInspector(): void {
    const domUI = this.engine.getDomUI();
    if (!domUI) return;
    const inspectorData: InspectorData = {
      map: this.engine.getMap(),
      player: this.engine.getPlayer(),
      dragon: this.engine.getDragon(),
      ghosts: this.engine.getGhosts(),
      enemies: this.engine.getEnemies(),
      tuningParams: this.engine.getActiveTuningParams(),
      isProceduralMode: this.engine.isProceduralModeState(),
      proceduralOptions: this.engine.getProceduralOptions(),
      totalTurns: this.engine.getTotalTurns(),
    };
    domUI.toggleInspector(inspectorData);
  }

  /**
   * アイテム＆ルールヘルプモーダルの表示切り替え
   */
  public toggleHelp(): void {
    const domUI = this.engine.getDomUI();
    if (!domUI) return;
    domUI.toggleHelp();
  }
}
