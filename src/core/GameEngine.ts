import { DeathInfo, Direction, GameState, Position, TargetEnemyInfo, ResolvedDungeonTuningParams } from '../models/Types.js';
import { AutoPlayBot } from '../ai/AutoPlayBot.js';
import { Player } from '../models/Player.js';
import { WorldMap } from '../models/WorldMap.js';
import { EnemyInstance } from '../models/Enemy.js';
import { Ghost } from '../models/Ghost.js';
import { Dragon, DragonPart } from '../models/Dragon.js';
import { CanvasRenderer } from '../view/CanvasRenderer.js';
import { CombatEffectManager } from '../view/CombatEffectManager.js';
import { EnemyAISystem } from '../systems/EnemyAISystem.js';
import { GhostAISystem } from '../systems/GhostAISystem.js';
import { SpawnSystem } from '../systems/SpawnSystem.js';
import { MagicSystem } from '../systems/MagicSystem.js';
import { DOMUIManager } from '../view/DOMUIManager.js';
import { TurnManager } from './TurnManager.js';
import { InputManager } from './InputManager.js';
import { GameLoop } from './GameLoop.js';
import { PSGAudio } from '../audio/PSGAudio.js';
import { ChestSystem } from '../systems/ChestSystem.js';
import { ProceduralMapOptions } from '../systems/ProceduralMapGenerator.js';
import { TuningPresetResolver } from '../config/TuningPresetResolver.js';
import { MapPresetData } from '../services/MapPresetManager.js';
import { SeedRandom } from './SeedRandom.js';
import { GameEventBus } from './GameEventBus.js';

import { TargetTrackingController } from './engine/TargetTrackingController.js';
import { TurnExecutionController } from './engine/TurnExecutionController.js';
import { DemoAndAutoPlayController } from './engine/DemoAndAutoPlayController.js';
import { SessionController } from './engine/SessionController.js';
import { EngineUIAndInputBinder } from './engine/EngineUIAndInputBinder.js';

export interface GameEngineOptions {
  canvas?: HTMLCanvasElement | null;
  seed?: number | string;
  rng?: SeedRandom;
  eventBus?: GameEventBus;
}

/**
 * ゲームエンジン（ファサード・オーケストレーター）
 * 各サブコントローラーへの処理委譲とゲームライフサイクル・描画ループを統括
 */
export class GameEngine {
  private rng: SeedRandom;
  private eventBus: GameEventBus;
  private player: Player;
  private map: WorldMap;
  private enemies: EnemyInstance[];
  private ghosts: Ghost[];
  private dragon: Dragon;
  private renderer?: CanvasRenderer;
  private combatEffects: CombatEffectManager;
  private domUI?: DOMUIManager;
  private turnManager: TurnManager;
  private inputManager: InputManager;
  private gameLoop: GameLoop;
  private audio: PSGAudio;

  private state: GameState = 'TITLE';
  private selectedMagicIndex: number = 0;
  private showMiniMap: boolean = false;
  private totalTurns: number = 0;
  private isProceduralMode: boolean = false;
  private activeTuningParams: ResolvedDungeonTuningParams = TuningPresetResolver.getClassicDefault();
  private proceduralOptions?: ProceduralMapOptions;

  // サブコントローラー
  private targetTracker: TargetTrackingController;
  private turnExecutionController: TurnExecutionController;
  private demoController: DemoAndAutoPlayController;
  private sessionController: SessionController;
  private uiBinder: EngineUIAndInputBinder;

