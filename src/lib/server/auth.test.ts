import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb, type Db } from './db';
import { changePassword, hashSessionToken, listUsers, resetPassword } from './auth';
import { sessions, users } from './db/schema';

let db: Db;
const user = {
	id: 'user-1',
	username: 'alice',
	passwordHash: 'old-hash',
	mustChangePassword: false,
	instanceRole: 'user' as const,
	notifyMinuteOfDay: 540,
	createdAt: 1
};

beforeEach(() => {
	db = createDb(':memory:');
	migrate(db, { migrationsFolder: './drizzle' });
	db.insert(users).values(user).run();
});

describe('パスワードセッション管理', () => {
	it('本人変更では現在のセッションだけを残し、強制変更状態を解除する', () => {
		const currentToken = 'current-token';
		const otherToken = 'other-token';
		db.insert(sessions).values([
			{ id: hashSessionToken(currentToken), userId: user.id, expiresAt: 1000 },
			{ id: hashSessionToken(otherToken), userId: user.id, expiresAt: 1000 }
		]).run();

		changePassword(user.id, 'new-hash', currentToken, db);

		expect(db.select().from(sessions).all().map((session) => session.id)).toEqual([
			hashSessionToken(currentToken)
		]);
		expect(db.select().from(users).where(eq(users.id, user.id)).get()?.mustChangePassword).toBe(false);
	});

	it('管理者リセットでは全セッションを削除して次回変更を要求する', () => {
		db.insert(sessions).values({ id: hashSessionToken('session'), userId: user.id, expiresAt: 1000 }).run();

		expect(resetPassword(user.id, 'temporary-hash', db)).toBe(true);
		expect(db.select().from(sessions).all()).toHaveLength(0);
		expect(db.select().from(users).where(eq(users.id, user.id)).get()?.mustChangePassword).toBe(true);
	});

	it('管理者一覧は認証情報を返さない', () => {
		expect(listUsers(db)).toEqual([{ id: user.id, username: user.username }]);
	});
});
