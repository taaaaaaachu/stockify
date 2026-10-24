# プロジェクト固有の指示

## 開発ツールの実行

- Node.js/pnpm などの mise 管理ツールを使うときは、プロジェクトで利用するランタイムを明示し、PowerShell では `--command` 形式で実行する。
- 例: `mise exec node@24.13.1 --command "pnpm test"`
- `mise exec -- pnpm test` はこの環境の mise / PowerShell ではコマンドとして解釈されないため使用しない。

## Git 操作

- この環境では `.git` への書き込みが通常のサンドボックス内で拒否されるため、`git add`、`git commit`、ブランチ操作など `.git` を変更する操作はサンドボックス外実行の承認を要求する。
- コミット前に、mise 経由で関連テストを実行して成功を確認する。
