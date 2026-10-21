# Sparca 設計書（データモデル・レンダリング方式）

仕様書 `docs/spec.md` §17 手順1「データモデルとレンダリング方式を設計する」の成果物。
確定済みの判断は `CLAUDE.md` §5 を参照。

## 1. 全体構成

```
src/
├── model/      ドキュメントのデータ型・生成関数・幾何計算（UI 非依存、純粋関数）
├── engine/     画像処理エンジン（リサンプリング、色調整、ぼかし、マスク）。UI 非依存、ImageData 相当の型のみ扱う
├── history/    Undo／Redo（スナップショット履歴、連続操作の結合）
├── io/         プロジェクト保存・読み込み（.sparca）、画像書き出し
├── render/     ドキュメント → SVG の描画、ラスター結果のキャッシュ
├── store/      エディタ状態（ドキュメント、選択、ツール、表示倍率）と編集コマンド
└── ui/         React コンポーネント（メニュー、ツールバー、キャンバス、レイヤー、プロパティ）
```

依存方向は `ui → store → (model, history, render, io) → engine`。`engine` と `model` は React・DOM に依存せず、Node 上の Vitest で直接テストする。

## 2. データモデル

### 2.1 ドキュメント

```ts
interface SparcaDocument {
  version: 1;
  width: number;            // キャンバス寸法（px）。表示倍率とは無関係
  height: number;
  background: { kind: 'transparent' } | { kind: 'color'; color: string };
  layers: Layer[];          // 配列の先頭が最背面
  assets: Record<AssetId, AssetMeta>; // 画像のメタ情報（画素データ本体は AssetStore）
}

interface Layer {
  id: string; name: string;
  visible: boolean; locked: boolean;
  children: SceneObject[];  // 先頭が最背面
}

type SceneObject = ShapeObject | PathObject | TextObject | ImageObject | GroupObject;
```

すべてのオブジェクトの共通項目：

```ts
interface BaseObject {
  id: string; name: string;
  visible: boolean; locked: boolean;
  opacity: number;          // 0..1
  box: Box;                 // 親（ドキュメント）座標での外接矩形と回転
  effects: Effect[];        // エフェクト（先頭から順に適用。編集情報として保持し、焼き込まない）
}
interface Box { x: number; y: number; width: number; height: number; rotation: number /* 度、矩形中心まわり */ }
```

- **ShapeObject**：`shape` に `rect`（角丸半径を含む）／`ellipse`／`polygon`（頂点数）／`star`（頂点数・内径比）／`line`／`arrow`（矢じりの大きさ）。塗り・線色・線幅を持つ。形状は `box` の内側に描く。直線・矢印は始点・終点を box 内の正規化座標（0..1）で持つ。
- **PathObject**：ベジェ曲線。アンカーと前後ハンドルを box 内の正規化座標で保持（後からアンカー／ハンドル編集できる構造）。閉じたパスかどうかのフラグを持つ。
- **TextObject**：テキスト内容、フォント、サイズ、太字／斜体、色、文字間隔、行間、揃え。ベクターのまま保持する。
- **ImageObject**：元画像 `assetId` と非破壊の加工パイプライン（§4）。
- **GroupObject**：`children: SceneObject[]`。子は**ドキュメント座標のまま**保持し、グループ自体は独自の変形を持たない。グループの移動・拡縮・回転は子それぞれへ同じ変換を適用する（回転は子の中心をグループ中心まわりに回し、子の回転角に加算）。回転済みの子を非等倍で拡縮した場合は外接矩形ベースの近似になる（Fireworks と同等の挙動）。

**エフェクト（Effect）**：`{ id, kind, enabled, strength, ...種類ごとの設定 }`。`kind` は drop-shadow / inner-shadow / glow / inner-glow / bevel-inner / bevel-outer / emboss / blur / sharpen / brightness-contrast / hue-saturation / invert / color-overlay。`enabled` は一時的なオン／オフ、`strength`（0..1）は適用前とのブレンド率。同じ種類を複数持てる。旧形式 `{ glow, dropShadow }` は読み込み時に配列へ変換する（有効なものだけ、グロー→ドロップシャドウの順）。

**塗り（Fill）**：図形・パスの `fill` とテキストの `color` は、色文字列（`#rrggbb`）か次のグラデーション。`fill` は塗りなし（`null`）も可。

```ts
interface Gradient {
  kind: 'linear' | 'radial' | 'conic';
  stops: { offset: number /* 0..1 */; color: string; opacity: number /* 0..1 */ }[]; // 2つ以上。保存順は任意
  start: Point; // box 内の正規化座標（回転前の box、0..1 の外も可）
  end: Point;
}
```

