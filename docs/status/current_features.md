# 『DS1ish』 実装機能・仕様一覧 (Feature Matrix & Implementation Status)

本書は、1984年 PC-8801版『ドラゴンスレイヤー (Level 2.0)』のコアメカニクスをベースにしつつ、プロシージャルダンジョン生成とモダンQoLを統合した拡張Web実装『DS1ish』において、**現在コードベース上に実装され、動作保証（テスト検証済み）されている全機能の一覧・仕様マトリクス**である。

---

## 1. コアゲームプレイ & 移動システム (`src/core/`, `src/models/`, `src/systems/`)

| 機能名 | ステータス | 該当コード / モジュール | 説明 |
| :--- | :---: | :--- | :--- |
| **時間制限付きターンタイマー** | ✅ 実装済み | `TurnManager.ts`, `GameEngine.ts` | 2.5秒周期のインジケーターゲージ。時間切れ時に自動手番進行。 |
| **8方向移動入力** | ✅ 実装済み | `InputManager.ts`, `MovementSystem.ts` | 矢印キー、WASD、テンキー（1〜9）による4方向＋斜め8方向入力。斜め角抜け（壁対角通過）が可能。 |
| **多層レイヤーマップ** | ✅ 実装済み | `WorldMap.ts` (64×64) | `baseTiles` (床/ワープ/壁), `objectTiles` (家/岩/墓/宝箱), `itemTiles` (アイテム) の3層構造。 |
| **重複禁止（1マス1要素）** | ✅ 実装済み | `WorldMap.ts`, `MovementSystem.ts` | 壁・岩・モンスター・アイテムの同一マス重複を完全防止。 |
| **我が家（HOME）機能** | ✅ 実装済み | `Player.ts`, `MovementSystem.ts` | 進入でHP全快、持ち帰りアイテムの能力換算（GOLD/STR/MAGIC/王冠）。家の中はモンスター攻撃完全遮断の絶対安全地帯。 |
| **倉庫番プッシュ移動** | ✅ 実装済み | `MovementSystem.ts` | 「指輪（RING）」所持時に岩（ROCK）および我が家（HOME）を押して移動可能。ワープゾーン通過時の下地タイル完全復元。 |
| **死神（DEATH）追従 & 成仏** | ✅ 実装済み | `Player.ts`, `MovementSystem.ts`, `TileGraphics.ts` | 一定歩数ごとに背後に出現し追従。十字架（CROSS）通過または我が家進入で成仏消滅。 |
| **ワープゾーンネットワーク** | ✅ 実装済み | `WorldMap.ts`, `MovementSystem.ts` | マップ上の特定座標ペア間を双方向テレポート。 |

---

## 2. アイテム & 装備・成長システム (`src/models/`, `src/systems/`)

| 機能名 | ステータス | 該当コード / モジュール | 説明 |
| :--- | :---: | :--- | :--- |
| **床上アイテム操作** | ✅ 実装済み | `MovementSystem.ts` | 床上アイテム（SWORD, RING, KEY, CROSS, POWER_STONE, COIN, POTION）の歩行通過、およびSPACEキーでの拾う／置く／交換。 |
| **剣（SWORD）装備** | ✅ 実装済み | `Player.ts`, `CombatSystem.ts` | 剣所持時のみ通常攻撃が可能。抜かれた剣グラフィックの床描画。 |
| **携帯アイテム可視化** | ✅ 実装済み | `TileGraphics.ts` | プレイヤー頭上に現在所持しているアイテム（RING, CROSS, POWER_STONE, KEY等）をドット絵重畳表示。 |
| **十字架（CROSS）結界・無敵仕様** | ✅ 実装済み | `Player.ts`, `CombatSystem.ts`, `GhostAISystem.ts` | 手持ち時: プレイヤー完全無敵（膠着判定）。地面設置時: モンスター・ゴースト進入遮断結界、死神成仏。 |
| **宝箱開錠 & 周期出現** | ✅ 実装済み | `ChestSystem.ts` | 鍵（KEY）を所持して宝箱に体当たりで開錠。8歩周期でのパワーストーン確定出現ロジック。 |
| **インフレSTR成長曲線** | ✅ 実装済み | `Player.ts` (`calculatePowerStoneGain`) | パワーストーン奉納時、1個目+1,000、2個目以降は `floor(現在STR * 0.35) + 2,000`（上限655,350）の複利成長。約15個でドラゴン首（DEF 400,000）突破可能。トポロジー連動の成長倍率（`powerStoneGainRatio`）に対応。 |
| **宝箱枯渇防止リポップ** | ✅ 実装済み | `ChestSystem.ts` (`replenishChestsIfNeeded`) | 帰還時に未開封宝箱が一定数未満となった際、安全な空床へ宝箱を自動補充し詰みを防止。 |
| **非消耗アイテム上限キャップ** | ✅ 実装済み | `ChestSystem.ts` | 十字架・指輪・鍵・剣のワールド総数（床上＋プレイヤー所持＋ゴースト運搬中）をカウントし、`maxCap` 到達時は宝箱の1/8装備枠を自動で消耗品・パワーストーンへフォールバック。 |
| **EXP減衰カーブ & 被ダメ軽減率** | ✅ 実装済み | `Enemy.ts`, `Player.ts`, `CombatSystem.ts` | 終盤モンスター撃破時のEXP急激インフレを抑制する3モード（`CLASSIC_LINEAR`, `DAMPED_POWER` べき乗減衰, `PHASE_CAPPED` 段階上限）およびEXPの被ダメージ軽減寄与率（`expDefenseMitigationRatio`）をサポート。 |

