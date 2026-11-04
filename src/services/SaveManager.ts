import { PlayerSaveData } from '../models/Player.js';
import { WorldMapSaveData } from '../models/WorldMap.js';
import { EnemySaveData } from '../models/Enemy.js';
import { DragonSaveData } from '../models/Dragon.js';
import { GhostSaveData } from '../models/Ghost.js';
import { PaletteMode, ResolvedDungeonTuningParams } from '../models/Types.js';
import { ProceduralMapOptions } from '../systems/ProceduralMapGenerator.js';
import {
  SaveStorageDriver,
  BrowserLocalStorageDriver,
  InMemoryStorageDriver,
} from './SaveStorageDriver.js';

export const SAVE_DATA_KEY = 'DS1_SAVEDATA';
export const CURRENT_SAVE_VERSION = '1.0.0';

export interface SystemSaveData {
  totalTurns: number;
  paletteMode: PaletteMode;
  selectedMagicIndex: number;
  showMiniMap: boolean;
  spawnTurnCounter: number;
  tuningParams?: ResolvedDungeonTuningParams;
  isProceduralMode?: boolean;
  proceduralOptions?: ProceduralMapOptions;
}

export interface FullSaveData {
  version: string;
  savedAt: string;
  player: PlayerSaveData;
  map: WorldMapSaveData;
  enemies: EnemySaveData[];
  dragon: DragonSaveData;
  ghosts: GhostSaveData[];
  system: SystemSaveData;
}

export interface SaveSummary {
  savedAt: string;
  formattedTime: string;
  kills: number;
  crowns: number;
  hp: number;
  exp: number;
}

export class SaveManager {
  private static customDriver: SaveStorageDriver | null = null;
  private static inMemoryDriver: SaveStorageDriver = new InMemoryStorageDriver();

  /**
   * 使用するストレージドライバーを差し替える（テストやNode.js用）
   */
  public static setDriver(driver: SaveStorageDriver | null): void {
    this.customDriver = driver;
  }

  /**
   * 現在のストレージドライバーを取得
   */
  public static getDriver(): SaveStorageDriver {
    if (this.customDriver) return this.customDriver;
    if (typeof localStorage !== 'undefined') {
      return new BrowserLocalStorageDriver();
    }
    return this.inMemoryDriver;
  }

  /**
   * ゲーム状態をストレージに保存
   */
  public static save(data: FullSaveData): boolean {
    try {
      const serialized = JSON.stringify(data);
      this.getDriver().setItem(SAVE_DATA_KEY, serialized);
      return true;
    } catch (e) {
      console.error('[SaveManager] Failed to save game data:', e);
      return false;
    }
  }

  /**
   * ストレージからゲーム状態をロード
   * バージョンチェックおよびデータ破損の検証を含む
   */
  public static load(): FullSaveData | null {
    try {
      const raw = this.getDriver().getItem(SAVE_DATA_KEY);
      if (!raw) return null;

      const data = JSON.parse(raw) as FullSaveData;

      // バージョンおよび最低限の整合性検証
      if (!data || data.version !== CURRENT_SAVE_VERSION) {
        console.warn(`[SaveManager] Incompatible save data version: ${data?.version} (Expected: ${CURRENT_SAVE_VERSION})`);
        return null;
      }

      if (!data.player || !data.map || !data.dragon) {
        console.warn('[SaveManager] Corrupted save data structure');
        return null;
      }

      return data;
    } catch (e) {
      console.error('[SaveManager] Error loading save data:', e);
      return null;
    }
  }

  /**
   * 有効なセーブデータが存在するか
   */
  public static hasSave(): boolean {
    return this.load() !== null;
  }

  /**
   * セーブデータを削除
   */
  public static clear(): void {
    try {
      this.getDriver().removeItem(SAVE_DATA_KEY);
    } catch (e) {
      console.error('[SaveManager] Failed to clear save data:', e);
    }
  }

  /**
   * タイトル画面等の表示用サマリー情報を取得
   */
  public static getSummary(): SaveSummary | null {
    const data = this.load();
    if (!data) return null;

    let formattedTime = '不明';
    try {
      const d = new Date(data.savedAt);
      formattedTime = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    } catch {
      // ignore
    }

    return {
      savedAt: data.savedAt,
      formattedTime,
      kills: data.player.totalKills ?? 0,
      crowns: data.player.crowns ?? 0,
      hp: data.player.hp,
      exp: data.player.experience,
    };
  }
}
