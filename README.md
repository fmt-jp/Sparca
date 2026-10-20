# Sparca

Macromedia Fireworks に着想を得た、ブラウザで動くハイブリッド型（ベクター＋ラスター）グラフィックエディタです。
仕様は [`docs/spec.md`](docs/spec.md)、設計は [`docs/design.md`](docs/design.md) を参照してください。

## 環境構築

- Node.js 22 以上、npm 10 以上

```sh
npm install
```

## 起動

```sh
npm run dev        # 開発サーバー（http://localhost:5173）
npm run build      # 本番ビルド（dist/）
npm run preview    # ビルド結果の確認
```

## 公開（GitHub Pages）

`main` ブランチに push すると `.github/workflows/deploy-pages.yml` が型チェック・単体テスト・ビルドを実行し、GitHub Pages に公開します（Actions タブから手動実行も可能）。
初回のみ、リポジトリの Settings → Pages → Build and deployment → Source を「GitHub Actions」に設定してください。
ビルドは相対パス（`base: './'`）なので、`https://<owner>.github.io/<repo>/` のようなサブパスでも動作します。

## テスト

```sh
npm test           # 単体テスト（Vitest）：モデル、履歴、保存形式、画像処理
npm run typecheck  # 型チェック
npm run test:e2e   # E2E テスト（Playwright + Chromium）。ビルドとプレビューサーバー起動を自動で行う
```

E2E は `@playwright/test` 1.56.1 に固定しています（クラウド環境にプリインストールされた Chromium と対応させるため）。
別環境では初回に `npx playwright install chromium` が必要です。

## 実装状況

| 区分 | 状態 |
|---|---|
| Phase 1 編集基盤 | 実装済み：レイアウト、キャンバス（表示倍率・手のひら・ズーム）、画像の配置（メニュー／ドラッグ＆ドロップ）、図形（矩形・角丸矩形・楕円・多角形・星・直線・矢印）、テキスト、レイヤー（追加・削除・複製・名前変更・表示・ロック・ドラッグ並べ替え）、選択・移動・拡大縮小・回転、Undo／Redo、プロジェクト保存・読み込み |
| Phase 2 基本画像加工 | 実装済み：画像サイズ変更（ピクセル／比率、縦横比固定、6種の補間方式、変更前後プレビュー）、キャンバスサイズ変更（9点基準）、トリミング（キャンバス全体／画像単体）、自動・手動カラー調整（明るさ・コントラスト・彩度・色温度・色かぶり補正）、ぼかし（画像全体／選択範囲）、範囲選択（矩形・楕円・投げ縄・多角形）、加工前との比較 |
| Phase 3 図形・文字の強化 | 実装済み：ペンツール（ベジェ曲線、角／曲線アンカー、開いた／閉じたパス）、多角形・星・矢印、テキスト装飾、グロー・ドロップシャドウ、グループ化、整列、スポイト、コピー＆ペースト |
| Phase 4 仕上げと書き出し | 実装済み：PNG／JPEG／WebP 書き出し、品質設定、透明背景の処理（JPEG は指定色で塗りつぶし）、書き出し失敗時の通知 |

未実装の機能はツールバーやメニューに表示していません。

### 複数のドキュメント（タブ）

- 「開く」で複数のファイルをまとめて選択でき、それぞれキャンバス上部のタブで開く。タブをクリックで切り替え
- 「新規」も新しいタブで開く。何も編集していない空の「名称未設定」タブは、開いたファイルで置き換える
- タブの ×（または中クリック）で閉じる。未保存の変更があれば確認する。最後のタブを閉じると空の新規ドキュメントになる
- タブバーに .sparca や画像ファイルをドロップすると新しいタブで開く（キャンバスへのドロップは現在のドキュメントへの配置）
- Undo 履歴・選択・表示倍率・スクロール位置・保存先はタブごと。クリップボードは共通（タブ間でコピー＆ペースト可）
- タブ切り替えのキーボードショートカットはなし（Ctrl+Tab などはブラウザが使用するため）

