// ヘルプ → 操作ガイド: the basics of HANABI by topic, plus the keyboard shortcuts.
import { useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const ALT = IS_MAC ? '⌥' : 'Alt+';

const K = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>;

interface Section {
  id: string;
  title: string;
  body: ReactNode;
}

export const HELP_SECTIONS: Section[] = [
  {
    id: 'start',
    title: 'はじめに',
    body: (
      <>
        <p>HANABI は、写真などの画像（ラスター）と、図形・テキスト（ベクター）を同じキャンバスで編集できるグラフィックエディタです。作ったオブジェクトは後から何度でも選び直して編集できます。</p>
        <h4>基本の流れ</h4>
        <ol>
          <li>「ファイル」→「新規…」でキャンバスを作るか、「開く…」で画像やプロジェクト（.hnb）を開く。</li>
          <li>「画像を配置…」やドラッグ＆ドロップ、<K>{MOD}V</K> で画像を置き、左のツールで図形やテキストを描く。</li>
          <li>オブジェクトを選んで、下のプロパティパネルで色・大きさ・エフェクトなどを調整する。</li>
          <li>「保存」（<K>{MOD}S</K>）でプロジェクト（.hnb）として保存すると、あとで続きから編集できる。</li>
          <li>「画像として書き出し…」（<K>{MOD}Shift+E</K>）で PNG／JPEG／WebP に書き出す。</li>
        </ol>
        <p>操作を間違えても <K>{MOD}Z</K>（取り消し）／<K>{MOD}Shift+Z</K>（やり直し）で戻せます。</p>
      </>
    ),
  },
  {
    id: 'screen',
    title: '画面の見かた',
    body: (
      <ul>
        <li><b>上</b>：メニューバー、取り消し／やり直し、表示倍率。タブで複数のドキュメントを切り替え。</li>
        <li><b>左</b>：ツールバー。ボタンにマウスを乗せると名前とショートカットキーが出る。右下に小さな三角があるボタンは長押し（または同じキーを繰り返し）で同じグループの別ツールに切り替え。</li>
        <li><b>中央</b>：キャンバス。灰色の部分は作業領域で、書き出されるのはキャンバスの範囲だけ。</li>
        <li><b>右</b>：レイヤーパネル。オブジェクトの重なり順・表示・ロックを管理する。</li>
        <li><b>下</b>：プロパティパネル。選択中のツールやオブジェクトに合わせて設定項目が変わる。</li>
        <li>キャンバスを広く使いたいときは <K>F4</K> で右と下のパネルを隠す／表示する（パネルの端のタブで片方ずつも可）。</li>
      </ul>
    ),
  },
  {
    id: 'view',
    title: '表示の拡大・移動',
    body: (
      <ul>
        <li>拡大・縮小：<K>{MOD}+</K>／<K>{MOD}-</K>、<K>{MOD}</K>を押しながらホイール（マウスの位置を中心に）、ズームツール（<K>Z</K>。<K>{ALT}</K>クリックで縮小）。</li>
        <li><K>{MOD}0</K> で全体表示、<K>{MOD}1</K> で 100%。上部の倍率欄からも選べる。</li>
        <li>表示位置の移動：<K>Space</K> を押しながらドラッグ、手のひらツール（<K>H</K>）、スクロール。</li>
        <li>グリッド：「表示」→「グリッドを表示」「グリッドにスナップ」「グリッド設定…」。</li>
      </ul>
    ),
  },
  {
    id: 'objects',
    title: '選択・移動・変形',
    body: (
      <ul>
        <li>選択ツール（<K>V</K>）でクリックして選択。<K>Shift</K>+クリックで追加選択、何もない所からドラッグで範囲内をまとめて選択。</li>
        <li>ドラッグで移動、矢印キーで 1px、<K>Shift</K>+矢印で 10px 移動。</li>
        <li>四隅・辺のハンドルで拡大縮小（<K>Shift</K> で縦横比固定、<K>{ALT}</K> で中心から）。上に出る丸いハンドルをドラッグすると回転（<K>Shift</K> で 15° 刻み）。</li>
        <li>位置・大きさ・回転・不透明度は、プロパティパネルに数値でも入力できる。</li>
        <li>複製 <K>{MOD}D</K>、削除 <K>Delete</K>、コピー／カット／ペースト <K>{MOD}C</K>／<K>{MOD}X</K>／<K>{MOD}V</K>。</li>
        <li>グループ化 <K>{MOD}G</K>、解除 <K>{MOD}Shift+G</K>。重なり順は <K>{MOD}]</K>／<K>{MOD}[</K>（<K>Shift</K> で最前面・最背面）。</li>
        <li>整列：「変更」メニュー、プロパティパネルのボタン、<K>{MOD}{ALT}1</K>〜<K>6</K>（均等配置は <K>7</K>・<K>9</K>）。</li>
        <li>右クリック（または <K>Shift+F10</K>）で、その場で使える操作のメニューが出る。</li>
      </ul>
    ),
  },
  {
    id: 'draw',
    title: '図形・テキスト・パス',
    body: (
      <ul>
        <li>図形ツール（<K>R</K>）：矩形・角丸矩形・楕円・多角形・星・矢印。ドラッグで描く（<K>Shift</K> で正方形／正円、<K>{ALT}</K> で中心から）。<K>R</K> を繰り返し押すと種類が切り替わる。</li>
        <li>ラインツール（<K>N</K>）：直線。<K>Shift</K> で 45° 刻み。</li>
        <li>塗り・線の色、線幅、角の丸み、頂点数などはプロパティパネルで変更。塗りはグラデーション（線形・放射・円錐）も使える。</li>
        <li>テキストツール（<K>T</K>）：クリックした位置に入力。<K>Esc</K> または <K>{MOD}Enter</K> で確定。既存のテキストはクリックで編集。フォント（この PC のフォント）・大きさ・色・揃え・文字間隔・行間はプロパティパネルで。</li>
        <li>ペンツール（<K>P</K>）：クリックで角の点、ドラッグで曲線の点。始点をクリックすると閉じたパス、<K>Enter</K>／<K>Esc</K>／ダブルクリックで開いたパスとして終了。</li>
        <li>部分選択ツール（<K>A</K>）：パスの点（アンカー）を移動・追加・削除。点をダブルクリックで角／曲線の切り替え。選択ツールでパスをダブルクリックしても編集に入れる。</li>
        <li>スポイト（<K>I</K>）：クリックした位置の色を、選択中の図形・テキストの塗り（または線）に使う。</li>
      </ul>
    ),
  },
  {
    id: 'layers',
    title: 'レイヤー',
    body: (
      <ul>
        <li>右のレイヤーパネルに、レイヤーとその中のオブジェクトが上（前面）から順に並ぶ。</li>
        <li>上部のボタンでレイヤーの追加・複製・削除。名前はダブルクリックで変更。</li>
        <li>目のアイコンで表示／非表示、鍵のアイコンでロック（ロック中は選択・編集できない）。</li>
        <li>行をドラッグして重なり順やレイヤーを変更。行をクリックするとそのオブジェクトを選択。</li>
        <li>新しいオブジェクトは選択中のレイヤーに入る。</li>
      </ul>
    ),
  },
  {
    id: 'image',
    title: '画像の加工',
    body: (
      <>
        <p>画像の加工は元の画像を書き換えずに編集情報として保存されるので、後から何度でも調整し直したり、元に戻したりできます。</p>
        <ul>
          <li><b>カラー調整</b>：画像を選ぶとプロパティパネルに「明るさ」「コントラスト」「彩度」「色温度」「色かぶり補正」と「自動カラー調整」が出る。「加工前と比較」を押している間は元の画像を表示。</li>
          <li><b>画像サイズ</b>：「変更」→「画像サイズ…」。ピクセルまたは % で指定し、補間方式（初期値はバイキュービック）を選べる。</li>
          <li><b>キャンバスサイズ</b>：「変更」→「キャンバスサイズ…」。9 点の基準位置を選んで広げる／狭める（中の画像や図形は拡大縮小されない）。</li>
          <li><b>トリミング</b>（<K>C</K>）：ドラッグで範囲を決めて <K>Enter</K>。画像を選んでいるとその画像だけ、選んでいないとキャンバス全体を切り抜く。</li>
          <li><b>ぼかし・グレースケール・セピアなど</b>：エフェクトとして付ける（「エフェクト」の項を参照）。</li>
        </ul>
      </>
    ),
  },
  {
    id: 'selection',
    title: '範囲選択',
    body: (
      <ul>
        <li>矩形・楕円選択（<K>M</K>）、投げ縄・多角形選択（<K>L</K>）で画像の一部を選ぶ。同じキーを繰り返すと種類が切り替わる。<K>Esc</K> で解除。</li>
        <li>選択ツールのプロパティの「エッジ」で、ハード／アンチエイリアス／ぼかし（幅 0〜100px）を選べる。</li>
        <li>「画像」→「選択範囲を拡張…」「選択範囲を縮小…」で輪郭を px 単位で動かせる。</li>
        <li>「画像」→「選択範囲にぼかし…」「選択範囲にモザイク…」で選んだ部分だけを加工（プレビューで確認してから適用）。</li>
        <li>範囲選択中に <K>{MOD}C</K> で選んだ部分の画素をコピーし、<K>{MOD}V</K> で同じ位置に新しい画像として貼り付け（他のアプリにも貼り付け可）。</li>
        <li>範囲選択（画素）とオブジェクトの選択は別のもの。範囲選択は画像の加工やコピーに使う。</li>
      </ul>
    ),
  },
  {
    id: 'effects',
    title: 'エフェクト',
    body: (
      <ul>
        <li>オブジェクトを選び、プロパティパネルの「エフェクト」の「＋」から追加（ドロップシャドウ・グロー・ベベル・ぼかし・色の調整・トーンカーブなど）。</li>
        <li>いくつでも重ねられ、上から順に適用される。ドラッグで順番を入れ替え、チェックで一時的にオフ、強さを調整できる。</li>
        <li>エフェクトも編集情報として保存されるので、後から設定を変えたり外したりできる。</li>
      </ul>
    ),
  },
  {
    id: 'files',
    title: '保存・書き出し',
    body: (
      <ul>
        <li><b>保存</b>（<K>{MOD}S</K>）：HANABI のプロジェクト形式（.hnb）で保存。レイヤー・オブジェクト・テキスト・エフェクト・画像データ・加工の設定がすべて入り、開き直して続きを編集できる。</li>
        <li><b>開く</b>（<K>{MOD}O</K>）：.hnb のほか、PNG・JPEG・GIF・BMP の画像を新しいドキュメントとして開ける。</li>
        <li><b>画像として書き出し</b>（<K>{MOD}Shift+E</K>）：PNG（透明対応）・JPEG・WebP。キャンバスの範囲を 1 枚の画像にまとめるため、レイヤーなどの編集情報は含まれない。続きを編集したいときは .hnb でも保存しておく。</li>
        <li>保存していない変更があると、タブとタイトルに ● が付き、閉じる前に確認が出る。</li>
      </ul>
    ),
  },
  {
    id: 'shortcuts',
    title: 'キーボードショートカット',
    body: (
      <table className="help-keys">
        <tbody>
          {(
            [
              ['ツール', 'V 選択 ／ A 部分選択 ／ C トリミング ／ M 範囲選択 ／ L 投げ縄 ／ N ライン ／ P ペン ／ R 図形 ／ T テキスト ／ I スポイト ／ H 手のひら ／ Z ズーム（同じキーで同じグループ内を切り替え）'],
              ['一時的に手のひら', 'Space を押しながらドラッグ'],
              ['取り消し／やり直し', `${MOD}Z ／ ${MOD}Shift+Z（${MOD}Y）`],
              ['コピー／カット／ペースト', `${MOD}C ／ ${MOD}X ／ ${MOD}V`],
              ['複製／削除', `${MOD}D ／ Delete`],
              ['すべてを選択／選択解除', `${MOD}A ／ Esc`],
              ['グループ化／解除', `${MOD}G ／ ${MOD}Shift+G`],
              ['重なり順', `${MOD}] 前面へ ／ ${MOD}[ 背面へ（Shift で最前面・最背面）`],
              ['整列', `${MOD}${ALT}1 左 ／ 2 横中央 ／ 3 右 ／ 4 上 ／ 5 縦中央 ／ 6 下 ／ 7 均等（幅） ／ 9 均等（高さ）`],
              ['移動', '矢印キーで 1px、Shift+矢印で 10px'],
              ['描画・変形中', `Shift：縦横比固定・角度を刻む ／ ${ALT}：中心から`],
              ['ズーム', `${MOD}+ ／ ${MOD}- ／ ${MOD}0 全体 ／ ${MOD}1 100%、${MOD}+ホイール`],
              ['保存／名前を付けて保存', `${MOD}S ／ ${MOD}Shift+S`],
              ['開く／画像を配置／書き出し', `${MOD}O ／ ${MOD}Shift+I ／ ${MOD}Shift+E`],
              ['トリミングの確定／取消', 'Enter ／ Esc'],
              ['右クリックメニュー', '右クリック、Menu キー、Shift+F10'],
              ['パネルを隠す／表示', 'F4'],
              ['操作ガイド', 'F1'],
            ] as const
          ).map(([what, keys]) => (
            <tr key={what}>
              <th>{what}</th>
              <td>{keys}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
  },
];

export function HelpDialog({ section, onClose }: { section?: string; onClose: () => void }) {
  const [current, setCurrent] = useState(HELP_SECTIONS.some((s) => s.id === section) ? section! : HELP_SECTIONS[0].id);
  const sec = HELP_SECTIONS.find((s) => s.id === current)!;
  return (
    <Dialog
      title="操作ガイド"
      className="help-dialog"
      onClose={onClose}
      footer={
        <button type="button" className="primary" onClick={onClose}>
          閉じる
        </button>
      }
    >
      <div className="help-layout">
        <nav className="help-nav" aria-label="項目">
          {HELP_SECTIONS.map((s) => (
            <button key={s.id} type="button" aria-current={s.id === current ? 'page' : undefined} className={s.id === current ? 'active' : ''} onClick={() => setCurrent(s.id)}>
              {s.title}
            </button>
          ))}
        </nav>
        <article className="help-content" aria-label={sec.title}>
          <h3>{sec.title}</h3>
          {sec.body}
        </article>
      </div>
    </Dialog>
  );
}
