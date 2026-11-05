import { Position, DungeonTopology } from '../../models/Types.js';
import { WorldMap } from '../../models/WorldMap.js';
import { PlacedThemeBlock } from './ThemeBlockTypes.js';
import { HierarchicalThemeBlockGenerator } from './HierarchicalThemeBlockGenerator.js';
import { AutoPlayBot } from '../../ai/AutoPlayBot.js';
import { GameEngine } from '../../core/GameEngine.js';
import { SeedRandom } from '../../core/SeedRandom.js';
import { GameEventBus } from '../../core/GameEventBus.js';

export type ProfiledDifficulty = 'EASY' | 'NORMAL' | 'HARD' | 'NIGHTMARE';
export type ProfiledPacing = 'BLITZ' | 'STANDARD' | 'MARATHON';
export type BotBenchmarkStatus = 'CLEARED' | 'UNBEATEN_BY_BOT' | 'FAILED';

export interface LairAccessibilityMetrics {
  entranceCount: number;
  safeSpacesCount: number;
  score: number;
}

export interface GeometricMetrics {
  opennessScore: number;          // 0.0 ~ 1.0 (開放度・広間比率)
  mazeIndex: number;              // 0.0 ~ 1.0 (迷路度・1タイル幅通路比率)
  roomCount: number;              // 独立した広間・閉鎖区画の数
  swordWalkDistance: number;      // 我が家から剣までの初期徒歩到達距離 (実歩数+ブロックペナルティ)
  nearHomeGraves: number;         // 我が家周囲12タイル以内の未封鎖墓数
  lairAccessibility: LairAccessibilityMetrics; // ドラゴン要塞への侵入路・安全スペース
  sectorPartitionScore: number;   // 0.0 ~ 1.0 (セクター分断度)
}

export interface BotBenchmarkResult {
  cleared: boolean;
  turns: number;
  finalStrength: number;
  maxHp: number;
  deathCause?: string;
  status: BotBenchmarkStatus;
}

export interface MapProfileReport {
  seed: number;
  isSolvable: boolean;
  metrics: GeometricMetrics;
  estimatedTopology: DungeonTopology;
  estimatedDifficulty: ProfiledDifficulty;
  estimatedPacing: ProfiledPacing;
  challengeRating: number;        // 1 〜 100
  botBenchmark?: BotBenchmarkResult;
  tags: string[];                 // 特徴タグ ('UNBEATEN_BY_BOT', 'NIGHTMARE', 'MARATHON', etc.)
  summary: string;
}

export interface MapProfileOptions {
  seed?: number;
  topology?: DungeonTopology;
  placedBlocks?: PlacedThemeBlock[];
  runBotBenchmark?: boolean;
  maxBotTurns?: number;
}

/**
 * MapProfiler (Seed Observatory)
 *
 * 生成されたマップの状態を観測・プロファイリングし、
 * トポロジー、難易度、ペーシング、プレイスタイルを事後推定する。
 */
export class MapProfiler {
  /**
   * マップ全体の観測プロファイリングを実行
   */
  public static profile(
    map: WorldMap,
    options?: MapProfileOptions
  ): MapProfileReport {
    const seed = options?.seed ?? 0;

    // 1. 物理的解法性の検証
    const dragonCenter = map.dragonCenter ?? { x: 32, y: 32 };
    const solvabilityReport = HierarchicalThemeBlockGenerator.validateSolvability(
      map,
      dragonCenter,
      seed,
      undefined
    );
    const isSolvable = solvabilityReport.isSolvable;

    // 2. 幾何学的メトリクスの計測
    const metrics = this.measureGeometricMetrics(map);

    // 3. トポロジーの事後推定
    const estimatedTopology = options?.topology ?? this.estimateTopology(map, metrics, options?.placedBlocks);

    // 4. ボットによるヘッドレスベンチマーク実測 (オプション)
    let botBenchmark: BotBenchmarkResult | undefined;
    if (options?.runBotBenchmark) {
      botBenchmark = this.runBotBenchmark(seed, estimatedTopology, options.maxBotTurns ?? 1600);
    }

    // 5. 難易度・ペーシング・チャレンジレーティングの判定
    const { estimatedDifficulty, estimatedPacing, challengeRating, tags } = this.evaluateDifficultyAndPacing(
      metrics,
      isSolvable,
      botBenchmark
    );

    // 6. プロファイル概要テキストの生成
    const summary = this.buildSummary(
      estimatedTopology,
      estimatedDifficulty,
      estimatedPacing,
      challengeRating,
      isSolvable,
      botBenchmark
    );

    return {
      seed,
      isSolvable,
      metrics,
      estimatedTopology,
      estimatedDifficulty,
      estimatedPacing,
      challengeRating,
      botBenchmark,
      tags,
      summary,
    };
  }