---

## 3. 戦闘 & タクティカル脅威度マーカー（モダン機能） (`src/systems/`, `src/view/`)

| 機能名 | ステータス | 該当コード / モジュール | 説明 |
| :--- | :---: | :--- | :--- |
| **交互ターン戦闘調停** | ✅ 実装済み | `CombatSystem.ts` | プレイヤーターン: 体当たり攻撃、与ダメのみ適用、生存時は押し合い。<br>敵ターン: 敵AI反撃、被ダメおよび能力吸収特殊効果の発動。 |
| **32種モンスターパラメータ** | ✅ 実装済み | `EnemyTable.ts`, `Enemy.ts` | 全32種のHP, ATK, DEFおよび特殊能力（dora/knightのSTR吸収、rich/crownloadのEXP吸収、monstirの壺強奪）。 |
| **敵AI（逃走 & 豹変追跡）** | ✅ 実装済み | `EnemyAISystem.ts` | 基本逃走（FLEE）。プレイヤーが `HP < EXP` に達すると一斉に好戦的追跡（CHASE）へ豹変するAI挙動。墓地周辺への優先スポーン。 |
| **敵相対5段階タクティカルマーカー & 攻防2軸二重マーカー** | ✅ 実装済み | `ThreatEvaluator.ts`, `CanvasRenderer.ts` | **【モダンRPG機能】** プレイヤーの装備・ステータスと敵の攻防を比較し、攻防2軸（3×3マトリクス）による二重マーカー（外枠リング＋中心警告コア）を足元にリアルタイム描画：<br>・外枠リング（攻撃視点）: 🔵 **ONE_SHOT** / 🟢 **SAFE** / 🟡 **STALEMATE** / 🔴 **DANGER** / ⚫ **LETHAL**<br>・中心警告コア（防御視点）: クリア（貰わない）、アンバー（貰う・追走注意 `isRiskyOneShot`）、赤黒脈動点滅（敵先制で即死 `isLethalOneShot`・ガラスの剣）<br>※ヘッドレス評価API `evaluateThreatDetails()` に対応し、シミュレーション・分析環境でも同一判定を利用可能。 |
| **タクティカルマーカートグル** | ✅ 実装済み | `GameEngine.ts`, `DOMUIManager.ts` | キーボード `[T]` キーおよびHUDボタン（`[🎯 TACTICAL]`）によるマーカー表示の即時ON/OFF。 |
| **死因トラッキング** | ✅ 実装済み | `Types.ts` (`DeathInfo`), `GameEngine.ts` | `MONSTER_ATTACK`, `MONSTER_COUNTER`, `DRAGON_HEAD`, `FIREBALL`, `GIVE_UP` 等を構造化記録。帰宅時に自動リセット。 |
| **戦闘エフェクト** | ✅ 実装済み | `CombatEffectManager.ts` | 敵の白フラッシュ・斬撃スパーク、被弾時のプレイヤー赤点滅、ダメージ数値ポップアップ演出。 |

---

## 4. 魔法システム & 3首ドラゴンボス戦 (`src/models/`, `src/systems/`)

