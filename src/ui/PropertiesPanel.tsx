// Bottom panel: shows settings relevant to the current selection (spec §12).
import { transformObjects, updateObject } from '../model/commands';
import { boxCenter, unionBounds } from '../model/geometry';
import { findObject, isEffectivelyLocked } from '../model/tree';
import type { ColorAdjust, Effects, SceneObject, ShapeObject, TextObject, ImageObject, PathObject, Id, Box } from '../model/types';
import { pipelineOutputSize } from '../engine/pipeline';
import { METHOD_LABELS } from '../engine/resample';
import { autoColor, cancelCrop, commitCrop, pixelTargetImage, resetAdjust, setAdjust, setCropTarget, setImageBlur } from '../store/imageActions';
import { openDialog } from './dialogs';
import { measureText } from '../render/text';
import { alignSelection, groupSelection, ungroupSelection, type AlignOp } from '../store/actions';
import { ColorInput, Field, NumberInput, SliderInput, Toggle } from './controls';
import { editor, useEditor } from './useEditor';
import { useState } from 'react';
import { toolDef } from './tools';

const FONTS = [
  'sans-serif',
  'serif',
  'monospace',
  'Hiragino Sans',
  'Hiragino Mincho ProN',
  'Yu Gothic',
  'Yu Mincho',
  'Meiryo',
  'Noto Sans JP',
  'Noto Serif JP',
  'Arial',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Impact',
  'Verdana',
];

function set(id: Id, patch: Partial<SceneObject>, label: string, key?: string) {
  editor.edit(label, (d) => updateObject(d, id, patch), key ? `${key}:${id}` : null);
}

/** Update text properties and re-fit the box to the text's natural size. */
function setText(o: TextObject, patch: Partial<TextObject>, label: string, key?: string) {
  const next = { ...o, ...patch };
  const m = measureText(next);
  set(o.id, { ...patch, box: { ...o.box, width: m.width, height: m.height } } as Partial<SceneObject>, label, key);
}

export function PropertiesPanel() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const locs = selection.map((id) => findObject(doc, id)).filter((l): l is NonNullable<typeof l> => !!l);

  let content: React.ReactNode;
  if (tool === 'crop') {
    content = <CropSection />;
  } else if (locs.length === 0) {
    content = (
      <>
        <div className="prop-section">
          <span className="hint">
            {toolDef(tool)?.label ?? ''}：{TOOL_HINT[tool] ?? 'オブジェクトを選択するとプロパティを編集できます。'}
          </span>
        </div>
        {tool === 'select' && <DocumentSection />}
      </>
    );
  } else if (locs.length === 1 && locs[0].object.type !== 'group') {
    const o = locs[0].object;
    const locked = isEffectivelyLocked(locs[0]);
    content = (
      <fieldset disabled={locked} className="prop-fieldset">
        {locked && <div className="hint">ロック中のため編集できません。</div>}
        <TransformSection o={o} />
        {o.type === 'shape' && <ShapeSection o={o} />}
        {o.type === 'path' && <PaintSection o={o} />}
        {o.type === 'text' && <TextSection o={o} />}
        {o.type === 'image' && <ImageSection o={o} />}
        {o.type !== 'image' && <EffectsSection o={o} />}
      </fieldset>
    );
  } else {
    content = <MultiSection ids={locs.map((l) => l.object.id)} objects={locs.map((l) => l.object)} />;
  }

  return (
    <section className="properties" aria-label="プロパティ">
      {tool !== 'crop' && <PixelSelectionSection />}
      {tool === 'eyedropper' && <EyedropperSection />}
      {content}
    </section>
  );
}

