import {
  GameEventMap,
  GameEventName,
  GameEventListener,
  WildcardGameEventListener,
} from './GameEvents.js';

/**
 * 型安全なゲーム内ドメインイベントバス (GameEventBus)
 * エンジンとUI/演出/音声/テレメトリ収集器を完全疎結合化し、
 * Pub/Sub パターンでドメインイベントを配信する。
 */
export class GameEventBus {
  private listeners: Map<GameEventName, Set<GameEventListener<any>>> = new Map();
  private wildcardListeners: Set<WildcardGameEventListener> = new Set();

  /**
   * 指定イベントのリスナーを登録
   */
  public on<K extends GameEventName>(event: K, listener: GameEventListener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);

    // 解除関数を返す
    return () => this.off(event, listener);
  }

  /**
   * 1回のみ発火するリスナーを登録
   */
  public once<K extends GameEventName>(event: K, listener: GameEventListener<K>): () => void {
    const wrapper: GameEventListener<K> = (payload) => {
      this.off(event, wrapper);
      listener(payload);
    };
    return this.on(event, wrapper);
  }

  /**
   * 指定イベントのリスナーを解除
   */
  public off<K extends GameEventName>(event: K, listener: GameEventListener<K>): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * 全てのイベントを購読するワイルドカードリスナーを登録（テレメトリ/ログ用）
   */
  public onAny(listener: WildcardGameEventListener): () => void {
    this.wildcardListeners.add(listener);
    return () => {
      this.wildcardListeners.delete(listener);
    };
  }

  /**
   * イベントを発行 (Publish)
   */
  public emit<K extends GameEventName>(event: K, payload: GameEventMap[K]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const listener of set) {
        try {
          listener(payload);
        } catch (err) {
          console.error(`[GameEventBus] Error in listener for event "${event}":`, err);
        }
      }
    }

    if (this.wildcardListeners.size > 0) {
      for (const wildcard of this.wildcardListeners) {
        try {
          wildcard(event, payload);
        } catch (err) {
          console.error(`[GameEventBus] Error in wildcard listener for event "${event}":`, err);
        }
      }
    }
  }

  /**
   * 全リスナーを解除
   */
  public clear(): void {
    this.listeners.clear();
    this.wildcardListeners.clear();
  }

  /**
   * 登録されているリスナー総数を取得
   */
  public getListenerCount(event?: GameEventName): number {
    if (event) {
      return this.listeners.get(event)?.size ?? 0;
    }
    let count = this.wildcardListeners.size;
    for (const set of this.listeners.values()) {
      count += set.size;
    }
    return count;
  }
}
