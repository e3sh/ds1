import { DeathInfo, Position, DungeonTuningParams } from '../../models/Types.js';
import { Player } from '../../models/Player.js';
import { WorldMap } from '../../models/WorldMap.js';
import { EnemyInstance } from '../../models/Enemy.js';
import { Ghost } from '../../models/Ghost.js';
import { Dragon } from '../../models/Dragon.js';
import { SpawnSystem } from '../../systems/SpawnSystem.js';
import { CombatSystem } from '../../systems/CombatSystem.js';
import { ProceduralMapGenerator, ProceduralMapOptions } from '../../systems/ProceduralMapGenerator.js';
import { TuningPresetResolver } from '../../config/TuningPresetResolver.js';
import { CURRENT_SAVE_VERSION, FullSaveData, SaveManager } from '../../services/SaveManager.js';
import { MapPresetData, MapPresetManager } from '../../services/MapPresetManager.js';
import { MapProfiler } from '../../systems/generator/MapProfiler.js';
import type { GameEngine } from '../GameEngine.js';

export class SessionController {
  private engine: GameEngine;

  constructor(engine: GameEngine) {
    this.engine = engine;
  }

  public initLevelEntities(): void {
    const activeTuningParams = this.engine.getActiveTuningParams();
    const rng = this.engine.getRng();
    const enemies = this.engine.getEnemies();
    const player = this.engine.getPlayer();
    const map = this.engine.getMap();

    // 墓からの適正初期スポーン (序盤バランス: 3体配置)
    SpawnSystem.spawnInitialEnemies(enemies, player, map, 3, activeTuningParams, rng);

    // ゴースト初期配置 (マップ中央付近・複数体対応)
    const ghosts: Ghost[] = [];
    const targetGhostCount = this.engine.isProceduralModeState()
      ? (activeTuningParams.resourceCapConfig.ghostCount ?? 2)
      : 2;
    const spawnPositions = [
      { x: 20, y: 20 },
      { x: 44, y: 44 },
      { x: 20, y: 44 },
      { x: 44, y: 20 },
    ];
    for (let i = 0; i < targetGhostCount; i++) {
      const pos = spawnPositions[i % spawnPositions.length];
      ghosts.push(
        new Ghost({
          pos,
          moveIntervalMs: activeTuningParams.resourceCapConfig.ghostMoveIntervalMs ?? 90,
          rng,
        })
      );
    }
    this.engine.setGhosts(ghosts);
  }

  public startGame(options?: ProceduralMapOptions | number): void {
    const opts = typeof options === 'number' ? { seed: options } : options;
    if (opts?.topology === 'CLASSIC_FIXED') {
      this.startClassicGame();
      return;
    }
    this.startProceduralGame({
      topology: 'MULTI_SECTOR',
      difficulty: 'NORMAL',
      pacing: 'STANDARD',
      ...opts,
    });
  }

  /**
   * 静的テストベッドマップ（開発・回帰テスト用）開始メソッド
   */
  public startClassicGame(): void {
    if (!this.engine.isDemoActive()) {
      this.engine.getDemoController().restoreSoundAfterDemo(true);
    }
    this.engine.setProceduralMode(false);
    this.engine.setProceduralOptions({ topology: 'CLASSIC_FIXED' });
    const classicTuning = TuningPresetResolver.getClassicDefault();
    this.engine.setActiveTuningParams(classicTuning);
    this.engine.setTotalTurns(0);
    SpawnSystem.reset();

    const player = this.engine.getPlayer();
    if (player) {
      player.reset({ x: 8, y: 8, hp: 1000, experience: 1000, progressionConfig: classicTuning.progressionConfig });
    } else {
      this.engine.setPlayer(new Player({ x: 8, y: 8, hp: 1000, experience: 1000, progressionConfig: classicTuning.progressionConfig }));
    }

    this.engine.setMap(new WorldMap(64, 64));
    this.engine.setEnemies([]);
    this.engine.setGhosts([]);
    this.engine.setDragon(new Dragon({ x: 32, y: 32 }, 1.0));
    this.engine.getTurnManager().reset();
    this.engine.getCombatEffects().clear();
    this.engine.setSelectedMagicIndex(0);
    this.engine.setShowMiniMap(false);

    this.initLevelEntities();

    this.engine.setState('PLAYING');
    CombatSystem.clearEngagedEnemy();
    this.engine.getTargetTracker().clear();
    this.engine.getAudio().startBGM();

    const domUI = this.engine.getDomUI();
    domUI?.setGameState(this.engine.getState());
    domUI?.addLog('🔧 静的テストベッドマップ（開発・回帰テスト用）で開始しました。', 'info');
  }