const TOOL_HINT: Partial<Record<string, string>> = {
  select: 'クリックで選択、Shift+クリックで追加選択、ドラッグで範囲内を選択。ハンドルで拡大縮小・回転（Shift で比率固定・15°刻み、Alt で中心から）。',
  rect: 'ドラッグで矩形を描画（Shift で正方形、Alt で中心から）。',
  'rounded-rect': 'ドラッグで角丸矩形を描画（Shift で正方形）。',
  ellipse: 'ドラッグで楕円を描画（Shift で正円）。',
  polygon: 'ドラッグで多角形を描画。頂点数は作成後に変更できます。',
  star: 'ドラッグで星を描画。頂点数と内径比は作成後に変更できます。',
  line: 'ドラッグで直線を描画（Shift で 45° 単位）。',
  arrow: 'ドラッグで矢印を描画（Shift で 45° 単位）。',
  crop: 'ドラッグで範囲を指定し Enter で確定。',
  'marquee-rect': 'ドラッグで矩形の範囲を選択（Shift で正方形）。',
  'marquee-ellipse': 'ドラッグで楕円の範囲を選択（Shift で正円）。',
  lasso: 'ドラッグで自由な形の範囲を選択。',
  'polygon-lasso': 'クリックで頂点を追加。始点をクリック、ダブルクリック、または Enter で閉じる。Esc で取消。',
  pen: 'クリックで角のアンカー、ドラッグで曲線のアンカー（Shift で 45° 単位）。始点クリックで閉じたパス、Enter・Esc・ダブルクリックで開いたパスとして終了。',
  eyedropper: 'クリックした位置の色を取得します。',
  text: 'クリックでテキストを追加。既存テキストをクリックで編集。Esc または Ctrl+Enter で確定。',
  hand: 'ドラッグで表示位置を移動。',
  zoom: 'クリックで拡大、Alt+クリックで縮小。Ctrl+ホイールでも拡大縮小できます。',
};

function TransformSection({ o }: { o: Exclude<SceneObject, { type: 'group' }> }) {
  const [lockAspect, setLockAspect] = useState(o.type === 'image' || o.type === 'text');
  const b = o.box;
  const setBox = (patch: Partial<Box>, label: string) => {
    let box = { ...b, ...patch };
    if (lockAspect && b.width > 0 && b.height > 0) {
      if (patch.width !== undefined && patch.height === undefined) box.height = (patch.width * b.height) / b.width;
      if (patch.height !== undefined && patch.width === undefined) box.width = (patch.height * b.width) / b.height;
    }
    // Keep the center when changing size so rotated objects don't jump.
    if (patch.width !== undefined || patch.height !== undefined) {
      const c = boxCenter(b);
      box = { ...box, x: c.x - box.width / 2, y: c.y - box.height / 2 };
    }
    if (o.type === 'text') {
      const k = box.height / b.height;
      set(o.id, { box, fontSize: Math.max(1, o.fontSize * k), letterSpacing: o.letterSpacing * k } as Partial<SceneObject>, label);
    } else set(o.id, { box } as Partial<SceneObject>, label);
  };
  return (
    <div className="prop-section">
      <Field label="X">
        <NumberInput label="X" value={b.x} precision={1} onCommit={(x) => setBox({ x }, '位置の変更')} />
      </Field>
      <Field label="Y">
        <NumberInput label="Y" value={b.y} precision={1} onCommit={(y) => setBox({ y }, '位置の変更')} />
      </Field>
      <Field label="幅">
        <NumberInput label="幅" value={b.width} min={1} max={100000} precision={1} suffix="px" onCommit={(width) => setBox({ width }, 'サイズの変更')} />
      </Field>
      <Field label="高さ">
        <NumberInput label="高さ" value={b.height} min={1} max={100000} precision={1} suffix="px" onCommit={(height) => setBox({ height }, 'サイズの変更')} />
      </Field>
      <Toggle checked={lockAspect} onChange={setLockAspect}>
        縦横比固定
      </Toggle>
      <Field label="回転">
        <NumberInput label="回転" value={b.rotation} min={-360} max={360} precision={1} suffix="°" onCommit={(rotation) => setBox({ rotation }, '回転')} />
      </Field>
      <Field label="不透明度">
        <SliderInput
          label="不透明度"
          value={Math.round(o.opacity * 100)}
          min={0}
          max={100}
          suffix="%"
          onChange={(v) => set(o.id, { opacity: v / 100 }, '不透明度の変更', 'opacity')}
        />
      </Field>
    </div>
  );
}

