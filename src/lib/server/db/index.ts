import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DATABASE_PATH } from '$app/env/private';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

/** 指定パスの SQLite に接続した drizzle インスタンスを作る(テストからも利用)。 */
export function createDb(dbPath: string): Db {
	if (dbPath !== ':memory:') {
		mkdirSync(dirname(dbPath), { recursive: true });
	}
	const sqlite = new Database(dbPath);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	return drizzle(sqlite, { schema });
}

// 本番/実行時のシングルトン。import 時ではなく初回アクセス時に開く(遅延初期化)。
let instance: Db | null = null;
function resolveDb(): Db {
	if (!instance) {
		instance = createDb(DATABASE_PATH);
	}
	return instance;
}

/** アプリ実行時に使う DB。初回アクセスで接続を開く。 */
export const db = new Proxy({} as Db, {
	get(_target, prop, receiver) {
		const real = resolveDb() as unknown as Record<string | symbol, unknown>;
		const value = Reflect.get(real, prop, receiver);
		return typeof value === 'function' ? value.bind(real) : value;
	}
});

export { schema };