  /**
   * プロシージャル（自動）生成されたダンジョンでゲームを開始
   */
  public startProceduralGame(options?: ProceduralMapOptions): void {
    if (options?.topology === 'CLASSIC_FIXED') {
      this.startClassicGame();
      return;
    }

    if (!this.engine.isDemoActive()) {
      this.engine.getDemoController().restoreSoundAfterDemo(true);
    }

    this.engine.setProceduralMode(true);
    const effectiveOverrides: DungeonTuningParams = {
      ...options?.tuningParams,
      progressionConfig: {
        ...options?.tuningParams?.progressionConfig,
        ...(options?.ruleMode ? { ruleMode: options.ruleMode } : {}),
      },
    };
    const resolvedParams = TuningPresetResolver.resolve(
      options?.topology,
      options?.difficulty,
      options?.pacing,
      effectiveOverrides,
      options?.archetype
    );
    this.engine.setActiveTuningParams(resolvedParams);
    this.engine.setTotalTurns(0);
    SpawnSystem.reset();

    const map = new WorldMap(64, 64);
    this.engine.setMap(map);
    const effectiveOptions: ProceduralMapOptions = {
      ...options,
      seed: options?.seed ?? this.engine.getRng().getSeed(),
    };
    const report = ProceduralMapGenerator.generateDungeon(map, effectiveOptions);
    this.engine.setProceduralOptions({
      ...effectiveOptions,
      seed: report.seed,
      homePos: { ...map.homePos },
      dragonCenter: { ...map.dragonCenter },
    });

    // プレイヤー初期位置は我が家の隣接空床
    const playerStartPos = this.findNearbyEmptyTile(map.homePos) ?? {
      x: map.homePos.x + 1,
      y: map.homePos.y + 1,
    };
    const activeProgConfig = this.engine.getActiveTuningParams().progressionConfig;
    const player = this.engine.getPlayer();
    if (player) {
      player.reset({ x: playerStartPos.x, y: playerStartPos.y, hp: 1000, experience: 1000, progressionConfig: activeProgConfig });
    } else {
      this.engine.setPlayer(new Player({ x: playerStartPos.x, y: playerStartPos.y, hp: 1000, experience: 1000, progressionConfig: activeProgConfig }));
    }

    this.engine.setEnemies([]);
    this.engine.setGhosts([]);
    this.engine.setDragon(new Dragon(map.dragonCenter, resolvedParams.progressionConfig.dragonDefRatio));
    this.engine.getTurnManager().reset();
    this.engine.getCombatEffects().clear();
    this.engine.setSelectedMagicIndex(0);
    this.engine.setShowMiniMap(false);

    this.initLevelEntities();

    this.engine.setState('PLAYING');
    CombatSystem.clearEngagedEnemy();
    this.engine.getTargetTracker().clear();
    this.engine.getAudio().startBGM();

    const domUI = this.engine.getDomUI();
    domUI?.setGameState(this.engine.getState());
    domUI?.addLog(
      `🎲 プロシージャル生成ダンジョン開始！ [${options?.topology ?? 'MULTI_SECTOR'} / ${options?.difficulty ?? 'NORMAL'} / ${options?.pacing ?? 'STANDARD'}] (Seed: ${report.seed}, 宝箱: ${report.counts.chests}個, 墓: ${report.counts.graves}基)`,
      'success'
    );
  }

