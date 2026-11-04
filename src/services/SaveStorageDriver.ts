/**
 * セーブデータストレージの抽象化ドライバーインターフェース
 * ブラウザ (localStorage) と Node.js ヘッドレス環境 (InMemory) の差異を吸収する。
 */
export interface SaveStorageDriver {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

/**
 * ブラウザ環境向け LocalStorage ドライバー
 */
export class BrowserLocalStorageDriver implements SaveStorageDriver {
  public getItem(key: string): string | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage.getItem(key);
  }

  public setItem(key: string, value: string): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
  }

  public removeItem(key: string): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  }

  public clear(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  }
}

/**
 * Node.js ヘッドレス環境 / テスト用 インメモリストレージドライバー
 */
export class InMemoryStorageDriver implements SaveStorageDriver {
  private store: Map<string, string> = new Map();

  public getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  public removeItem(key: string): void {
    this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }

  /**
   * テスト・デバッグ用: 格納されているキー一覧を取得
   */
  public keys(): string[] {
    return Array.from(this.store.keys());
  }
}
