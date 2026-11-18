# HANABI を別の Web サイト・PC のローカルで動かす

HANABI は、ビルドすると `dist/` フォルダに HTML・JavaScript・CSS・アイコンだけが出てくる**静的なサイト**です。

- サーバー側のプログラムやデータベースはありません。
- 外部のサーバーとの通信もしません。フォントや部品もすべて `dist/` の中に入っています。
- ファイルの参照はすべて相対パスです（`vite.config.ts` の `base: './'`）。そのため、サイトの一番上（`https://example.com/`）にもサブフォルダ（`https://example.com/tools/hanabi/`）にも、そのまま置けます。

この文書は次の 3 部構成です。

1. ビルドする（`dist/` を作る）……どちらの方法でも最初に必要
2. 別の Web サイトに置く
3. PC のローカルで動かす（Windows・Linux）

---

## 1. ビルドする（`dist/` を作る）

ビルドは、**自分の PC のターミナル**で実行します。Windows では PowerShell、Linux では端末です。

### 1-1. Node.js を入れる（最初の 1 回だけ）

Node.js 22 以上が必要です（npm も一緒に入ります）。

**Windows**
- https://nodejs.org/ から「LTS」のインストーラーをダウンロードして実行する。
- または PowerShell で次を実行する。
  ```powershell
  winget install OpenJS.NodeJS.LTS
  ```
- インストール後、PowerShell を開き直して確かめます。
  ```powershell
  node -v    # v22.x.x 以上なら OK
  npm -v
  ```

**Linux（Ubuntu・Kubuntu など）**
- ディストリビューション標準の Node.js は古いことが多いので、nvm で入れるのがおすすめです。
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  # 端末を開き直してから
  nvm install 22
  node -v    # v22.x.x 以上なら OK
  ```

### 1-2. HANABI のソースを取ってくる

次のどちらかで取ってきます。

- **ZIP でダウンロード**：GitHub の `fmt-jp/Sparca` のページで「Code」→「Download ZIP」を押し、好きな場所に展開する（リポジトリが非公開の場合は、見る権限のあるアカウントでログインしておく）。
- **Git で取ってくる**：
  ```bash
  git clone https://github.com/fmt-jp/Sparca.git
  ```

### 1-3. ビルドする

ターミナルで、取ってきたフォルダ（`package.json` があるフォルダ）に移動してから、次を実行します。

**Windows（PowerShell）**
```powershell
cd $HOME\Downloads\Sparca-main   # 展開した場所に合わせる
npm ci
npm run build
```

**Linux**
```bash
cd ~/Sparca                      # 取ってきた場所に合わせる
npm ci
npm run build
```

- `npm ci` は、必要な部品をインターネットから取ってきます（数分かかることがあります。2 回目以降は不要）。
- `npm run build` が終わると、同じフォルダに `dist` フォルダができます。これが HANABI 本体です。
- `npm ci` が失敗するときは、代わりに `npm install` を使ってください。

> ソースを更新したとき（新しい版にしたいとき）は、1-2 で取り直してから `npm ci` と `npm run build` をやり直します。

---

## 2. 別の Web サイトに置く

### 2-1. 置き方

`dist` フォルダの**中身**（`index.html`・`assets/`・アイコンなど）を、Web サーバーの公開したい場所にアップロードします。

- 例：`dist` の中身を、サーバーの `public_html/tools/hanabi/` に置く → `https://example.com/tools/hanabi/` で開ける。
- レンタルサーバー（FTP でアップロード）、自社の Web サーバー（Apache・nginx など）、Netlify・Cloudflare Pages・Vercel などの静的サイトのサービス、Amazon S3 など、静的ファイルを置ける所ならどこでも動きます。
  - Netlify・Cloudflare Pages では、管理画面に `dist` フォルダをドラッグ＆ドロップするだけで公開できます。
- サーバー側で特別な設定は要りません。`.js` が JavaScript（`text/javascript`）として送られれば動きます（普通のサーバーは最初からそうなっています）。

### 2-2. 必ず HTTPS で公開する

次の機能は、ブラウザが **HTTPS（または localhost）** のページにしか使わせません。HTTP で公開すると、これらが使えなくなります。

| HTTPS で使える機能 | HTTP のとき |
|---|---|
| 上書き保存（File System Access API） | 保存はダウンロードになる（毎回新しいファイル） |
| 最近使ったファイル | 使えない |
| PC のフォント一覧、テキストのアウトライン化をフォントファイルから正確に行う（Local Font Access） | フォント一覧が限られ、アウトライン化は近似になる |
| メニューからのクリップボード画像の読み込み | 使えない（Ctrl+V は使える） |

多くのレンタルサーバー・静的サイトのサービスは、無料で HTTPS を使えます。