  /**
   * 指定したプリセット（シード＆設定）からゲームを開始
   */
  public startPresetGame(preset: MapPresetData): void {
    this.startProceduralGame({
      seed: preset.seed,
      difficulty: preset.options.difficulty,
      pacing: preset.options.pacing,
      topology: preset.options.topology,
      archetype: preset.options.archetype,
      dragonPrefab: preset.options.dragonPrefab,
      homePrefab: preset.options.homePrefab,
    });
    this.engine.getDomUI()?.addLog(`🗺️ プリセット「${preset.name}」をロードして開始しました！`, 'info');
  }

  /**
   * 現在プレイ中/終了時のマップシード＆設定をプリセットとして保存
   */
  public saveCurrentMapAsPreset(name?: string): MapPresetData | null {
    const isProcedural = this.engine.isProceduralModeState();
    const proceduralOptions = this.engine.getProceduralOptions();
    const domUI = this.engine.getDomUI();

    if (!isProcedural || !proceduralOptions?.seed) {
      domUI?.addLog('⚠️ 静的テストベッドマップまたは未設定マップはプリセット保存できません。', 'warn');
      return null;
    }

    const presetName =
      name?.trim() ||
      `ダンジョン (Seed: ${proceduralOptions.seed})`;

    const map = this.engine.getMap();
    const isCleared = this.engine.getState() === 'STAGECLEAR';
    const totalTurns = this.engine.getTotalTurns();

    // MapProfilerで幾何メトリクス・推定トポロジー・難易度を取得
    let profileReport;
    if (map) {
      try {
        profileReport = MapProfiler.profile(map, {
          seed: proceduralOptions.seed,
          topology: proceduralOptions.topology,
        });
      } catch (e) {
        console.warn('[SessionController] Failed to profile map on save:', e);
      }
    }

    const saved = MapPresetManager.savePreset({
      name: presetName,
      seed: proceduralOptions.seed,
      options: {
        difficulty: proceduralOptions.difficulty ?? 'NORMAL',
        pacing: proceduralOptions.pacing ?? 'STANDARD',
        topology: proceduralOptions.topology ?? 'MULTI_SECTOR',
        archetype: proceduralOptions.archetype ?? 'BALANCED',
        dragonPrefab: proceduralOptions.dragonPrefab,
        homePrefab: proceduralOptions.homePrefab,
      },
      metrics: {
        dragonPos: map?.dragonCenter ? { ...map.dragonCenter } : undefined,
        homePos: map?.homePos ? { ...map.homePos } : undefined,
        cleared: isCleared,
        clearTurns: totalTurns,
        highScore: this.engine.getPlayer()?.gold,
        estimatedTopology: profileReport?.estimatedTopology,
        estimatedDifficulty: profileReport?.estimatedDifficulty,
        estimatedPacing: profileReport?.estimatedPacing,
        challengeRating: profileReport?.challengeRating,
        tags: profileReport?.tags,
        playerCleared: isCleared,
        playerClearTurns: isCleared ? totalTurns : undefined,
      },
    });

    if (isCleared) {
      MapPresetManager.recordPlayerClear(proceduralOptions.seed, totalTurns);
    }

    const shareCode = MapPresetManager.exportShareCode(saved);
    domUI?.addLog(`★ マッププリセット「${saved.name}」を保存しました！`, 'success');
    if (profileReport) {
      domUI?.addLog(
        `📊 観測プロファイル: [${profileReport.estimatedDifficulty}] ${profileReport.estimatedTopology} (難易度: ${profileReport.challengeRating}/100)`,
        'info'
      );
    }
    domUI?.addLog(`📋 共有コード: ${shareCode}`, 'info');

    return saved;
  }