### 読み込める画像形式

PNG（Fireworks PNG は統合画像として）、JPEG（.jpg / .jpe / .jpeg）、GIF（アニメーションは1フレーム目）、BMP（.bmp / .dib / .rle）。以前から配置できた WebP も引き続き読み込めます。
形式は拡張子ではなくファイル先頭のバイトで判定し、それ以外（TIFF、PSD など）は理由を表示して読み込みません。

- ファイル → 開く：画像と同じサイズの新規ドキュメント（透明背景）として開く
- ファイル → 画像を配置／キャンバスへドロップ：現在のドキュメントに画像オブジェクトとして追加

## 操作

| 操作 | キー |
|---|---|
| 選択 / トリミング / 矩形・楕円選択 / 投げ縄・多角形選択 | V / C / M / L（同じキーで切り替え） |
| ペン / スポイト | P / I |
| 部分選択（パスのアンカー編集） | A（選択ツールでパスをダブルクリックしても可） |
| アンカー：移動 / 追加 / 削除 | ドラッグ・矢印キー / 輪郭をダブルクリック / Delete |
| アンカー：角 ↔ 曲線 | アンカーをダブルクリック（ハンドルは Alt+ドラッグで左右独立） |
| ライン / 図形（矩形・角丸矩形・楕円・多角形・星・矢印）/ テキスト / 手のひら / ズーム | N / R / T / H / Z（同じキーで同グループ内を切り替え） |
| トリミング確定 / 取消 | Enter / Esc |
| 範囲選択の解除 | Esc |
| 一時的に手のひら | Space を押しながらドラッグ |
| 取り消し / やり直し | Ctrl+Z / Ctrl+Shift+Z（Ctrl+Y） |
| コピー / カット / ペースト / 複製 / 削除 | Ctrl+C / Ctrl+X / Ctrl+V / Ctrl+D / Delete |
| グループ化 / 解除 | Ctrl+G / Ctrl+Shift+G |
| 重ね順 | Ctrl+] 前面へ、Ctrl+[ 背面へ（Shift で最前面・最背面） |
| 保存 / 名前を付けて保存 / 開く / 画像を配置 / 書き出し | Ctrl+S / Ctrl+Shift+S / Ctrl+O / Ctrl+Shift+I / Ctrl+Shift+E |
| 新規 | メニューから（Ctrl+N はブラウザが新規ウィンドウに使うため割り当てない） |
| ズーム | Ctrl+ホイール、Ctrl++ / Ctrl+- / Ctrl+0（全体表示）/ Ctrl+1（100%） |
| 描画・変形中の修飾キー | Shift：縦横比固定・正方形／正円・角度 15°（直線は 45°）刻み、Alt：中心から |
| 移動 | 矢印キーで 1px、Shift+矢印で 10px |

macOS では Ctrl の代わりに ⌘ も使えます。

## 受け入れ基準とテスト

仕様書 §16 の各項目は、実際の動作（状態・描画結果・書き出し画素）を確認するテストで検証しています。

| # | 受け入れ基準 | テスト |
|---|---|---|
| 1 | 画像を読み込みキャンバスに配置 | `e2e/phase1.spec.ts` places an image… |
| 2 | ベクター図形とテキストの作成 | `e2e/phase1.spec.ts` draws shapes and text…、`e2e/phase3.spec.ts` pen tool / polygon, star and arrow |
| 3 | ベクターとラスターの重ね編集 | `e2e/phase1.spec.ts` places an image and stacks vector objects over it |
| 4 | レイヤーの順序・表示・ロック | `e2e/phase1.spec.ts` layers: add, hide, lock and reorder、`src/model/commands.test.ts` |
| 5 | ピクセル指定・比率指定のリサイズ | `e2e/phase2.spec.ts` image size: pixel and percent modes… |
| 6 | バイキュービックを含む補間方式の選択 | 同上（最近傍で画素を検証）、`src/engine/engine.test.ts` resample（6方式すべて） |
| 7 | キャンバス寸法変更と9点基準 | `e2e/phase2.spec.ts` canvas size…、`src/model/imageOps.test.ts`（仕様書の3例） |
| 8 | 明るさ・コントラスト・彩度などの反映 | `e2e/phase2.spec.ts` manual color adjustments… / auto color…、`src/engine/engine.test.ts` color |
| 9 | 画像全体・選択範囲へのぼかし | `e2e/phase2.spec.ts` range selection + blur… / whole-image blur… |
| 10 | テキスト・図形のグロー・ドロップシャドウ | `e2e/phase3.spec.ts` glow and drop shadow…、`e2e/phase4.spec.ts` PNG export（影の画素を確認） |
| 11 | 主要操作の Undo／Redo | `e2e/phase1.spec.ts`、`e2e/phase2.spec.ts`（色調整・トリミング）、`src/history/history.test.ts` |
| 12 | プロジェクトの保存と再編集 | `e2e/phase1.spec.ts` saves a project and reopens it…、`e2e/robustness.spec.ts`、`src/io/project.test.ts` |
| 13 | PNG・JPEG・WebP 書き出し | `e2e/phase4.spec.ts`（透明・塗りつぶし・品質・画素） |
| 14 | 失敗時のエラー通知 | `e2e/phase1.spec.ts` rejects non-image files、`e2e/phase4.spec.ts` export failure、`e2e/robustness.spec.ts`（画像処理失敗・壊れたプロジェクト） |

## 主要な設計判断

詳細は [`docs/design.md`](docs/design.md)。

- **描画**：ドキュメント全体を1つの SVG で描画し、画面表示と画像書き出しで同じ描画関数を使う。
- **データモデル**：Document → Layer → オブジェクト（図形・パス・テキスト・画像・グループ）。全オブジェクトが「回転付き矩形（box）」を持つ。グループは子をドキュメント座標のまま持ち、変形は子へ同じ変換を適用する。
- **画像**：画素データは不変アセットとして別管理し、ドキュメントは参照だけを持つ。加工は元画像＋パラメータの非破壊パイプライン（切り抜き → リサイズ → 色調整 → ぼかし → 部分ぼかし）。
- **Undo／Redo**：Immer による不変ドキュメントのスナップショット履歴。構造共有と不変アセットにより、画像データを複製しない。ドラッグやスライダー操作は1件にまとめる。
- **保存形式**：`.sparca`（ZIP：`document.json` と `assets/` に元画像を埋め込み）。読み込み時に構造と画像の存在を検証する。
- **画像処理**：`src/engine/` に UI 非依存の純粋関数として実装し、Web Worker で実行する。パラメータ変更中は縮小プレビューを先に表示し、操作が止まると原寸で再計算する。補間方式・自動カラー調整のアルゴリズムとパラメータは `docs/design.md` §4 に明記。
- **ファイル操作**：File System Access API が使えるブラウザでは上書き保存、使えない場合はダウンロードで保存する。

## 既知の制約

- 選択ツールのハンドルで画像を拡大縮小した場合の表示はブラウザの補間に従う。補間方式を指定した正確なリサイズは「画像サイズ」ダイアログを使う。
- 画像の部分ぼかし（選択範囲へのぼかし）を後から個別に編集する UI はなく、「最後の1件を削除」または Undo で取り消す。
- 画像トリミング後に既存の部分ぼかしの範囲は追従するが、トリミング範囲外になった部分は失われる。
- 回転済みオブジェクトを含むグループを非等倍で拡大縮小すると、子の形は外接矩形ベースの近似になる。
- 部分選択ツールで編集できるのはペンで描いたパスのみ。矩形・楕円などの図形はパラメータ（角丸・頂点数など）で編集する（パスへの変換は未実装）。
- 書き出しでは Web フォントを埋め込まないため、OS にインストールされたフォントで描画される。
- SVG 書き出しは未実装（仕様上の拡張候補）。
