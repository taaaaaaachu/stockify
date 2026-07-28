# Stockify デプロイ手順書

**Synology NAS 上の Docker** で動かし、**Cloudflare Tunnel** で
`stock.example.com`(例)に公開する前提の手順です。lowest_finder と同じ構成に
**通知評価cron** を足しています。

---

## 1. 構成

```
                 ┌─────────────────────── NAS / Docker ───────────────────────┐
 インターネット   │                                                            │
   ─────────►  cloudflared ──http──►  app (SvelteKit adapter-node :3000)       │
 (HTTPS/Tunnel)  │                         │                                   │
                 │                         └── /data/app.sqlite (db-data ボリューム) │
                 │                                                            │
                 │   notify-cron ──毎日 09:00 JST── POST /api/cron/notify ────►  │
                 └────────────────────────────────────────────────────────────┘
```

- **app**: SvelteKit(adapter-node)。会員データは SQLite に永続化。起動時に自動マイグレーション。
- **cloudflared**: Cloudflare Tunnel。ポート開放なしで HTTPS 公開(PWA/プッシュに必須)。
- **notify-cron**: 毎日 1 回 `/api/cron/notify` を叩き、購入推奨に達した品目を会員へプッシュ通知。
- データは名前付きボリューム `db-data` の SQLite ファイル 1 つ(バックアップ=ファイルコピー)。

---

## 2. 前提

- NAS に Docker(Container Manager)と `docker compose` が使えること。
- `example.com` が Cloudflare 管理下にあること(別ドメインでも可、読み替え)。
- ローカルに Node.js(mise 管理)があること(鍵生成に使用)。

---

## 3. 事前準備

### 3.1 リポジトリを NAS に配置

```bash
git clone <このリポジトリ> stockify
cd stockify
```

### 3.2 VAPID 鍵を生成(プッシュ通知用)

```bash
npx web-push generate-vapid-keys
```

出力の `Public Key` / `Private Key` を控えます。

### 3.3 cron シークレットを生成

```bash
openssl rand -hex 32
```

### 3.4 Cloudflare Tunnel トークンを取得

1. Cloudflare **Zero Trust** ダッシュボード → **Networks → Tunnels → Create a tunnel**。
2. コネクタは **Cloudflared** を選択し、トンネル名を付けて作成。
3. 表示される **トークン**(`eyJ...` の長い文字列)を控える。
4. **Public Hostname** を追加:
   - Subdomain: `stock`、Domain: `example.com`
   - Service: **HTTP** → `app:3000`

### 3.5 本番用 `.env` を作成(リポジトリ直下)

`docker compose` が自動で読み込みます。**このファイルはコミットしないこと**(`.gitignore` 済み)。

```dotenv
ORIGIN=https://stock.example.com
VAPID_PUBLIC_KEY=＜3.2 の Public Key＞
VAPID_PRIVATE_KEY=＜3.2 の Private Key＞
VAPID_SUBJECT=mailto:you@example.com
CRON_SECRET=＜3.3 の値＞
TUNNEL_TOKEN=＜3.4 のトークン＞
```

> `ORIGIN` は必ず公開 URL に一致させます。ズレるとログイン等の POST が CSRF で 403 になります。

---

## 4. ローカルでの動作確認(任意)

cloudflared を使わずローカルで確認できます(`.env` の VAPID/CRON_SECRET は流用可)。

```bash
docker compose -f docker-compose.local.yml up --build
```

- ブラウザで `http://localhost:3000`。
- 通知cronは含めないので、手動で評価を叩けます:

```bash
curl -X POST -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/notify
```

停止・破棄:

```bash
docker compose -f docker-compose.local.yml down
```

---

## 5. 本番デプロイ

```bash
docker compose up -d --build
```

- `app` はビルド後、起動時に `scripts/migrate.js` でマイグレーションを自動適用します。
- `cloudflared` がトンネルを張り、`https://stock.example.com` で到達可能になります。
- `notify-cron` が常駐し、毎日 **00:00 UTC(= 09:00 JST)** に通知評価を実行します。

状態確認 / ログ:

```bash
docker compose ps
docker compose logs -f app
docker compose logs -f cloudflared
```

---

## 6. 初回セットアップ

1. `https://stock.example.com/register` を開く。
2. **最初のユーザー**は招待コード不要で登録でき、**インスタンス管理者(super_admin)**になり、
   入力した名前で**最初の世帯**が作られます。
3. ほかの人を招くには、`/account` で招待コードを発行し、相手に `/register` で使ってもらいます
   (その世帯にメンバーとして参加)。世帯はヘッダのセレクタで切り替えられます。

---

## 7. 通知(PWA プッシュ)の有効化

1. 会員でログインした状態で、ブラウザからアプリを**ホーム画面に追加/インストール**(PWA)。
2. **設定 → 購入リマインド通知 → 通知をオンにする**。ブラウザの許可ダイアログで許可。
3. 以降、購入推奨日に達した品目があると、`notify-cron` の実行時にプッシュが届きます
   (同じ端末へは 20 時間に 1 回まで)。

> プッシュは HTTPS 必須です(Cloudflare Tunnel が満たします)。iOS はホーム画面に
> 追加した PWA からのみ通知を許可できます。

通知時刻を変えたい場合は `docker-compose.yml` の `notify-cron` の cron 式
(`0 0 * * *` = 00:00 UTC)を編集して `docker compose up -d` し直します。

---

## 8. バックアップ / リストア

データは `db-data` ボリューム上の SQLite ファイル 1 つです。

バックアップ(ホストにコピー):

```bash
docker compose cp app:/data/app.sqlite ./backup-app.sqlite
```

リストア(停止 → 差し替え → 起動):

```bash
docker compose down
docker compose cp ./backup-app.sqlite app:/data/app.sqlite
docker compose up -d
```

---

## 9. アップデート手順

```bash
git pull
docker compose up -d --build
```

マイグレーションは起動時に自動適用されます(`drizzle/` の差分)。

---

## 10. トラブルシューティング

| 症状 | 原因 / 対処 |
|---|---|
| ログイン/登録で 403 | `ORIGIN` が公開 URL と不一致。`.env` の `ORIGIN` を修正して再起動。 |
| 設定に「サーバーで通知が設定されていません」 | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` 未設定。`.env` を確認。 |
| 通知が来ない | ①ブラウザで通知を許可したか ②PWA としてインストールしたか(特に iOS)③`notify-cron` が動いているか(`docker compose logs notify-cron`)④購入推奨日に達している品目があるか(定期便が有効な品目は対象外)。 |
| cron が 401 | `notify-cron` と `app` の `CRON_SECRET` が一致しているか(同じ `.env`)。 |
| DB を作り直したい | `docker compose down` 後、`db-data` ボリュームを削除して再起動(全データ消去)。 |

---

## 付録: 環境変数一覧

| 変数 | 用途 | 必須 |
|---|---|---|
| `ORIGIN` | 公開オリジン(CSRF/リダイレクト) | 本番で必須 |
| `DATABASE_PATH` | SQLite パス(compose で `/data/app.sqlite` 固定) | — |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push 鍵 | 通知を使うなら必須 |
| `VAPID_SUBJECT` | VAPID の連絡先(`mailto:` 等) | 任意 |
| `CRON_SECRET` | 通知cronの共有シークレット | 通知を使うなら必須 |
| `TUNNEL_TOKEN` | Cloudflare Tunnel トークン | 本番で必須 |
