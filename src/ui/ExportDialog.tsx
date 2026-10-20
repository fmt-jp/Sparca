// Export dialog (spec §13.2): PNG / JPEG / WebP, quality, transparency handling.
import { useState } from 'react';
import { exportImage, ExportError, FORMAT_INFO, type ExportFormat } from '../io/export';
import { isAbort, saveBlob } from '../io/files';
import { ColorInput, Field, SliderInput } from './controls';
import { Dialog } from './Dialog';
import { editor, useEditor } from './useEditor';

const FORMATS = Object.keys(FORMAT_INFO) as ExportFormat[];

function baseName(fileName: string): string {
  const n = fileName.replace(/\.sparca$/i, '');
  return n === '名称未設定' ? 'untitled' : n;
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const fileName = useEditor((s) => s.fileName);
  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState(90);
  const [jpegBackground, setJpegBackground] = useState(doc.background.kind === 'color' ? doc.background.color : '#ffffff');
  const [name, setName] = useState(baseName(fileName));
  const info = FORMAT_INFO[format];
  const transparent = doc.background.kind === 'transparent';

  async function run() {
    const outName = `${name.trim() || 'untitled'}.${info.ext}`;
    try {
      editor.set({ busy: `${info.label} に書き出し中…` });
      const blob = await exportImage(doc, { format, quality, jpegBackground });
      const handle = await saveBlob(blob, outName, { description: `${info.label} 画像`, accept: { [info.mime]: [`.${info.ext}`] } });
      if (handle === undefined) return;
      editor.notify('info', `${outName} を書き出しました（${(blob.size / 1024).toFixed(0)} KB）。`);
      onClose();
    } catch (e) {
      if (isAbort(e)) return;
      editor.notify('error', e instanceof ExportError ? e.message : `書き出しに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      editor.set({ busy: null });
    }
  }

  return (
    <Dialog
      title="画像として書き出し"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className="primary" onClick={() => void run()}>
            書き出し
          </button>
        </>
      }
    >
      <div className="notice-inline" role="note">
        書き出した画像は1枚に合成され、レイヤー構造や編集情報（テキスト・図形・調整値）は含まれません。
        後から編集するには「ファイル → 保存」で .sparca プロジェクトとして保存してください。
      </div>
      <Field label="ファイル名">
        <input aria-label="ファイル名" value={name} onChange={(e) => setName(e.target.value)} />
        <span className="suffix">.{info.ext}</span>
      </Field>
      <div className="radio-row" role="radiogroup" aria-label="形式">
        {FORMATS.map((f) => (
          <label key={f}>
            <input type="radio" name="format" checked={format === f} onChange={() => setFormat(f)} /> {FORMAT_INFO[f].label}
          </label>
        ))}
      </div>
      {info.lossy && (
        <Field label="品質">
          <SliderInput label="品質" value={quality} min={1} max={100} onChange={setQuality} />
        </Field>
      )}
      {format === 'png' && <div className="hint">{transparent ? '透明な背景は透明のまま書き出します。' : '背景色で塗りつぶした状態で書き出します。'}</div>}
      {format === 'webp' && <div className="hint">透明部分は透明のまま書き出します。</div>}
      {format === 'jpeg' && (
        <>
          <div className="hint">JPEG は透明に対応していないため、透明な部分を次の色で塗りつぶします。</div>
          <Field label="透明部分の色">
            <ColorInput label="透明部分の色" value={jpegBackground} onChange={(c) => setJpegBackground(c ?? '#ffffff')} />
          </Field>
        </>
      )}
      <div className="hint">
        書き出し範囲: キャンバス全体 {doc.width} × {doc.height} px（キャンバス外のオブジェクトは含まれません）
      </div>
    </Dialog>
  );
}