| 機能名 | ステータス | 該当コード / モジュール | 説明 |
| :--- | :---: | :--- | :--- |
| **魔法アンロックテーブル** | ✅ 実装済み | `MagicTable.ts`, `MagicSystem.ts` | EXP蓄積により順次解禁（斜め移動特技＋全9種魔法）。 |
| **全9種魔法** | ✅ 実装済み | `MagicSystem.ts` | ・`BREAK`: 目の前の壁破壊<br>・`KICK`: 岩・敵を前方に蹴り飛ばす<br>・`FREEZE`: 画面内全敵を一時凍結<br>・`FLASH`: 画面内全敵にダメージ<br>・`FLY`: 一定歩数壁を無視して飛行（鳥グラフィック化）<br>・`JUMP`: 徘徊中のゴースト位置へテレポート<br>・`RETURN`: 我が家へ瞬時に帰還<br>・`MAP`: 64×64全体マップ透視<br>・`SAVE`: ゲーム状態の完全シリアライズ保存 |
| **3首ドラゴンボス** | ✅ 実装済み | `Dragon.ts`, `CombatSystem.ts` | 本体＋左首・中首・右首＋尻尾の固定配置ボス。基本パラメータ（HP 650,000 / DEF 300,000〜400,000）。 |
| **火炎弾弾道力学** | ✅ 実装済み | `Dragon.ts`, `CanvasRenderer.ts` | 各首からの直線火炎弾（壁遮蔽あり、斜めマスは安全地帯）。尻尾による初期位置送還。 |
| **ドラゴン討伐・クリア判定** | ✅ 実装済み | `Dragon.ts`, `GameEngine.ts` | 3首討伐で世界変化（家リセット、全敵スポーン、ダークパレット化、クラウン4個出現）。4個持ち帰り帰宅でゲームクリア。 |

---

## 5. ゴースト（おばけ）AIシステム (`src/models/Ghost.ts`, `src/systems/GhostAISystem.ts`)

| 機能名 | ステータス | 該当コード / モジュール | 説明 |
| :--- | :---: | :--- | :--- |
| **リアルタイム直線滑空 & 反射** | ✅ 実装済み | `GhostAISystem.ts` | プレイヤー手番非同期の独自タイマー。壁・障害物を完全無視して滑空し、外周境界で反転・反射。 |
| **アイテム自動吸引 & ポイ捨て** | ✅ 実装済み | `GhostAISystem.ts` | 通過線上の床アイテムを回収し、隔離通路や壁の向こうの空床へポイ捨て。 |
| **手持ちアイテム強奪** | ✅ 実装済み | `GhostAISystem.ts` | プレイヤーとすれ違った際に手持ちアイテム（十字架含む）をひったくり。 |
| **十字架結界への進入禁止** | ✅ 実装済み | `GhostAISystem.ts` | 地面に置かれた十字架マスへの進入禁止および直前反転。 |
| **JUMPテレポート & 安全着地** | ✅ 実装済み | `MagicSystem.ts` | JUMP魔法でゴースト位置へワープ。ゴーストが壁内部にいる際は最寄りの安全床へ自動着地。 |
| **所持アイテムミニアイコン表示** | ✅ 実装済み | `TileGraphics.ts` | ゴーストが運搬しているアイテムのミニスプライトをリアルタイム重畳描画。 |
| **ゴースト高速巡回 & 速度連動** | ✅ 実装済み | `Ghost.ts`, `TuningPresetResolver.ts` | 高速巡回（標準90ms/歩、BLITZ時70ms/歩）。トポロジー・ペーシング連動の速度パラメータ（`ghostMoveIntervalMs`）に対応。 |

---

## 6. マップ生成 & ダンジョン環境 (`src/models/WorldMap.ts`, `src/systems/ProceduralMapGenerator.ts`, `src/config/TuningPresetResolver.ts`)

