import { Position, DungeonTuningParams } from '../models/Types.js';
import { WorldMap } from '../models/WorldMap.js';
import { Player } from '../models/Player.js';
import { EnemyInstance } from '../models/Enemy.js';
import { Dragon } from '../models/Dragon.js';
import { CombatSystem } from './CombatSystem.js';
import { SeedRandom } from '../core/SeedRandom.js';

export class SpawnSystem {
  private static defaultRng: SeedRandom = new SeedRandom();
  private static spawnTurnInterval: number = 6; // 6ターン毎にスポーン補充試行
  private static turnCounter: number = 0;
  public static totalKills: number = 0; // 敵撃破数カウンター (モンスターランク進行用)

  public static setDefaultRng(rng: SeedRandom): void {
    this.defaultRng = rng;
  }

  /**
   * ステージ状態（ドラゴンの首討伐数）に応じた敵の通常フィールド生存上限
   * 首を倒すごとにステージの危険度が段階的に上昇
   */
  public static getMaxActiveEnemies(dragon?: Dragon): number {
    if (!dragon || dragon.defeatedHeadsCount === 0) {
      return 7; // 序盤: 最大7体
    }
    if (dragon.defeatedHeadsCount === 1) {
      return 9; // 首1本討伐後: 最大9体
    }
    if (dragon.defeatedHeadsCount === 2) {
      return 11; // 首2本討伐後: 最大11体
    }
    return 13; // 首3本討伐後: 最大13体（クライマックス）
  }

  /**
   * パラメータ連動の通常フィールド墓湧き上限
   */
  public static getMaxFieldEnemies(dragon?: Dragon, params?: DungeonTuningParams): number {
    const heads = dragon ? Math.min(3, dragon.defeatedHeadsCount) : 0;
    if (params?.spawnConfig?.maxFieldEnemiesByPhase) {
      return params.spawnConfig.maxFieldEnemiesByPhase[heads];
    }
    return this.getMaxActiveEnemies(dragon);
  }

  /**
   * パラメータ連動の家湧き専用別枠スロット数
   */
  public static getHomeSpawnReserve(dragon?: Dragon, params?: DungeonTuningParams): number {
    const heads = dragon ? Math.min(3, dragon.defeatedHeadsCount) : 0;
    if (heads === 0) return 0;
    if (params?.spawnConfig?.homeSpawnReserveByPhase) {
      return params.spawnConfig.homeSpawnReserveByPhase[heads];
    }
    return [0, 2, 3, 4][heads];
  }

  /**
   * 敵撃破数を記録（撃破ごとにモンスターランクが進行）
   */
  public static recordKill(): void {
    this.totalKills++;
  }

  /**
   * 墓・家からの定期スポーン更新（上限未満時に1体ずつ補充）
   */
  public static onTurnEnd(
    enemies: EnemyInstance[],
    player: Player,
    map: WorldMap,
    dragon?: Dragon,
    params?: DungeonTuningParams,
    rng?: SeedRandom,
    engineTurnCounter?: number
  ): EnemyInstance[] {
    const isSpawnTurn = engineTurnCounter !== undefined
      ? (engineTurnCounter % this.spawnTurnInterval === 0 && engineTurnCounter > 0)
      : (++this.turnCounter >= this.spawnTurnInterval);

    if (!isSpawnTurn) {
      return [];
    }
    if (engineTurnCounter === undefined) {
      this.turnCounter = 0;
    }

    const maxField = this.getMaxFieldEnemies(dragon, params);
    const spawned: EnemyInstance[] = [];

    // 1. 首討伐後の世界変化: 家からのスポーン（首1本以上討伐時は家湧き枠を優先試行）
    if (dragon && dragon.defeatedHeadsCount >= 1) {
      const homeSpawned = this.spawnFromHome(enemies, player, map, dragon, params, rng);
      if (homeSpawned) {
        spawned.push(homeSpawned);
      }
    }

    // 2. 墓からの1体補充（首3本討伐時は墓湧き停止、かつ通常フィールド上限未満時のみ）
    if ((!dragon || !dragon.isAllHeadsDefeated) && enemies.filter(e => e.isAlive).length < maxField) {
      const graveSpawned = this.spawnOneFromGraves(enemies, player, map, params, rng);
      if (graveSpawned) {
        spawned.push(graveSpawned);
      }
    }

    return spawned;
  }

