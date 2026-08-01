# Android PWA / WebAPK トラブルシュート知見

作成日: 2026-08-02

## 概要

Stockify を Android Chrome から PWA としてインストールしようとしたとき、ホーム画面のアイコン右下に
Chrome アイコンが付いた状態になった。

この状態は WebAPK として独立インストールされた PWA ではなく、Chrome が作成したホーム画面ショートカット
として扱われている状態だった。

## 発生した症状

- ホーム画面の Stockify アイコン右下に Chrome の小さなアイコンが付く
- Android の「設定 → アプリ → すべてのアプリ」に `Stockify` が表示されない
- アプリ情報を開くと `Stockify` ではなく Chrome のアプリ情報が開く
- Chrome メニューの文言が `インストールしてショートカットを作成` だった
- アンインストール後に Chrome のキャッシュや Cookie を削除して再インストールしても改善しなかった

## 結論

原因は 2 つあった。

1. Service Worker が WebAPK 判定に必要なオフライン navigation 対応を満たしていなかった
2. 修正後も CDN / Cloudflare が古い Service Worker を返していた

最終的には、オフライン fallback 対応済みの Service Worker を追加し、さらに Service Worker 登録 URL に
アプリのバージョンを付けて CDN キャッシュを回避することで、Android Chrome から WebAPK として
インストールできる状態になった。

## 原因 1: Service Worker のオフライン navigation 対応不足

Android Chrome が WebAPK として PWA を扱うには、manifest だけでなく、Service Worker による基本的な
オフライン対応が必要になる。

Stockify には Service Worker 自体は存在していたが、当初は push 通知系の処理が中心だった。
ページ遷移、つまり navigation request に対する `fetch` ハンドラとオフライン fallback が不足していたため、
Chrome から見ると WebAPK として十分な PWA 要件を満たせていない可能性があった。

対応として以下を追加した。

- `install` イベントで `/offline.html` をキャッシュする
- `activate` イベントで古いキャッシュを整理する
- `fetch` イベントで navigation request のみ network-first で処理する
- ネットワーク失敗時に `/offline.html` を返す
- API、認証済み HTML、ユーザーデータはキャッシュしない

関連ファイル:

- `src/service-worker.ts`
- `static/offline.html`
- `src/app.html`
- `static/manifest.webmanifest`
- `src/pwa-manifest.test.ts`

対応コミット:

```text
646825c AndroidでPWAをWebAPKとしてインストール可能にする
```

## 原因 2: CDN が古い Service Worker をキャッシュしていた

Service Worker 修正後にデプロイしても、実機では古い `/service-worker.js` が配信され続けていた。

調査時点では、裸の `/service-worker.js` にアクセスすると Cloudflare から古い 594 byte の Service Worker が
返っていた。一方、クエリパラメータ付きの URL では新しい 1257 byte の Service Worker が返っていた。

つまり、デプロイ済みの最新 Service Worker は存在していたが、CDN キャッシュのため Android Chrome が
古い Service Worker を見続けていた。

対応として、SvelteKit の Service Worker 自動登録を止め、アプリのバージョンをクエリパラメータに付けて
手動登録するようにした。

関連ファイル:

- `vite.config.ts`
- `src/routes/+layout.svelte`

対応内容:

```ts
serviceWorker: {
  register: false
}
```

```ts
navigator.serviceWorker.register(
  `/service-worker.js?v=${encodeURIComponent(version)}`
);
```

対応コミット:

```text
78c3b85 Service WorkerのCDNキャッシュを回避する
```

## WebAPK と Chrome ショートカットの見分け方

Android で PWA をインストールしたとき、WebAPK として入っているか、Chrome ショートカット扱いかは
以下で切り分けられる。

WebAPK として入っている場合:

- Android のアプリ一覧に対象アプリ名が表示される
- アプリ情報が対象アプリ自身の情報として開く
- ホーム画面アイコンが Chrome のショートカット扱いにならない

Chrome ショートカット扱いの場合:

- Android のアプリ一覧に対象アプリ名が表示されない
- アプリ情報を開くと Chrome の情報が開く
- ホーム画面アイコンに Chrome のバッジが付く

今回の Stockify は後者だった。

## 調査時の注意点

Chrome DevTools Protocol の `AppBanners.InstallableStatusCode` だけで原因を断定しないこと。

今回、`AppBanners.InstallableStatusCode=6` を見て、最初は manifest link が見えていない可能性を疑った。
しかし比較対象として確認した `pokedex.org` でも同じ値が出る場面があり、この値だけで
「manifest が壊れている」とは断定できなかった。

実際の切り分けでは、以下を組み合わせて確認する。

- Android 実機でインストール後にアプリ一覧へ表示されるか
- アプリ情報が Chrome ではなく PWA 自身になるか
- Service Worker の controller が有効か
- `caches.keys()` に期待するキャッシュがあるか
- `/offline.html` が Cache Storage に入っているか
- `/service-worker.js` と `/service-worker.js?v=...` のレスポンスが一致しているか
- CDN の `Cache-Control`、`CF-Cache-Status`、`Content-Length`、`ETag`、`Last-Modified` を見る

特に Service Worker は CDN にキャッシュされると厄介。ソースコードとデプロイ結果が正しくても、
実機の Chrome が古い worker を見続けることがある。

## 最終確認

修正後、Android 実機で以下を確認できた。

```text
Service Worker controller:
https://stock.example.com/service-worker.js?v=1785614690920

Cache names:
stockify-offline-v1

/offline.html:
キャッシュ済み
```

その後、実機で再インストールしたところ、PWA としてインストールできた。

## 再発防止チェックリスト

Android WebAPK 対応を別プロジェクトへ適用するときは、以下を確認する。

- HTML に manifest link がある
- manifest に `name`、`short_name`、`start_url`、`scope`、`display` がある
- `display` は `standalone` または `fullscreen` など PWA として妥当な値になっている
- 192x192 と 512x512 の PNG アイコンがある
- 可能なら `purpose: "any maskable"` のアイコンを用意する
- Service Worker に navigation request 用の `fetch` ハンドラがある
- オフライン fallback ページを用意している
- 認証済み HTML、API レスポンス、ユーザーデータを不用意にキャッシュしていない
- CDN 経由で配信している場合、Service Worker が古いまま返っていないか確認する
- Service Worker 登録 URL にビルドバージョンを付ける
- 実機 Android で「アプリ一覧に表示されるか」「アプリ情報が Chrome ではないか」まで確認する

## CDN キャッシュ確認コマンド例

```powershell
curl -I https://example.com/service-worker.js
curl -I "https://example.com/service-worker.js?v=test"
```

見るべきヘッダ:

```text
Cache-Control
CF-Cache-Status
Content-Length
ETag
Last-Modified
```

裸の `/service-worker.js` とクエリ付き URL で `Content-Length` や内容が違う場合、CDN が古い
Service Worker を返している可能性が高い。

## 参考にした Stockify 内の変更

別プロジェクトへ展開する場合は、このリポジトリの以下を参照する。

- `C:\dev\git\stockify\src\service-worker.ts`
- `C:\dev\git\stockify\static\offline.html`
- `C:\dev\git\stockify\src\routes\+layout.svelte`
- `C:\dev\git\stockify\vite.config.ts`
- `C:\dev\git\stockify\src\app.html`
- `C:\dev\git\stockify\static\manifest.webmanifest`
- `C:\dev\git\stockify\src\pwa-manifest.test.ts`

参照コミット:

```text
646825c AndroidでPWAをWebAPKとしてインストール可能にする
78c3b85 Service WorkerのCDNキャッシュを回避する
```
