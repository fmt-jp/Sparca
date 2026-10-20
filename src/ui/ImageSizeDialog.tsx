// Image size dialog (spec §7.1, §7.2): pixel or percentage mode, aspect lock,
// interpolation method, and a 1:1 before/after preview of the center of the image.
import { useEffect, useState } from 'react';
import { coversCanvas, croppedSourceSize } from '../model/imageOps';
import { findObject } from '../model/tree';
import type { ImageObject, ResampleMethod } from '../model/types';
import { METHOD_LABELS } from '../engine/resample';
import { imageCache } from '../render/imageCache';
import { validateDimensions } from '../store/assets';
import { resizeImage } from '../store/imageActions';
import { Field, NumberInput, Toggle } from './controls';
import { Dialog } from './Dialog';
import { editor, useEditor } from './useEditor';

const METHODS = Object.keys(METHOD_LABELS) as ResampleMethod[];

export function ImageSizeDialog({ imageId, onClose }: { imageId: string; onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const obj = findObject(doc, imageId)?.object as ImageObject | undefined;
  const meta = obj ? doc.assets[obj.assetId] : undefined;
  const base = obj && meta ? croppedSourceSize(obj, meta.width, meta.height) : { width: 1, height: 1 };
  const current = obj?.pipeline.resize ?? { ...base, method: 'bicubic' as ResampleMethod };

  const [mode, setMode] = useState<'pixels' | 'percent'>('pixels');
  const [lock, setLock] = useState(true);
  const [width, setWidth] = useState(current.width);
  const [height, setHeight] = useState(current.height);
  const [method, setMethod] = useState<ResampleMethod>(current.method);
  // On by default when the image fills the canvas exactly (e.g. a photo opened as a document).
  const [fitCanvas, setFitCanvas] = useState(() => coversCanvas(doc, imageId));

  const pctW = (width / base.width) * 100;
  const pctH = (height / base.height) * 100;
  const problem = validateDimensions(width, height);

  function setW(w: number) {
    setWidth(Math.round(w));
    if (lock) setHeight(Math.max(1, Math.round((w * base.height) / base.width)));
  }
  function setH(h: number) {
    setHeight(Math.round(h));
    if (lock) setWidth(Math.max(1, Math.round((h * base.width) / base.height)));
  }

  if (!obj || !meta) return null;

  return (
    <Dialog
      title="画像サイズ"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="primary"
            disabled={!!problem}
            onClick={() => {
              if (resizeImage(editor, imageId, width, height, method, fitCanvas)) onClose();
            }}
          >
            適用
          </button>
        </>
      }
    >
      <div className="hint">
        元画像{obj.pipeline.crop ? '（トリミング後）' : ''}: {base.width} × {base.height} px
      </div>
      <div className="radio-row" role="radiogroup" aria-label="指定方法">
        <label>
          <input type="radio" checked={mode === 'pixels'} onChange={() => setMode('pixels')} /> ピクセル指定
        </label>
        <label>
          <input type="radio" checked={mode === 'percent'} onChange={() => setMode('percent')} /> 比率指定
        </label>
      </div>
      {mode === 'pixels' ? (
        <div className="field-row">
          <Field label="幅">
            <NumberInput label="幅" value={width} min={1} max={16384} suffix="px" onCommit={setW} />
          </Field>
          <Field label="高さ">
            <NumberInput label="高さ" value={height} min={1} max={16384} suffix="px" onCommit={setH} />
          </Field>
        </div>
      ) : lock ? (
        <Field label="拡大・縮小率">
          <NumberInput label="拡大・縮小率" value={pctW} min={0.1} max={10000} precision={2} suffix="%" onCommit={(p) => setW((base.width * p) / 100)} />
        </Field>
      ) : (
        <div className="field-row">
          <Field label="幅">
            <NumberInput label="幅の比率" value={pctW} min={0.1} max={10000} precision={2} suffix="%" onCommit={(p) => setW((base.width * p) / 100)} />
          </Field>
          <Field label="高さ">
            <NumberInput label="高さの比率" value={pctH} min={0.1} max={10000} precision={2} suffix="%" onCommit={(p) => setH((base.height * p) / 100)} />
          </Field>
        </div>
      )}
      <Toggle checked={lock} onChange={setLock}>
        縦横比を固定
      </Toggle>
      <Field label="補間方式">
        <select aria-label="補間方式" value={method} onChange={(e) => setMethod(e.target.value as ResampleMethod)}>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABELS[m].label}
            </option>
          ))}
        </select>
      </Field>
      <div className="hint">{METHOD_LABELS[method].use}</div>
      <Toggle checked={fitCanvas} onChange={setFitCanvas}>
        キャンバスサイズも画像に合わせる
      </Toggle>
      <div className="hint">
        {fitCanvas
          ? `キャンバスを ${width} × ${height} px にし、画像を左上に合わせます（他のオブジェクトも画像と一緒に移動、拡大縮小はしません）。`
          : `キャンバスは ${doc.width} × ${doc.height} px のままです。`}
      </div>
      <div className={problem ? 'error-text' : 'result-size'} data-testid="result-size">
        {problem ?? `処理後: ${width} × ${height} px（${pctW.toFixed(1)}% × ${pctH.toFixed(1)}%）`}
      </div>
      {!problem && <ResizePreview obj={obj} width={width} height={height} method={method} />}
    </Dialog>
  );
}

/** Center of the image at 100% before and after resizing, rendered by the real engine. */
function ResizePreview({ obj, width, height, method }: { obj: ImageObject; width: number; height: number; method: ResampleMethod }) {
  const [after, setAfter] = useState<string | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    const t = setTimeout(() => {
      const candidate: ImageObject = { ...obj, pipeline: { ...obj.pipeline, resize: { width, height, method } } };
      imageCache
        .fullBlob(candidate)
        .then((blob) => {
          if (cancelled) return;
          url = URL.createObjectURL(blob);
          setAfter(url);
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(e.message));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (url) URL.revokeObjectURL(url);
    };
  }, [obj, width, height, method]);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    const original: ImageObject = { ...obj, pipeline: { ...obj.pipeline, resize: null } };
    imageCache.fullBlob(original).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setBefore(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [obj]);

  return (
    <div className="resize-preview">
      <figure>
        <div className="preview-box" style={before ? { backgroundImage: `url(${before})` } : undefined} />
        <figcaption>変更前（100%・中央）</figcaption>
      </figure>
      <figure>
        <div className="preview-box" data-testid="resize-after" style={after ? { backgroundImage: `url(${after})` } : undefined}>
          {!after && !error && <span className="hint">生成中…</span>}
          {error && <span className="error-text">{error}</span>}
        </div>
        <figcaption>変更後（100%・中央）</figcaption>
      </figure>
    </div>
  );
}