| 機能名 | ステータス | 該当コード / モジュール | 説明 |
| :--- | :---: | :--- | :--- |
| **静的テストベッドマップ (64×64)（開発・回帰テスト用）** | ✅ 実装済み | `WorldMap.ts` | 導入チュートリアル部屋、中央ドラゴン要塞、四方ウィング、ワープ網を備えた開発・回帰テスト用の静的テストベッド（`CLASSIC_FIXED` / UI表記: `TESTBED`）。 |
| **スタンダード・プロシージャル生成** | ✅ 実装済み | `ProceduralMapGenerator.ts` | 決定論的PRNG（Mulberry32）によるシード指定ランダムダンジョン生成器。<br>・難易度別（EASY / NORMAL / HARD）のブートストラップ保証<br>・内部壁すべて破壊可能なBLOCKで統一<br>・ドラゴンの巣、宝箱群、墓地、初期アイテムの自動配置 |
| **多彩な6種トポロジー生成** | ✅ 実装済み | `ProceduralMapGenerator.ts` | `STANDARD_ROOMS`（小部屋・回廊）、`PILLAR_GRID`（ピラー市松模様）、`NARROW_MAZE`（幅1マス迷路）、`SPIRAL_LABYRINTH`（スパイラル渦巻き）、`FORTRESS_ARENA`（アリーナ要塞）、および4象限モザイクの `MULTI_SECTOR`（複合セクター＋セクター間ワープ網）。 |
| **戦略ギミック配置** | ✅ 実装済み | `ProceduralMapGenerator.ts` | 「パンドラの墓場」（密集墓地＋アイテム誘致）や「閉鎖された宝物庫」（BLOCK密室に囲まれた高価値宝物部屋）の自動生成。 |
| **トポロジー連動パラメータ基盤** | ✅ 実装済み | `Types.ts`, `TuningPresetResolver.ts` | 地形構造ごとに最適化された `DungeonTuningParams`（成長速度・敵ATK倍率・ドラゴンDEF倍率・資源キャップ・家湧き専用枠）。 |
| **54通り自動プリセット解決** | ✅ 実装済み | `TuningPresetResolver.ts` | ユーザー選択の「トポロジー（6種）× 難易度（EASY/NORMAL/HARD）× プレイ時間ペーシング（BLITZ/STANDARD/MARATHON）」から最適パラメータを自動合成。 |
| **家湧き専用枠 & 最遠敵パージ** | ✅ 実装済み | `SpawnSystem.ts` | 首討伐後の我が家スポーン専用枠（`homeSpawnReserveByPhase`）を確保。上限到達時は交戦していない最遠方の敵を自動パージ（`evictDistantEnemyOnHomeSpawn`）し、家からの敵湧きスタックを完全解消。 |
| **空間密度向上 & 空地岩塊散布** | ✅ 実装済み | `ProceduralMapGenerator.ts` (`densifyOpenAreas`) | セクター外周の空地検知と自然な岩塊・柱クラスタの散布、部屋サイズの枠拡張、ピラー密度の引き締めにより、原作らしい迷宮密度を確保。 |
| **全域9セクター動的配置 & コンパクトプレハブ** | ✅ 実装済み | `ProceduralMapGenerator.ts` | 64×64空間を9つの不規則セクターに分割し、我が家（`COMPACT_3x3` / `STANDARD_ROOM`）とドラゴン要塞（`COMPACT_5x5` / `FORTRESS_7x7`）をトーラス距離 $\ge 20$ の離隔保証付きで動的セクター配置。 |
| **4大戦術アーキタイプ** | ✅ 実装済み | `TuningPresetResolver.ts`, `ProceduralMapGenerator.ts` | `BALANCED`, `SANCTUARY`（十字架結界・ゴースト4体）, `WARP_NEXUS`（高密度ワープ迷宮）, `ARMORY`（複数剣デポ）の4大テーマ生成。 |
| **プリセット保存 & 1行共有コード (`DS1MAP:`)** | ✅ 実装済み | `MapPresetManager.ts`, `DOMUIManager.ts` | 公式おすすめプリセット5種の同梱、ユーザーによる生成マップ保存、および `DS1MAP:` 形式の1行テキストによるエクスポート・インポート。 |
| **トポロジー連動ゴースト数制御** | ✅ 実装済み | `GameEngine.ts`, `GhostAISystem.ts` | マップ形状に応じた初期ゴースト数（0〜4体）の動的反映。 |
| **クリア可能性自動診断** | ✅ 実装済み | `ProceduralMapGenerator.ts` (`validateSolvability`) | 生成直後に家からドラゴン要塞へのクリアランス、宝箱数、重複ゼロを検証。パラメータ連動の初期資源保証。 |
| **タイトル画面プロシージャルUI** | ✅ 実装済み | `DOMUIManager.ts`, `GameEngine.ts` | タイトル画面のプリセット選択、カスタム生成モーダル（シード・地形・難易度・ペース・テーマ・診断プレビュー）からの即時開始。 |

