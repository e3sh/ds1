import { Direction } from '../models/Types.js';

export type ActionCallback = (dir: Direction | null) => void;
export type MagicSelectCallback = (index?: number) => void;
export type MagicCastCallback = () => void;
export type SimpleCallback = () => void;
export type AnyKeyCallback = (code?: string) => boolean | void;

export class InputManager {
  private activeKeys: Set<string> = new Set();
  private onAction?: ActionCallback;
  private onMagicSelect?: MagicSelectCallback;
  private onMagicCast?: MagicCastCallback;
  private onToggleMap?: SimpleCallback;
  private onRestart?: SimpleCallback;
  private onGiveUp?: SimpleCallback;
  private onContinue?: SimpleCallback;
  private onConfirmYes?: SimpleCallback;
  private onConfirmNo?: SimpleCallback;
  private onToggleMarker?: SimpleCallback;
  private onToggleInspect?: SimpleCallback;
  private onToggleAutoPlay?: SimpleCallback;
  private onDemo?: SimpleCallback;
  private onAnyKey?: AnyKeyCallback;

  constructor() {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyDown);
      window.addEventListener('keyup', this.handleKeyUp);
    }
  }

  public setOnAction(cb: ActionCallback): void {
    this.onAction = cb;
  }

  public setOnMagicSelect(cb: MagicSelectCallback): void {
    this.onMagicSelect = cb;
  }

  public setOnMagicCast(cb: MagicCastCallback): void {
    this.onMagicCast = cb;
  }

  public setOnToggleMap(cb: SimpleCallback): void {
    this.onToggleMap = cb;
  }

  public setOnRestart(cb: SimpleCallback): void {
    this.onRestart = cb;
  }

  public setOnGiveUp(cb: SimpleCallback): void {
    this.onGiveUp = cb;
  }

  public setOnContinue(cb: SimpleCallback): void {
    this.onContinue = cb;
  }

  public setOnConfirmYes(cb: SimpleCallback): void {
    this.onConfirmYes = cb;
  }

  public setOnConfirmNo(cb: SimpleCallback): void {
    this.onConfirmNo = cb;
  }

  public setOnToggleMarker(cb: SimpleCallback): void {
    this.onToggleMarker = cb;
  }

  public setOnToggleInspect(cb: SimpleCallback): void {
    this.onToggleInspect = cb;
  }

  public setOnToggleAutoPlay(cb: SimpleCallback): void {
    this.onToggleAutoPlay = cb;
  }

  public setOnDemo(cb: SimpleCallback): void {
    this.onDemo = cb;
  }

  public setOnAnyKey(cb: AnyKeyCallback): void {
    this.onAnyKey = cb;
  }

  public destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeyDown);
      window.removeEventListener('keyup', this.handleKeyUp);
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // 矢印キーなどのデフォルトスクロールを防止
    if (
      [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Space',
        'Numpad8',
        'Numpad2',
        'Numpad4',
        'Numpad6',
        'Numpad7',
        'Numpad9',
        'Numpad1',
        'Numpad3',
        'Tab',
      ].includes(e.code)
    ) {
      e.preventDefault();
    }

    if (this.activeKeys.has(e.code)) return;
    this.activeKeys.add(e.code);

    // 任意のキー押下通知（デモ中断・アイドル解除・自走検証キー操作用）
    if (this.onAnyKey) {
      const consumed = this.onAnyKey(e.code);
      if (consumed) {
        return;
      }
    }

    // デモ・チュートリアル起動 (D キー)
    if (e.code === 'KeyD' && this.onDemo) {
      this.onDemo();
      return;
    }

    // 確認ダイアログ時の [Y] (YES) / [N] または [Escape] (NO)
    if (e.code === 'KeyY' && this.onConfirmYes) {
      this.onConfirmYes();
      return;
    }
    if ((e.code === 'KeyN' || e.code === 'Escape') && this.onConfirmNo) {
      this.onConfirmNo();
      return;
    }

    // ギブアップ (Q キー)
    if (e.code === 'KeyQ' && this.onGiveUp) {
      this.onGiveUp();
      return;
    }

    // コンティニュー (C キー)
    if (e.code === 'KeyC' && this.onContinue) {
      this.onContinue();
      return;
    }

    // リトライ (R キー)
    if (e.code === 'KeyR' && this.onRestart) {
      this.onRestart();
      return;
    }

    // 敵相対マーカー切替 (T キー)
    if (e.code === 'KeyT' && this.onToggleMarker) {
      this.onToggleMarker();
      return;
    }

    // インスペクタ表示切替 (I キー)
    if (e.code === 'KeyI' && this.onToggleInspect) {
      this.onToggleInspect();
      return;
    }

    // 自動自走 ⇔ 手動操作のシームレス切替 (Tab キー または P キー)
    if ((e.code === 'Tab' || e.code === 'KeyP') && this.onToggleAutoPlay) {
      this.onToggleAutoPlay();
      return;
    }

    // 魔法選択 (M キーで順送り、または数字キー 1〜9)
    if (e.code === 'KeyM' && this.onMagicSelect) {
      this.onMagicSelect();
      return;
    }
    if (e.code.startsWith('Digit') && this.onMagicSelect) {
      const num = parseInt(e.code.replace('Digit', ''), 10);
      if (num >= 1 && num <= 9) {
        this.onMagicSelect(num - 1);
        return;
      }
    }

    // 魔法発動 (X キー または Enter)
    if ((e.code === 'KeyX' || e.code === 'Enter') && this.onMagicCast) {
      this.onMagicCast();
      return;
    }

    // ミニマップ閉じ (Escape)
    if (e.code === 'Escape' && this.onToggleMap) {
      this.onToggleMap();
      return;
    }

    const dir = this.resolveDirection(e.code);
    if (dir !== undefined && this.onAction) {
      this.onAction(dir);
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.activeKeys.delete(e.code);
  }

  private resolveDirection(code: string): Direction | null | undefined {
    // パス/待機 (Space)
    if (code === 'Space') {
      return null;
    }

    // 単一キーによる4方向
    if (code === 'ArrowUp' || code === 'KeyW' || code === 'Numpad8') return 'UP';
    if (code === 'ArrowDown' || code === 'KeyS' || code === 'Numpad2') return 'DOWN';
    if (code === 'ArrowLeft' || code === 'KeyA' || code === 'Numpad4') return 'LEFT';
    if (code === 'ArrowRight' || code === 'KeyD' || code === 'Numpad6') return 'RIGHT';

    // テンキーまたはEZによる斜め (Qはギブアップ、Cはコンティニューに優先)
    if (code === 'Numpad7') return 'UP_LEFT';
    if (code === 'Numpad9' || code === 'KeyE') return 'UP_RIGHT';
    if (code === 'Numpad1' || code === 'KeyZ') return 'DOWN_LEFT';
    if (code === 'Numpad3') return 'DOWN_RIGHT';

    return undefined;
  }
}
