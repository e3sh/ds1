import { PaletteMode } from '../models/Types.js';

export class PaletteManager {
  private currentMode: PaletteMode = 'NORMAL';

  public setMode(mode: PaletteMode): void {
    this.currentMode = mode;
  }

  public getMode(): PaletteMode {
    return this.currentMode;
  }

  public updateByPlayerHP(hp: number, allHeadsDefeated: boolean): void {
    if (allHeadsDefeated) {
      this.currentMode = 'DARK';
    } else if (hp < 500 && hp > 0) {
      this.currentMode = 'PINCH';
    } else {
      this.currentMode = 'NORMAL';
    }
  }

  public getThemeClass(): string {
    switch (this.currentMode) {
      case 'PINCH':
        return 'theme-pinch';
      case 'DARK':
        return 'theme-dark';
      case 'NORMAL':
      default:
        return 'theme-normal';
    }
  }

  // フィールドの背景色（ダンジョン床）
  public get fieldBackgroundColor(): string {
    switch (this.currentMode) {
      case 'PINCH':
        return '#3a0000'; // 危険を告げる赤暗色
      case 'DARK':
        return '#000000'; // 終盤の漆黒
      case 'NORMAL':
      default:
        return '#002800'; // PC-88風 深い暗緑
    }
  }

  // 壁・岩などの基本アクセント色（原色のギラつきを抑えた落ち着いた石材トーン）
  public get wallColor(): string {
    switch (this.currentMode) {
      case 'PINCH':
        return '#882222'; // 落ち着いた深紅石
      case 'DARK':
        return '#254477'; // 落ち着いた深青石
      case 'NORMAL':
      default:
        return '#236e3a'; // 落ち着いた深緑石
    }
  }

  public get wallInnerColor(): string {
    switch (this.currentMode) {
      case 'PINCH':
        return '#441111';
      case 'DARK':
        return '#12223c';
      case 'NORMAL':
      default:
        return '#10381d';
    }
  }
}
