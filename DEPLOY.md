# Stockify デプロイ手順書(SSH 不要・Synology GUI 完結)

**Synology NAS** で、**File Station(ファイル操作)** と
**Container Manager(Docker GUI)** だけを使って動かす手順です。**SSH は使いません。**
鍵などは **Windows で生成**し、File Station で NAS にコピーします。

外部公開は **Cloudflare Tunnel** で `stock.example.com`(例)に割り当てます。

---

## 1. 構成

```
                 ┌─────────────────────── NAS / Container Manager ────────────┐
 インターネット   │                                                            │
   ─────────►  cloudflared ──http──►  app (SvelteKit adapter-node :3000)       │
 (HTTPS/Tunnel)  │                         │                                   │
                 │                         └── data/app.sqlite (バインドマウント) │
                 │                                                            │
                 │   notify-cron ──毎日 09:00 JST── POST /api/cron/notify ────►  │
                 └────────────────────────────────────────────────────────────┘
```

- **app**: 会員データは SQLite に保存。起動時に自動マイグレーション。
- **cloudflared**: ポート開放なしで HTTPS 公開(PWA/プッシュに必須)。
- **notify-cron**: 毎日 1 回、購入推奨に達した品目を会員へプッシュ通知。
- **SQLite はプロジェクト直下 `data/app.sqlite`**(バインドマウント)。**File Station でそのまま
  バックアップ/リストアできます。**

---

## 2. 前提

- Synology DSM **7.2 以降**(**Container Manager** の「プロジェクト」でビルドできる版)。
- **File Station** が使えること。
- `example.com` が Cloudflare 管理下にあること(別ドメインでも読み替え可)。
- **Windows** に Node.js(mise 管理)があること(鍵生成に使用)。

> このアプリはネイティブモジュール(better-sqlite3 / argon2)を使うため、
> Container Manager 側でイメージを**ビルド**します(DSM 7.2 の「プロジェクト」機能で可能)。

---

## 3. Windows での準備

### 3.1 VAPID 鍵を生成(プッシュ通知用)

PowerShell で(プロジェクトフォルダ内):

```powershell
npx web-push generate-vapid-keys
```

出力の `Public Key` / `Private Key` を控えます。

### 3.2 cron シークレットを生成

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3.3 Cloudflare Tunnel トークンを取得(ブラウザ)

1. Cloudflare **Zero Trust** ダッシュボード → **Networks → Tunnels → Create a tunnel**。
2. コネクタは **Cloudflared** を選択し、トンネル名を付けて作成。
3. 表示される **トークン**(`eyJ...` の長い文字列)を控える。
4. **Public Hostname** を追加:
   - Subdomain: `stock`、Domain: `example.com`
   - Service: **HTTP** → `app:3000`

### 3.4 本番用 `.env` を作成(Windows のプロジェクトフォルダ直下)

メモ帳等で以下の内容の **`.env`** を作ります(拡張子なし・UTF-8)。**このファイルは配布・公開しないこと。**

```dotenv
ORIGIN=https://stock.example.com
VAPID_PUBLIC_KEY=＜3.1 の Public Key＞
VAPID_PRIVATE_KEY=＜3.1 の Private Key＞
VAPID_SUBJECT=mailto:you@example.com
CRON_SECRET=＜3.2 の値＞
TUNNEL_TOKEN=＜3.3 のトークン＞
```

> `ORIGIN` は必ず公開 URL に一致させます。ズレるとログイン等の POST が CSRF で 403 になります。

### 3.5 アップロード用に ZIP を作る

NAS へは **`node_modules` などを除いて**コピーします(重い・不要)。プロジェクトフォルダで、
以下を**含めない**で ZIP 化してください:

- 含めない: `node_modules` / `.svelte-kit` / `build` / `data` / `.git`
- 含める: それ以外すべて(**`.env` / `Dockerfile` / `docker-compose.yml` / `src` / `drizzle` / `scripts` / `static` / `package.json` / `package-lock.json` など**)

PowerShell で作る例(必要フォルダだけ ZIP):

```powershell
$items = Get-ChildItem -Force | Where-Object { $_.Name -notin @('node_modules','.svelte-kit','build','data','.git') }
Compress-Archive -Path $items -DestinationPath ..\stockify-deploy.zip -Force
```

> `.env` は隠しでなく通常ファイルなので `-Force` 付き `Get-ChildItem` で拾えます。ZIP に
> `.env` が入っているか一応確認してください。

---

## 4. File Station で NAS へ配置

1. File Station で Docker 用の共有フォルダ(無ければ作成、例 `docker`)を開く。
2. その中に `stockify` フォルダを作る(例: `/docker/stockify`)。
3. `stockify-deploy.zip` をアップロードし、**右クリック → 展開(解凍)** して
   `/docker/stockify` 直下に中身が並ぶようにする(`Dockerfile` や `docker-compose.yml` が
   `/docker/stockify/` 直下に来る状態)。

---

## 5. Container Manager でプロジェクトを作成・起動

1. **Container Manager** を開く → 左メニュー **プロジェクト** → **作成**。
2. **プロジェクト名**: `stockify`。
3. **パス**: `/docker/stockify` を選択。
4. **ソース**: 「既存の docker-compose.yml を使用」を選ぶ(フォルダ内の
   `docker-compose.yml` が自動で読まれる)。
