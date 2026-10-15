# Stockify

洗剤・柔軟剤・トイレットペーパーなどの消耗品の残量を**購入履歴だけから推定**し、枯渇予想日と購入推奨日を知らせる PWA。日々の使用量は記録せず、記録するのは「買ったとき」だけ。家族や小規模グループで在庫を共有する使い方を想定している。

ドメインの用語は [CONTEXT.md](./CONTEXT.md)、主要な設計判断は [docs/adr/](./docs/adr/) にまとめている。

## 主な機能

- **残量・枯渇予想日・購入推奨日の推定**: 購入(内容量+購入日時)の履歴から消費レートを逆算する。任意の「使い切り」「残量補正」で推定の原点を直せる。購入推奨日は「枯渇予想日 − 余裕日数(リードタイム)」で、リードタイムは全体既定値と品目ごとの上書きを持つ。
- **買い物リスト**: 購入推奨日に達した品目を自動で集め、ワンタップで購入登録につなぐ。
- **定期便**: 繰り返し購入のスケジュールをアプリ内で定義し、予定日を過ぎた分の購入をアプリを開いたときに遅延生成する。次回配送のスキップ・次回日変更・一時停止に対応。
- **購入推奨のプッシュ通知**: Web Push(VAPID)。通知時刻は 15 分単位で指定でき、複数世帯に所属する場合は世帯ごとに通知の ON/OFF を切り替えられる。
- **商品リンク**: 品目ごとに購入先の販売ページを複数登録し、並べ替えられる(先頭が既定リンク)。
- **履歴グラフ**: 残量の推移を時系列で表示する。
- **ゲストモードと会員モード**: ゲストはアカウント不要でブラウザの IndexedDB だけで完結する。会員はサーバーの SQLite に保存して複数端末で共有でき、ゲストのデータを会員の世帯へ取り込める。
- **オフライン記録と同期**: 会員もローカル DB(IndexedDB)で読み書きし、オフライン中の書き込みは outbox に積んで再接続時にサーバーへ送る。
- **世帯と3層ロール**: 在庫は世帯が所有し、ユーザーは複数世帯に所属して切り替えられる。世帯内ロールは `owner` / `manager` / `member` の3層で、owner の交代は指名先の承認で確定する。これとは別レイヤーにインスタンス管理者(`super_admin`)を置く。
- **招待制**: 会員登録には世帯に紐づく招待コード(有効期限付き・単回使用)が必要。ユーザーが 0 人のときだけ招待なしで登録でき、その人がインスタンス管理者になる。
- **パスキー認証**: パスワード、パスキー、またはその両方でログインできる。パスワードを削除してパスキーのみの会員にもなれる。

## 技術スタック

| 領域 | 採用技術 |
| --- | --- |
| フロントエンド | Svelte 5 / SvelteKit 2 / TypeScript 6 / Vite 8 |
| サーバー | SvelteKit(`@sveltejs/adapter-node`)によるフルスタック構成、Node.js 22(Docker イメージ) |
| DB | SQLite(better-sqlite3)+ Drizzle ORM / drizzle-kit。クライアント側は IndexedDB(`idb`) |
| 認証 | Argon2(`@node-rs/argon2`)+ サーバーセッション(httpOnly Cookie)、パスキー(`@simplewebauthn/server` / `browser` 14) |
| PWA | Web App Manifest、Service Worker、Web Push(`web-push`) |
| インフラ | Docker / Docker Compose、Cloudflare Tunnel、GHCR、Watchtower |
| CI/CD | GitHub Actions(ESLint・svelte-check・Vitest → main のみイメージをビルドして GHCR へ push) |
| テスト | Vitest 4、fake-indexeddb |

## アーキテクチャと設計判断

```
 ブラウザ(PWA)
 ┌───────────────────────────────────────────────┐
 │ 画面 (Svelte)                                   │
 │   │                                             │
 │ 推定ロジック $lib/domain(純粋関数・サーバーと共有)│
 │   │                                             │
 │ Repository ── ゲスト: IndexedDB のみ             │
 │            └─ 会員  : IndexedDB + outbox ──┐     │
 │ Service Worker(アプリ本体をプリキャッシュ)   │     │
 └──────────────────────────────────────────│─────┘
                     push(既存 /api/* へ再送)│ ▲ pull(全件スナップショット)
                                            ▼ │
 サーバー(SvelteKit adapter-node)
   認証・権限・入力検証・永続化(SQLite)・同期の受け口
   POST /api/cron/notify ◀── notify-cron(15 分ごと)── Web Push 送信
```

推定ロジックはブラウザとサーバーで共有し、サーバーの役割は「認証・権限・入力検証・永続化・端末間同期・プッシュ通知」に絞っている。主な判断とトレードオフは ADR に記録している。

