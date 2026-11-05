import { TileGraphics } from './TileGraphics.js';
import { PaletteManager } from './PaletteManager.js';
import { Ghost } from '../models/Ghost.js';
import { TileType } from '../models/Types.js';

export type HelpTabType = 'items' | 'facilities' | 'controls';

export class HelpModal {
  private overlayEl: HTMLElement | null = null;
  private currentTab: HelpTabType = 'items';
  private onCloseCallback?: () => void;
  private palette: PaletteManager = new PaletteManager();

  constructor(onClose?: () => void) {
    this.onCloseCallback = onClose;
    this.initDOM();
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Escape' && this.isOpen()) {
          this.close();
        }
      });
    }
  }

  private initDOM(): void {
    if (typeof document === 'undefined') return;

    let overlay = document.getElementById('dom-help-modal');
    if (!overlay && document.body && typeof document.body.appendChild === 'function') {
      overlay = document.createElement('div');
      overlay.id = 'dom-help-modal';
      overlay.className = 'game-modal-overlay help-modal-overlay';
      overlay.style.display = 'none';
      document.body.appendChild(overlay);
    }
    this.overlayEl = overlay;
  }

  public isOpen(): boolean {
    return this.overlayEl !== null && this.overlayEl.style.display !== 'none';
  }

  public open(defaultTab: HelpTabType = 'items'): void {
    this.currentTab = defaultTab;
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

  public setOnClose(cb: () => void): void {
    this.onCloseCallback = cb;
  }

  private renderModal(): void {
    if (!this.overlayEl) return;

    this.overlayEl.innerHTML = `
      <div class="modal-content-box help-modal-box">
        <div class="help-header">
          <div class="help-title">
            <span class="help-header-tag">[HELP & GUIDE]</span>
            <h2>ADVENTURE GUIDE</h2>
            <span class="help-badge">アイテム効果・施設・基本ルール</span>
          </div>
          <button class="help-close-btn" id="help-close-x" title="閉じる [ESC / H]">✕</button>
        </div>

        <div class="help-tab-bar">
          <button class="help-tab-btn ${this.currentTab === 'items' ? 'active' : ''}" data-tab="items">
            [ITEMS] アイテム図鑑
          </button>
          <button class="help-tab-btn ${this.currentTab === 'facilities' ? 'active' : ''}" data-tab="facilities">
            [FACILITIES] 施設・ギミック
          </button>
          <button class="help-tab-btn ${this.currentTab === 'controls' ? 'active' : ''}" data-tab="controls">
            [CONTROLS] 操作・基本ルール
          </button>
        </div>

        <div class="help-body">
          ${this.renderTabContent()}
        </div>

        <div class="help-footer">
          <div class="help-key-hint">ESC / H キーまたは ✕ ボタンでいつでも戻れます</div>
          <button class="action-btn-large help-ok-btn" id="help-ok-btn">閉じる [ESC / H]</button>
        </div>
      </div>
    `;

    this.attachEventListeners();
    this.renderTileCanvases();
  }

  /**
   * ヘルプ内の全キャンバスにゲーム内のピクセルアートを描画
   */
  private renderTileCanvases(): void {
    if (!this.overlayEl) return;
    const canvases = this.overlayEl.querySelectorAll<HTMLCanvasElement>('canvas.help-tile-canvas');

    canvases.forEach((canvas) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;

      const tile = canvas.getAttribute('data-tile');
      if (!tile) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (tile === 'GHOST') {
        const dummyGhost = new Ghost({ id: 'help-dummy', pos: { x: 0, y: 0 } });
        TileGraphics.drawGhost(ctx, dummyGhost, 0, 0);
      } else {
        TileGraphics.drawTile(ctx, tile as TileType, 0, 0, this.palette);
      }
    });
  }

  private renderTabContent(): string {
    switch (this.currentTab) {
      case 'items':
        return this.renderItemsTab();
      case 'facilities':
        return this.renderFacilitiesTab();
      case 'controls':
        return this.renderControlsTab();
      default:
        return '';
    }
  }

  private renderItemsTab(): string {
    return `
      <div class="help-section-intro">
        ダンジョン内には様々な効果を持つアイテムが存在します。<br>
        携帯アイテムは<strong>1種類のみ</strong>手持ち可能で、不要な時は足元の床に置いて持ち替えることができます。
      </div>

      <div class="help-grid">
        <!-- 剣 -->
        <div class="help-card highlight-card">
          <div class="card-icon">
            <canvas class="help-tile-canvas" data-tile="SWORD" width="32" height="32"></canvas>
          </div>
          <div class="card-content">
            <div class="card-title">SWORD [剣] <span class="card-badge badge-equip">最重要・即時装備</span></div>
            <div class="card-desc">
              足元のマスでSPACEを押すと自動装備されます。<br>
              <strong>【最重要】剣を装備していない状態では、どんなにSTRが高くても攻撃力は一律「10」に制限されます！</strong><br>
              剣を手に入れることで、蓄えたSTRの攻撃力が100%発揮されるようになります。最優先で探しましょう。
            </div>
          </div>
        </div>

        <!-- 指輪 -->
        <div class="help-card">
          <div class="card-icon">
            <canvas class="help-tile-canvas" data-tile="RING" width="32" height="32"></canvas>
          </div>
          <div class="card-content">
            <div class="card-title">RING [指輪] <span class="card-badge badge-hold">携帯アイテム</span></div>
            <div class="card-desc">
              手持ちに所持している間、<strong>岩（BLOCK）や「我が家（HOME）」を押して動かす</strong>ことができます。<br>
              ・道をふさぐ岩をどかして進行ルートを確保<br>
              ・岩を押して墓（GRAVE）の上に重ね、モンスターの出現を永久封鎖<br>
              ・危険な場所にある「我が家」を安全な部屋や通路の角へ移設（引っ越し）
            </div>
          </div>
        </div>

        <!-- 十字架 -->
        <div class="help-card">
          <div class="card-icon">
            <canvas class="help-tile-canvas" data-tile="CROSS" width="32" height="32"></canvas>
          </div>
          <div class="card-content">
            <div class="card-title">CROSS [十字架] <span class="card-badge badge-hold">携帯アイテム</span></div>
            <div class="card-desc">
              聖なる加護を宿す神秘の十字架。<br>
              ・<strong>手持ち中：完全無敵！</strong> 敵やドラゴンからの全ダメージを無効化します（※攻撃や魔法も行えなくなります）。<br>
              ・<strong>死神の浄化：</strong> 十字架を拾うか踏むと、取り憑いていた死神が即座に成仏・消滅します。<br>
              ・<strong>聖域結界：</strong> 地面に置いた十字架マスには、ゴーストが侵入できなくなります。
            </div>
          </div>
        </div>

        <!-- 鍵 -->
        <div class="help-card">
          <div class="card-icon">
            <canvas class="help-tile-canvas" data-tile="KEY" width="32" height="32"></canvas>
          </div>
          <div class="card-content">
            <div class="card-title">KEY [鍵] <span class="card-badge badge-hold">携帯アイテム</span></div>
            <div class="card-desc">
              宝箱を開けるための真鍮の鍵。<br>
              所持した状態で宝箱（CHEST）のマスに重なり、<strong>SPACEキーを押すことで宝箱を開錠</strong>します。<br>
              中からは貴重なアイテムが出現しますが、稀に死神（DEATH）が潜んでいることも…？
            </div>
          </div>
        </div>

        <!-- パワーストーン -->
        <div class="help-card">
          <div class="card-icon">
            <canvas class="help-tile-canvas" data-tile="POWER_STONE" width="32" height="32"></canvas>
          </div>
          <div class="card-content">
            <div class="card-title">POWER STONE [パワーストーン] <span class="card-badge badge-hold">携帯アイテム</span></div>
            <div class="card-desc">
              勇者の力を高める神秘の鉱石。<br>
              手持ちにして<strong>「我が家（HOME）」へ持ち帰ることで奉納され、プレイヤーのSTR（攻撃力）が永続的に大幅上昇</strong>します！<br>
              強力な上位モンスターやドラゴンを倒すには、パワーストーンによるSTR強化が不可欠です。
            </div>
          </div>
        </div>

        <!-- 王冠 -->
        <div class="help-card highlight-card">
          <div class="card-icon">
            <canvas class="help-tile-canvas" data-tile="CROWN" width="32" height="32"></canvas>
          </div>
          <div class="card-content">
            <div class="card-title">CROWN [王冠] <span class="card-badge badge-hold">携帯アイテム・クリア条件</span></div>
            <div class="card-desc">
              ドラゴンの各頭部を撃破すると宝箱から現れる秘宝（計4個）。<br>
              ・所持中は呪力により魔法詠唱が封じられます。<br>
              ・<strong>4つの王冠をすべて「我が家（HOME）」へ持ち帰るとステージクリア（完全勝利）！</strong>
            </div>
          </div>
        </div>

        <!-- 魔法の壺 -->
        <div class="help-card">
          <div class="card-icon">
            <canvas class="help-tile-canvas" data-tile="POTION" width="32" height="32"></canvas>
          </div>
          <div class="card-content">
            <div class="card-title">POTION [魔法の壺] <span class="card-badge badge-consume">即時取得</span></div>
            <div class="card-desc">
              足元でSPACEを押して拾うと、<strong>MAGIC（魔法使用可能回数）が +1</strong> 増加します。<br>
              魔法（瞬間移動JUMP、帰還RETURN、壁破壊BREAK、凍結FREEZEなど）を行使するための重要なリソースです。
            </div>
          </div>
        </div>

        <!-- 金貨 -->
        <div class="help-card">
          <div class="card-icon">
            <canvas class="help-tile-canvas" data-tile="COIN" width="32" height="32"></canvas>
          </div>
          <div class="card-content">
            <div class="card-title">COIN [金貨] <span class="card-badge badge-consume">即時取得</span></div>
            <div class="card-desc">
              足元でSPACEを押して拾うと所持金（GOLD）が加算されます。<br>
              集めたGOLDは、<strong>「我が家（HOME）」へ持ち帰ることで経験値（EXP）や最大HPボーナスへ換金</strong>されます。
            </div>
          </div>
        </div>

        <!-- 死神 -->
        <div class="help-card danger-card">
          <div class="card-icon">
            <canvas class="help-tile-canvas" data-tile="DEATH" width="32" height="32"></canvas>
          </div>
          <div class="card-content">
            <div class="card-title">DEATH [死神] <span class="card-badge badge-curse">トラップ・呪い</span></div>
            <div class="card-desc">
              宝箱の罠や床に佇む恐怖の死神。<br>
              触れるとプレイヤーの背後に憑依し、<strong>呪いによって一切の魔法詠唱が封じられます</strong>。<br>
              【浄化方法】<strong>十字架（CROSS）を拾う・踏む</strong>か、<strong>我が家（HOME）に帰還</strong>することで成仏させて追い払えます。
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderFacilitiesTab(): string {
    return `
      <div class="help-section-intro">
        ダンジョン内の特殊な地形・施設を熟知することが生還への鍵となります。
      </div>

      <div class="help-grid">
        <!-- 我が家 -->
        <div class="help-card highlight-card">
          <div class="card-icon">
            <canvas class="help-tile-canvas" data-tile="HOME" width="32" height="32"></canvas>
          </div>
          <div class="card-content">
            <div class="card-title">HOME [我が家] <span class="card-badge badge-facility">安全地帯・拠点</span></div>
            <div class="card-desc">
              勇者の最重要拠点。<br>
              ・<strong>指輪なしで入る：</strong> HPが全快し、GOLDが換金され、パワーストーンや王冠が奉納され、取り憑いた死神が成仏します。<br>
              ・<strong>指輪所持時：</strong> 家を押して移動できます。敵の湧きが激しい場所から、防衛しやすい通路や部屋へ引っ越しさせましょう。
            </div>
          </div>
        </div>

        <!-- 岩 -->
        <div class="help-card">
          <div class="card-icon">
            <canvas class="help-tile-canvas" data-tile="BLOCK" width="32" height="32"></canvas>
          </div>
          <div class="card-content">
            <div class="card-title">BLOCK [岩 / 障害物] <span class="card-badge badge-facility">可動障害物</span></div>
            <div class="card-desc">
              迷宮に転がる大きな岩。<br>
              ・<strong>指輪（RING）を所持</strong>していれば、押して前方に押し出せます。<br>
              ・通路を塞いで敵の侵入を防ぐ盾にしたり、墓（GRAVE）の上に押し込んで敵の出現を封じるなど、戦略的に利用できます。<br>
              ・魔法「BREAK」で粉砕・消去することも可能です。
            </div>
          </div>
        </div>

        <!-- 墓 -->
        <div class="help-card danger-card">
          <div class="card-icon">
            <canvas class="help-tile-canvas" data-tile="GRAVE" width="32" height="32"></canvas>
          </div>
          <div class="card-content">
            <div class="card-title">GRAVE [墓] <span class="card-badge badge-danger">モンスター出現源</span></div>
            <div class="card-desc">
              ダンジョン各所に点在する墓場。<br>
              モンスターは倒されても、墓から次々と新たな個体が再出現します。<br>
              <strong>岩（BLOCK）を押して墓の上に被せる</strong>か、敵モンスターを周囲で膠着させて墓の上に居座らせることで、その墓からの出現を恒久的に防ぐことができます。
            </div>
          </div>
        </div>

        <!-- 宝箱 -->
        <div class="help-card">
          <div class="card-icon">
            <canvas class="help-tile-canvas" data-tile="CHEST" width="32" height="32"></canvas>
          </div>
          <div class="card-content">
            <div class="card-title">CHEST [宝箱] <span class="card-badge badge-facility">秘宝の保管箱</span></div>
            <div class="card-desc">
              ダンジョンに点在する木箱。<br>
              鍵（KEY）を持って上に乗り、SPACEキーを押すことで開錠できます。<br>
              中にはポーション、コイン、指輪、十字架、パワーストーン、または死神が眠っています。
            </div>
          </div>
        </div>

        <!-- ワープ -->
        <div class="help-card">
          <div class="card-icon">
            <canvas class="help-tile-canvas" data-tile="WARP" width="32" height="32"></canvas>
          </div>
          <div class="card-content">
            <div class="card-title">WARP [ワープゾーン] <span class="card-badge badge-facility">瞬間移動床</span></div>
            <div class="card-desc">
              踏み込むと、対となる別のワープゾーンへ瞬時にテレポートします。<br>
              広大な迷宮のショートカットや、強敵からの緊急離脱に役立ちます。
            </div>
          </div>
        </div>

        <!-- ゴースト -->
        <div class="help-card">
          <div class="card-icon">
            <canvas class="help-tile-canvas" data-tile="GHOST" width="32" height="32"></canvas>
          </div>
          <div class="card-content">
            <div class="card-title">GHOST [ゴースト] <span class="card-badge badge-danger">アイテム泥棒</span></div>
            <div class="card-desc">
              ダンジョン内を浮遊するいたずら好きな幽霊。<br>
              床に置かれたアイテム（鍵、指輪、王冠、死神など）を持ち去って別の場所へ運んでしまいます。<br>
              十字架（CROSS）が置かれたマスには入ることができません。
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderControlsTab(): string {
    return `
      <div class="help-section-intro">
        キーボードと画面上のボタンで操作します。
      </div>

      <div class="help-controls-table">
        <div class="ctrl-row">
          <div class="ctrl-key">矢印キー / WASD / テンキー</div>
          <div class="ctrl-action"><strong>移動・体当たり攻撃</strong>（斜め移動解放時は8方向すべてに対応）</div>
        </div>
        <div class="ctrl-row">
          <div class="ctrl-key">SPACE</div>
          <div class="ctrl-action"><strong>足元アクション / 待機</strong>（足元アイテム取得・手持ちアイテムの床配置・宝箱開錠 / その場1ターン待機）</div>
        </div>
        <div class="ctrl-row">
          <div class="ctrl-key">M または 数字 1〜9</div>
          <div class="ctrl-action"><strong>習得済み魔法の選択・順送り</strong></div>
        </div>
        <div class="ctrl-row">
          <div class="ctrl-key">X または Enter</div>
          <div class="ctrl-action"><strong>選択中の魔法を発動（キャスト）</strong>（※MAGICポイントを消費）</div>
        </div>
        <div class="ctrl-row">
          <div class="ctrl-key">T</div>
          <div class="ctrl-action"><strong>敵相対マーカー切替</strong>（TACTICAL: 一撃キル青/安全緑/危険赤などの戦術表示 ⇔ RETRO）</div>
        </div>
        <div class="ctrl-row">
          <div class="ctrl-key">H</div>
          <div class="ctrl-action"><strong>アイテム＆ルールヘルプ画面の開閉</strong>（タイトル画面・プレイ中いつでも表示可能）</div>
        </div>
        <div class="ctrl-row">
          <div class="ctrl-key">I</div>
          <div class="ctrl-action"><strong>ダンジョン・インスペクター表示</strong>（マップ全体図・パラメータ観測）</div>
        </div>
        <div class="ctrl-row">
          <div class="ctrl-key">Tab または P</div>
          <div class="ctrl-action"><strong>AUTO PLAY (自動自走AI) のON/OFF切替</strong></div>
        </div>
        <div class="ctrl-row">
          <div class="ctrl-key">Q</div>
          <div class="ctrl-action"><strong>ギブアップ（探索中断）</strong></div>
        </div>
        <div class="ctrl-row">
          <div class="ctrl-key">ESC</div>
          <div class="ctrl-action"><strong>開いているモーダル（ヘルプ・インスペクター・確認）を閉じる</strong></div>
        </div>
      </div>

      <div class="help-card highlight-card" style="margin-top: 14px;">
        <div class="card-content">
          <div class="card-title">[STRATEGY] 序盤攻略の黄金セオリー</div>
          <div class="card-desc">
            1. まずは <strong>剣（SWORD）</strong> を見つけて拾い、本来の攻撃力を解放しよう！<br>
            2. <strong>鍵（KEY）</strong> を拾って宝箱を開け、<strong>パワーストーン</strong> を見つけたら我が家へ運んでSTRを上げよう！<br>
            3. 強敵に遭遇したら <strong>十字架（CROSS）</strong> を持てばダメージを受けない！<br>
            4. <strong>指輪（RING）</strong> で邪魔な岩を押し、墓を塞いでモンスターの湧きを止めよう！
          </div>
        </div>
      </div>
    `;
  }

  private attachEventListeners(): void {
    if (!this.overlayEl) return;

    // 閉じるボタン
    const closeBtn = this.overlayEl.querySelector('#help-close-x');
    closeBtn?.addEventListener('click', () => this.close());

    const okBtn = this.overlayEl.querySelector('#help-ok-btn');
    okBtn?.addEventListener('click', () => this.close());

    // オーバーレイ背景クリックで閉じる
    this.overlayEl.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) {
        this.close();
      }
    });

    // タブ切り替えボタン
    const tabBtns = this.overlayEl.querySelectorAll('.help-tab-btn');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const tab = target.getAttribute('data-tab') as HelpTabType;
        if (tab && tab !== this.currentTab) {
          this.currentTab = tab;
          this.renderModal();
        }
      });
    });
  }
}
