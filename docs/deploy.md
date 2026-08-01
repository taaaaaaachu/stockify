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
**classic PAT(スコープ `read:packages`)を使うこと**。

> ⚠️ **Fine-grained PAT は使わない**。`stockify` 限定 + `Contents: Read` に絞った
> Fine-grained PAT でも、Synology から private GHCR を pull すると
> `Error response from daemon: denied` になる(認証は通るが pull 認可が伝播しない、
> GHCR + Fine-grained の既知の弱点)。classic `read:packages` なら安定して pull できる。
> スコープを絞りたい動機はあるが、確実性を優先して classic を使う。

1. GitHub で **classic PAT** を発行: Settings → Developer settings →
   Personal access tokens → **Tokens (classic)** → Generate new token (classic)。
   - スコープは **`read:packages` のみ**(他は不要)。
   - Expiration は任意(無人の NAS が期限切れで黙って止まるのを防ぐなら No expiration)。

   > このトークンは「アカウント内の全 private パッケージが読める」が、**read-only・packages 限定**で
   > 被害は限定的。同じ NAS で複数プロジェクト(例: lowest_finder)を動かす場合、
   > **この 1 トークンで全プロジェクトの pull をまかなえる**(config.json は `ghcr.io` 1 エントリのため、
   > 追加ログインは不要)。

2. NAS に SSH で入り、docker にログイン(`/root/.docker/config.json` に保存される):

   ```bash
   echo 'ghp_発行したトークン全文字列' | sudo docker login ghcr.io -u taaaaaaachu --password-stdin
   ```

   > - Synology では docker デーモンへのアクセスに `sudo`(root)が必要。root で入れることで、
   >   compose の watchtower がマウントする `/root/.docker/config.json` と保存先が一致する。
   > - `--password-stdin` にするとシェル履歴にトークンが残らず、`--password` 警告も出ない。
   > - 「パスワードが暗号化されず保存される」警告は想定どおり(Watchtower がこの平文をマウントして使う)。
   > - `Login Succeeded` を確認。

**認証を省きたい場合**: GitHub の Packages ページで当該パッケージを **public** に変更すれば、
PAT の発行・上記ログイン・compose の `config.json` マウント行はすべて不要になる
(イメージには秘密が焼き込まれていない = `ORIGIN`/`VAPID_*`/`CRON_SECRET` は実行時注入のため)。

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

- **`manifest unknown`**: そのタグがまだ GHCR に無い。`main` にマージして `build-push` が
  成功しているか確認(PR 段階では配布されない)。認証エラーではない。
- **`denied` / `unauthorized`**: 認証・認可の問題。
  - Fine-grained PAT を使っていないか確認(→ classic `read:packages` に切り替える。上記「2. GHCR 認証」参照)。
  - `sudo docker pull ghcr.io/taaaaaaachu/stockify:latest` で切り分け。ここで通れば Container Manager が
    資格情報を使えていないだけ。まず SSH で pull しておけばローカルイメージで起動できる。
  - 最終手段はパッケージの **public 化**(認証不要になる)。
- **Container Manager の UI では denied だが SSH の `sudo docker pull` は通る**: CM のプロジェクト
  ビルドが `/root/.docker/config.json` を使っていない。先に SSH で pull しておくか、
  CM の「レジストリ」設定に GHCR 認証を登録する。
- **CI の test が落ちる**: `better-sqlite3` を使うサーバーテストがある。ローカル再現は
  `npm ci && npm test`。
- **build-push が `Cache export is not supported for the docker driver`**: ワークフローに
  `docker/setup-buildx-action` があるか確認(gha キャッシュには docker-container ドライバが必要)。
- **マイグレーションが当たっていない**: app コンテナのログ(`docker compose logs app`)で
  「マイグレーションを適用します」の出力を確認。