function PaintSection({ o }: { o: ShapeObject | PathObject }) {
  const lineLike = o.type === 'shape' ? o.shape.kind === 'line' || o.shape.kind === 'arrow' : !o.closed;
  return (
    <div className="prop-section">
      {!lineLike && (
        <Field label="塗り">
          <ColorInput label="塗り" allowNone value={o.fill} onChange={(fill) => set(o.id, { fill } as Partial<SceneObject>, '塗りの変更', 'fill')} />
        </Field>
      )}
      <Field label="線">
        <ColorInput
          label="線"
          allowNone={!lineLike}
          value={o.stroke}
          onChange={(stroke) => {
            const patch: Partial<ShapeObject> = { stroke };
            if (stroke && o.strokeWidth === 0) patch.strokeWidth = 2;
            set(o.id, patch as Partial<SceneObject>, '線の色の変更', 'stroke');
          }}
        />
      </Field>
      <Field label="線幅">
        <NumberInput label="線幅" value={o.strokeWidth} min={0} max={500} precision={1} suffix="px" onCommit={(strokeWidth) => set(o.id, { strokeWidth } as Partial<SceneObject>, '線幅の変更')} />
      </Field>
    </div>
  );
}

function ShapeSection({ o }: { o: ShapeObject }) {
  const g = o.shape;
  const setShape = (patch: Partial<ShapeObject['shape']>, label: string, key?: string) =>
    set(o.id, { shape: { ...g, ...patch } as ShapeObject['shape'] } as Partial<SceneObject>, label, key);
  return (
    <>
      <PaintSection o={o} />
      <div className="prop-section">
        {g.kind === 'rect' && (
          <Field label="角丸">
            <NumberInput label="角丸" value={g.cornerRadius} min={0} max={10000} suffix="px" onCommit={(cornerRadius) => setShape({ cornerRadius }, '角丸の変更')} />
          </Field>
        )}
        {g.kind === 'polygon' && (
          <Field label="頂点数">
            <NumberInput label="頂点数" value={g.sides} min={3} max={64} onCommit={(sides) => setShape({ sides: Math.round(sides) }, '頂点数の変更')} />
          </Field>
        )}
        {g.kind === 'star' && (
          <>
            <Field label="頂点数">
              <NumberInput label="頂点数" value={g.points} min={3} max={64} onCommit={(points) => setShape({ points: Math.round(points) }, '頂点数の変更')} />
            </Field>
            <Field label="内径比">
              <SliderInput label="内径比" value={Math.round(g.innerRatio * 100)} min={5} max={95} suffix="%" onChange={(v) => setShape({ innerRatio: v / 100 }, '星の形状の変更', 'star')} />
            </Field>
          </>
        )}
        {g.kind === 'arrow' && (
          <Field label="矢じり">
            <NumberInput label="矢じり" value={g.headSize} min={1} max={1000} suffix="px" onCommit={(headSize) => setShape({ headSize }, '矢じりの変更')} />
          </Field>
        )}
      </div>
    </>
  );
}

