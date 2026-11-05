import { WorldMap } from '../models/WorldMap.js';
import { Player } from '../models/Player.js';
import { Dragon } from '../models/Dragon.js';
import { Ghost } from '../models/Ghost.js';
import { EnemyInstance } from '../models/Enemy.js';
import { ResolvedDungeonTuningParams } from '../models/Types.js';
import { ProceduralMapOptions } from '../systems/ProceduralMapGenerator.js';

export interface InspectorData {
  map: WorldMap;
  player: Player;
  dragon: Dragon;
  ghosts: Ghost[];
  enemies: EnemyInstance[];
  tuningParams: ResolvedDungeonTuningParams;
  isProceduralMode: boolean;
  proceduralOptions?: ProceduralMapOptions;
  totalTurns: number;
}

export class InspectorModal {
  private overlayEl: HTMLElement | null = null;
  private currentTab: 'map' | 'params' | 'charts' = 'map';
  private cachedData: InspectorData | null = null;
  private onCloseCallback?: () => void;

  constructor(onClose?: () => void) {
    this.onCloseCallback = onClose;
    this.initDOM();
  }

  private initDOM(): void {
    if (typeof document === 'undefined') return;

    let overlay = document.getElementById('dom-inspector-modal');
    if (!overlay && document.body && typeof document.body.appendChild === 'function') {
      overlay = document.createElement('div');
      overlay.id = 'dom-inspector-modal';
      overlay.className = 'game-modal-overlay inspector-modal-overlay';
      overlay.style.display = 'none';
      document.body.appendChild(overlay);
    }
    this.overlayEl = overlay;
  }

  public isOpen(): boolean {
    return this.overlayEl !== null && this.overlayEl.style.display !== 'none';
  }

  public open(data: InspectorData): void {
    this.cachedData = data;
    if (!this.overlayEl) this.initDOM();
    if (!this.overlayEl) return;

    this.renderModal();
    this.overlayEl.style.display = 'flex';
  }

  public close(): void {
    if (this.overlayEl) {
      this.overlayEl.style.display = 'none';
    }
    this.onCloseCallback?.();
  }

  private renderModal(): void {
    if (!this.overlayEl || !this.cachedData) return;
    const d = this.cachedData;

    this.overlayEl.innerHTML = `
      <div class="modal-content-box inspector-modal-box">
        <div class="inspector-header">
          <div class="inspector-title">
            <span style="font-size: 20px;">📊</span>
            <h2>DUNGEON & TUNING INSPECTOR</h2>
            <span class="inspector-badge">${d.isProceduralMode ? 'PROCEDURAL' : 'CLASSIC FIXED'}</span>
          </div>
          <button class="inspector-close-btn" id="inspector-close-x" title="閉じる [ESC / I]">✕</button>
        </div>

        <!-- タブナビゲーション -->
        <div class="inspector-tabs">
          <button class="inspector-tab-btn ${this.currentTab === 'map' ? 'active' : ''}" data-tab="map">
            🗺️ マップ俯瞰 & 密度統計
          </button>
          <button class="inspector-tab-btn ${this.currentTab === 'params' ? 'active' : ''}" data-tab="params">
            ⚙️ トポロジー連動パラメータ
          </button>
          <button class="inspector-tab-btn ${this.currentTab === 'charts' ? 'active' : ''}" data-tab="charts">
            📈 成長カーブ & 戦闘グラフ
          </button>
        </div>

        <!-- タブコンテンツエリア -->
        <div class="inspector-content-area" id="inspector-content-body">
          ${this.renderTabContent(d)}
        </div>

        <div class="inspector-footer">
          <span class="inspector-turn-info">Total Turns: ${d.totalTurns} | Player Pos: (${d.player.pos.x}, ${d.player.pos.y})</span>
          <button class="action-btn-primary" id="inspector-bottom-close-btn">閉じる [ESC / I]</button>
        </div>
      </div>
    `;

    this.bindEvents(d);
  }

