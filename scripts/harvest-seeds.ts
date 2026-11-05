import { WorldMap } from '../src/models/WorldMap.js';
import { SeedRandom } from '../src/core/SeedRandom.js';
import { DungeonTopology, MapDifficulty, PlayPacingMode } from '../src/models/Types.js';
import { HierarchicalThemeBlockGenerator } from '../src/systems/generator/HierarchicalThemeBlockGenerator.js';
import { MapProfiler, MapProfileReport } from '../src/systems/generator/MapProfiler.js';
import { MapPresetData } from '../src/services/MapPresetManager.js';
import * as fs from 'fs';
import * as path from 'path';

interface HarvestOptions {
  seedCount: number;
  baseSeed: number;
  maxBotTurns: number;
  outputJsonPath?: string;
}

export class SeedHarvestService {
  /**
   * シード群をバッチプロファイリングし、カタログ化
   */
  public static harvest(options: HarvestOptions): {
    clearedList: MapProfileReport[];
    unbeatenList: MapProfileReport[];
    insolvableList: MapProfileReport[];
    curatedPresets: MapPresetData[];
  } {
    const { seedCount, baseSeed, maxBotTurns } = options;
    const rng = new SeedRandom(baseSeed);

    const clearedList: MapProfileReport[] = [];
    const unbeatenList: MapProfileReport[] = [];
    const insolvableList: MapProfileReport[] = [];

    const topologies: DungeonTopology[] = [
      'STANDARD_ROOMS',
      'PILLAR_GRID',
      'NARROW_MAZE',
      'SPIRAL_LABYRINTH',
      'FORTRESS_ARENA',
      'MULTI_SECTOR',
    ];

    console.log(`========================================================================`);
    console.log(` 🌱 Seed Observatory: Harvesting & Profiling ${seedCount} Seeds (MaxTurns: ${maxBotTurns})`);
    console.log(`========================================================================\n`);

    for (let i = 0; i < seedCount; i++) {
      const seed = rng.nextInt(100000, 999999);
      const topology = topologies[i % topologies.length];

      // マップ生成
      const map = new WorldMap(64, 64);
      HierarchicalThemeBlockGenerator.generate(map, {
        seed,
        topology,
        difficulty: 'NORMAL',
        pacing: 'STANDARD',
      });

      // プロファイリングとボット実測
      const report = MapProfiler.profile(map, {
        seed,
        runBotBenchmark: true,
        maxBotTurns,
      });

      if (!report.isSolvable) {
        insolvableList.push(report);
        console.log(`❌ [Seed: ${seed}] 物理的解法性なし - 除外`);
        continue;
      }

      const bot = report.botBenchmark;
      if (bot?.status === 'CLEARED') {
        clearedList.push(report);
        console.log(
          `✓ [Seed: ${seed}] CLEAR! (${bot.turns}T) | 推定: ${report.estimatedTopology} / ${report.estimatedDifficulty} (Rating: ${report.challengeRating})`
        );
      } else if (bot?.status === 'UNBEATEN_BY_BOT') {
        unbeatenList.push(report);
        console.log(
          `🔥 [Seed: ${seed}] 🤖 UNBEATEN BY BOT! (1600T完走未クリア / 耐久・高難度) | 推定: ${report.estimatedTopology} / ${report.estimatedDifficulty} (Rating: ${report.challengeRating})`
        );
      } else {
        // ボットが途中で力尽きた場合
        console.log(
          `☠ [Seed: ${seed}] BOT FAILED (${bot?.deathCause}) | 推定: ${report.estimatedTopology} / ${report.estimatedDifficulty}`
        );
      }
    }

    // 厳選プリセットの作成
    const curatedPresets: MapPresetData[] = [];

    // 1. ボット未踏破チャレンジシードのプリセット化
    for (let i = 0; i < Math.min(3, unbeatenList.length); i++) {
      const u = unbeatenList[i];
      curatedPresets.push({
        id: `curated_unbeaten_${u.seed}`,
        name: `🤖 ボット未踏破: 超迷宮の試練 (Seed: ${u.seed})`,
        description: `解法性は100%保証されているが、標準AutoPlayBotが1600ターン以内に踏破できなかった超高難度・長時間耐久シード。勇者の手で完全攻略せよ！`,
        createdAt: 1730000010000 + i * 1000,
        isCurated: true,
        seed: u.seed,
        options: {
          difficulty: 'HARD',
          pacing: 'MARATHON',
          topology: u.estimatedTopology,
          archetype: 'BALANCED',
        },
        metrics: {
          estimatedTopology: u.estimatedTopology,
          estimatedDifficulty: 'NIGHTMARE',
          estimatedPacing: 'MARATHON',
          botStatus: 'UNBEATEN_BY_BOT',
          botTurns: u.botBenchmark?.turns,
          challengeRating: u.challengeRating,
          tags: u.tags,
          isUnbeatenChallenge: true,
        },
      });
    }

    // 2. 快調クリア良質シードのプリセット化
    const fastClears = [...clearedList].sort((a, b) => (a.botBenchmark?.turns ?? 9999) - (b.botBenchmark?.turns ?? 9999));
    if (fastClears.length > 0) {
      const f = fastClears[0];
      curatedPresets.push({
        id: `curated_speed_run_${f.seed}`,
        name: `⚡ 快進撃の回廊 (Speedrun Trail - Seed: ${f.seed})`,
        description: `我が家から剣や重要アイテムへの動線が極めて良好で、快適に成長と決戦を楽しめるハイスピード攻略シード。`,
        createdAt: 1730000020000,
        isCurated: true,
        seed: f.seed,
        options: {
          difficulty: 'EASY',
          pacing: 'BLITZ',
          topology: f.estimatedTopology,
          archetype: 'BALANCED',
        },
        metrics: {
          estimatedTopology: f.estimatedTopology,
          estimatedDifficulty: 'EASY',
          estimatedPacing: 'BLITZ',
          botStatus: 'CLEARED',
          botTurns: f.botBenchmark?.turns,
          challengeRating: f.challengeRating,
          tags: f.tags,
        },
      });
    }

    return {
      clearedList,
      unbeatenList,
      insolvableList,
      curatedPresets,
    };
  }
}