function TextSection({ o }: { o: TextObject }) {
  return (
    <>
      <div className="prop-section">
        <Field label="テキスト" wide>
          <textarea
            className="text-content"
            aria-label="テキスト内容"
            value={o.text}
            rows={2}
            onChange={(e) => {
              if (e.target.value.length) setText(o, { text: e.target.value }, 'テキストの編集', 'text');
            }}
          />
        </Field>
        <Field label="フォント">
          <input
            className="font-input"
            list="sparca-fonts"
            aria-label="フォント"
            defaultValue={o.fontFamily}
            key={o.id + o.fontFamily}
            onBlur={(e) => e.target.value.trim() && e.target.value !== o.fontFamily && setText(o, { fontFamily: e.target.value.trim() }, 'フォントの変更')}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <datalist id="sparca-fonts">
            {FONTS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </Field>
        <Field label="サイズ">
          <NumberInput label="フォントサイズ" value={o.fontSize} min={1} max={2000} precision={1} suffix="px" onCommit={(fontSize) => setText(o, { fontSize }, 'フォントサイズの変更')} />
        </Field>
        <Field label="スタイル" group>
          <span className="button-row">
            <button type="button" className={`style-btn${o.bold ? ' on' : ''}`} aria-pressed={o.bold} title="太字" onClick={() => setText(o, { bold: !o.bold }, '太字の切り替え')}>
              <b>B</b>
            </button>
            <button type="button" className={`style-btn${o.italic ? ' on' : ''}`} aria-pressed={o.italic} title="斜体" onClick={() => setText(o, { italic: !o.italic }, '斜体の切り替え')}>
              <i>I</i>
            </button>
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} type="button" className={`style-btn${o.align === a ? ' on' : ''}`} aria-pressed={o.align === a} title={{ left: '左揃え', center: '中央揃え', right: '右揃え' }[a]} onClick={() => setText(o, { align: a }, '揃えの変更')}>
                {{ left: '左', center: '中', right: '右' }[a]}
              </button>
            ))}
          </span>
        </Field>
        <Field label="色">
          <ColorInput label="文字色" value={o.color} onChange={(c) => set(o.id, { color: c ?? '#000000' } as Partial<SceneObject>, '文字色の変更', 'color')} />
        </Field>
        <Field label="文字間隔">
          <NumberInput label="文字間隔" value={o.letterSpacing} min={-100} max={1000} precision={1} suffix="px" onCommit={(letterSpacing) => setText(o, { letterSpacing }, '文字間隔の変更')} />
        </Field>
        <Field label="行間">
          <NumberInput label="行間" value={o.lineHeight} min={0.5} max={5} step={0.1} precision={2} suffix="倍" onCommit={(lineHeight) => setText(o, { lineHeight }, '行間の変更')} />
        </Field>
      </div>
    </>
  );
}

function ImageSection({ o }: { o: ImageObject }) {
  const meta = useEditor((s) => s.doc.assets[o.assetId]);
  const comparing = useEditor((s) => s.compareImageId === o.id);
  const a = o.pipeline.adjust;
  const adj = (key: keyof Omit<ColorAdjust, 'auto'>, label: string) => (
    <Field label={label}>
      <SliderInput label={label} value={a[key]} min={-100} max={100} onChange={(v) => setAdjust(editor, o.id, { [key]: v }, `${label}の変更`, key)} />
    </Field>
  );
  const out = meta ? pipelineOutputSize(o.pipeline, meta.width, meta.height) : null;
  const stopCompare = () => editor.set({ compareImageId: null });
  return (
    <>
      <div className="prop-section">
        <span className="hint">
          元画像: {meta ? `${meta.width} × ${meta.height} px` : '不明'}
          {out && (o.pipeline.crop || o.pipeline.resize) ? ` → 現在 ${out.width} × ${out.height} px` : ''}
          {o.pipeline.resize ? `（${METHOD_LABELS[o.pipeline.resize.method].label}）` : ''}
        </span>
        <button type="button" onClick={() => openDialog({ kind: 'image-size', imageId: o.id })}>
          画像サイズ…
        </button>
      </div>
      <div className="prop-section adjust-grid">
        {adj('brightness', '明るさ')}
        {adj('contrast', 'コントラスト')}
        {adj('saturation', '彩度')}
        {adj('temperature', '色温度')}
        {adj('tint', '色かぶり補正')}
        <Field label="ぼかし">
          <SliderInput label="ぼかし" value={o.pipeline.blur} min={0} max={100} step={0.5} precision={1} suffix="px" onChange={(v) => setImageBlur(editor, o.id, v)} />
        </Field>
      </div>
      <div className="prop-section">
        <button type="button" onClick={() => void autoColor(editor, o.id)}>
          自動カラー調整
        </button>
        {a.auto && (
          <button type="button" onClick={() => setAdjust(editor, o.id, { auto: null }, '自動カラー調整の解除')}>
            自動調整を解除
          </button>
        )}
        <button
          type="button"
          className={comparing ? 'on' : ''}
          title="押している間、加工前の画像を表示します"
          onPointerDown={() => editor.set({ compareImageId: o.id })}
          onPointerUp={stopCompare}
          onPointerLeave={stopCompare}
        >
          加工前と比較（押下中）
        </button>
        <button type="button" onClick={() => resetAdjust(editor, o.id)}>
          調整をリセット
        </button>
        {o.pipeline.localEdits.length > 0 && (
          <span className="hint">
            部分ぼかし {o.pipeline.localEdits.length} 件
            <button
              type="button"
              className="link-btn"
              onClick={() =>
                editor.edit('部分ぼかしの削除', (d) => {
                  const loc = findObject(d, o.id);
                  if (loc?.object.type === 'image') loc.object.pipeline.localEdits.pop();
                })
              }
            >
              最後の1件を削除
            </button>
          </span>
        )}
      </div>
    </>
  );
}