---

## 7. UI / HUD / 演出 / サウンド (`src/view/`, `src/audio/`)

| 機能名 | ステータス | 該当コード / モジュール | 説明 |
| :--- | :---: | :--- | :--- |
| **ハイブリッド画面構成** | ✅ 実装済み | `CanvasRenderer.ts`, `DOMUIManager.ts` | 480×352純マップ描画Canvas ＋ 右側DOM UIによるステータス・HUDの完全分離。 |
| **画面ガタつき防止ストリップ** | ✅ 実装済み | `index.html`, `style.css` | マップ下部に装備バッジストリップを固定配置し、アイテム脱着時のLayout Shiftを完全防止。 |
| **PSG音源レトロサウンド** | ✅ 実装済み | `PSGAudio.ts` | Web Audio APIによる矩形波BGMおよび全SE（体当たり、被弾、壁破壊、開錠、アイテム操作、魔法、火炎弾、ワープ、死亡、回復、ファンファーレ）。 |
| **サウンドトグル** | ✅ 実装済み | `PSGAudio.ts`, `DOMUIManager.ts` | HUDボタン `[🔊 SOUND: ON/OFF]` によるリアルタイム消音切り替え。 |
| **カラーパレット動的切替** | ✅ 実装済み | `PaletteManager.ts`, `TileGraphics.ts` | 通常（NORMAL）、HP<500ピンチ（PINCH/赤）、ドラゴン全滅後（DARK/暗黒）のリアルタイムパレット切り替え。 |
| **32種モンスタースプライトシート** | ✅ 実装済み | `MonsterGraphics.ts` | 全32種のプロシージャル生成ドット絵 ＋ FREEZE凍結ブルー状態のキャッシュスプライトシート。 |
| **HUDターゲット敵追跡パネル** | ✅ 実装済み | `DOMUIManager.ts` | プレイヤー直近・戦闘中の敵のアイコン、HP、ATK、DEF、特殊能力、相対脅威度バッジをリアルタイム表示。 |
| **モーダルUI** | ✅ 実装済み | `DOMUIManager.ts` | ・タイトルモーダル（通常開始 / ランダムマップ開始 / 再開 / 地形・難易度・プレイ時間選択セレクトボックス）<br>・ゲームオーバーモーダル（死因バッジ、キル数、ターン数、`[R]` リトライ）<br>・ゲームクリアモーダル（王冠4個クリア祝福、`👑 REPLAY STAGE`）<br>・ギブアップ確認モーダル（`[Y]` 諦める / `[N / ESC]` 継続） |
| **ダンジョン＆成長インスペクタ** | ✅ 実装済み | `InspectorModal.ts`, `DOMUIManager.ts` | **【新機能】** HUDボタン `[📊 INSPECT]` および `[I]` キーで開閉するリアルタイム解析モーダル：<br>① **マップ全体俯瞰 & 密度統計**: 64×64全体マップ縮小描画、ブロック密度%、床比率、宝箱・墓・ゴースト数<br>② **トポロジー連動パラメータ表**: スポーン上限、家湧き枠、EXP減衰設定、アイテム上限キャップ一覧<br>③ **成長パラメータグラフ**: Canvas リアルタイム描画（パワーストーン奉納STR成長曲線 vs ドラゴン首DEFライン、敵DEF vs 獲得EXP減衰比較曲線） |

---

## 8. QoL & セーブ／中断機構 (`src/services/SaveManager.ts`, `src/services/SaveStorageDriver.ts`, `src/core/GameEngine.ts`)

