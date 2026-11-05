import { MapDifficulty, PlayPacingMode, DungeonTopology, DungeonArchetype } from '../models/Types.js';
import { DragonPrefabType, HomePrefabType } from '../systems/ProceduralMapGenerator.js';

export const MAP_PRESETS_STORAGE_KEY = 'DS1_MAP_PRESETS';
export const SHARE_CODE_PREFIX = 'DS1MAP:';

export type PresetBotStatus = 'CLEARED' | 'UNBEATEN_BY_BOT' | 'FAILED';

export interface MapPresetMetrics {
  dragonSectorName?: string;
  dragonPos?: { x: number; y: number };
  homePos?: { x: number; y: number };
  cleared?: boolean;
  clearTurns?: number;
  highScore?: number;

  // Phase 14 / Seed Observatory 拡張フィールド
  estimatedTopology?: DungeonTopology;
  estimatedDifficulty?: 'EASY' | 'NORMAL' | 'HARD' | 'NIGHTMARE';
  estimatedPacing?: PlayPacingMode;
  botStatus?: PresetBotStatus;
  botTurns?: number;
  challengeRating?: number;
  tags?: string[];
  playerCleared?: boolean;
  playerClearTurns?: number;
  isUnbeatenChallenge?: boolean;
}

export interface MapPresetData {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  isCurated?: boolean;
  seed: number;
  options: {
    difficulty: MapDifficulty;
    pacing: PlayPacingMode;
    topology: DungeonTopology;
    archetype?: DungeonArchetype;
    dragonPrefab?: DragonPrefabType;
    homePrefab?: HomePrefabType;
  };
  metrics?: MapPresetMetrics;
}

/**
 * 初回から選択可能な「公式おすすめプリセット (Curated Presets)」
 */
export const CURATED_PRESETS: MapPresetData[] = [
  {
    id: 'curated_grand_hall',
    name: '👑 龍の大広間 (Grand Hall of the Dragon)',
    description: '広大な大広間の中央に3首ドラゴンが鎮座するドラマチックなマップ。周囲からの火炎弾に注意。',
    createdAt: 1730000000000,
    isCurated: true,
    seed: 777777,
    options: {
      difficulty: 'NORMAL',
      pacing: 'STANDARD',
      topology: 'MULTI_SECTOR',
      archetype: 'BALANCED',
      dragonPrefab: 'FORTRESS_7x7',
    },
    metrics: {
      dragonSectorName: 'CENTER',
    },
  },
  {
    id: 'curated_corridor_lair',
    name: '🐉 回廊奥の古龍 (Corridor Lair)',
    description: '細長いロングコリドーの最深部に巣食うドラゴン。退路のない直線火炎弾を突破せよ。',
    createdAt: 1730000001000,
    isCurated: true,
    seed: 888888,
    options: {
      difficulty: 'HARD',
      pacing: 'BLITZ',
      topology: 'NARROW_MAZE',
      archetype: 'BALANCED',
      dragonPrefab: 'COMPACT_5x5',
    },
    metrics: {
      dragonSectorName: 'SOUTH_EAST',
    },
  },
  {
    id: 'curated_sanctuary_guardian',
    name: '✝️ 聖域の守護者 (Sanctuary Guardian)',
    description: '十字架が多数配置された聖域マップ。ゴーストから王冠を守る結界戦術が鍵。',
    createdAt: 1730000002000,
    isCurated: true,
    seed: 999999,
    options: {
      difficulty: 'NORMAL',
      pacing: 'MARATHON',
      topology: 'MULTI_SECTOR',
      archetype: 'SANCTUARY',
      dragonPrefab: 'COMPACT_5x5',
    },
  },
  {
    id: 'curated_armory_nexus',
    name: '⚔️ 四神の武器庫 (Armory Nexus)',
    description: '多数の剣とワープゾーンが張り巡らされた武器庫迷宮。予備武器を活用して攻略せよ。',
    createdAt: 1730000003000,
    isCurated: true,
    seed: 333333,
    options: {
      difficulty: 'NORMAL',
      pacing: 'STANDARD',
      topology: 'PILLAR_GRID',
      archetype: 'ARMORY',
      dragonPrefab: 'FORTRESS_7x7',
    },
  },
  {
    id: 'curated_spiral_roar',
    name: '🌀 螺旋迷宮の咆哮 (Spiral Roar)',
    description: '渦巻き状の回廊が中央へ続く高密度ラビリンス。岩押しパズルの腕が試される。',
    createdAt: 1730000004000,
    isCurated: true,
    seed: 555555,
    options: {
      difficulty: 'HARD',
      pacing: 'STANDARD',
      topology: 'SPIRAL_LABYRINTH',
      archetype: 'BALANCED',
      dragonPrefab: 'COMPACT_5x5',
    },
  },
  {
    id: 'curated_hierarchical_citadel',
    name: '🏰 宝物殿城塞の巨龍 (Citadel of the Grand Vault)',
    description: '16×16大宝物殿と城塞ドラゴン、8歩周期宝物庫が連結したPhase 14階層テーマブロック合成の決定版マップ。',
    createdAt: 1730000005000,
    isCurated: true,
    seed: 123456,
    options: {
      difficulty: 'NORMAL',
      pacing: 'BLITZ',
      topology: 'FORTRESS_ARENA',
      archetype: 'BALANCED',
      dragonPrefab: 'FORTRESS_7x7',
    },
  },
  {
    id: 'curated_unbeaten_nightmare',
    name: '🤖 ボット未踏破：奈落の深層要塞 (Nightmare Deep Fortress)',
    description: '物理的解法性は100%保証されつつも、標準AutoPlayBotが1600ターンで解ききれなかった難攻不落マップ。プレイヤーの挑戦を求む！',
    createdAt: 1730000006000,
    isCurated: true,
    seed: 833139,
    options: {
      difficulty: 'HARD',
      pacing: 'MARATHON',
      topology: 'FORTRESS_ARENA',
      archetype: 'BALANCED',
      dragonPrefab: 'FORTRESS_7x7',
    },
    metrics: {
      estimatedTopology: 'FORTRESS_ARENA',
      estimatedDifficulty: 'NIGHTMARE',
      estimatedPacing: 'MARATHON',
      botStatus: 'UNBEATEN_BY_BOT',
      botTurns: 1600,
      challengeRating: 92,
      tags: ['UNBEATEN_BY_BOT', 'NIGHTMARE', 'MARATHON', 'FORTIFIED_LAIR'],
      isUnbeatenChallenge: true,
    },
  },
];

