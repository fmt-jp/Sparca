// Export dialog (spec §13.2): PNG / JPEG / WebP / SVG, quality, transparency handling.
import { useState } from 'react';
import { exportImage, ExportError, FORMAT_INFO, type ExportFormat } from '../io/export';
import { hasFileSystemAccess, isAbort, pickSaveFile, saveBlob } from '../io/files';
import { ColorInput, Field, SliderInput } from './controls';
import { Dialog } from './Dialog';
import { editor, useEditor } from './useEditor';

const FORMATS = Object.keys(FORMAT_INFO) as ExportFormat[];

function baseName(fileName: string): string {
  const n = fileName.replace(/\.hnb$/i, '');
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
  // Where the browser asks for the place and name to save, the name is chosen there only;
  // otherwise (the file is downloaded) it is entered here.
  const askName = !hasFileSystemAccess();

  async function run() {
    const suggested = `${(askName ? name.trim() : '') || baseName(fileName) || 'untitled'}.${info.ext}`;
    const type = { description: `${info.label} 画像`, accept: { [info.mime]: [`.${info.ext}`] } };
    try {
      const target = await pickSaveFile(suggested, type);
      if (target === undefined) return;
      editor.set({ busy: `${info.label} に書き出し中…` });
      const blob = await exportImage(doc, { format, quality, jpegBackground });
      const handle = await saveBlob(blob, suggested, type, target);
      if (handle === undefined) return;
      editor.notify('info', `${handle?.name ?? suggested} を書き出しました（${(blob.size / 1024).toFixed(0)} KB）。`);
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
      {format === 'svg' ? (
        <div className="notice-inline" role="note">
          SVG は図形・パス・テキストをベクターのまま書き出します（Web ページなどにそのまま使えます）。HANABI で読み込み直して編集することはできないため、
          後から編集するには「ファイル → 保存」で .hnb プロジェクトとして保存してください。
        </div>
      ) : (
        <div className="notice-inline" role="note">
          書き出した画像は1枚に合成され、レイヤー構造や編集情報（テキスト・図形・調整値）は含まれません。
          後から編集するには「ファイル → 保存」で .hnb プロジェクトとして保存してください。
        </div>
      )}
      <div className="radio-row" role="radiogroup" aria-label="形式">
        {FORMATS.map((f) => (
          <label key={f}>
            <input type="radio" name="format" checked={format === f} onChange={() => setFormat(f)} /> {FORMAT_INFO[f].label}
          </label>
        ))}
      </div>
      {askName && (
        <Field label="ファイル名">
          <input aria-label="ファイル名" value={name} onChange={(e) => setName(e.target.value)} />
          <span className="suffix">.{info.ext}</span>
        </Field>
      )}
      {info.lossy && (
        <Field label="品質">
          <SliderInput label="品質" value={quality} min={1} max={100} onChange={setQuality} />
        </Field>
      )}
      {format === 'png' && <div className="hint">{transparent ? '透明な背景は透明のまま書き出します。' : '背景色で塗りつぶした状態で書き出します。'}</div>}
      {format === 'webp' && <div className="hint">透明部分は透明のまま書き出します。</div>}
      {format === 'svg' && (
        <ul className="hint export-svg-notes">
          <li>テキストは文字のまま書き出します。見る PC にそのフォントがないと、別のフォントで表示されます。</li>
          <li>写真などの画像は SVG の中に埋め込みます（カラー調整・部分加工を反映）。画像が多いとファイルが大きくなります。</li>
          <li>エフェクトは SVG のフィルターとして書き出します。ブラウザでは同じ見た目になりますが、ほかのソフトでは一部が異なって表示されることがあります。</li>
          <li>レイヤーはレイヤー名付きのグループになります。非表示のレイヤー・オブジェクトは含みません。{transparent ? '背景は透明のままです。' : '背景色は四角形として入ります。'}</li>
        </ul>
      )}
      {format === 'jpeg' && (
        <>
          <div className="hint">JPEG は透明に対応していないため、透明な部分を次の色で塗りつぶします。</div>
          <Field label="透明部分の色">
            <ColorInput label="透明部分の色" value={jpegBackground} onChange={(c) => setJpegBackground(c ?? '#ffffff')} />
          </Field>
        </>
      )}
      {!askName && <div className="hint">「書き出し」を押すと、保存先とファイル名を選ぶ画面が開きます。</div>}
      <div className="hint">
        書き出し範囲: キャンバス全体 {doc.width} × {doc.height} px（キャンバス外のオブジェクトは含まれません）
      </div>
    </Dialog>
  );
}
