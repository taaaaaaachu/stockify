import { createHash } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { db as defaultDb, type Db } from './db';
import { authAttempts, users } from './db/schema';

export const AUTH_WINDOW_MS = 15 * 60 * 1000;
export const AUTH_BLOCK_MS = 15 * 60 * 1000;
export const AUTH_RETENTION_MS = 24 * 60 * 60 * 1000;
const USER_LIMIT = 5;
const IP_LIMIT = 20;

type Scope = 'user' | 'ip';

function canonicalUsername(username: string): string {
	return username.trim();
}

function key(scope: Scope, value: string): string {
	return createHash('sha256').update(`stockify-auth-attempt:${scope}:${value}`, 'utf8').digest('hex');
}

function cleanup(database: Db, now: number): void {
	database.delete(authAttempts).where(lt(authAttempts.updatedAt, now - AUTH_RETENTION_MS)).run();
}

function isBlocked(row: typeof authAttempts.$inferSelect | undefined, now: number): boolean {
	return row?.blockedUntil != null && row.blockedUntil > now;
}

export function isAuthRateLimited(
	username: string,
	ip: string,
	database: Db = defaultDb,
	now = Date.now()
): boolean {
	cleanup(database, now);
	const userRow = database.select().from(authAttempts).where(eq(authAttempts.id, key('user', canonicalUsername(username)))).get();
	const ipRow = database.select().from(authAttempts).where(eq(authAttempts.id, key('ip', ip))).get();
	return isBlocked(userRow, now) || isBlocked(ipRow, now);
}

function recordScopeFailure(scope: Scope, value: string, limit: number, database: Db, now: number): void {
	const id = key(scope, value);
	const current = database.select().from(authAttempts).where(eq(authAttempts.id, id)).get();
	const inWindow = current && now - current.windowStartedAt < AUTH_WINDOW_MS;
	const failedCount = inWindow ? current.failedCount + 1 : 1;
	const blockedUntil = failedCount >= limit ? now + AUTH_BLOCK_MS : null;
	const row = {
		id,
		scope,
		failedCount,
		windowStartedAt: inWindow ? current.windowStartedAt : now,
		blockedUntil,
		updatedAt: now
	};
	if (current) database.update(authAttempts).set(row).where(eq(authAttempts.id, id)).run();
	else database.insert(authAttempts).values(row).run();
}

/** 失敗はユーザー単位とIP単位の両方に記録し、入口をまたいで共有する。 */
export function recordAuthFailure(username: string, ip: string, database: Db = defaultDb, now = Date.now()): void {
	database.transaction((tx) => {
		cleanup(tx, now);
		recordScopeFailure('user', canonicalUsername(username), USER_LIMIT, tx, now);
		recordScopeFailure('ip', ip, IP_LIMIT, tx, now);
	});
}

/** 正常認証時はユーザー単位だけをリセットする。IP単位の履歴は維持する。 */
export function resetUserAuthRateLimit(username: string, database: Db = defaultDb, now = Date.now()): void {
	cleanup(database, now);
	database.delete(authAttempts).where(and(eq(authAttempts.scope, 'user'), eq(authAttempts.id, key('user', canonicalUsername(username))))).run();
}

/** super_adminのパスワードリセット時に対象ユーザー単位だけをリセットする。 */
export function resetUserAuthRateLimitById(userId: string, database: Db = defaultDb, now = Date.now()): void {
	const user = database.select({ username: users.username }).from(users).where(eq(users.id, userId)).get();
	if (user) resetUserAuthRateLimit(user.username, database, now);
}

export function authAttemptKeyForTest(scope: Scope, value: string): string {
	return key(scope, scope === 'user' ? canonicalUsername(value) : value);
}
