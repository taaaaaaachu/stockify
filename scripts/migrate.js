// SQLite にマイグレーションを適用する。起動前(またはコンテナ起動時)に実行する。
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 開いた SQLite にマイグレーションを適用する。外部キー違反が残れば例外。
 * @param {import('better-sqlite3').Database} sqlite
 */
export function applyMigrations(sqlite, migrationsFolder = './drizzle') {
	// テーブルを作り直すマイグレーションはトランザクション内で走るため、SQL 中の
	// `PRAGMA foreign_keys=OFF` が効かない。ここで切っておかないと DROP TABLE の巻き添えで
	// ON DELETE CASCADE / SET NULL が走り、関連テーブルのデータが消える。
	sqlite.pragma('foreign_keys = OFF');
	migrate(drizzle(sqlite), { migrationsFolder });
	const violations = /** @type {unknown[]} */ (sqlite.pragma('foreign_key_check'));
	sqlite.pragma('foreign_keys = ON');
	if (violations.length > 0) {
		throw new Error(`外部キー違反があります: ${JSON.stringify(violations)}`);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const dbPath = process.env.DATABASE_PATH ?? './data/app.sqlite';
	mkdirSync(dirname(dbPath), { recursive: true });

	const sqlite = new Database(dbPath);
	sqlite.pragma('journal_mode = WAL');
	applyMigrations(sqlite);
	console.log(`マイグレーション適用完了: ${dbPath}`);
	sqlite.close();
}