  constructor(
    canvasOrOptions?: HTMLCanvasElement | null | GameEngineOptions,
    options?: GameEngineOptions
  ) {
    let resolvedCanvas: HTMLCanvasElement | null | undefined;
    let resolvedOptions: GameEngineOptions | undefined;

    if (canvasOrOptions && typeof canvasOrOptions === 'object' && !('getContext' in canvasOrOptions)) {
      resolvedOptions = canvasOrOptions as GameEngineOptions;
      resolvedCanvas = resolvedOptions.canvas;
    } else {
      resolvedCanvas = canvasOrOptions as (HTMLCanvasElement | null | undefined);
      resolvedOptions = options;
    }

    this.rng = resolvedOptions?.rng ?? new SeedRandom(resolvedOptions?.seed ?? Date.now());
    this.eventBus = resolvedOptions?.eventBus ?? new GameEventBus();

    // 各システムのデフォルトPRNGを本エンジンの乱数器にバインド
    SpawnSystem.setDefaultRng(this.rng);
    EnemyAISystem.setDefaultRng(this.rng);
    GhostAISystem.setDefaultRng(this.rng);
    ChestSystem.setDefaultRng(this.rng);

    this.audio = PSGAudio.getInstance();
    this.renderer = resolvedCanvas ? new CanvasRenderer(resolvedCanvas) : undefined;
    this.combatEffects = new CombatEffectManager();
    this.turnManager = new TurnManager();
    this.inputManager = new InputManager();

    // 内部エンティティ初期化
    this.player = new Player({ x: 8, y: 8, hp: 1000, experience: 1000 });
    this.map = new WorldMap();
    this.enemies = [];
    this.ghosts = [];
    this.dragon = new Dragon({ x: 32, y: 32 });

    // サブコントローラー初期化
    this.targetTracker = new TargetTrackingController();
    this.turnExecutionController = new TurnExecutionController(this);
    this.demoController = new DemoAndAutoPlayController(this);
    this.sessionController = new SessionController(this);
    this.uiBinder = new EngineUIAndInputBinder(this);

    // DOM UI層の初期化（ブラウザ環境）
    if (typeof document !== 'undefined') {
      this.domUI = this.uiBinder.bindDOMUI('dom-ui-layer');
      this.domUI.setGameState(this.state);
      this.domUI.updateSoundStatus(this.audio.isMuted());
      this.domUI.updateMarkerStatus(this.uiBinder.isMarkerEnabled());
      this.refreshContinueButton();
    }

    if (this.renderer) {
      this.renderer.setTacticalMarker(this.uiBinder.isMarkerEnabled());
    }

    this.sessionController.initLevelEntities();
    this.uiBinder.bindInputHandlers(this.inputManager);

    // ゲームループ初期化
    this.gameLoop = new GameLoop(
      (deltaMs) => this.update(deltaMs),
      () => this.render()
    );
  }

  // ==========================================================================
  // ライフサイクル & メインループ
  // ==========================================================================

  public start(): void {
    this.gameLoop.start();
  }

  public stop(): void {
    this.gameLoop.stop();
    this.inputManager.destroy();
    this.audio.stopBGM();
  }

  private update(deltaMs: number): void {
    if (this.state !== 'PLAYING') return;

    // 1. ターンの時間進行
    this.turnManager.update(deltaMs);

    // 2. 戦闘視覚エフェクトの更新
    this.combatEffects.update(deltaMs);

    // 3. ゴーストのリアルタイム高速徘徊・アイテム強奪
    GhostAISystem.updateGhosts(this.ghosts, deltaMs, this.player, this.map, this.rng);

    // 4. ターゲットモンスターの追跡更新
    this.updateTargetTracking();

    // 死亡判定 (火炎弾やゴースト等によるダメージ)
    if (this.player.hp <= 0 && this.state === 'PLAYING') {
      this.turnExecutionController.handleGameOver();
    }
  }

  public stepFrame(deltaMs: number = 16.6): void {
    this.update(deltaMs);
    this.render();
  }

  private render(): void {
    if (!this.renderer) {
      return;
    }

    const unlocked = MagicSystem.getUnlockedMagics(this.player);
    const selectedMagic =
      unlocked.length > 0
        ? unlocked[this.selectedMagicIndex % unlocked.length]?.type
        : undefined;

    // 1. Canvas 純マップ描画（戦闘エフェクト連携）
    this.renderer.render(
      this.player,
      this.map,
      this.turnManager.ratio,
      this.enemies,
      this.ghosts,
      this.dragon,
      selectedMagic,
      this.showMiniMap,
      this.combatEffects
    );

    // 2. パレット（テーマ）の同期
    const currentPaletteMode = this.renderer.getPalette().getMode();
    this.domUI?.syncPalette(currentPaletteMode);

    // 3. DOM UI層の同期更新
    this.domUI?.update(
      this.player,
      this.turnManager.ratio,
      selectedMagic,
      unlocked,
      this.map,
      this.targetTracker.getTargetEnemyInfo()
    );
  }

  // ==========================================================================
  // セッション・開始・リセット・保存（SessionController 委譲）
  // ==========================================================================

  public startGame(options?: ProceduralMapOptions): void {
    this.sessionController.startGame(options);
  }

  public startClassicGame(): void {
    this.sessionController.startClassicGame();
  }

  public startProceduralGame(options?: ProceduralMapOptions): void {
    this.sessionController.startProceduralGame(options);
  }

  public startPresetGame(preset: MapPresetData): void {
    this.sessionController.startPresetGame(preset);
  }