// スクリプト直接実行時
if (process.argv[1] && process.argv[1].endsWith('harvest-seeds.ts')) {
  const seedCountArg = process.argv.find(a => a.startsWith('--count='));
  const count = seedCountArg ? parseInt(seedCountArg.split('=')[1], 10) : 12;

  const result = SeedHarvestService.harvest({
    seedCount: count,
    baseSeed: 9876543,
    maxBotTurns: 1600,
  });

  const catalogOutputPath = path.resolve('src/services/SeedCatalogData.json');
  fs.writeFileSync(
    catalogOutputPath,
    JSON.stringify(
      {
        harvestedAt: new Date().toISOString(),
        totalSeeds: count,
        clearedCount: result.clearedList.length,
        unbeatenCount: result.unbeatenList.length,
        insolvableCount: result.insolvableList.length,
        unbeatenSeeds: result.unbeatenList.map(u => ({
          seed: u.seed,
          topology: u.estimatedTopology,
          rating: u.challengeRating,
          turns: u.botBenchmark?.turns,
          finalStr: u.botBenchmark?.finalStrength,
          tags: u.tags,
        })),
        curatedPresets: result.curatedPresets,
      },
      null,
      2
    ),
    'utf-8'
  );

  console.log(`\n🎉 シード観測完了！`);
  console.log(`- クリア達成シード: ${result.clearedList.length} 件`);
  console.log(`- 🤖 ボット未踏破チャレンジシード: ${result.unbeatenList.length} 件`);
  console.log(`- カタログ保存: ${catalogOutputPath}`);
}
