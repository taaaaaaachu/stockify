import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb, type Db } from './db';
import {
	changePassword,
	deleteUserAccount,
	hashSessionToken,
	isRecentlyVerified,
	listUsers,
	RECENT_AUTH_MS,
	resetPassword,
	verifyUserPassword
} from './auth';
import { sessions, users, memberships, invites, passkeys } from './db/schema';
import { createHousehold } from './households';

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

	it('管理者リセットでは対象の全パスキーも消え、他人のパスキーは残る(認証情報の全初期化)', () => {
		db.insert(users).values({ ...user, id: 'other', username: 'other' }).run();
		const pk = { publicKey: Buffer.from([1]), counter: 0, transports: null, name: 'p', createdAt: 0 };
		db.insert(passkeys).values([
			{ ...pk, id: 'pk-1', userId: user.id },
			{ ...pk, id: 'pk-2', userId: user.id },
			{ ...pk, id: 'pk-other', userId: 'other' }
		]).run();

		expect(resetPassword(user.id, 'temporary-hash', db)).toBe(true);
		expect(db.select().from(passkeys).all().map((p) => p.id)).toEqual(['pk-other']);
	});

	it('管理者一覧は認証情報を返さない', () => {
		expect(listUsers(db)).toEqual([{ id: user.id, username: user.username }]);
	});

	it('ownerの世帯が残っているユーザーは削除できない', () => {
		createHousehold(db, '自宅', user.id);
		expect(deleteUserAccount(user.id, db)).toEqual({ ok: false, error: 'owns_household' });
		expect(db.select().from(users).where(eq(users.id, user.id)).get()).toBeTruthy();
	});

	it('ownerでないユーザーを削除すると所属・セッション・招待の参照を整理する', () => {
		const owner = { ...user, id: 'owner-1', username: 'owner' };
		db.insert(users).values(owner).run();
		const household = createHousehold(db, '共有世帯', owner.id);
		db.insert(memberships).values({ id: 'membership-1', userId: user.id, householdId: household.id, role: 'member', createdAt: 2 }).run();
		db.insert(sessions).values({ id: 'session-1', userId: user.id, expiresAt: 1000 }).run();
		db.insert(invites).values({ id: 'invite-1', code: 'invite-1', householdId: household.id, createdBy: user.id, createdAt: 1, expiresAt: null, usedBy: user.id, usedAt: 2, revokedAt: null }).run();

		expect(deleteUserAccount(user.id, db)).toEqual({ ok: true });
		expect(db.select().from(users).where(eq(users.id, user.id)).get()).toBeUndefined();
		expect(db.select().from(memberships).where(eq(memberships.userId, user.id)).all()).toHaveLength(0);
		expect(db.select().from(sessions).where(eq(sessions.userId, user.id)).all()).toHaveLength(0);
		expect(db.select().from(invites).where(eq(invites.id, 'invite-1')).get()).toMatchObject({ createdBy: null, usedBy: null });
	});

	it('最後のsuper_adminは削除できない', () => {
		db.update(users).set({ instanceRole: 'super_admin' }).where(eq(users.id, user.id)).run();
		expect(deleteUserAccount(user.id, db)).toEqual({ ok: false, error: 'last_super_admin' });
	});
});

describe('verifyUserPassword', () => {
	it('パスワードのない会員(パスキーのみ)は常に失敗する', async () => {
		db.update(users).set({ passwordHash: null }).where(eq(users.id, user.id)).run();
		expect(await verifyUserPassword(user.id, 'anything', db)).toBe(false);
	});
});

describe('isRecentlyVerified', () => {
	it('猶予内なら true、猶予切れ・未確認なら false', () => {
		const now = 1_000_000_000;
		expect(isRecentlyVerified(now - RECENT_AUTH_MS + 1, now)).toBe(true);
		expect(isRecentlyVerified(now - RECENT_AUTH_MS, now)).toBe(false);
		expect(isRecentlyVerified(null, now)).toBe(false);
	});
});
