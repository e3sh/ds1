# 『DS1ish』 Seed Observatory & Challenge Catalog UI/UX 現仕様書

- **バージョン**: 1.5.0 (Phase 15: Seed Observatory & Challenge Catalog UI/UX Update)
- **対象リポジトリ**: `github.com/e3sh/ds1`
- **主要関連ファイル**:
  - `src/systems/generator/MapProfiler.ts`
  - `src/services/MapPresetManager.ts`
  - `src/view/DOMUIManager.ts`
  - `src/view/InspectorModal.ts`
  - `src/core/InputManager.ts`
  - `src/systems/generator/HierarchicalThemeBlockGenerator.ts`
  - `src/style.css`

---

## 1. 概要と基本コンセプト

### 1.1 「事後観測・プロファイリング（Seed Observatory）」思想への転換
従来のプロシージャル生成（Phase 9〜12）は、ユーザーがUI上で事前に「トポロジー」「難易度」「ペーシング」を指定し、生成器が無理やりその型にはめてマップを構築する方式をとっていました。

Phase 14〜15では、**「シード値から決定論的に生成されたマップの実態を幾何学的にスキャン・プロファイリング（事後観測）し、真の難易度やトポロジーを格付けして、挑戦状やカタログとして楽しむ（Seed Observatory & Challenge Catalog）」** という設計思想へと進化しました。

- **事前パラメータ**: 生成器（`HierarchicalThemeBlockGenerator`）に対する「初期ブロック配合バイアス（出現確率の重み付け）」。
- **事後観測プロファイル (`MapProfiler`)**: 生成された64×64トーラス空間を客観的にスキャンした「幾何学的実態・真の難易度指数（1〜100）」。

---

## 2. 画面別 UI/UX 仕様

### 2.1 タイトル画面 (`DOMUIManager.ts`)
- **「⚔ START GAME (標準ダンジョン開始)」 (`#dom-start-btn`)**:
  - 標準設定（`MULTI_SECTOR` / `NORMAL` / `STANDARD` / `BALANCED` / `EXPONENTIAL`）で開始。
  - **シード値は毎回ランダム採番**（完全固定マップではありません）。
  - **初心者が理不尽に詰まない安全保証**: 我が家から徒歩1〜3歩に指輪、6〜14歩に鍵、10〜20歩に剣が「敵と交戦せずに徒歩のみで到達可能なマス（BFS走査）」に配置され、物理解法性100%が保証されます。
- **「🗺️ CHALLENGE CATALOG & SEED OBSERVATORY」 (`#dom-open-custom-btn`)**:
  - ステージ選択・挑戦状カタログ・シード観測所モーダル（`#dom-custom-modal`）を開くメイン導線ボタン。
- **「🎬 DEMO / チュートリアル」 (`#dom-demo-btn`)**:
  - 自動アトラクションデモ・チュートリアルを開始。
- **「▶ CONTINUE」 (`#dom-continue-btn`)**:
  - セーブデータが存在する場合のみ表示・再開。

---

### 2.2 ステージ調整・選択メニューモーダル (`#dom-custom-modal`)

4つのセグメントタブUIで構成されます：

```
[ 🎲 クイック設定 ] [ 🗺️ 挑戦状カタログ ] [ 📋 共有コード ] [ 🔬 シード観測・詳細 ]
```

#### ① 🎲 クイック設定パネル (`#dom-panel-quick`)
- **シード値直接入力欄 (`#dom-proc-seed`) ＆ 🎲 乱数ボタン (`#dom-proc-rand-seed-btn`)**:
  - 空欄で開始した場合は完全ランダム生成。
  - 任意のシード番号を直接入力するか、🎲ボタンでランダム値をセットしてそのまま開始可能。
- **地形 (`#dom-proc-topology`)**: MULTI_SECTOR, STANDARD_ROOMS, PILLAR_GRID, NARROW_MAZE, SPIRAL_LABYRINTH, FORTRESS_ARENA
- **難易度 (`#dom-proc-difficulty`)**: NORMAL, EASY, HARD
- **プレイ時間 (`#dom-proc-pacing`)**: STANDARD (15〜25分), BLITZ (5〜10分), MARATHON (35〜60分)
- **テーマ (`#dom-proc-archetype`)**: BALANCED, SANCTUARY, WARP_NEXUS, ARMORY
- **ルール体系 (`#dom-proc-rule-mode`)**: EXPONENTIAL (指数成長), CLASSIC (初代加算)

#### ② 🗺️ 挑戦状カタログパネル (`#dom-panel-preset`)
- **プリセット選択プルダウン (`#dom-preset-select`)**:
  - 公式おすすめプリセット（`CURATED_PRESETS`）およびローカル保存済みプリセットを選択。
- **選択中シードのプロファイル詳細カード (`#dom-preset-detail-card`)**:
  - プルダウン変更時に即時更新。
  - **マップ名・ID・シード値・説明文**: プリセット固有のフレーバーテキスト。
  - **推定トポロジー & 推定難易度バッジ**: `EASY` (緑), `NORMAL` (青), `HARD` (橙), `NIGHTMARE` (赤パルス)。
  - **チャレンジ指数ゲージ (`challengeRating`)**: 1〜100点とカラーゲージバー（80以上は赤、50〜79は橙、49以下は緑）。
  - **ボット観測ステータス**:
    - `🤖 ボット1600T未踏破チャレンジ！`（例: Seed 833139 奈落の深層要塞）
    - `🤖 ボット基準クリア: XXX ターン`
  - **プレイヤー自身の踏破記録**:
    - `🏆 踏破済: 最速 XXX ターン` / `⚪ 未踏破（挑戦求む！）`
  - **特徴タグバッジ群**: `UNBEATEN_BY_BOT`, `MARATHON`, `EARLY_SWORD`, `FORTIFIED_LAIR` 等。
