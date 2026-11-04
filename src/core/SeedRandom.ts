/**
 * 決定論的擬似乱数生成器 (Deterministic Seedable PRNG)
 * 32-bit Mulberry32 アルゴリズムに基づき、同一シードから100%同一の乱数列を再現可能。
 * ヘッドレスシミュレーション、A/Bテスト、リプレイ再生の基盤として機能する。
 */
export class SeedRandom {
  private state: number;
  private readonly initialSeed: number;

  constructor(seed: number | string = Date.now()) {
    if (typeof seed === 'string') {
      let hash = 0;
      for (let i = 0; i < seed.length; i++) {
        hash = (Math.imul(31, hash) + seed.charCodeAt(i)) | 0;
      }
      this.state = hash >>> 0;
    } else {
      this.state = seed >>> 0;
    }

    if (this.state === 0) {
      this.state = 0x6d2b79f5;
    }
    this.initialSeed = this.state;
  }

  /**
   * 初期シード値を取得
   */
  public getSeed(): number {
    return this.initialSeed;
  }

  /**
   * 現在の内部状態を取得（シリアライズ・スナップショット用）
   */
  public getState(): number {
    return this.state;
  }

  /**
   * 内部状態を復元
   */
  public setState(state: number): void {
    this.state = state >>> 0;
  }

  /**
   * 0.0 以上 1.0 未満の浮動小数点乱数を返す
   */
  public next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * min 以上 max 以下の整数乱数を返す [min, max]
   */
  public nextInt(min: number, max: number): number {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return Math.floor(this.next() * (hi - lo + 1)) + lo;
  }

  /**
   * min 以上 max 未満の浮動小数乱数を返す [min, max)
   */
  public nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * 確率 probability (0.0 〜 1.0) で true を返す
   */
  public chance(probability: number): boolean {
    return this.next() < probability;
  }

  /**
   * 配列からランダムに1要素を選択
   */
  public choice<T>(array: T[]): T {
    if (array.length === 0) {
      throw new Error('SeedRandom.choice: cannot choose from empty array');
    }
    return array[Math.floor(this.next() * array.length)];
  }

  /**
   * Fisher-Yates アルゴリズムによる配列のシャッフル（元配列は変更せず新規配列を返す）
   */
  public shuffle<T>(array: T[]): T[] {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /**
   * Fisher-Yates アルゴリズムによる配列のインプレースシャッフル
   */
  public shuffleInPlace<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * サブシステムや独立シミュレーション用の派生 PRNG インスタンスを生成 (Fork)
   */
  public fork(subSeedModifier?: number | string): SeedRandom {
    if (subSeedModifier !== undefined) {
      const sub = typeof subSeedModifier === 'number' ? subSeedModifier : (new SeedRandom(subSeedModifier)).getSeed();
      return new SeedRandom((this.next() * 0xffffffff) ^ sub);
    }
    return new SeedRandom(this.nextInt(1, 0x7fffffff));
  }
}