function EyedropperSection() {
  const target = useEditor((s) => s.eyedropperTarget);
  const picked = useEditor((s) => s.pickedColor);
  return (
    <div className="prop-section" data-testid="eyedropper-panel">
      <span className="hint">キャンバス上をクリックして色を取得し、選択中の図形・テキストに適用します。</span>
      <div className="radio-row" role="radiogroup" aria-label="図形への適用先">
        <label>
          <input type="radio" checked={target === 'fill'} onChange={() => editor.set({ eyedropperTarget: 'fill' })} /> 塗り
        </label>
        <label>
          <input type="radio" checked={target === 'stroke'} onChange={() => editor.set({ eyedropperTarget: 'stroke' })} /> 線
        </label>
      </div>
      {picked && (
        <span className="picked">
          取得した色 <span className="swatch" style={{ background: picked }} /> <code data-testid="picked-color">{picked}</code>
        </span>
      )}
    </div>
  );
}

function DocumentSection() {
  const doc = useEditor((s) => s.doc);
  const bg = doc.background;
  return (
    <div className="prop-section">
      <span className="hint">
        キャンバス {doc.width} × {doc.height} px
      </span>
      <button type="button" onClick={() => openDialog({ kind: 'canvas-size' })}>
        キャンバスサイズ…
      </button>
      <Toggle
        checked={bg.kind === 'transparent'}
        onChange={(t) =>
          editor.edit('背景の変更', (d) => {
            d.background = t ? { kind: 'transparent' } : { kind: 'color', color: '#ffffff' };
          })
        }
      >
        透明な背景
      </Toggle>
      {bg.kind === 'color' && (
        <Field label="背景色">
          <ColorInput
            label="背景色"
            value={bg.color}
            onChange={(c) =>
              editor.edit(
                '背景色の変更',
                (d) => {
                  d.background = { kind: 'color', color: c ?? '#ffffff' };
                },
                'background',
              )
            }
          />
        </Field>
      )}
    </div>
  );
}