- 線形：`start`（位置 0）→ `end`（位置 1）。放射：`start` が中心、`end` は外周上の点（正規化座標で円なので、box に合わせて楕円に伸びる）。円錐：`start` が中心、`end` の方向が位置 0 で、時計回り。
- 正規化座標なので、オブジェクトの移動・拡縮・回転・テキスト枠の自動調整に追従する。
- 線（枠線）の色は単色のみ。

`box` を「回転付き矩形」で統一することで、選択ハンドル・プロパティパネル（X, Y, 幅, 高さ, 回転）・保存形式が全種類のオブジェクトで共通になる。

### 2.2 画像データ（AssetStore）

- 画像の画素データは**不変（immutable）なアセット**として `AssetStore`（ID → Blob と デコード済みビットマップ）に保持し、ドキュメントには ID とメタ情報だけを置く。
- 加工結果でアセットを上書きしない。Undo／Redo 履歴がアセットを参照するだけになり、画像データの複製が起きない。
- どの履歴からも参照されなくなったアセットは、保存時に書き出さない。

### 2.3 エディタ状態（ドキュメント外）

ドキュメントに含めず保存もしない状態：選択中オブジェクト ID、**範囲選択（画素選択）**、現在のツール、表示倍率・スクロール位置、未保存フラグ。
範囲選択（矩形／楕円／投げ縄／多角形）は**ドキュメント座標のベクター形状**として保持し、オブジェクト選択とは別のフィールドで管理する。

## 3. レンダリング方式

- キャンバスはドキュメント全体を **1つの SVG** で描画する。`viewBox` はドキュメント座標、表示倍率は SVG の表示サイズで表現する（表示倍率と実寸を分離）。
- 図形・パス・テキストは SVG 要素。
- エフェクトはオブジェクトごとに 1 つの SVG フィルターにまとめる（`render/effects.tsx`）。リストの先頭から順に、前の結果（最初は `SourceGraphic`）を入力にしてフィルター要素をつなぐ。強さが 1 未満なら `feComposite operator="arithmetic"` で前の結果とブレンドする。シャドウ・グローは結果のアルファ（`feColorMatrix`）からぼかし・膨張・オフセット・塗り（`feGaussianBlur`／`feMorphology`／`feOffset`／`feFlood`）、内側系はアルファの反転を元の形で切り抜く。ベベル・エンボスは光源方向へずらしたアルファとの差（`feComposite out`）でハイライトと影を作る。色の調整は `feComponentTransfer`／`feColorMatrix`（明るさ・コントラストは画像の色調整と同じ式）。フィルターはオブジェクトの回転した座標系で働くため、角度は回転を打ち消して画面上で一定の向きにする。
- 画像は画像エンジンでパイプラインを適用した結果（§4）を `<image>` として配置する。
- グラデーション：線形・放射は SVG の `linearGradient`／`radialGradient`（`gradientUnits="userSpaceOnUse"` と box への変換行列）。SVG に円錐グラデーションはないため、Canvas の `createConicGradient` で画像（長辺 最大 2048px、小さい図形は 2 倍密度）を生成し `pattern` として塗る。生成画像はキャッシュする。
- 選択ハンドル・範囲選択の点線などの操作 UI は、ドキュメント SVG の上に重ねた別レイヤーで描画し、書き出しには含めない。
- キャンバス外のオブジェクトはドキュメントに残し、作業領域には表示する（書き出し対象はキャンバス内のみ）。
- **書き出し**：同じ描画関数で書き出し用 SVG（画像は data URL 埋め込み、操作 UI なし、viewBox ＝キャンバス）を生成し、Canvas に描画してから PNG／JPEG／WebP にエンコードする。画面と書き出しで描画経路が同じになり、見た目が一致する。
- **補間方式**：画像サイズ変更は画像エンジンが指定方式で画素を生成し、box を新しい画素寸法に合わせる（等倍表示）。ブラウザ側のリサイズで補間方式が無視されることはない。選択ツールでの自由変形（ハンドルでの拡縮）はブラウザの描画補間で表示する。正確な補間が必要な場合は「画像サイズ変更」を使う（UI に明記）。

## 4. ラスター加工パイプライン（非破壊）

```ts
interface ImageObject extends BaseObject {
  type: 'image';
  assetId: AssetId;                 // 元画像（変更しない）
  pipeline: {
    crop?: { x; y; width; height }; // 元画像ピクセル座標での切り抜き
    resize?: { width; height; method: ResampleMethod };
    adjust: { brightness; contrast; saturation; temperature; tint; auto?: AutoParams };
    blur: number;                   // 画像全体へのガウスぼかし半径（px）
    localEdits: LocalEdit[];        // 選択範囲へのぼかし等（マスクは画像内の正規化座標）
  };
}
```