  public findNearbyEmptyTile(pos: Position): Position | null {
    const map = this.engine.getMap();
    const offsets = [
      { dx: 1, dy: 0 },
      { dx: 1, dy: 1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: -1, dy: -1 },
      { dx: 0, dy: -1 },
      { dx: 1, dy: -1 },
    ];
    for (const off of offsets) {
      const p = map.wrapPosition({ x: pos.x + off.dx, y: pos.y + off.dy });
      if (
        map.getBaseTile(p) === 'EMPTY' &&
        map.getObject(p) === 'NONE' &&
        map.getItem(p) === 'NONE'
      ) {
        return p;
      }
    }
    return null;
  }

  public resetGame(): void {
    this.engine.setTotalTurns(0);
    SpawnSystem.reset();
    const map = new WorldMap(64, 64);
    this.engine.setMap(map);

    if (this.engine.isProceduralModeState()) {
      ProceduralMapGenerator.generateDungeon(map, this.engine.getProceduralOptions());
    }
    const playerStartPos = this.findNearbyEmptyTile(map.homePos) ?? {
      x: map.homePos.x + 1,
      y: map.homePos.y + 1,
    };
    const activeProgConfig = this.engine.getActiveTuningParams().progressionConfig;
    const player = this.engine.getPlayer();
    if (player) {
      player.reset({ x: playerStartPos.x, y: playerStartPos.y, hp: 1000, experience: 1000, progressionConfig: activeProgConfig });
    } else {
      this.engine.setPlayer(new Player({ x: playerStartPos.x, y: playerStartPos.y, hp: 1000, experience: 1000, progressionConfig: activeProgConfig }));
    }
    this.engine.setEnemies([]);
    this.engine.setGhosts([]);
    this.engine.setDragon(new Dragon(
      map.dragonCenter,
      this.engine.isProceduralModeState() ? this.engine.getActiveTuningParams().progressionConfig.dragonDefRatio : 1.0
    ));
    this.engine.getTurnManager().reset();
    this.engine.getCombatEffects().clear();
    this.engine.setSelectedMagicIndex(0);
    this.engine.setShowMiniMap(false);

    this.initLevelEntities();

    this.engine.setState('PLAYING');
    CombatSystem.clearEngagedEnemy();
    this.engine.getTargetTracker().clear();
    this.engine.getAudio().startBGM();

    const domUI = this.engine.getDomUI();
    domUI?.setGameState(this.engine.getState());
    domUI?.addLog('Game Reset. 新たな挑戦が始まった！', 'info');
  }

  public toggleSound(): void {
    const audio = this.engine.getAudio();
    const isMuted = audio.toggleMute();
    this.engine.getDomUI()?.updateSoundStatus(isMuted);
    if (!isMuted && this.engine.getState() === 'PLAYING') {
      audio.startBGM();
    }
  }

  /**
   * ギブアップ確認ダイアログの表示
   */
  public promptGiveUp(): void {
    if (this.engine.getState() !== 'PLAYING') return;
    this.engine.getDomUI()?.showGiveUpConfirm();
  }

  /**
   * ギブアップ実行処理 (探索断念 -> リザルト/ゲームオーバー)
   */
  public handleGiveUp(): void {
    if (this.engine.getState() !== 'PLAYING') return;
    this.engine.getDomUI()?.hideGiveUpConfirm();
    const giveUpDeathInfo: DeathInfo = {
      cause: 'GIVE_UP',
      message: '過酷な迷宮の前に自ら探索を断念した（GIVE UP）…',
      damage: 0,
      turn: this.engine.getTotalTurns(),
    };
    this.engine.getTurnExecutionController().handleGameOver(giveUpDeathInfo);
  }