5. そのまま進めて **ビルドして起動**。初回はイメージのビルドに数分かかります。
6. ビルド後、3 コンテナ(`app` / `cloudflared` / `notify-cron`)が起動します。
   - `app` は起動時に DB マイグレーションを自動適用します。
   - ログは Container Manager の各コンテナ「詳細 → ログ」で確認できます(**SSH 不要**)。

> `.env` はプロジェクトフォルダ直下にあれば Container Manager が自動で読み込みます
> (`${...}` の値がそこから注入されます)。

---

## 6. 初回セットアップ(ブラウザ)

1. `https://stock.example.com/register` を開く。
2. **最初のユーザー**は招待コード不要で登録でき、**インスタンス管理者(super_admin)**になり、
   入力した名前で**最初の世帯**が作られます。
3. ほかの人を招くには、`/account` で招待コードを発行し、相手に `/register` で使ってもらいます
   (その世帯にメンバーとして参加)。世帯はヘッダのセレクタで切り替えられます。

---

## 7. 通知(PWA プッシュ)の有効化

1. 会員でログインした状態で、スマホ/PC のブラウザからアプリを
   **ホーム画面に追加/インストール**(PWA)。
2. **設定 → 購入リマインド通知 → 通知をオンにする**。ブラウザの許可ダイアログで許可。
3. 以降、購入推奨日に達した品目があると `notify-cron` の実行時にプッシュが届きます
   (同じ端末へは 20 時間に 1 回まで)。

> プッシュは HTTPS 必須(Cloudflare Tunnel が満たす)。iOS はホーム画面に追加した
> PWA からのみ通知を許可できます。

通知時刻を変えたい場合は、Windows 側で `docker-compose.yml` の `notify-cron` の cron 式
(`0 0 * * *` = 00:00 UTC = 09:00 JST)を編集し、**第 9 章の更新手順**で反映します。

---

## 8. バックアップ / リストア(File Station だけで完結)

SQLite はプロジェクト直下 `data/app.sqlite` にあります。

- **バックアップ**: File Station で `/docker/stockify/data/app.sqlite`(と `app.sqlite-wal`、
  `app.sqlite-shm` があれば一緒に)を別フォルダへコピー、または右クリック → ダウンロード。
  安全のため、コピー前に Container Manager で `app` を一時停止すると確実です。
- **リストア**: Container Manager でプロジェクト(または `app`)を**停止** → File Station で
  `data/` のファイルをバックアップと差し替え → **起動**。

---

## 9. アップデート手順(SSH 不要)

1. Windows で新しいソースを用意し、第 3.5 と同じ手順で ZIP 化。
2. File Station で `/docker/stockify` にアップロードして**展開・上書き**
   (`data/` と `.env` は消さない/上書きしない)。
3. Container Manager → プロジェクト `stockify` → **ビルド**(または「停止 → ビルド → 起動」)。
   マイグレーションは起動時に自動適用されます。

---

## 10. トラブルシューティング

| 症状 | 原因 / 対処 |
|---|---|
| ログイン/登録で 403 | `ORIGIN` が公開 URL と不一致。`.env` を修正し、第 9 章で反映。 |
| 設定に「サーバーで通知が設定されていません」 | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` 未設定。`.env` を確認。 |
| 通知が来ない | ①ブラウザで通知を許可したか ②PWA としてインストールしたか(特に iOS)③`notify-cron` が起動しているか(Container Manager のログ)④購入推奨日に達した品目があるか(定期便が有効な品目は対象外)。 |
| cron が 401 | `.env` の `CRON_SECRET` が空でないか。`app` と `notify-cron` は同じ `.env` を共有します。 |
| ビルドが失敗する | DSM が 7.2 以降か(プロジェクトのビルド対応)。ログでネイティブビルドのエラーを確認。 |
| 最初からやり直したい | Container Manager でプロジェクト停止 → File Station で `data/` を削除 → 起動(全データ消去)。 |

---

## 付録 A: 環境変数一覧

| 変数 | 用途 | 必須 |
|---|---|---|
| `ORIGIN` | 公開オリジン(CSRF/リダイレクト) | 本番で必須 |
| `DATABASE_PATH` | SQLite パス(compose で `/data/app.sqlite` 固定) | — |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push 鍵 | 通知を使うなら必須 |
| `VAPID_SUBJECT` | VAPID の連絡先(`mailto:` 等) | 任意 |
| `CRON_SECRET` | 通知cronの共有シークレット | 通知を使うなら必須 |
| `TUNNEL_TOKEN` | Cloudflare Tunnel トークン | 本番で必須 |

## 付録 B: Windows でのローカル確認(任意・Docker Desktop がある場合)

NAS に上げる前に手元で確認したい場合のみ。cloudflared なしでポート直開放します。

```powershell
docker compose -f docker-compose.local.yml up --build
```

→ `http://localhost:3000`。通知評価は手動で叩けます:

```powershell
curl -X POST -H "Authorization: Bearer dev-cron-secret" http://localhost:3000/api/cron/notify
```
