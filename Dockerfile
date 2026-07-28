# --- ビルドステージ ---
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 / @node-rs/argon2 のネイティブビルドに備えて toolchain を入れる
# (プリビルドが使えれば実際にはコンパイルされない)。
RUN apt-get update && apt-get install -y --no-install-recommends \
	python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# 本番用に devDependencies を落とす(ネイティブモジュールは残る)。
RUN npm prune --omit=dev

# --- 実行ステージ ---
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/app.sqlite
ENV PORT=3000

COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

# SQLite ファイルの置き場(compose 側で名前付きボリュームをマウント)。
VOLUME /data
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
