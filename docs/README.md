# ドキュメント管理ガイド (Documentation Guide)

本ディレクトリ（`docs/`）は、1984年 PC-8801版『ドラゴンスレイヤー (Level 2.0)』へのリスペクト・オマージュとして、そのコアメカニクスをベースに**プロシージャル（自動）マップ生成**・**タクティカル脅威度マーカー**・**自律攻略ボット＆ヘッドレス検証基盤**を統合した非公式ファンメイドWeb実装 **『DS1ish』** の仕様書・設計書・実装状況・ロードマップを管理する。

---

## 1. ディレクトリ構成と責務

```text
docs/
├── README.md                         # 本書（ドキュメント全体ガイド・目次・運用ルール）
├── procedural_generation_spec.md     # 【プロシージャル生成＆攻略バランス仕様書】(全域9セクター動的配置・プレハブ・プリセット共有まで網羅した決定版仕様書)
├── autoplay_and_simulation_spec.md   # 【自律攻略ボット＆ヘッドレスシミュレーション仕様書】(AutoPlayBot・拠点引越し戦術・バッチ検証・インゲーム自走の決定版仕様書)
│
├── status/                           # 【実装状態】現在実際に稼働・動作保証されている機能と仕様
│   ├── current_features.md           # 実装機能リスト（全システム別の網羅的機能・ステータスマトリクス）
│   └── combat_mechanics.md           # 実装済み戦闘・ステータス・アイテム計算仕様書
│
├── roadmap/                          # 【ロードマップ・発展構想】開発マイルストーン・アーキテクチャ提案書
│   ├── roadmap.md                    # 全体ロードマップ・進行フェーズ一覧 (Phase 6〜12完了 & 今後の発展構想)
│   └── proposals/                    # 各機能の詳細提案・設計コンセプト資料
│       ├── hierarchical_theme_block_generation.md # マルチスケール・テーマブロック階層合成＆ボット攻略方針連携設計
│       ├── procedural_variety_and_sandbox.md    # プロシージャル多彩化・チューニング基盤・プリセット共有設計
│       ├── headless_and_multi_frontend.md       # ヘッドレス評価基盤＆シグナル駆動マルチフロントエンド構想
│       ├── procedural_and_roguelike_concepts.md # プロシージャル生成原理＆マルチフロア発展構想
│       └── enemy_marker_and_modernization.md    # 敵相対マーカー（攻防2軸3×3マトリクス）＆モダンパズルRPG化構想
│
├── specs/                            # 【基本ルール仕様】『DS1ish』のコアメカニクス・基本パラメータ仕様
│   └── game_specification.md         # 基本ルール・ベースメカニクス仕様書 (Base Mechanics Reference)
│
└── architecture/                     # 【システム設計】コード構造・アーキテクチャ
    └── technical_design.md           # システム設計書（クラス設計・サブコントローラー・レイヤー責務・データフロー）
```

---

## 2. ドキュメント一覧リンク

### 2.1 実装状態 (Implementation Status)
- [実装機能リスト (`status/current_features.md`)](./status/current_features.md)
  - コア移動、アイテム、戦闘、モダン敵マーカー、魔法、ドラゴン、ゴースト、プロシージャル生成（9セクター動的配置・4大アーキタイプ・プリセット共有）、UI/サウンド、QoL/セーブ、ヘッドレス自動プレイ検証まで、全カテゴリの網羅的機能マトリクス。
- [戦闘・ステータス計算仕様書 (`status/combat_mechanics.md`)](./status/combat_mechanics.md)
  - ターン調停、ダメージ計算式、モンスター行動パラメータ、各アイテム仕様。

### 2.2 仕様・設計 (Specs & Architecture)
- [プロシージャルダンジョン生成・攻略バランス設計仕様書 (`procedural_generation_spec.md`)](./procedural_generation_spec.md)
  - 全域9セクター動的分割、我が家＆ドラゴン要塞の動的アンカー配置・コンパクトプレハブ（`COMPACT_5x5` / `COMPACT_3x3`）、アンチ・ブロック押し込みバリア、4大アーキタイプ、54通りチューニングプリセット、ソルバビリティ検証ロジック、おすすめプリセット＆1行共有コード（`DS1MAP:`）仕様を網羅。
- [自律攻略ボット ＆ ヘッドレスシミュレーション仕様書 (`autoplay_and_simulation_spec.md`)](./autoplay_and_simulation_spec.md)
  - `AutoPlayBot`（Behaviorモジュール分割、幾何スケール連動動的パラメータ `TacticalContext`、訪問ヒートマップ周回打開、MP=1温存、8歩周期開錠チェーン、アイテム持ち替え、チョークポイント墓封鎖 `GraveSealBehavior`、家をドラゴン近傍へ押し運ぶ拠点引越し戦術 `RelocateBehavior`、スタン時王冠脱出 `EscapeBehavior`）、ヘッドレス・バッチシミュレーション基盤、およびインゲーム連携モード（アトラクトデモ、可変速自走検証、シームレス操作引き継ぎ）の決定版仕様書。
- [基本ルール・ベースメカニクス仕様書 (`specs/game_specification.md`)](./specs/game_specification.md)
  - 『DS1ish』のコアメカニクスおよび基本パラメータ定義リファレンス。
- [システム設計書 (`architecture/technical_design.md`)](./architecture/technical_design.md)
  - TypeScriptアーキテクチャ、`GameEngine` サブコントローラー分割設計、MVC/システム構成、ヘッドレス分離方針。

### 2.3 ロードマップ・発展構想 (Roadmap & Proposals)
- [ロードマップ (`roadmap/roadmap.md`)](./roadmap/roadmap.md)
  - Phase 6〜12（プロシージャル生成、パラメータ基盤、ヘッドレスシミュレータ、アーキタイプ戦術、9セクター動的配置＆プリセット共有）の達成マイルストーンと今後の発展構想。
- [機能提案・構想設計書 (`roadmap/proposals/`)](./roadmap/proposals/)
  - 個別機能の背景・数理モデル・設計コンセプトを管理。

---

## 3. ドキュメント運用ルール (Lifecycle & Workflow)

新機能の考案から実装完了までのドキュメント更新ライフサイクルは以下の通りとする：

1. **構想・アイディアフェーズ**:
   - `roadmap/proposals/` に構想ドキュメントを作成・更新し、背景・仕様草案をまとめる。
   - `roadmap/roadmap.md` のフェーズ一覧に紐付ける。
2. **実装進行中フェーズ**:
   - `roadmap/roadmap.md` 上で対象フェーズのステータスを【進行中】に更新。
3. **実装完了・動作検証フェーズ**:
   - 実装が完了し自動テスト（`npm test`）・動作検証が通ったら、`status/current_features.md` および該当する決定版仕様書（`procedural_generation_spec.md` / `autoplay_and_simulation_spec.md`）を更新。
   - `roadmap/roadmap.md` の該当項目を【完了】に更新。
   - システム構造の変更がある場合は `architecture/technical_design.md` を更新。