| 機能名 | ステータス | 該当コード / モジュール | 説明 |
| :--- | :---: | :--- | :--- |
| **ギブアップ操作 (Give Up / Retire)** | ✅ 実装済み | `GameEngine.ts`, `DOMUIManager.ts` | `[Q]` キーおよびステータスバー上部 `[🏳️ GIVE UP]` ボタンによる探索断念。誤操作防止モーダル付き。 |
| **ストレージドライバ抽象化** | ✅ 実装済み | `SaveStorageDriver.ts`, `SaveManager.ts` | `BrowserLocalStorageDriver`（ブラウザ環境）と `InMemoryStorageDriver`（Node.jsヘッドレス環境）の抽象化により、CLI・テスト環境でも完全動作。 |
| **LocalStorage中断セーブ & 再開** | ✅ 実装済み | `SaveManager.ts` (version: `1.0.0`) | プレイヤー全状態、3層マップ全タイル、敵・ドラゴン・ゴースト・経過ターン・パレット状態を完全シリアライズ。 |
| **タイトル画面コンティニュー** | ✅ 実装済み | `DOMUIManager.ts`, `GameEngine.ts` | タイトル画面での `[▶ CONTINUE [C]]` ボタン動的表示（セーブ日時・HP・クラウン数サマリー付き）および `[C]` キー再開。 |
| **SAVE魔法統合** | ✅ 実装済み | `MagicSystem.ts` | 原作魔法 `SAVE` 詠唱時に設定されたストレージドライバへ自動保存。 |

---

## 9. ヘッドレス評価＆自動プレイシミュレータ基盤 (`src/core/`, `src/services/`, `src/ai/`, `src/simulation/`, `scripts/`)

| 機能名 | ステータス | 該当コード / モジュール | 説明 |
| :--- | :---: | :--- | :--- |
| **決定論的擬似乱数生成器 (`SeedRandom`)** | ✅ 実装済み | `SeedRandom.ts` | Mulberry32 アルゴリズムに基づくPRNG。`next()`, `nextInt()`, `choice()`, `shuffle()`, `fork()` を提供。全システム（Spawn, EnemyAI, GhostAI, Chest, Engine）へDI注入され、未指定時はデフォルト乱数（Math.random）へフォールバック。同一シードで100%の動作再現性を確立。 |
| **型安全ドメインイベントバス (`GameEventBus`)** | ✅ 実装済み | `GameEvents.ts`, `GameEventBus.ts` | 戦闘、敵・家スポーン試行（上限ブロック・パージ追跡）、宝箱開錠（上限キャップ抑制追跡）、ゴースト行動、プレイヤー移動・帰還、魔法詠唱、状態変化を構造化通知するPub/Subイベントバス。 |
| **自律自動プレイボット (`AutoPlayBot`)** | ✅ 実装済み | `AutoPlayBot.ts`, `BotNavigator.ts`, `EightStepController.ts`, `tactics/` | 6フェーズ自律エージェント（`BOOTSTRAP` → `GRAVE_SEAL` → `POWER_RUSH` → `HOME_RELOCATE` → `DRAGON_SLAY` → `CROWN_ESCAPE`）。<br>・**マップ静的評価 (`assessMap`)**: 墓・十字架数から封鎖ポリシー（`AUTO`, `NONE`, `NEAR_HOME`, `ALL`）を自動選定<br>・**8歩周期連続開錠チェーン (`EightStepController`)**: パワーストーン確定出現のための歩数調整および近傍宝箱への連続開錠<br>・**拠点引越し戦術 (`HomeRelocationTactics`)**: ドラゴン討伐前に指輪で「我が家」をドラゴン要塞近傍の安全アンカーへ押し運び、王冠4個脱出距離を大幅短縮<br>・**アイテム持ち替え制御 (Hands-Free Rule)**: 鍵の一時ドロップ＆再回収、10ターン安全弁タイムアウト<br>・**目標分離ロック＆ヒステリシス**: 宝箱用・アイテム用の独立ロックと `-3` 距離ボーナスによるチャタリング完全防止<br>・**到達不能ターゲット・ブラックリスト**: 孤立目標の即時除外（BFS Early Exit）と上位5候補走査による同一ターン内フォールバック<br>・**ワープタブー & 連続ワープ探索**: ワープ直後の逆戻りピンポンを強固に遮断しつつ、ワープ経由の最短経路を探索<br>・**進退ループ解消＆能動魔法突破**: 退避タイルの記憶ペナルティと、境界での `FREEZE`/`FLASH` 能動詠唱<br>・**振動検知＆安全徘徊 (`wanderSafe`)**: 訪問履歴ペナルティ、直進慣性ボーナス（`-2`）、袋小路緊急脱出 |
| **定量KPI集計テレメトリ (`SimulationTelemetry`)** | ✅ 実装済み | `SimulationTelemetry.ts` | 全体成績（勝率・平均ターン・死因内訳）に加え、課題1（首討伐後家湧き成功率・上限ブロック率・最遠敵パージ数）、課題2（EXP/STR推移パーセンタイル・最大EXPジャンプ・被ダメ内訳）、課題3（非消耗品出現数・上限フォールバック発動数・ゴースト強奪数）を構造化集計。 |
| **高速バッチシミュレータ (`SimulationRunner`)** | ✅ 実装済み | `SimulationRunner.ts` | ヘッドレス環境で `AutoPlayBot` による探索を並行/順次バッチ実行し、テレメトリ集計レポート（Markdown/JSONサマリー）を生成。 |
| **シミュレーション実行CLI (`simulate.ts`)** | ✅ 実装済み | `scripts/simulate.ts`, `package.json` | `npm run simulate`（または `npm run simulate -- --runs=20 --turns=3000 --topology=SPIRAL_LABYRINTH` 等）で実行可能なCLIツール。バッチ実行結果および3大課題の健全性診断をコンソールへ即時出力。 |
| **パラメータ評価スクリプト (`evaluate-params.ts`)** | ✅ 実装済み | `scripts/evaluate-params.ts` | ベースライン、ポーション強化、墓封鎖タイミング、自動マップ評価など複数戦略を並行評価し、勝率・マイルストーン・死因の比較表を出力。 |