| ADR | 要約 |
| --- | --- |
| [0001](./docs/adr/0001-consumption-estimation-from-purchase-history.md) | 使用量は記録させず、購入履歴から消費レートを推定する。直近1回の購入間隔だと早買いで消費を過大評価するため長期平均を採り、のちに直近ほど重く見る指数減衰(半減期3サイクル)の加重平均へ改訂した。 |
| [0002](./docs/adr/0002-subscription-app-defined-lazy-generation.md) | 定期便は外部サービスと連携せずアプリ内で定義し、常駐ジョブを使わず「開いたときに遅延生成」する。購入推奨からの除外は「次回配送が枯渇前に届くか」で判定する。 |
| [0003](./docs/adr/0003-household-ownership-and-two-layer-roles.md) | 在庫はユーザーではなく世帯が所有し、ユーザーと世帯は多対多。世帯内ロールとインスタンス管理者を別レイヤーに分ける。 |
| [0004](./docs/adr/0004-password-change-and-admin-reset.md) | 本人のパスワード変更と、管理者による一時パスワードでのリセット(次回ログイン時に変更を強制)を分けて提供する。 |
| [0005](./docs/adr/0005-household-three-layer-roles-and-invitation-ownership.md) | owner を世帯ごとに1人に限り、招待管理は manager に委任する。owner を複数置けるモデルでの世帯乗っ取りを防ぐため。 |
| [0006](./docs/adr/0006-user-deletion-and-household-data-retention.md) | ユーザー削除は即時・完全削除とし、世帯の共有在庫は残す。owner のままでは削除できない。 |
| [0007](./docs/adr/0007-authentication-rate-limiting.md) | パスワードを検証するすべての入口で、ユーザー単位・IP 単位の試行制限を共有する。カウンターは SQLite にハッシュキーで保存する。 |
| [0008](./docs/adr/0008-product-links.md) | 商品リンクは JSON 配列ではなく、順序を持つ子レコードとして品目に紐づける。 |
| [0009](./docs/adr/0009-offline-first-local-db-and-sync.md) | ローカル DB を優先し、outbox を既存 API へ再送して同期する。データ量が小さいので差分同期や CRDT ではなく全件 pull を採り、冪等性はクライアント採番の UUID と操作ごとの性質で担保する。 |
| [0010](./docs/adr/0010-passkey-only-members.md) | パスキーのみの会員を認める。認証情報は常に1つ以上必要とし、端末を失くしたときは管理者リセットで全パスキーを削除して復旧する。 |

## セキュリティ上の工夫

- **パスワードハッシュ**: Argon2 で保存する。ユーザーが存在しない場合やパスワードを持たない場合もハッシュ計算を行い、応答時間からアカウントの有無を推測されにくくしている(`src/lib/server/auth.ts`)。
- **セッション**: セッショントークンは SHA-256 ハッシュだけを DB に保存する。Cookie は `httpOnly` / `SameSite=Lax` / 本番では `Secure`。
- **パスキー(WebAuthn)**: ユーザー名入力なしでログインできる discoverable credential 方式。認証情報の追加・削除には直近 5 分以内の本人確認を求め、削除系の操作では操作した端末以外のセッションを無効化する。
- **認証試行のレート制限**: ログイン・パスワード変更・アカウント削除・本人確認のパスワード経路で、ユーザー単位(15 分で 5 回)と IP 単位(15 分で 20 回)の失敗を数えて一時的に拒否する。キーはユーザー名や IP そのものではなく、用途別のハッシュ(`src/lib/server/authRateLimit.ts`)。
- **招待制**: 世帯に紐づく単回使用の招待コードがないと登録できない。
- **強制パスワード変更**: 管理者リセット後はサーバー側でパスワード変更とログアウト以外のページ・API を拒否する(`src/hooks.server.ts`)。リセット時には全パスキーと全セッションも消す。
- **世帯のアクセス制御**: 在庫系の API は所属とロールを確認してから処理する。他世帯の ID と衝突した場合も 404 を返し、存在を明かさない。
- **通知 cron の保護**: `/api/cron/notify` は共有シークレット(`Authorization: Bearer`)を要求する。

## テスト

```bash
npm test        # vitest run
```

25 ファイル・220 件のテストがすべて通ることを確認している。主な対象は次のとおり。

- **推定ロジック**(`src/lib/domain`): 消費レート・残量・枯渇予想日・購入推奨日、定期便の遅延生成、ダッシュボード集計、残量推移
- **サーバー**(`src/lib/server`): 認証とセッション、認証試行制限、認証情報の追加・削除、パスキーの登録・認証(往復テストを含む)、世帯とロールの権限、入力検証、在庫操作、プッシュ通知の評価
- **クライアント**: IndexedDB リポジトリ(fake-indexeddb)、会員用リポジトリと同期、Service Worker のキャッシュ戦略、RBAC 判定

CI(`.github/workflows/ci.yml`)では main への push と全 PR で ESLint(`npm run lint`)、svelte-check(`npm run check`)、Vitest(`npm test`)を実行する。

## ローカルでの起動方法

CI と Docker イメージは Node.js 22 を使っている。

```bash
npm ci
cp .env.example .env   # 任意。DATABASE_PATH の既定は ./data/app.sqlite
npm run db:migrate     # SQLite にマイグレーションを適用
npm run dev            # http://localhost:5173
```

- 最初に `/register` で登録したユーザーは招待コードなしでインスタンス管理者になり、最初の世帯が作られる。
- プッシュ通知を試す場合は `.env` に `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`(`npx web-push generate-vapid-keys` で生成)と `CRON_SECRET` を設定する。未設定なら通知機能は無効になる。
- そのほかのコマンド: `npm run check`(型チェック)、`npm run lint`、`npm run db:generate`(スキーマ変更後のマイグレーション生成)。
- Docker で本番相当のコンテナを動かす場合は `docker compose -f docker-compose.local.yml up --build`(`http://localhost:3000`)。

## デプロイ

プル型の CI/CD で運用している。`main` に入ると GitHub Actions が Docker イメージをビルドして GHCR に push し、本番ホスト側の Watchtower が新しいイメージを取得してコンテナを作り直す。DB マイグレーションはコンテナ起動時に自動で適用され、外部公開には Cloudflare Tunnel を使う(ポート開放は不要)。

手順の詳細は [docs/deploy.md](./docs/deploy.md)(CI/CD・Watchtower)と [DEPLOY.md](./DEPLOY.md)(初回構築)を参照。

## ライセンス

[MIT](./LICENSE)
