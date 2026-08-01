# デプロイ / CI・CD 手順

stockify は **プル型 CI/CD** で本番(Synology NAS / x86_64)へ反映する。

```
push/PR ──▶ GitHub Actions (lint / check / test)
   main ──▶ Docker ビルド ──▶ GHCR に push (ghcr.io/taaaaaaachu/stockify:latest, :sha-xxxx)
                                   │
                          (NAS から外向きに pull)
                                   ▼
              Synology NAS: Watchtower が 5 分毎に GHCR を監視
                          └─ 新しい :latest を検知 ─▶ 自動 pull ─▶ app を再作成
                                   └─ 起動時に scripts/migrate.js で DB マイグレーション
```

- NAS は宅内にあり外部から到達できないので、GitHub からは **push しない**。NAS が **pull で取りに行く**。
- ポート開放・VPN は不要(必要な外向き通信は GHCR への HTTPS のみ)。
- ビルドはランタイム env 非依存(`ORIGIN` 等は実行時に compose の `environment:` で注入)。

## 構成ファイル

| ファイル | 役割 |
| --- | --- |
| `.github/workflows/ci.yml` | CI(lint/check/test)+ main のイメージを GHCR に配布 |
| `docker-compose.yml` | NAS 本番。`app` は GHCR イメージを pull、`watchtower` が自動更新 |
| `docker-compose.local.yml` | ローカル動作確認用(こちらは従来どおり `build:`) |
| `Dockerfile` / `docker-entrypoint.sh` | イメージ定義と起動時マイグレーション |

## 初回セットアップ(一度だけ)

### 1. GitHub 側(GHCR)

- `main` への push で `ci.yml` の `build-push` ジョブが走り、初回に GHCR パッケージ
  `ghcr.io/taaaaaaachu/stockify` が自動作成される。追加の secret は不要
  (ワークフローの `GITHUB_TOKEN` に `packages: write` を付与済み)。

### 2. NAS 側の GHCR 認証(**パッケージが private の場合のみ**)

GHCR パッケージは既定で private。Watchtower が pull できるよう認証情報を用意する。

1. GitHub で PAT を発行: Settings → Developer settings → Personal access tokens (classic)、
   スコープ **`read:packages`** のみ。
2. NAS に SSH で入り、docker にログイン(`~/.docker/config.json` が作られる):

   ```bash
   docker login ghcr.io -u taaaaaaachu -p <PAT>
   ```

   > compose の watchtower は `/root/.docker/config.json` をマウントしている。
   > root 以外で運用する場合はマウント元パスをそのユーザーの `~/.docker/config.json` に合わせる。

**認証を省きたい場合**: GitHub の Packages ページで当該パッケージを **public** に変更すれば、
上記ログインと compose の `config.json` マウント行は不要になる。

### 3. NAS で本番を起動

1. `.env` を用意(`.env.example` 参照。`VAPID_*` / `CRON_SECRET` / `TUNNEL_TOKEN` / `ORIGIN`)。
2. 新しい `docker-compose.yml` を配置して起動:

   ```bash
   docker compose up -d
   ```

以後 NAS でのビルドは不要。`main` に変更が入るたび、5 分以内に Watchtower が自動反映する。

## 日常運用

- **通常のリリース**: PR → `main` にマージするだけ。CI が緑なら GHCR に `:latest` が上がり、
  NAS が自動で入れ替える。
- **手動で即時反映したい**: NAS で `docker compose pull app && docker compose up -d app`。
- **ロールバック**: GHCR には各コミットの `:sha-xxxxxxx` タグも残る。NAS で
  `docker-compose.yml` の `app.image` を戻したい版の `:sha-xxxxxxx` に固定し、
  `docker compose up -d app`(Watchtower に再度上書きされないよう、安定するまでは
  一時的に app の `com.centurylinklabs.watchtower.enable` ラベルを外すか watchtower を停止)。

## トラブルシュート

- **Watchtower が pull できない(401/403)**: private パッケージなのに NAS 未ログイン。手順 2 を実施。
- **CI の test が落ちる**: `better-sqlite3` を使うサーバーテストがある。ローカル再現は
  `npm ci && npm test`。
- **マイグレーションが当たっていない**: app コンテナのログ(`docker compose logs app`)で
  「マイグレーションを適用します」の出力を確認。