- **📋 共有ボタン (`#dom-preset-share-btn`)**: Base64圧縮された共有コード（`DS1MAP:...`）をクリップボードにコピー。
- **🗑️ 削除ボタン (`#dom-preset-delete-btn`)**: ユーザー保存プリセットを削除（公式プリセットは削除保護）。

#### ③ 📋 共有コードパネル (`#dom-panel-share`)
- 共有コード文字列（`DS1MAP:...`）を貼り付けてインポート・即時開始。

#### ④ 🔬 シード観測・詳細パラメータパネル (`#dom-panel-debug`)
- **シード値直接入力欄 (`#dom-debug-seed`)**:
  - キー入力（`input` イベント）連動で、数値を打ち替えると即座（300ms debounce）にリアルタイム観測プレビューが更新。
- **🎲 乱数ボタン (`#dom-debug-rand-seed-btn`)**:
  - ランダムなシード番号を生成し、即座に観測プロファイルを実行（「シードガチャ」体験）。
- **🔍 観測プロファイル実行ボタン (`#dom-debug-preview-btn`)**:
  - 指定されたシード・パラメータで仮想マップを生成し、`MapProfiler.profile` を実行して `#dom-debug-report-box` に以下の観測結果をグラフィカル表示：
    - 物理解法性（PASS / FAIL）
    - 推定トポロジー、推定難易度、推定ペース
    - チャレンジ指数（`★ XX/100`）
    - 幾何学的メトリクス（開放度、迷路度、独立部屋数、初期剣到達歩数、我が家近接墓数、要塞アクセス度、セクター分断度、宝箱/墓数）
    - 理論到達STRおよび特徴タグバッジ一覧

---

### 2.3 INSPECT画面 (`InspectorModal.ts`)

インゲーム中に `[I]` キーまたはHUDの「🔍 INSPECT」ボタンで開くリアルタイム解析モーダル。

#### タブ 1: 🗺️ マップ俯瞰 & 密度統計
- **64×64 DUNGEON MAP OVERVIEW**:
  - 全体マップ縮小キャンバス（壁/岩、家、宝箱、墓、竜、自機位置をピクセル描画）。
- **密度・構造メトリクス表**:
  - 推定トポロジー、難易度バッジ、推定ペース、チャレンジ指数（★ XX/100）、解法性（PASS）、障害物密度、空床密度、宝箱数、墓数、アイテム数、ゴースト数。
- **🔬 GEOMETRIC METRICS (幾何構造プロファイル)**:
  - 開放度 (`opennessScore`) / 迷路度 (`mazeIndex`) / 独立部屋数 (`roomCount`) / 初期剣到達歩数 (`swordWalkDistance`) / 我が家近接12マス墓数 (`nearHomeGraves`) / 竜要塞侵入路と首周辺安全スペース (`lairAccessibility`) / セクター分断度 (`sectorPartitionScore`)。
  - 特徴タグバッジ一覧およびプロファイルサマリー文。
- **🎯 PHASE 14 TACTICAL INTELLIGENCE (戦術攻略インテリジェンス)**:
  - ドラゴン要塞スタイル (`dragonLairStyle`)
  - 8歩周期宝物庫エリア数 (`treasureZoneHints.length`)
  - 墓封鎖パズル配置数 (`gravePuzzleHints.length`)
  - 我が家移転推奨アンカー数 (`recommendedRelocateAnchors.length`)
  - 突入ショートカット数 (`breachShortcutPositions.length`)

#### タブ 2: ⚙️ ゲームチューニング定数 (Active Tuning)
- 現在のワールドセッションに適用されている実効物理定数（`ResolvedDungeonTuningParams`）の完全開示：
  1. **スポーン＆家湧き制御**: 首討伐フェーズ別の通常湧き上限と家湧き専用別枠数（`maxFieldEnemiesByPhase`, `homeSpawnReserveByPhase`）、最遠非交戦敵パージ有効性。
  2. **成長・戦闘カーブ制御**: EXP減衰指数、パワーストーン複利成長率、敵ATK倍率、竜DEF倍率。
  3. **資源上限制御**: 十字架・指輪・鍵・剣の同時存在上限（Cap）、ゴースト滑空速度（ms/歩）。

#### タブ 3: 📈 成長カーブ & 戦闘グラフ
- パワーストーン取得数に伴うSTR成長シミュレーション曲線。
- 敵DEF値とEXP獲得減衰カーブのリアルタイムグラフ描画。

---

## 3. キーボード入力ガード仕様 (`InputManager.ts`)

テキストボックス入力時のゲーム側キーイベント横取り防止仕様：
- `window.addEventListener('keydown', ...)` の先頭において、イベント発生元要素（`e.target`）が `INPUT`、`TEXTAREA`、または `isContentEditable` の場合、ゲームのショートカットキー（移動、Space、D、Q、C、数字キーなど）やスクロール抑止（`preventDefault`）をすべてバイパス。
- `Escape` キー押下時のみ入力フォーカスを解除（`blur()`）し、モーダル操作を阻害しない。