  public saveCurrentMapAsPreset(name?: string): MapPresetData | null {
    return this.sessionController.saveCurrentMapAsPreset(name);
  }

  public resetGame(): void {
    this.sessionController.resetGame();
  }

  public toggleSound(): void {
    this.sessionController.toggleSound();
  }

  public promptGiveUp(): void {
    this.sessionController.promptGiveUp();
  }

  public handleGiveUp(): void {
    this.sessionController.handleGiveUp();
  }

  public saveAndQuit(): void {
    this.sessionController.saveAndQuit();
  }

  public continueGame(): void {
    this.sessionController.continueGame();
  }

  public refreshContinueButton(): void {
    this.sessionController.refreshContinueButton();
  }

  // ==========================================================================
  // デモ & AutoPlay自走検証（DemoAndAutoPlayController 委譲）
  // ==========================================================================

  public startDemoMode(): void {
    this.demoController.startDemoMode();
  }

  public startAutoPlayVerifyMode(options?: ProceduralMapOptions, preset?: MapPresetData): void {
    this.demoController.startAutoPlayVerifyMode(options, preset);
  }

  public setAutoPlaySpeed(multiplier: number): void {
    this.demoController.setAutoPlaySpeed(multiplier);
  }

  public takeoverAutoPlay(): void {
    this.demoController.takeoverAutoPlay();
  }

  public startAutoPlayFromCurrentState(): void {
    this.demoController.startAutoPlayFromCurrentState();
  }

  public toggleAutoPlay(): void {
    this.demoController.toggleAutoPlay();
  }

  public stopAutoPlayVerifyMode(returnToCustom: boolean = true): void {
    this.demoController.stopAutoPlayVerifyMode(returnToCustom);
  }

  public stepDemo(): void {
    this.demoController.stepDemo();
  }

  public stopDemoMode(): void {
    this.demoController.stopDemoMode();
  }

  public isDemoActive(): boolean {
    return this.demoController.isDemoActive();
  }

  public isAutoPlayVerifyActive(): boolean {
    return this.demoController.isAutoPlayVerifyActive();
  }

  public getAutoPlaySpeed(): number {
    return this.demoController.getAutoPlaySpeed();
  }

  public isAutoPlayPausedState(): boolean {
    return this.demoController.isAutoPlayPausedState();
  }

  // 後方互換性プロパティ (テストコード等で直接参照される内部ステートの委譲)
  public get isDemoMode(): boolean {
    return this.demoController.isDemoActive();
  }

  public set isDemoMode(val: boolean) {
    this.demoController.setDemoMode(val);
  }

  public get demoTurns(): number {
    return this.demoController.getDemoTurns();
  }

  public set demoTurns(val: number) {
    this.demoController.setDemoTurns(val);
  }

  public get lastDemoPos(): Position | null {
    return this.demoController.getLastDemoPos();
  }

  public set lastDemoPos(val: Position | null) {
    this.demoController.setLastDemoPos(val);
  }

  public get demoStuckFrames(): number {
    return this.demoController.getDemoStuckFrames();
  }

  public set demoStuckFrames(val: number) {
    this.demoController.setDemoStuckFrames(val);
  }

  public get demoBot(): AutoPlayBot | null {
    return this.demoController.getDemoBot();
  }

  public set demoBot(bot: AutoPlayBot | null) {
    this.demoController.setDemoBot(bot);
  }

  // ==========================================================================
  // ターン進行・魔法（TurnExecutionController 委譲）
  // ==========================================================================

  public castMagic(magicType: string): boolean {
    return this.turnExecutionController.castMagic(magicType);
  }

  public castSelectedMagic(): void {
    this.turnExecutionController.castSelectedMagic();
  }

  public executeTurn(dir: Direction | null, isTimeout: boolean = false): void {
    this.turnExecutionController.executeTurn(dir, isTimeout);
  }

  public executeEnemyTurn(): void {
    this.turnExecutionController.executeEnemyTurn();
  }

  public handleGameOver(overrideDeathInfo?: DeathInfo): void {
    this.turnExecutionController.handleGameOver(overrideDeathInfo);
  }

  public handleStageClear(): void {
    this.turnExecutionController.handleStageClear();
  }

  // ==========================================================================
  // ターゲット情報 & UIトグル（TargetTracker & UIAndInputBinder 委譲）
  // ==========================================================================

  public createTargetEnemyInfo(enemy: EnemyInstance): TargetEnemyInfo {
    return this.targetTracker.createTargetEnemyInfo(enemy, this.player, this.activeTuningParams);
  }