export class MapPresetManager {
  /**
   * 全プリセット（公式おすすめ＋ユーザー保存）を取得
   */
  public static getAllPresets(): MapPresetData[] {
    const userPresets = this.getUserPresets();
    return [...CURATED_PRESETS, ...userPresets];
  }

  /**
   * ユーザーがローカル保存したプリセット一覧を取得
   */
  public static getUserPresets(): MapPresetData[] {
    if (typeof localStorage === 'undefined') {
      return [];
    }
    try {
      const raw = localStorage.getItem(MAP_PRESETS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return [];
    } catch (e) {
      console.error('[MapPresetManager] Failed to read user presets:', e);
      return [];
    }
  }

  /**
   * プリセットを保存
   */
  public static savePreset(
    data: Omit<MapPresetData, 'id' | 'createdAt' | 'isCurated'>
  ): MapPresetData {
    const newPreset: MapPresetData = {
      ...data,
      id: `preset_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: Date.now(),
      isCurated: false,
    };

    if (typeof localStorage !== 'undefined') {
      try {
        const userPresets = this.getUserPresets();
        // 重複防止（同名または同シード設定があれば更新、なければ先頭追加）
        const existingIdx = userPresets.findIndex(
          p => p.seed === newPreset.seed && p.name === newPreset.name
        );
        if (existingIdx >= 0) {
          userPresets[existingIdx] = newPreset;
        } else {
          userPresets.unshift(newPreset);
        }
        localStorage.setItem(MAP_PRESETS_STORAGE_KEY, JSON.stringify(userPresets));
      } catch (e) {
        console.error('[MapPresetManager] Failed to save preset:', e);
      }
    }

    return newPreset;
  }

  /**
   * プリセットを削除（公式プリセットは削除不可）
   */
  public static deletePreset(id: string): boolean {
    if (typeof localStorage === 'undefined') {
      return false;
    }
    try {
      const userPresets = this.getUserPresets();
      const filtered = userPresets.filter(p => p.id !== id);
      if (filtered.length !== userPresets.length) {
        localStorage.setItem(MAP_PRESETS_STORAGE_KEY, JSON.stringify(filtered));
        return true;
      }
      return false;
    } catch (e) {
      console.error('[MapPresetManager] Failed to delete preset:', e);
      return false;
    }
  }

  /**
   * プリセットを1行の共有コード文字列にエクスポート
   */
  public static exportShareCode(preset: MapPresetData): string {
    const payload: any = {
      n: preset.name,
      s: preset.seed,
      o: {
        d: preset.options.difficulty,
        p: preset.options.pacing,
        t: preset.options.topology,
        a: preset.options.archetype,
        dp: preset.options.dragonPrefab,
        hp: preset.options.homePrefab,
      },
    };
    if (preset.metrics) {
      payload.m = {
        et: preset.metrics.estimatedTopology,
        ed: preset.metrics.estimatedDifficulty,
        ep: preset.metrics.estimatedPacing,
        bs: preset.metrics.botStatus,
        bt: preset.metrics.botTurns,
        cr: preset.metrics.challengeRating,
        pc: preset.metrics.playerCleared,
        pct: preset.metrics.playerClearTurns,
        uc: preset.metrics.isUnbeatenChallenge,
      };
    }
    const jsonStr = JSON.stringify(payload);
    let encoded: string;
    const globalObj = globalThis as { Buffer?: { from: (s: string, enc?: string) => { toString: (e: string) => string } } };
    if (typeof btoa !== 'undefined') {
      encoded = btoa(encodeURIComponent(jsonStr));
    } else if (globalObj.Buffer) {
      encoded = globalObj.Buffer.from(encodeURIComponent(jsonStr)).toString('base64');
    } else {
      encoded = encodeURIComponent(jsonStr);
    }
    return `${SHARE_CODE_PREFIX}${encoded}`;
  }

  /**
   * 共有コード文字列からプリセットデータをインポート・復元
   */
  public static importShareCode(code: string): MapPresetData | null {
    if (!code || typeof code !== 'string') return null;
    const trimmed = code.trim();
    if (!trimmed.startsWith(SHARE_CODE_PREFIX)) {
      return null;
    }
    const rawEncoded = trimmed.slice(SHARE_CODE_PREFIX.length);
    try {
      let jsonStr: string;
      const globalObj = globalThis as { Buffer?: { from: (s: string, enc?: string) => { toString: (e: string) => string } } };
      if (typeof atob !== 'undefined') {
        jsonStr = decodeURIComponent(atob(rawEncoded));
      } else if (globalObj.Buffer) {
        jsonStr = decodeURIComponent(globalObj.Buffer.from(rawEncoded, 'base64').toString('utf-8'));
      } else {
        jsonStr = decodeURIComponent(rawEncoded);
      }
      const parsed = JSON.parse(jsonStr);
      if (!parsed || typeof parsed.s !== 'number' || !parsed.o) {
        return null;
      }

      const metrics: MapPresetMetrics | undefined = parsed.m
        ? {
            estimatedTopology: parsed.m.et,
            estimatedDifficulty: parsed.m.ed,
            estimatedPacing: parsed.m.ep,
            botStatus: parsed.m.bs,
            botTurns: parsed.m.bt,
            challengeRating: parsed.m.cr,
            playerCleared: parsed.m.pc,
            playerClearTurns: parsed.m.pct,
            isUnbeatenChallenge: parsed.m.uc,
          }
        : undefined;

      return {
        id: `shared_${Date.now()}`,
        name: parsed.n || `共有マップ (Seed: ${parsed.s})`,
        createdAt: Date.now(),
        isCurated: false,
        seed: parsed.s,
        options: {
          difficulty: parsed.o.d ?? 'NORMAL',
          pacing: parsed.o.p ?? 'STANDARD',
          topology: parsed.o.t ?? 'MULTI_SECTOR',
          archetype: parsed.o.a ?? 'BALANCED',
          dragonPrefab: parsed.o.dp,
          homePrefab: parsed.o.hp,
        },
        metrics,
      };
    } catch (e) {
      console.error('[MapPresetManager] Failed to import share code:', e);
      return null;
    }
  }

  /**
   * プレイヤーがシードをクリアした際のレコード更新
   */
  public static recordPlayerClear(seed: number, clearTurns: number): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const userPresets = this.getUserPresets();
      let updated = false;
      for (const p of userPresets) {
        if (p.seed === seed) {
          p.metrics = {
            ...p.metrics,
            playerCleared: true,
            playerClearTurns:
              p.metrics?.playerClearTurns !== undefined
                ? Math.min(p.metrics.playerClearTurns, clearTurns)
                : clearTurns,
            cleared: true,
            clearTurns:
              p.metrics?.clearTurns !== undefined
                ? Math.min(p.metrics.clearTurns, clearTurns)
                : clearTurns,
          };
          updated = true;
        }
      }
      if (updated) {
        localStorage.setItem(MAP_PRESETS_STORAGE_KEY, JSON.stringify(userPresets));
      }
    } catch (e) {
      console.error('[MapPresetManager] Failed to record player clear:', e);
    }
  }
}