- 適用順は固定：**切り抜き → リサイズ → 色調整 → 全体ぼかし → 部分ぼかし（localEdits）**。
- 範囲選択でのぼかしは、選択形状を画像内の正規化座標（0..1）へ変換したマスクとして `localEdits` に記録する。後でリサイズしてもマスクは追従する。
- 自動カラー調整は、実行時に解析したパラメータ（チャンネル別の黒点・白点、ホワイトバランスのゲイン）を `adjust.auto` に**数値として保存**する。開き直しても同じ結果になる。
- パイプライン結果はパラメータのハッシュでキャッシュする。重い処理は Web Worker で実行し、スライダー操作中は表示サイズに縮小したプロキシで高速プレビューし、確定後に原寸で計算する。
- 加工前後の比較は、パイプラインを無効にした元画像の表示に一時的に切り替えて行う。

### 4.1 リサンプリング（`engine/resample`）

分離可能な畳み込みフィルター（横→縦の2パス）で実装する。縮小時はフィルター幅を縮小率で広げる（アンチエイリアス）。アルファは乗算済み（premultiplied）で計算し、縁の色にじみを防ぐ。

| 方式 | カーネル | 半径 |
|---|---|---|
| 最近傍 | 最も近い画素 | – |
| バイリニア | 三角（tent） | 1 |
| バイキュービック | Keys 3次畳み込み a=−0.5 | 2 |
| Lanczos | Lanczos3（sinc × sinc窓） | 3 |
| バイキュービック・シャープ | Keys a=−0.75 で補間後、アンシャープマスク（半径 0.8px、量 0.5、閾値 0） | 2 |
| バイキュービック・スムーズ | Mitchell–Netravali B=1/3, C=1/3 | 2 |

### 4.2 色調整（`engine/color`）

- 明るさ（−100..100）：加算オフセット。コントラスト（−100..100）：中間灰（128）を中心にしたゲイン。彩度（−100..100）：Rec.709 輝度を基準に色差を拡縮。色温度（−100..100）：R と B のゲインを逆方向に変化。色かぶり補正（−100..100）：G のゲイン。
- 自動カラー調整：チャンネル別ヒストグラムの両端 0.5% をクリップして黒点・白点を求め、レベルを伸長。続けてグレーワールド法（R, G, B の平均を揃えるゲイン）でホワイトバランスを補正する。ゲインは過補正を避けるため 0.5..2.0 に制限。

### 4.3 ぼかし（`engine/blur`）

ガウスぼかしを3回のボックスぼかしで近似（分離可能、O(n)）。乗算済みアルファで計算する。部分ぼかしは、ぼかした画像と元画像をマスク（アンチエイリアス付きで塗った形状）でブレンドする。

## 5. Undo／Redo

- ドキュメントは不変データとして扱い、編集は Immer で新しいドキュメントを作る（構造共有により、変更のない部分はコピーされない）。
- 履歴は「編集前ドキュメントへの参照」の列。画素データは不変アセットの参照なので、履歴に画像の複製は生じない。
- 連続操作の結合：ドラッグやスライダー操作は `beginTransaction`／`commit` で1つの履歴にまとめる。同じ結合キー（例：`opacity:<id>`）の連続編集も1件に結合する。
- 対象：オブジェクトの作成・変形・プロパティ変更・削除、レイヤー操作、画像加工、キャンバスサイズ変更、トリミング。表示倍率や選択状態の変更は履歴に含めない。

## 6. プロジェクト形式 `.sparca`

ZIP（JSZip）形式：

```
document.json        SparcaDocument（version フィールドでスキーマ移行に対応）
assets/<assetId>.<ext>  元画像のバイト列（読み込んだファイルのまま。PNG/JPEG/WebP 等）
```

- 読み込み時は `document.json` の構造を検証し、参照されている全アセットの存在を確認する。不足や不正な値があればドキュメントを開かずに理由を表示する。
- 画像は常に埋め込むため、元ファイルの移動で参照切れは起きない。

## 7. 画像書き出し

- PNG：透明背景をそのまま出力。
- JPEG：透明部分は背景色（ドキュメント背景色、透明背景の場合は白。ダイアログで変更可）で塗りつぶす。品質 0..100。
- WebP：透明対応、品質 0..100。
- 書き出しダイアログで「レイヤー構造や編集情報は保存されない。再編集には .sparca で保存」と表示する。

## 8. 検証と制限

- 最大寸法：一辺 16384px、総画素数 1億（ブラウザの Canvas 上限に配慮）。超える入力は拒否して理由を表示する。
- 画像の読み込み失敗、書き出し失敗、プロジェクトの読み込み失敗は、原因を日本語で通知し、ドキュメントは変更しない。