  /**
   * 中断セーブしてタイトル画面へ戻る (SAVE & QUIT)
   */
  public saveAndQuit(): void {
    if (this.engine.getState() !== 'PLAYING') return;

    const renderer = this.engine.getRenderer();
    const fullData: FullSaveData = {
      version: CURRENT_SAVE_VERSION,
      savedAt: new Date().toISOString(),
      player: this.engine.getPlayer().serialize(),
      map: this.engine.getMap().serialize(),
      enemies: this.engine.getEnemies().map(e => e.serialize()),
      dragon: this.engine.getDragon().serialize(),
      ghosts: this.engine.getGhosts().map(g => g.serialize()),
      system: {
        totalTurns: this.engine.getTotalTurns(),
        paletteMode: renderer ? renderer.getPalette().getMode() : 'NORMAL',
        selectedMagicIndex: this.engine.getSelectedMagicIndex(),
        showMiniMap: this.engine.getShowMiniMap(),
        spawnTurnCounter: SpawnSystem.getTurnCounter(),
        tuningParams: this.engine.getActiveTuningParams(),
        isProceduralMode: this.engine.isProceduralModeState(),
        proceduralOptions: this.engine.getProceduralOptions(),
      },
    };

    const domUI = this.engine.getDomUI();
    const success = SaveManager.save(fullData);
    if (success) {
      domUI?.addLog('💾 ゲームを中断セーブしました。タイトル画面に戻ります。', 'info');
      this.engine.setState('TITLE');
      this.engine.getAudio().stopBGM();
      domUI?.setGameState(this.engine.getState());
      this.refreshContinueButton();
    } else {
      domUI?.addLog('セーブデータの保存に失敗しました', 'warn');
    }
  }

  /**
   * 中断セーブデータからゲーム再開 (CONTINUE)
   */
  public continueGame(): void {
    this.engine.getDemoController().restoreSoundAfterDemo(true);
    const data = SaveManager.load();
    const domUI = this.engine.getDomUI();
    if (!data) {
      domUI?.addLog('有効なセーブデータが見つかりません', 'warn');
      return;
    }

    try {
      this.engine.getPlayer().deserialize(data.player);
      this.engine.getMap().deserialize(data.map);
      this.engine.setEnemies(data.enemies.map(e => EnemyInstance.fromJSON(e)));
      this.engine.getDragon().deserialize(data.dragon);
      this.engine.setGhosts(data.ghosts.map(g => Ghost.fromJSON(g)));
      this.engine.setTotalTurns(data.system.totalTurns ?? 0);
      this.engine.setSelectedMagicIndex(data.system.selectedMagicIndex ?? 0);
      this.engine.setShowMiniMap(data.system.showMiniMap ?? false);
      this.engine.setProceduralMode(data.system.isProceduralMode ?? false);
      this.engine.setProceduralOptions(data.system.proceduralOptions);
      const activeTuning = data.system.tuningParams ?? TuningPresetResolver.getClassicDefault();
      this.engine.setActiveTuningParams(activeTuning);
      this.engine.getPlayer().activeProgressionConfig = activeTuning.progressionConfig;
      SpawnSystem.setTurnCounter(data.system.spawnTurnCounter ?? 0);
      SpawnSystem.totalKills = data.player.totalKills ?? 0;

      const renderer = this.engine.getRenderer();
      if (renderer) {
        renderer.getPalette().setMode(data.system.paletteMode ?? 'NORMAL');
      }

      CombatSystem.clearEngagedEnemy();
      this.engine.getTargetTracker().clear();
      this.engine.getTurnManager().reset();
      this.engine.getCombatEffects().clear();

      this.engine.setState('PLAYING');
      this.engine.getAudio().startBGM();
      domUI?.setGameState(this.engine.getState());
      domUI?.addLog('★ 前回の中断データから冒険を再開しました！ ★', 'success');
    } catch (e) {
      console.error('[GameEngine] Failed to restore save data:', e);
      domUI?.addLog('セーブデータの復元に失敗しました。通常開始をお試しください。', 'warn');
    }
  }

  /**
   * タイトル画面のCONTINUEボタン状態を更新
   */
  public refreshContinueButton(): void {
    const summary = SaveManager.getSummary();
    this.engine.getDomUI()?.updateContinueButton(summary);
  }
}