### 2-3. 推奨ブラウザ

Chrome・Edge（Chromium 系）を推奨します。Firefox・Safari でも基本的な編集はできますが、上書き保存や最近使ったファイルなどは、ブラウザの仕様で使えません。

### 2-4. 更新のしかた

新しい版にするときは、1-3 でビルドし直し、`dist` の中身でサーバーのファイルを置き換えます（古い `assets/` のファイルは消して構いません）。

> GitHub Pages と同じように、`main` に変更が入るたびに自動でビルドして別のサーバーへアップロードすることもできます（GitHub Actions の設定を追加します）。必要になったら相談してください。

---

## 3. PC のローカルで動かす（Windows・Linux）

インターネットに公開せず、自分の PC だけで使う方法です。1 のビルドまで済ませておきます。

### 3-1. いちばん簡単な方法（Node.js を使う）

ビルドしたフォルダで、次を実行します。

**Windows（PowerShell）・Linux 共通**
```bash
npm run preview
```

- 表示された `http://localhost:4173/` を Chrome か Edge で開きます。
- 使い終わったら、ターミナルで **Ctrl+C** を押して止めます。
- 次に使うときは、同じフォルダで `npm run preview` を実行するだけです（ビルドし直す必要はありません）。
- ポートを変えたいときは `npm run preview -- --port 8080` のようにします。

### 3-2. Node.js を使わない方法（Python などの簡単なサーバー）

`dist` フォルダだけを持っている場合（ほかの PC でビルドしたものをコピーした場合など）は、どんな簡単な Web サーバーでも動きます。Python がある場合の例です。

**Windows（PowerShell）**
```powershell
cd C:\path\to\dist
python -m http.server 8000
```

**Linux**
```bash
cd /path/to/dist
python3 -m http.server 8000
```

ブラウザで `http://localhost:8000/` を開きます。止めるときは Ctrl+C です。

### 3-3. `index.html` のダブルクリックでは動かない

`dist/index.html` をダブルクリックして直接開く（`file://` で開く）と、画面が真っ白になります。ブラウザが、ファイルから直接読み込んだ JavaScript（モジュール）の実行を止めるためです。必ず 3-1 か 3-2 の方法で、`http://localhost:…` から開いてください。

### 3-4. ローカルで動かすときの特徴

- `localhost` は、ブラウザが HTTPS と同じ「安全な場所」として扱います。そのため、上書き保存・最近使ったファイル・フォント一覧などもすべて使えます。
- サーバーを起動したあとは、インターネットにつながっていなくても使えます。
- 同じネットワークのほかの PC からも使いたいときは、`npm run preview -- --host` で起動し、表示された `http://192.168.x.x:4173/` を開きます。ただし、ほかの PC からは「安全な場所」として扱われないため、上書き保存などは使えません（2-2 の HTTP のときと同じ）。

---

## 4. 置き場所を変えるときの注意（データの引き継ぎ）

次のものは、ブラウザの中に**サイトのアドレスごと**に保存されています。GitHub Pages・別のサイト・`localhost:4173`・`localhost:8000` は、それぞれ別のアドレスとして扱われるため、引き継がれません。

| 保存されているもの | 引き継ぐ方法 |
|---|---|
| 作品のファイル（.hnb・編集できる PNG） | PC 上のファイルなので、どこからでもそのまま開ける |
| ライブラリ | 元の場所で「ライブラリをすべてエクスポート」（.hnbfx）→ 新しい場所でインポート |
| 環境設定（ルーラー・グリッド・説明の表示・最近使ったファイルの数など） | 新しい場所で設定し直す |
| 最近使ったファイルの一覧 | 引き継げない（新しい場所で開いたり保存したりすると、また溜まっていく） |
| 自動保存（保存していない作業） | 引き継げない。移す前に、作業中のものはファイルに保存しておく |

---

## 5. 困ったとき

| 症状 | 原因と対処 |
|---|---|
| 画面が真っ白 | `index.html` を直接開いている（3-3）。`http://localhost:…` から開く。サーバーに置いた場合は、`dist` の**中身**を置いたか（`dist` フォルダごと置くと `…/dist/` が入口になる）、`assets/` も置いたかを確認する |
| 保存がいつもダウンロードになる | HTTP で開いている（2-2）、または Firefox・Safari で開いている（2-3） |
| `npm` が見つからない | Node.js が入っていない、または入れたあとターミナルを開き直していない（1-1） |
| `npm ci` が失敗する | `npm install` を試す。社内ネットワークなどで外に出られない場合は、外に出られる PC でビルドして `dist` だけを持ってくる |
| ポート 4173 が使われている | `npm run preview -- --port 8080` のように別のポートにする |