function CropSection() {
  const crop = useEditor((s) => s.crop);
  if (!crop) return null;
  const r = crop.rect;
  const setRect = (patch: Partial<NonNullable<typeof r>>) => r && editor.set({ crop: { ...crop, rect: { ...r, ...patch } } });
  return (
    <div className="prop-section" data-testid="crop-panel">
      <div className="radio-row" role="radiogroup" aria-label="トリミング対象">
        <label>
          <input type="radio" checked={crop.target === 'document'} onChange={() => setCropTarget(editor, 'document')} /> キャンバス全体
        </label>
        <label>
          <input type="radio" checked={crop.target === 'image'} onChange={() => setCropTarget(editor, 'image')} /> 選択中の画像のみ
        </label>
      </div>
      {r ? (
        <>
          <Field label="X">
            <NumberInput label="トリミング X" value={r.x} onCommit={(x) => setRect({ x })} />
          </Field>
          <Field label="Y">
            <NumberInput label="トリミング Y" value={r.y} onCommit={(y) => setRect({ y })} />
          </Field>
          <Field label="幅">
            <NumberInput label="トリミング幅" value={r.width} min={1} suffix="px" onCommit={(width) => setRect({ width })} />
          </Field>
          <Field label="高さ">
            <NumberInput label="トリミング高さ" value={r.height} min={1} suffix="px" onCommit={(height) => setRect({ height })} />
          </Field>
          <button type="button" className="primary" onClick={() => commitCrop(editor)}>
            確定（Enter）
          </button>
          <button type="button" onClick={() => cancelCrop(editor)}>
            キャンセル（Esc）
          </button>
        </>
      ) : (
        <span className="hint">
          {crop.target === 'document'
            ? 'ドラッグでキャンバスの切り抜き範囲を指定します。'
            : 'ドラッグで画像の切り抜き範囲を指定します（他のオブジェクトやキャンバスは変わりません）。'}
        </span>
      )}
    </div>
  );
}

function PixelSelectionSection() {
  const sel = useEditor((s) => s.pixelSelection);
  if (!sel) return null;
  const target = pixelTargetImage(editor);
  return (
    <div className="prop-section" data-testid="selection-panel">
      <span className="hint">範囲選択：{target ? `対象画像「${target.name}」` : '対象画像なし'}</span>
      <button type="button" disabled={!target} onClick={() => openDialog({ kind: 'blur-selection' })}>
        選択範囲にぼかし…
      </button>
      <button type="button" onClick={() => editor.set({ pixelSelection: null })}>
        選択解除
      </button>
    </div>
  );
}

