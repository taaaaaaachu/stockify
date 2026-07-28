#!/bin/sh
set -e

# 起動時に DB マイグレーションを適用してからサーバーを起動する。
echo "マイグレーションを適用します (DATABASE_PATH=$DATABASE_PATH)"
node scripts/migrate.js

echo "サーバーを起動します (PORT=$PORT)"
exec node build