  private bindEvents(d: InspectorData): void {
    if (!this.overlayEl) return;

    // 閉じるボタン
    this.overlayEl.querySelector('#inspector-close-x')?.addEventListener('click', () => this.close());
    this.overlayEl.querySelector('#inspector-bottom-close-btn')?.addEventListener('click', () => this.close());

    // 外枠背景クリックで閉じる
    this.overlayEl.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) {
        this.close();
      }
    });

    // タブ切り替え
    const tabBtns = this.overlayEl.querySelectorAll('.inspector-tab-btn');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const tab = target.dataset.tab as 'map' | 'params' | 'charts';
        if (tab && tab !== this.currentTab) {
          this.currentTab = tab;
          this.renderModal();
        }
      });
    });

    // タブに応じたCanvas描画
    if (this.currentTab === 'map') {
      this.drawMinimapCanvas(d);
    } else if (this.currentTab === 'charts') {
      this.drawCharts(d);
    }
  }

  private renderTabContent(d: InspectorData): string {
    switch (this.currentTab) {
      case 'map':
        return this.renderMapTab(d);
      case 'params':
        return this.renderParamsTab(d);
      case 'charts':
        return this.renderChartsTab(d);
    }
  }

  // --- タブ 1: マップ俯瞰 & 密度メトリクス ---
  private renderMapTab(d: InspectorData): string {
    // マップ密度統計の集計
    let emptyFloorCount = 0;
    let blockCount = 0;
    let chestCount = 0;
    let graveCount = 0;
    let floorItemCount = 0;

    for (let y = 0; y < d.map.height; y++) {
      for (let x = 0; x < d.map.width; x++) {
        const base = d.map.getBaseTile({ x, y });
        const obj = d.map.getObject({ x, y });
        const item = d.map.getItem({ x, y });

        if (base === 'EMPTY' && obj === 'NONE') emptyFloorCount++;
        if (obj === 'BLOCK' || base === 'WALL_STATIC') blockCount++;
        if (obj === 'CHEST' || obj === 'CHEST_DRAGON') chestCount++;
        if (base === 'GRAVE') graveCount++;
        if (item !== 'NONE') floorItemCount++;
      }
    }

    const totalTiles = d.map.width * d.map.height;
    const obstacleDensity = ((blockCount / totalTiles) * 100).toFixed(1);
    const floorDensity = ((emptyFloorCount / totalTiles) * 100).toFixed(1);

    const topology = d.proceduralOptions?.topology ?? (d.isProceduralMode ? 'MULTI_SECTOR' : 'CLASSIC_FIXED');
    const difficulty = d.proceduralOptions?.difficulty ?? 'NORMAL';
    const pacing = d.proceduralOptions?.pacing ?? 'STANDARD';
    const seed = d.proceduralOptions?.seed ?? 'CLASSIC';

    return `
      <div class="inspector-map-layout">
        <!-- 左: 全体マップ縮小キャンバス -->
        <div class="inspector-canvas-wrapper">
          <div class="canvas-label">64×64 DUNGEON MAP OVERVIEW</div>
          <canvas id="inspector-minimap-canvas" width="256" height="256" class="inspector-minimap"></canvas>
          <div class="minimap-legend">
            <span class="legend-chip"><span class="chip-color chip-block"></span>壁/岩</span>
            <span class="legend-chip"><span class="chip-color chip-home"></span>家</span>
            <span class="legend-chip"><span class="chip-color chip-chest"></span>宝箱</span>
            <span class="legend-chip"><span class="chip-color chip-grave"></span>墓</span>
            <span class="legend-chip"><span class="chip-color chip-dragon"></span>竜</span>
            <span class="legend-chip"><span class="chip-color chip-player"></span>自機</span>
          </div>
        </div>

        <!-- 右: 密度・構造メトリクス表 -->
        <div class="inspector-stats-grid">
          <div class="metric-card">
            <div class="metric-title">ダンジョン地形 (Topology)</div>
            <div class="metric-value highlight">${topology}</div>
          </div>
          <div class="metric-card">
            <div class="metric-title">難易度 (Difficulty)</div>
            <div class="metric-value">${difficulty}</div>
          </div>
          <div class="metric-card">
            <div class="metric-title">プレイ時間 (Pacing)</div>
            <div class="metric-value">${pacing}</div>
          </div>
          <div class="metric-card">
            <div class="metric-title">生成シード値 (Seed)</div>
            <div class="metric-value mono">${seed}</div>
          </div>

          <div class="metric-card">
            <div class="metric-title">障害物・岩密度 (Obstacle)</div>
            <div class="metric-value highlight-cyan">${obstacleDensity}% <small>(${blockCount}マス)</small></div>
          </div>
          <div class="metric-card">
            <div class="metric-title">通行可能空床 (Floor)</div>
            <div class="metric-value">${floorDensity}% <small>(${emptyFloorCount}マス)</small></div>
          </div>
          <div class="metric-card">
            <div class="metric-title">宝箱総数 (Chests)</div>
            <div class="metric-value highlight-gold">${chestCount} <small>個</small></div>
          </div>
          <div class="metric-card">
            <div class="metric-title">敵墓地数 (Graves)</div>
            <div class="metric-value highlight-purple">${graveCount} <small>基</small></div>
          </div>
          <div class="metric-card">
            <div class="metric-title">床上アイテム数 (Items)</div>
            <div class="metric-value">${floorItemCount} <small>個</small></div>
          </div>
          <div class="metric-card">
            <div class="metric-title">徘徊ゴースト (Ghosts)</div>
            <div class="metric-value">${d.ghosts.length} <small>体 (${d.tuningParams.resourceCapConfig.ghostMoveIntervalMs}ms)</small></div>
          </div>
        </div>
      </div>
    `;
  }

  private drawMinimapCanvas(d: InspectorData): void {
    const canvas = document.getElementById('inspector-minimap-canvas') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scale = canvas.width / d.map.width; // 4px per tile

    for (let y = 0; y < d.map.height; y++) {
      for (let x = 0; x < d.map.width; x++) {
        const base = d.map.getBaseTile({ x, y });
        const obj = d.map.getObject({ x, y });

        if (base === 'WALL_STATIC') {
          ctx.fillStyle = '#30363d';
          ctx.fillRect(x * scale, y * scale, scale, scale);
        } else if (obj === 'BLOCK') {
          ctx.fillStyle = '#586069';
          ctx.fillRect(x * scale, y * scale, scale, scale);
        } else if (base === 'HOME') {
          ctx.fillStyle = '#3fb950';
          ctx.fillRect(x * scale, y * scale, scale, scale);
        } else if (obj === 'CHEST' || obj === 'CHEST_DRAGON') {
          ctx.fillStyle = '#d29922';
          ctx.fillRect(x * scale, y * scale, scale, scale);
        } else if (base === 'GRAVE') {
          ctx.fillStyle = '#a371f7';
          ctx.fillRect(x * scale, y * scale, scale, scale);
        } else if (base === 'WARP') {
          ctx.fillStyle = '#388bfd';
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }

    // ドラゴン要塞エリア
    const dc = d.dragon.centerPos;
    ctx.fillStyle = 'rgba(248, 81, 73, 0.4)';
    ctx.fillRect((dc.x - 4) * scale, (dc.y - 4) * scale, 9 * scale, 9 * scale);
    ctx.fillStyle = '#f85149';
    ctx.fillRect(dc.x * scale, dc.y * scale, scale, scale);

    // プレイヤー位置
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(d.player.pos.x * scale, d.player.pos.y * scale, scale, scale);
    ctx.strokeStyle = '#ffff00';
    ctx.strokeRect((d.player.pos.x - 1) * scale, (d.player.pos.y - 1) * scale, scale * 3, scale * 3);
  }

  // --- タブ 2: トポロジー連動パラメータ一覧 ---
  private renderParamsTab(d: InspectorData): string {
    const tp = d.tuningParams;

    return `
      <div class="inspector-params-layout">
        <!-- スポーン制御 -->
        <div class="params-section">
          <div class="params-section-title">1. スポーン＆家湧き制御 (Spawn & Home Reserve)</div>
          <table class="params-table">
            <thead>
              <tr>
                <th>フェーズ (討伐首数)</th>
                <th>首0本 (序盤)</th>
                <th>首1本 (中盤)</th>
                <th>首2本 (終盤)</th>
                <th>首3本 (決戦・運搬)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>通常墓湧き上限</td>
                <td>${tp.spawnConfig.maxFieldEnemiesByPhase[0]}体</td>
                <td>${tp.spawnConfig.maxFieldEnemiesByPhase[1]}体</td>
                <td>${tp.spawnConfig.maxFieldEnemiesByPhase[2]}体</td>
                <td>${tp.spawnConfig.maxFieldEnemiesByPhase[3]}体</td>
              </tr>
              <tr>
                <td>家湧き専用別枠 (Home Reserve)</td>
                <td>${tp.spawnConfig.homeSpawnReserveByPhase[0]}体</td>
                <td>${tp.spawnConfig.homeSpawnReserveByPhase[1]}体</td>
                <td>${tp.spawnConfig.homeSpawnReserveByPhase[2]}体</td>
                <td>${tp.spawnConfig.homeSpawnReserveByPhase[3]}体</td>
              </tr>
            </tbody>
          </table>
          <div class="param-annotation">
            ※ 上限到達時の最遠非交戦敵パージ (evictDistantEnemyOnHomeSpawn): <strong>${tp.spawnConfig.evictDistantEnemyOnHomeSpawn ? '有効 (家湧き完全保証)' : '無効'}</strong>
          </div>
        </div>

        <!-- 成長・戦闘カーブ制御 -->
        <div class="params-section">
          <div class="params-section-title">2. 成長・戦闘カーブ制御 (Progression & Mitigation)</div>
          <div class="params-keyvalues">
            <div class="kv-item">
              <span class="kv-key">EXP減衰カーブモード:</span>
              <span class="kv-val highlight">${tp.progressionConfig.expCurveMode}</span>
            </div>
            <div class="kv-item">
              <span class="kv-key">減衰べき乗指数 (Exponent):</span>
              <span class="kv-val">${tp.progressionConfig.expDampingExponent}</span>
            </div>
            <div class="kv-item">
              <span class="kv-key">EXP全体スケール倍率:</span>
              <span class="kv-val">${tp.progressionConfig.expScaleFactor}x</span>
            </div>
            <div class="kv-item">
              <span class="kv-key">被ダメ軽減寄与倍率:</span>
              <span class="kv-val">${tp.progressionConfig.expDefenseMitigationRatio}x</span>
            </div>
            <div class="kv-item">
              <span class="kv-key">パワーストーン複利成長率:</span>
              <span class="kv-val highlight-cyan">${(tp.progressionConfig.powerStoneGrowthRate * 100).toFixed(0)}%</span>
            </div>
            <div class="kv-item">
              <span class="kv-key">パワーストーン固定加算値:</span>
              <span class="kv-val">+${tp.progressionConfig.powerStoneFlatBonus.toLocaleString()}</span>
            </div>
            <div class="kv-item">
              <span class="kv-key">一般モンスターATK倍率:</span>
              <span class="kv-val">${tp.progressionConfig.enemyAtkRatio}x</span>
            </div>
            <div class="kv-item">
              <span class="kv-key">ドラゴン首DEF倍率:</span>
              <span class="kv-val">${tp.progressionConfig.dragonDefRatio}x</span>
            </div>
          </div>
        </div>

        <!-- 資源上限制御 -->
        <div class="params-section">
          <div class="params-section-title">3. 非消耗アイテム上限 & ゴースト (Resource Caps & Ghost)</div>
          <table class="params-table">
            <thead>
              <tr>
                <th>アイテム種別</th>
                <th>初期床上配置数</th>
                <th>ワールド同時存在上限 (Cap)</th>
                <th>上限到達時の挙動</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>十字架 (CROSS)</td>
                <td>${tp.resourceCapConfig.cross.initial}個</td>
                <td>${tp.resourceCapConfig.cross.maxCap}個</td>
                <td>宝箱の1/8枠を消耗品(POTION/COIN)へ自動フォールバック</td>
              </tr>
              <tr>
                <td>指輪 (RING)</td>
                <td>${tp.resourceCapConfig.ring.initial}個</td>
                <td>${tp.resourceCapConfig.ring.maxCap}個</td>
                <td>宝箱の1/8枠を消耗品へ自動フォールバック</td>
              </tr>
              <tr>
                <td>鍵 (KEY)</td>
                <td>${tp.resourceCapConfig.key.initial}個</td>
                <td>${tp.resourceCapConfig.key.maxCap}個</td>
                <td>宝箱の1/8枠を消耗品へ自動フォールバック</td>
              </tr>
              <tr>
                <td>剣 (SWORD)</td>
                <td>${tp.resourceCapConfig.sword.initial}個</td>
                <td>${tp.resourceCapConfig.sword.maxCap}個</td>
                <td>宝箱の1/8枠を消耗品へ自動フォールバック</td>
              </tr>
            </tbody>
          </table>
          <div class="param-annotation">
            ※ ゴースト初期数: <strong>${tp.resourceCapConfig.ghostCount}体</strong> | 滑空速度: <strong>${tp.resourceCapConfig.ghostMoveIntervalMs}ms / 歩</strong>
          </div>
        </div>
      </div>
    `;
  }

  // --- タブ 3: 成長カーブ & 戦闘グラフ ---
  private renderChartsTab(d: InspectorData): string {
    const isClassic = d.tuningParams.progressionConfig.ruleMode === 'CLASSIC' || d.tuningParams.progressionConfig.powerStoneGrowthRate === 0;
    const stoneDesc = isClassic
      ? '約160個の奉納でドラゴン首 (DEF 400,000) を突破（初代固定+2,500加算成長）'
      : '約14〜16個の奉納でドラゴン首 (DEF 400,000) を突破（指数複利成長）';

    return `
      <div class="inspector-charts-layout">
        <!-- グラフ 1: パワーストーン奉納 STR成長曲線 -->
        <div class="chart-container-box">
          <div class="chart-header">
            <span class="chart-title">💎 パワーストーン奉納個数 vs プレイヤーSTR成長曲線</span>
            <span class="chart-desc">${stoneDesc}</span>
          </div>
          <canvas id="chart-powerstone-str" width="560" height="190" class="inspector-chart"></canvas>
        </div>

        <!-- グラフ 2: 敵DEF vs 獲得EXPカーブ -->
        <div class="chart-container-box">
          <div class="chart-header">
            <span class="chart-title">⚔️ 撃破敵DEF vs 獲得EXPカーブ (インフレ減衰比較)</span>
            <span class="chart-desc">CLASSIC_LINEAR (急騰) vs DAMPED_POWER (べき乗減衰) vs PHASE_CAPPED (段階上限)</span>
          </div>
          <canvas id="chart-exp-damping" width="560" height="190" class="inspector-chart"></canvas>
        </div>
      </div>
    `;
  }

  private drawCharts(d: InspectorData): void {
    const tp = d.tuningParams;

    // 1. パワーストーン STR 成長グラフ
    this.drawPowerStoneChart(tp);

    // 2. EXP 減衰カーブグラフ
    this.drawExpDampingChart(tp);
  }

  private drawPowerStoneChart(tp: ResolvedDungeonTuningParams): void {
    const canvas = document.getElementById('chart-powerstone-str') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, w, h);

    const padL = 60;
    const padR = 25;
    const padT = 25;
    const padB = 30;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const isClassic = tp.progressionConfig.ruleMode === 'CLASSIC' || tp.progressionConfig.powerStoneGrowthRate === 0;
    const maxStone = 20;
    const xStep = 2;
    const maxStr = isClassic ? 25000 : 500000;
    const yStep = isClassic ? 5000 : 100000;

    // グリッド線とY軸ラベル
    ctx.strokeStyle = '#21262d';
    ctx.fillStyle = '#8b949e';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';

    for (let s = yStep; s <= maxStr; s += yStep) {
      const y = padT + plotH - (s / maxStr) * plotH;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.fillText(isClassic ? `${s}` : `${s / 1000}k`, padL - 8, y + 3);
    }

    // X軸ラベル
    ctx.textAlign = 'center';
    for (let n = 0; n <= maxStone; n += xStep) {
      const x = padL + (n / maxStone) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.fillText(`${n}`, x, h - 12);
    }

    // ドラゴン首のDEFターゲットライン (DEF: 300,000 / 350,000 / 400,000)
    const dragonDefs = [
      { def: 300000 * tp.progressionConfig.dragonDefRatio, label: 'L-Head DEF' },
      { def: 350000 * tp.progressionConfig.dragonDefRatio, label: 'C-Head DEF' },
      { def: 400000 * tp.progressionConfig.dragonDefRatio, label: 'R-Head DEF' },
    ];

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#f85149';
    ctx.fillStyle = '#f85149';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';

    for (const dd of dragonDefs) {
      const y = padT + plotH - (dd.def / maxStr) * plotH;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.fillText(dd.label, padL + plotW - 4, y - 4);
    }
    ctx.restore();

    // プレイヤーSTR成長曲線シミュレーション
    // Player.calculatePowerStoneGain と完全同期 (CLASSIC時は+2500固定加算、EXPONENTIAL時は複利成長)
    const strValues: number[] = [10];
    let currentStr = 10;
    for (let i = 1; i <= maxStone; i++) {
      const gain = Player.calculatePowerStoneGain(currentStr, tp.progressionConfig);
      currentStr = Math.min(Player.MAX_STR, currentStr + gain);
      strValues.push(currentStr);
    }

    // プロット描画
    ctx.strokeStyle = '#388bfd';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= maxStone; i++) {
      const x = padL + (i / maxStone) * plotW;
      const y = padT + plotH - (strValues[i] / maxStr) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ポイントドット
    ctx.fillStyle = '#58a6ff';
    const dotStep = isClassic ? 2 : 1;
    for (let i = 0; i <= maxStone; i += dotStep) {
      const x = padL + (i / maxStone) * plotW;
      const y = padT + plotH - (strValues[i] / maxStr) * plotH;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawExpDampingChart(tp: ResolvedDungeonTuningParams): void {
    const canvas = document.getElementById('chart-exp-damping') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, w, h);

    const padL = 60;
    const padR = 25;
    const padT = 25;
    const padB = 30;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const maxDef = 200000;
    const maxExp = 150000;

    // グリッド線
    ctx.strokeStyle = '#21262d';
    ctx.fillStyle = '#8b949e';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';

    for (let e = 30000; e <= maxExp; e += 30000) {
      const y = padT + plotH - (e / maxExp) * plotH;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.fillText(`${e / 1000}k`, padL - 8, y + 3);
    }

    ctx.textAlign = 'center';
    for (let d = 0; d <= maxDef; d += 50000) {
      const x = padL + (d / maxDef) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.fillText(`${d / 1000}k`, x, h - 12);
    }

    const steps = 40;

    // 1. CLASSIC_LINEAR (灰色点線)
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#6e7681';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const def = (i / steps) * maxDef;
      const baseGain = Math.max(10, Math.floor(def * 0.8)); // 原作の線形比例
      const x = padL + (def / maxDef) * plotW;
      const y = padT + plotH - (Math.min(maxExp, baseGain) / maxExp) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // 2. PHASE_CAPPED (黄色点線)
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#d29922';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const phaseCap = tp.progressionConfig.expPhaseCaps[1]; // 首1本時 (例: 35000)
    for (let i = 0; i <= steps; i++) {
      const def = (i / steps) * maxDef;
      const exp = Math.min(phaseCap, Math.floor(def * 0.8));
      const x = padL + (def / maxDef) * plotW;
      const y = padT + plotH - (exp / maxExp) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // 3. DAMPED_POWER (シアン実線 - 現在のデフォルト)
    const isDamped = tp.progressionConfig.expCurveMode === 'DAMPED_POWER';
    ctx.strokeStyle = isDamped ? '#39c5bb' : '#a371f7';
    ctx.lineWidth = isDamped ? 2.5 : 1.5;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const def = (i / steps) * maxDef;
      const exp = Math.floor(Math.pow(def, tp.progressionConfig.expDampingExponent) * 15 * tp.progressionConfig.expScaleFactor);
      const x = padL + (def / maxDef) * plotW;
      const y = padT + plotH - (Math.min(maxExp, exp) / maxExp) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // レジェンド
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#6e7681';
    ctx.fillText('--- CLASSIC LINEAR', padL + 10, padT + 15);
    ctx.fillStyle = '#d29922';
    ctx.fillText('--- PHASE CAPPED', padL + 140, padT + 15);
    ctx.fillStyle = isDamped ? '#39c5bb' : '#a371f7';
    ctx.fillText('━━ DAMPED POWER (0.75)', padL + 260, padT + 15);
  }
}