function EffectsSection({ o }: { o: ShapeObject | PathObject | TextObject }) {
  const e = o.effects;
  const setFx = (patch: Partial<Effects>, label: string, key?: string) =>
    set(o.id, { effects: { ...e, ...patch } } as Partial<SceneObject>, label, key);
  const glow = (p: Partial<Effects['glow']>, key?: string) => setFx({ glow: { ...e.glow, ...p } }, 'グローの変更', key && `glow-${key}`);
  const shadow = (p: Partial<Effects['dropShadow']>, key?: string) =>
    setFx({ dropShadow: { ...e.dropShadow, ...p } }, 'ドロップシャドウの変更', key && `shadow-${key}`);
  return (
    <>
      <div className="prop-section effect">
        <Toggle checked={e.glow.enabled} onChange={(enabled) => glow({ enabled })}>
          グロー
        </Toggle>
        {e.glow.enabled && (
          <>
            <Field label="色">
              <ColorInput label="グローの色" value={e.glow.color} onChange={(c) => glow({ color: c ?? '#ffffff' }, 'color')} />
            </Field>
            <Field label="ぼかし">
              <SliderInput label="グローのぼかし" value={e.glow.blur} min={0} max={50} suffix="px" onChange={(blur) => glow({ blur }, 'blur')} />
            </Field>
            <Field label="広がり">
              <SliderInput label="グローの広がり" value={e.glow.spread} min={0} max={30} suffix="px" onChange={(spread) => glow({ spread }, 'spread')} />
            </Field>
            <Field label="強さ">
              <SliderInput label="グローの強さ" value={Math.round(e.glow.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => glow({ opacity: v / 100 }, 'opacity')} />
            </Field>
          </>
        )}
      </div>
      <div className="prop-section effect">
        <Toggle checked={e.dropShadow.enabled} onChange={(enabled) => shadow({ enabled })}>
          ドロップシャドウ
        </Toggle>
        {e.dropShadow.enabled && (
          <>
            <Field label="色">
              <ColorInput label="影の色" value={e.dropShadow.color} onChange={(c) => shadow({ color: c ?? '#000000' }, 'color')} />
            </Field>
            <Field label="不透明度">
              <SliderInput label="影の不透明度" value={Math.round(e.dropShadow.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => shadow({ opacity: v / 100 }, 'opacity')} />
            </Field>
            <Field label="角度">
              <SliderInput label="影の角度" value={e.dropShadow.angle} min={-180} max={180} suffix="°" onChange={(angle) => shadow({ angle }, 'angle')} />
            </Field>
            <Field label="距離">
              <SliderInput label="影の距離" value={e.dropShadow.distance} min={0} max={100} suffix="px" onChange={(distance) => shadow({ distance }, 'distance')} />
            </Field>
            <Field label="ぼかし">
              <SliderInput label="影のぼかし" value={e.dropShadow.blur} min={0} max={50} suffix="px" onChange={(blur) => shadow({ blur }, 'blur')} />
            </Field>
          </>
        )}
      </div>
    </>
  );
}

const ALIGN: { op: AlignOp; label: string }[] = [
  { op: 'left', label: '左揃え' },
  { op: 'hcenter', label: '左右中央' },
  { op: 'right', label: '右揃え' },
  { op: 'top', label: '上揃え' },
  { op: 'vcenter', label: '上下中央' },
  { op: 'bottom', label: '下揃え' },
];

export function AlignButtons({ single }: { single: boolean }) {
  return (
    <span className="button-row" title={single ? 'キャンバスに対して整列' : '選択範囲に対して整列'}>
      {ALIGN.map((a) => (
        <button key={a.op} type="button" className="align-btn" onClick={() => alignSelection(editor, a.op)}>
          {a.label}
        </button>
      ))}
    </span>
  );
}

function MultiSection({ ids, objects }: { ids: Id[]; objects: SceneObject[] }) {
  const b = unionBounds(objects);
  const hasGroup = objects.some((o) => o.type === 'group');
  const move = (dx: number, dy: number) =>
    editor.edit('移動', (d) => transformObjects(d, ids, { pivot: { x: 0, y: 0 }, sx: 1, sy: 1, rotation: 0, dx, dy }));
  return (
    <div className="prop-section">
      <span className="hint">{objects.length === 1 ? 'グループ' : `${objects.length} 個のオブジェクト`}</span>
      {b && (
        <>
          <Field label="X">
            <NumberInput label="X" value={b.x} precision={1} onCommit={(x) => move(x - b.x, 0)} />
          </Field>
          <Field label="Y">
            <NumberInput label="Y" value={b.y} precision={1} onCommit={(y) => move(0, y - b.y)} />
          </Field>
          <span className="hint">
            {Math.round(b.width)} × {Math.round(b.height)} px
          </span>
        </>
      )}
      <Field label="整列" group>
        <AlignButtons single={objects.length === 1} />
      </Field>
      {objects.length > 1 && (
        <button type="button" onClick={() => groupSelection(editor)}>
          グループ化
        </button>
      )}
      {hasGroup && (
        <button type="button" onClick={() => ungroupSelection(editor)}>
          グループ解除
        </button>
      )}
      {objects.length === 1 && (
        <Field label="不透明度">
          <SliderInput
            label="不透明度"
            value={Math.round(objects[0].opacity * 100)}
            min={0}
            max={100}
            suffix="%"
            onChange={(v) => set(objects[0].id, { opacity: v / 100 }, '不透明度の変更', 'opacity')}
          />
        </Field>
      )}
    </div>
  );
}