---

## 10. インゲーム連携モード（デモ＆自走検証） (`src/core/GameEngine.ts`, `src/view/DOMUIManager.ts`)

| 機能名 | ステータス | 該当コード / モジュール | 説明 |
| :--- | :---: | :--- | :--- |
| **アトラクションデモモード** | ✅ 実装済み | `GameEngine.ts`, `DOMUIManager.ts` | タイトル画面放置での自動実演開始。デモ中のサウンド自動消音＆復帰、チュートリアル字幕オーバーレイ表示、任意キー入力／クリックによる即時タイトル復帰、500ターン／60フレームスタック終了。 |
| **自走検証モード (Auto-Play Verify)** | ✅ 実装済み | `GameEngine.ts`, `DOMUIManager.ts` | 任意の生成マップでAI自走を可視化。ターン上限撤廃（無制限自走）、ステータス字幕表示、スタック救済（`handleStuckRescue`）による自力脱出。 |
| **可変速自走 & 一時停止** | ✅ 実装済み | `GameEngine.ts`, `DOMUIManager.ts` | オーバーレイUIボタンおよびキー操作による速度変更（1x / 2x / 5x / Pause）。静止しての状況分析が可能。 |
| **シームレス操作引き継ぎ (Takeover / Toggle)** | ✅ 実装済み | `GameEngine.ts`, `InputManager.ts` | プレイヤー手動操作 ⇔ 自動自走のリアルタイム相互切り替え（`[A]` / `[Tab]` キー）。プレイ途中状態のままその場で自走開始・手動引き継ぎが可能。 |

---

## 11. ヘッドレス検証 & アーキテクチャ自動テスト (`test/`, `src/core/`)

| 機能名 | ステータス | 該当コード / モジュール | 説明 |
| :--- | :---: | :--- | :--- |
| **ヘッドレス完全疎結合シミュレータ** | ✅ 実装済み | `GameEngine.ts`, `GameLoop.ts` | Canvas / DOM が存在しない純粋 Node.js 環境において、`new GameEngine()` のみで自律稼働。手動フレーム進行 `stepFrame(deltaMs)` 提供。 |
| **アーキテクチャ境界静的リントテスト** | ✅ 実装済み | `test/test-architecture-rules.ts` | `models`, `systems`, `config`, `ai`, `simulation` が DOM API や `view/`, `audio/` を一切インポートしていないことを自動検証（Passive View & ヘッドレス純粋性保証）。 |
| **120ターン自動ノーモック駆動テスト** | ✅ 実装済み | `test/test-headless-evaluation.ts` | 移動、戦闘、火炎弾弾道力学、被弾、敵撃破、経験値、死因記録、ゲームオーバーまでを完全ヘッドレス検証。 |
| **包括的統合テストスイート** | ✅ 実装済み | `test/*.ts` (全35テストスイート) | ターン制、戦闘、マップ、ゴースト、プロシージャル、9セクター動的配置、コンパクトプレハブ、プリセット共有、タクティカルマーカー、中断セーブ、Phase 9〜12基盤、およびAutoPlayBotの拠点引越し・ピンポン防止・孤立目標ブラックリスト・連続ワープ・マップ評価・サウンド復帰全方位のテストカバレッジ。 |