  /**
   * 幾何学的メトリクスの計測
   */
  public static measureGeometricMetrics(map: WorldMap): GeometricMetrics {
    const width = map.width;
    const height = map.height;

    let walkableCount = 0;
    let roomCoreCount = 0;
    let corridorOrDeadEndCount = 0;

    const isWalkable = (x: number, y: number): boolean => {
      const p = map.wrapPosition({ x, y });
      const base = map.getBaseTile(p);
      const obj = map.getObject(p);
      return base !== 'WALL_STATIC' && obj !== 'BLOCK';
    };

    // 1. 各タイルの開放性・迷路性判定
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!isWalkable(x, y)) continue;
        walkableCount++;

        // 4近傍の歩行可能数
        let adjWalkable = 0;
        const neighbors4 = [
          { dx: 1, dy: 0 },
          { dx: -1, dy: 0 },
          { dx: 0, dy: 1 },
          { dx: 0, dy: -1 },
        ];
        for (const n of neighbors4) {
          if (isWalkable(x + n.dx, y + n.dy)) adjWalkable++;
        }

        // 4近傍のうち1（袋小路）または2（一本道・屈折）なら通路判定
        if (adjWalkable <= 2) {
          corridorOrDeadEndCount++;
        }

        // 8近傍がすべて歩行可能なら広間コア
        let all8Walkable = true;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (!isWalkable(x + dx, y + dy)) {
              all8Walkable = false;
              break;
            }
          }
          if (!all8Walkable) break;
        }
        if (all8Walkable) {
          roomCoreCount++;
        }
      }
    }

    const opennessScore = walkableCount > 0
      ? Math.min(1.0, Math.round((roomCoreCount / walkableCount) * 100) / 100)
      : 0;

    const mazeIndex = walkableCount > 0
      ? Math.min(1.0, Math.round((corridorOrDeadEndCount / walkableCount) * 100) / 100)
      : 0;

    // 2. 独立した広間区画（roomCount）のフラッドフィル計測
    const roomCount = this.countDistinctRooms(map, isWalkable);

    // 3. 我が家から剣までの初期徒歩距離 (swordWalkDistance)
    const swordWalkDistance = this.calculateSwordWalkDistance(map);

    // 4. 我が家周囲12以内の未封鎖墓数 (nearHomeGraves)
    const nearHomeGraves = this.countNearHomeGraves(map, 12);

    // 5. ドラゴン要塞への侵入路・安全スペース (lairAccessibility)
    const lairAccessibility = this.evaluateLairAccessibility(map);

    // 6. セクター分断度 (sectorPartitionScore)
    const sectorPartitionScore = this.evaluateSectorPartition(map, isWalkable);

    return {
      opennessScore,
      mazeIndex,
      roomCount,
      swordWalkDistance,
      nearHomeGraves,
      lairAccessibility,
      sectorPartitionScore,
    };
  }

  /**
   * 独立した広間区画の数をカウント
   */
  private static countDistinctRooms(
    map: WorldMap,
    isWalkable: (x: number, y: number) => boolean
  ): number {
    const visited = new Set<string>();
    let rooms = 0;

    // 3x3以上の広間コアを探して部屋をクラスタリング
    for (let y = 0; y < map.height; y += 2) {
      for (let x = 0; x < map.width; x += 2) {
        const key = `${x},${y}`;
        if (visited.has(key) || !isWalkable(x, y)) continue;

        // BFSで連結成分を走査
        const queue: Position[] = [{ x, y }];
        visited.add(key);
        let componentSize = 0;
        let interiorCount = 0;

        while (queue.length > 0) {
          const curr = queue.shift()!;
          componentSize++;

          // 8方向すべて歩行可能なら内部セル
          let isCore = true;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (!isWalkable(curr.x + dx, curr.y + dy)) {
                isCore = false;
                break;
              }
            }
            if (!isCore) break;
          }
          if (isCore) interiorCount++;

          const dirs = [
            { dx: 1, dy: 0 },
            { dx: -1, dy: 0 },
            { dx: 0, dy: 1 },
            { dx: 0, dy: -1 },
          ];
          for (const d of dirs) {
            const nx = (curr.x + d.dx + map.width) % map.width;
            const ny = (curr.y + d.dy + map.height) % map.height;
            const nKey = `${nx},${ny}`;
            if (!visited.has(nKey) && isWalkable(nx, ny)) {
              visited.add(nKey);
              // 小さな部屋境界のために遠くへ広がりすぎないよう一定サイズで部屋確定
              if (componentSize < 60) {
                queue.push({ x: nx, y: ny });
              }
            }
          }
        }

        // 内部コアがあるか、中規模以上の空間を「部屋」とみなす
        if (interiorCount >= 3 || componentSize >= 20) {
          rooms++;
        }
      }
    }

    return Math.max(1, rooms);
  }

  /**
   * 我が家から剣までの最短徒歩到達コスト（BFS）
   * BLOCKを通過する場合はペナルティ+30を加算
   */
  private static calculateSwordWalkDistance(map: WorldMap): number {
    const home = map.homePos;
    if (!home) return 999;

    // 剣の配置マスを全探索
    const swordPositions: Position[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.getItem({ x, y }) === 'SWORD') {
          swordPositions.push({ x, y });
        }
      }
    }

    if (swordPositions.length === 0) return 999;

    // Priority Queue風にコスト最小探索（Dijkstra）
    const distMap = new Map<string, number>();
    const startKey = `${home.x},${home.y}`;
    distMap.set(startKey, 0);

    const queue: { pos: Position; cost: number }[] = [{ pos: home, cost: 0 }];

    let minSwordCost = 999;

    while (queue.length > 0) {
      // 最小コストのノードを取り出し
      queue.sort((a, b) => a.cost - b.cost);
      const current = queue.shift()!;
      const currKey = `${current.pos.x},${current.pos.y}`;

      if (current.cost > (distMap.get(currKey) ?? Infinity)) continue;

      // 剣に到達したか？
      if (swordPositions.some(sp => sp.x === current.pos.x && sp.y === current.pos.y)) {
        minSwordCost = Math.min(minSwordCost, current.cost);
        break;
      }

      // 4方向展開
      const dirs = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
      ];

      for (const d of dirs) {
        const nextPos = map.wrapPosition({
          x: current.pos.x + d.dx,
          y: current.pos.y + d.dy,
        });
        const base = map.getBaseTile(nextPos);
        if (base === 'WALL_STATIC') continue; // 外壁は通過不能

        const obj = map.getObject(nextPos);
        // BLOCKの場合は破壊・押しを想定しコスト+30
        const stepCost = obj === 'BLOCK' ? 30 : 1;
        const newCost = current.cost + stepCost;

        const nextKey = `${nextPos.x},${nextPos.y}`;
        const prevCost = distMap.get(nextKey) ?? Infinity;
        if (newCost < prevCost) {
          distMap.set(nextKey, newCost);
          queue.push({ pos: nextPos, cost: newCost });
        }
      }
    }

    return minSwordCost;
  }

  /**
   * 我が家周囲（トーラス距離12以内）の未封鎖墓数をカウント
   */
  private static countNearHomeGraves(map: WorldMap, maxDist: number): number {
    const home = map.homePos;
    if (!home) return 0;

    let count = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const pos = { x, y };
        if (map.getBaseTile(pos) === 'GRAVE') {
          // 未封鎖（BLOCKが上にない）
          if (map.getObject(pos) !== 'BLOCK') {
            const dx = Math.abs(pos.x - home.x);
            const dy = Math.abs(pos.y - home.y);
            const torusDx = Math.min(dx, map.width - dx);
            const torusDy = Math.min(dy, map.height - dy);
            const dist = torusDx + torusDy;
            if (dist <= maxDist) {
              count++;
            }
          }
        }
      }
    }
    return count;
  }

  /**
   * ドラゴン要塞への侵入路・首周囲安全スペースの計測
   */
  private static evaluateLairAccessibility(map: WorldMap): LairAccessibilityMetrics {
    const center = map.dragonCenter;
    if (!center) {
      return { entranceCount: 2, safeSpacesCount: 4, score: 0.5 };
    }

    // 1. 要塞外周リング（半径4）の開口部チェック
    let entranceCount = 0;
    const perimeterRadius = 4;
    for (let dy = -perimeterRadius; dy <= perimeterRadius; dy++) {
      for (let dx = -perimeterRadius; dx <= perimeterRadius; dx++) {
        if (Math.abs(dx) === perimeterRadius || Math.abs(dy) === perimeterRadius) {
          const p = map.wrapPosition({ x: center.x + dx, y: center.y + dy });
          if (map.getBaseTile(p) !== 'WALL_STATIC' && map.getObject(p) !== 'BLOCK') {
            entranceCount++;
          }
        }
      }
    }

    // 2. ドラゴン3首周囲の安全スペース（斜め角マスや退避マス）
    let safeSpacesCount = 0;
    const cornerOffsets = [
      { dx: -2, dy: -2 },
      { dx: 2, dy: -2 },
      { dx: -2, dy: 2 },
      { dx: 2, dy: 2 },
      { dx: 0, dy: -2 },
      { dx: 0, dy: 2 },
      { dx: -2, dy: 0 },
      { dx: 2, dy: 0 },
    ];
    for (const off of cornerOffsets) {
      const p = map.wrapPosition({ x: center.x + off.dx, y: center.y + off.dy });
      if (map.getBaseTile(p) === 'EMPTY' && map.getObject(p) === 'NONE') {
        safeSpacesCount++;
      }
    }

    // スコア化 (0.0 〜 1.0)
    const score = Math.min(1.0, Math.round(((entranceCount / 12) * 0.5 + (safeSpacesCount / 8) * 0.5) * 100) / 100);

    return {
      entranceCount,
      safeSpacesCount,
      score,
    };
  }

  /**
   * セクター分断度（4象限間のボトルネック・チョークポイント度合い）
   */
  private static evaluateSectorPartition(
    map: WorldMap,
    isWalkable: (x: number, y: number) => boolean
  ): number {
    const midX = Math.floor(map.width / 2);
    const midY = Math.floor(map.height / 2);

    let verticalCrossings = 0;
    let horizontalCrossings = 0;

    for (let y = 0; y < map.height; y++) {
      if (isWalkable(midX - 1, y) && isWalkable(midX, y)) {
        verticalCrossings++;
      }
    }

    for (let x = 0; x < map.width; x++) {
      if (isWalkable(x, midY - 1) && isWalkable(x, midY)) {
        horizontalCrossings++;
      }
    }

    const totalCrossings = verticalCrossings + horizontalCrossings;
    // 境界の開放率が低いほど「分断されたセクター」構造
    const partitionIndex = Math.max(0, 1.0 - (totalCrossings / (map.width + map.height)));
    return Math.round(partitionIndex * 100) / 100;
  }

  /**
   * トポロジーの事後推定
   */
  public static estimateTopology(
    map: WorldMap,
    metrics: GeometricMetrics,
    placedBlocks?: PlacedThemeBlock[]
  ): DungeonTopology {
    // 0. tacticalMetadataのスタイルを反映
    const lairStyle = map.tacticalMetadata?.dragonLairStyle;
    if (lairStyle === 'MAZE_LAIR' && metrics.mazeIndex >= 0.50) {
      return metrics.roomCount <= 3 ? 'SPIRAL_LABYRINTH' : 'NARROW_MAZE';
    }
    if (lairStyle === 'GRAND_TREASURE_HALL' && metrics.opennessScore >= 0.12) {
      return 'FORTRESS_ARENA';
    }

    // 1. 配置ブロック情報がある場合はそのカテゴリ傾向を参照
    if (placedBlocks && placedBlocks.length > 0) {
      let mazeBlockCount = 0;
      let arenaBlockCount = 0;
      let roomBlockCount = 0;
      let pillarBlockCount = 0;

      for (const b of placedBlocks) {
        const id = b.template.id.toLowerCase();
        if (id.includes('spiral')) return 'SPIRAL_LABYRINTH';
        if (id.includes('maze')) mazeBlockCount++;
        if (id.includes('grand_hall') || id.includes('citadel') || id.includes('fortress')) arenaBlockCount++;
        if (id.includes('room') || id.includes('enclosed')) roomBlockCount++;
        if (id.includes('pillar') || id.includes('grid')) pillarBlockCount++;
      }

      if (arenaBlockCount >= 2 || (arenaBlockCount >= 1 && metrics.opennessScore >= 0.15)) {
        return 'FORTRESS_ARENA';
      }
      if (mazeBlockCount >= 3 || metrics.mazeIndex >= 0.55) {
        return 'NARROW_MAZE';
      }
      if (pillarBlockCount >= 2) {
        return 'PILLAR_GRID';
      }
    }

    // 2. 幾何学的メトリクスからの推定
    // (a) 螺旋迷宮: 迷路度が高く、部屋数が極めて少ない
    if (metrics.mazeIndex >= 0.55 && metrics.roomCount <= 3) {
      return 'SPIRAL_LABYRINTH';
    }

    // (b) 細道迷路: 迷路度が高く開放度が低い
    if (metrics.mazeIndex >= 0.48 && metrics.opennessScore <= 0.10) {
      return 'NARROW_MAZE';
    }

    // (c) 要塞アリーナ: 開放度が高く、ドラゴン要塞へのアクセスが良好
    if (metrics.opennessScore >= 0.15 && metrics.lairAccessibility.score >= 0.40) {
      return 'FORTRESS_ARENA';
    }

    // (d) セクター分断型: 4セクター境界のチョークポイントが明確で部屋数も多い
    if (metrics.sectorPartitionScore >= 0.45 && metrics.roomCount >= 4) {
      return 'MULTI_SECTOR';
    }

    // (e) 柱グリッド: 迷路度・開放度が中間
    if (metrics.mazeIndex >= 0.35 && metrics.mazeIndex < 0.48 && metrics.opennessScore >= 0.08) {
      return 'PILLAR_GRID';
    }

    // (f) デフォルト: 標準小部屋
    return 'STANDARD_ROOMS';
  }

  /**
   * AutoPlayBotによるヘッドレスベンチマーク実行
   */
  public static runBotBenchmark(
    seed: number,
    topology: DungeonTopology,
    maxTurnsLimit: number = 1600
  ): BotBenchmarkResult {
    const eventBus = new GameEventBus();
    const runRng = new SeedRandom(seed);
    const engine = new GameEngine({ rng: runRng, eventBus });

    engine.startProceduralGame({
      seed,
      topology,
      difficulty: 'NORMAL',
      pacing: 'STANDARD',
    });

    const bot = new AutoPlayBot({
      profile: 'STANDARD',
      maxTurnsLimit,
    });

    let turns = 0;
    while (turns < maxTurnsLimit && engine.getState() === 'PLAYING') {
      turns++;
      engine.stepFrame(100);
      bot.step(engine);
    }

    const won = engine.getState() === 'STAGECLEAR';
    const player = engine.getPlayer();
    const deathCause = won
      ? undefined
      : (player.deathInfo?.cause ?? (turns >= maxTurnsLimit ? 'TIMEOUT_LIMIT' : 'UNKNOWN'));

    let status: BotBenchmarkStatus;
    if (won) {
      status = 'CLEARED';
    } else if (turns >= maxTurnsLimit) {
      status = 'UNBEATEN_BY_BOT';
    } else {
      status = 'FAILED';
    }

    return {
      cleared: won,
      turns,
      finalStrength: player.strength,
      maxHp: player.maxHp,
      deathCause,
      status,
    };
  }

  /**
   * 難易度・ペーシング・チャレンジレーティングの判定
   */
  private static evaluateDifficultyAndPacing(
    metrics: GeometricMetrics,
    isSolvable: boolean,
    botBenchmark?: BotBenchmarkResult
  ): {
    estimatedDifficulty: ProfiledDifficulty;
    estimatedPacing: ProfiledPacing;
    challengeRating: number;
    tags: string[];
  } {
    const tags: string[] = [];

    // 1. 基本チャレンジ指数の算出 (1 〜 100)
    let score = 50;

    // 剣までの距離 (+10 〜 +30)
    if (metrics.swordWalkDistance > 50) {
      score += 20;
      tags.push('DISTANT_SWORD');
    } else if (metrics.swordWalkDistance <= 15) {
      score -= 15;
      tags.push('EARLY_SWORD');
    }

    // 我が家周辺の墓数 (+5 〜 +20)
    if (metrics.nearHomeGraves >= 4) {
      score += 15;
      tags.push('DANGEROUS_HOME');
    } else if (metrics.nearHomeGraves <= 1) {
      score -= 10;
      tags.push('PEACEFUL_HOME');
    }

    // 迷路度 (+10 〜 -10)
    if (metrics.mazeIndex >= 0.55) {
      score += 10;
      tags.push('LABYRINTH');
    } else if (metrics.opennessScore >= 0.40) {
      score -= 10;
      tags.push('OPEN_ARENA');
    }

    // ドラゴン要塞アクセス度
    if (metrics.lairAccessibility.score <= 0.3) {
      score += 15;
      tags.push('FORTIFIED_LAIR');
    }

    // 2. ボット実測結果との統合
    let estimatedDifficulty: ProfiledDifficulty = 'NORMAL';
    let estimatedPacing: ProfiledPacing = 'STANDARD';

    if (botBenchmark) {
      if (botBenchmark.status === 'CLEARED') {
        tags.push('BOT_CLEARED');
        if (botBenchmark.turns <= 1100) {
          estimatedDifficulty = 'EASY';
          estimatedPacing = 'BLITZ';
          score = Math.min(score, 40);
        } else if (botBenchmark.turns <= 1500) {
          estimatedDifficulty = 'NORMAL';
          estimatedPacing = 'STANDARD';
          score = Math.max(35, Math.min(score, 65));
        } else if (botBenchmark.turns <= 1800) {
          estimatedDifficulty = 'HARD';
          estimatedPacing = 'MARATHON';
          score = Math.max(65, Math.min(score, 85));
        } else {
          estimatedDifficulty = 'NIGHTMARE';
          estimatedPacing = 'MARATHON';
          score = Math.max(85, score);
        }
      } else if (botBenchmark.status === 'UNBEATEN_BY_BOT') {
        // 物理的解法性があるが1600Tタイムアウトした場合
        estimatedDifficulty = 'NIGHTMARE';
        estimatedPacing = 'MARATHON';
        score = Math.max(88, score);
        tags.push('UNBEATEN_BY_BOT');
        tags.push('MARATHON');
      } else {
        // FAILED
        estimatedDifficulty = 'HARD';
        score = Math.max(75, score);
        tags.push('LETHAL_HAZARD');
      }
    } else {
      // ボット実測なし時の静的推定
      if (score <= 35) {
        estimatedDifficulty = 'EASY';
        estimatedPacing = 'BLITZ';
      } else if (score <= 65) {
        estimatedDifficulty = 'NORMAL';
        estimatedPacing = 'STANDARD';
      } else if (score <= 85) {
        estimatedDifficulty = 'HARD';
        estimatedPacing = 'STANDARD';
      } else {
        estimatedDifficulty = 'NIGHTMARE';
        estimatedPacing = 'MARATHON';
      }
    }

    if (!isSolvable) {
      tags.push('INSOLVABLE');
      estimatedDifficulty = 'NIGHTMARE';
    }

    const challengeRating = Math.max(1, Math.min(100, Math.round(score)));

    return {
      estimatedDifficulty,
      estimatedPacing,
      challengeRating,
      tags,
    };
  }

  /**
   * サマリー文字列の構築
   */
  private static buildSummary(
    topology: DungeonTopology,
    difficulty: ProfiledDifficulty,
    pacing: ProfiledPacing,
    rating: number,
    isSolvable: boolean,
    bot?: BotBenchmarkResult
  ): string {
    const botText = bot
      ? bot.status === 'CLEARED'
        ? `ボット完走 (${bot.turns}T / 到達STR: ${bot.finalStrength})`
        : bot.status === 'UNBEATEN_BY_BOT'
        ? '🤖 ボット1600T未踏破（長時間耐久・高難度チャレンジ）'
        : `ボット途中撃沈 (${bot.deathCause})`
      : '静的プロファイリングのみ';

    return `[${difficulty}] ${topology} (${pacing}) - 難易度指数: ${rating}/100 | 解法性: ${
      isSolvable ? '保証' : '警告'
    } | ${botText}`;
  }
}