  /**
   * 首討伐後の世界変化: 我が家からのモンスタースポーン
   */
  public static spawnFromHome(
    enemies: EnemyInstance[],
    player: Player,
    map: WorldMap,
    dragon: Dragon,
    params?: DungeonTuningParams,
    rng?: SeedRandom
  ): EnemyInstance | null {
    const effectiveRng = rng ?? this.defaultRng;
    const maxField = this.getMaxFieldEnemies(dragon, params);
    const homeReserve = this.getHomeSpawnReserve(dragon, params);
    const maxTotalForHome = maxField + homeReserve;

    let aliveCount = enemies.filter(e => e.isAlive).length;
    if (aliveCount >= maxTotalForHome) {
      const shouldEvict = params?.spawnConfig?.evictDistantEnemyOnHomeSpawn ?? true;
      if (shouldEvict) {
        // 交戦中でなく、永続凍結されていない、プレイヤーおよび我が家から最遠（かつ距離8以上）の敵をパージ
        const engagedId = CombatSystem.engagedEnemy?.id;
        let bestEnemy: EnemyInstance | null = null;
        let bestDist = -1;

        for (const e of enemies) {
          if (!e.isAlive || e.isPermanentlyFrozen) continue;
          if (engagedId && e.id === engagedId) continue;

          const targetHomePos = map.spawnHomePos ?? map.initialHomePos ?? map.homePos;
          const distPlayer = Math.abs(e.pos.x - player.pos.x) + Math.abs(e.pos.y - player.pos.y);
          const distHome = Math.abs(e.pos.x - targetHomePos.x) + Math.abs(e.pos.y - targetHomePos.y);

          if (distPlayer >= 8 && distHome >= 8) {
            const totalDist = distPlayer + distHome;
            if (totalDist > bestDist) {
              bestDist = totalDist;
              bestEnemy = e;
            }
          }
        }

        if (bestEnemy) {
          bestEnemy.isAlive = false;
          const idx = enemies.indexOf(bestEnemy);
          if (idx !== -1) {
            enemies.splice(idx, 1);
          }
        }
      }
    }

    aliveCount = enemies.filter(e => e.isAlive).length;
    if (aliveCount >= maxTotalForHome) {
      return null;
    }

    const homePos = map.spawnHomePos ?? map.initialHomePos ?? map.homePos;
    const candidates: Position[] = [
      { x: homePos.x + 1, y: homePos.y },
      { x: homePos.x - 1, y: homePos.y },
      { x: homePos.x, y: homePos.y + 1 },
      { x: homePos.x, y: homePos.y - 1 },
    ];

    for (const pos of candidates) {
      if (!map.isInside(pos) || !map.isPassableByEnemy(pos)) continue;
      if (player.pos.x === pos.x && player.pos.y === pos.y) continue;
      if (enemies.some(e => e.isAlive && e.pos.x === pos.x && e.pos.y === pos.y)) continue;

      let typeId: number;
      if (dragon.defeatedHeadsCount >= 2) {
        typeId = effectiveRng.nextInt(1, 32); // 全32種から
      } else {
        typeId = this.selectEnemyTypeToSpawn(player, effectiveRng);
      }

      const enemyAtkRatio = params?.progressionConfig?.enemyAtkRatio ?? 1.0;
      const newEnemy = new EnemyInstance({ typeId, pos });
      if (enemyAtkRatio !== 1.0) {
        newEnemy.atk = Math.max(1, Math.floor(newEnemy.atk * enemyAtkRatio));
      }

      enemies.push(newEnemy);
      return newEnemy;
    }

    return null;
  }