  public createTargetDragonInfo(part: DragonPart): TargetEnemyInfo {
    return this.targetTracker.createTargetDragonInfo(part, this.player, this.activeTuningParams);
  }

  public updateTargetTracking(): void {
    this.targetTracker.updateTargetTracking(this.player, this.activeTuningParams);
  }

  public getTargetEnemyInfo(): TargetEnemyInfo | null {
    return this.targetTracker.getTargetEnemyInfo();
  }

  public setTargetEnemy(enemy: EnemyInstance | null): void {
    this.targetTracker.setTargetEnemy(enemy, this.player, this.activeTuningParams);
  }

  public toggleMarker(): void {
    this.uiBinder.toggleMarker();
  }

  public isMarkerEnabled(): boolean {
    return this.uiBinder.isMarkerEnabled();
  }

  public toggleInspector(): void {
    this.uiBinder.toggleInspector();
  }

  // ==========================================================================
  // 状態管理・ゲッター・セッター
  // ==========================================================================

  public getState(): GameState {
    return this.state;
  }

  public setState(state: GameState): void {
    if (this.state === state) return;
    const prev = this.state;
    this.state = state;
    this.domUI?.setGameState(state, this.player, this.player.totalKills);
    this.eventBus.emit('game:stateChange', {
      prev,
      current: state,
      turn: this.totalTurns,
      deathInfo: this.player.deathInfo ?? undefined,
    });
  }

  public getActiveTuningParams(): ResolvedDungeonTuningParams {
    return this.activeTuningParams;
  }

  public setActiveTuningParams(params: ResolvedDungeonTuningParams): void {
    this.activeTuningParams = params;
  }

  public getProceduralOptions(): ProceduralMapOptions | undefined {
    return this.proceduralOptions;
  }

  public setProceduralOptions(options?: ProceduralMapOptions): void {
    this.proceduralOptions = options;
  }

  public isProceduralModeState(): boolean {
    return this.isProceduralMode;
  }

  public setProceduralMode(val: boolean): void {
    this.isProceduralMode = val;
  }

  public getTotalTurns(): number {
    return this.totalTurns;
  }

  public setTotalTurns(val: number): void {
    this.totalTurns = val;
  }

  public incrementTotalTurns(): void {
    this.totalTurns++;
  }

  public getSelectedMagicIndex(): number {
    return this.selectedMagicIndex;
  }

  public setSelectedMagicIndex(idx: number): void {
    this.selectedMagicIndex = idx;
  }

  public getShowMiniMap(): boolean {
    return this.showMiniMap;
  }

  public setShowMiniMap(val: boolean): void {
    this.showMiniMap = val;
  }

  public getRng(): SeedRandom {
    return this.rng;
  }

  public getEventBus(): GameEventBus {
    return this.eventBus;
  }

  public getAudio(): PSGAudio {
    return this.audio;
  }

  public getPlayer(): Player {
    return this.player;
  }

  public setPlayer(player: Player): void {
    this.player = player;
  }

  public getMap(): WorldMap {
    return this.map;
  }

  public setMap(map: WorldMap): void {
    this.map = map;
  }

  public getEnemies(): EnemyInstance[] {
    return this.enemies;
  }

  public setEnemies(enemies: EnemyInstance[]): void {
    this.enemies = enemies;
  }

  public getGhosts(): Ghost[] {
    return this.ghosts;
  }

  public setGhosts(ghosts: Ghost[]): void {
    this.ghosts = ghosts;
  }

  public getDragon(): Dragon {
    return this.dragon;
  }

  public setDragon(dragon: Dragon): void {
    this.dragon = dragon;
  }

  public addEnemy(enemy: EnemyInstance): void {
    this.enemies.push(enemy);
  }

  public addGhost(ghost: Ghost): void {
    this.ghosts.push(ghost);
  }

  public getTurnManager(): TurnManager {
    return this.turnManager;
  }

  public getCombatEffects(): CombatEffectManager {
    return this.combatEffects;
  }

  public getRenderer(): CanvasRenderer | undefined {
    return this.renderer;
  }

  public getDomUI(): DOMUIManager | undefined {
    return this.domUI;
  }

  public getTargetTracker(): TargetTrackingController {
    return this.targetTracker;
  }

  public getTurnExecutionController(): TurnExecutionController {
    return this.turnExecutionController;
  }

  public getDemoController(): DemoAndAutoPlayController {
    return this.demoController;
  }

  public getSessionController(): SessionController {
    return this.sessionController;
  }

  public getUIBinder(): EngineUIAndInputBinder {
    return this.uiBinder;
  }
}
