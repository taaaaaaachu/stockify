# --- ビルドステージ ---
FROM node:24-trixie-slim AS build
WORKDIR /app

# better-sqlite3 / @node-rs/argon2 のネイティブビルドに備えて toolchain を入れる
# (プリビルドが使えれば実際にはコンパイルされない)。
RUN apt-get update && apt-get install -y --no-install-recommends \
	python3 make g++ && rm -rf /var/lib/apt/lists/*

# pnpm は package.json の packageManager に書いた版を corepack で使う。
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# 公開オリジンをビルドに焼き込むときだけ渡す(ローカル compose 用。本番の CI では渡さない)。
ARG ORIGIN
RUN ORIGIN=$ORIGIN pnpm build

# 本番用に devDependencies を落とす(ネイティブモジュールは残る)。
RUN pnpm prune --prod

# --- 実行ステージ ---
FROM node:24-trixie-slim
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