  /**
   * 空いている墓から1体だけモンスターを出現させる（1体補充方式）
   */
  public static spawnOneFromGraves(
    enemies: EnemyInstance[],
    player: Player,
    map: WorldMap,
    params?: DungeonTuningParams,
    rng?: SeedRandom
  ): EnemyInstance | null {
    const effectiveRng = rng ?? this.defaultRng;
    // マップ上の有効な墓（岩で塞がれておらず、敵も上にいない墓）を収集
    const availableGraves: Position[] = [];

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const pos: Position = { x, y };
        if (map.getBaseTile(pos) !== 'GRAVE') continue;
        if (player.pos.x === x && player.pos.y === y) continue;
        // 墓の上に生存中の敵がいる場合は追加スポーン自然阻止（墓の周囲封鎖による敵居座り）
        if (enemies.some(e => e.isAlive && e.pos.x === x && e.pos.y === y)) continue;

        availableGraves.push(pos);
      }
    }

    if (availableGraves.length === 0) return null;

    // プレイヤーの探索エリア周辺（距離25以内）の墓を優先選択し、過疎化を防止
    const nearbyGraves = availableGraves.filter(g => {
      const dist = Math.abs(g.x - player.pos.x) + Math.abs(g.y - player.pos.y);
      return dist <= 28;
    });

    const candidateGraves = nearbyGraves.length > 0 ? nearbyGraves : availableGraves;
    const chosenGrave = effectiveRng.choice(candidateGraves);
    const typeId = this.selectEnemyTypeToSpawn(player, effectiveRng);
    const enemyAtkRatio = params?.progressionConfig?.enemyAtkRatio ?? 1.0;
    const newEnemy = new EnemyInstance({ typeId, pos: chosenGrave });
    if (enemyAtkRatio !== 1.0) {
      newEnemy.atk = Math.max(1, Math.floor(newEnemy.atk * enemyAtkRatio));
    }
    enemies.push(newEnemy);
    return newEnemy;
  }

  /**
   * ゲーム開始時の初期スポーン（数体のみ適正配置）
   */
  public static spawnInitialEnemies(
    enemies: EnemyInstance[],
    player: Player,
    map: WorldMap,
    targetCount: number = 5,
    params?: DungeonTuningParams,
    rng?: SeedRandom
  ): EnemyInstance[] {
    const spawned: EnemyInstance[] = [];
    while (enemies.filter(e => e.isAlive).length < targetCount) {
      const e = this.spawnOneFromGraves(enemies, player, map, params, rng);
      if (!e) break;
      spawned.push(e);
    }
    return spawned;
  }

  /**
   * マップ内の全墓からスポーン（テスト・互換用）
   */
  public static spawnFromAllGraves(
    enemies: EnemyInstance[],
    player: Player,
    map: WorldMap,
    dragon?: Dragon,
    rng?: SeedRandom
  ): EnemyInstance[] {
    const maxActive = this.getMaxActiveEnemies(dragon);
    const spawned: EnemyInstance[] = [];

    while (enemies.filter(e => e.isAlive).length < maxActive) {
      const e = this.spawnOneFromGraves(enemies, player, map, undefined, rng);
      if (!e) break;
      spawned.push(e);
    }

    return spawned;
  }

  /**
   * 出現モンスターの種類を決定 (倒すたびにより強いモンスターが出現)
   */
  public static selectEnemyTypeToSpawn(player: Player, rng?: SeedRandom): number {
    const effectiveRng = rng ?? this.defaultRng;
    // 撃破数 player.totalKills または SpawnSystem.totalKills に応じて出現モンスターのベースランクが上昇 (2体倒すごとに +1)
    const kills = Math.max(player.totalKills ?? 0, this.totalKills ?? 0);
    const rankByKills = Math.floor(kills / 2) + 1;

    // プレイヤーの経験値による上限補正
    const rankByExp = Math.floor(player.experience / 1200) + 2;

    const baseRank = Math.min(32, Math.max(1, Math.min(rankByKills, rankByExp)));

    // baseRank を中心に -1 〜 +1 のブレで抽選
    const minId = Math.max(1, baseRank - 1);
    const maxId = Math.min(32, baseRank + 1);

    return effectiveRng.nextInt(minId, maxId);
  }

  public static reset(): void {
    this.turnCounter = 0;
    this.totalKills = 0;
  }

  public static getTurnCounter(): number {
    return this.turnCounter;
  }

  public static setTurnCounter(val: number): void {
    this.turnCounter = val;
  }
}
