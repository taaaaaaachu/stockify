import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb, type Db } from './db';
import {
	authAttemptKeyForTest,
	isAuthRateLimited,
	recordAuthFailure,
	resetUserAuthRateLimit,
	resetUserAuthRateLimitById
} from './authRateLimit';
import { authAttempts, users } from './db/schema';

let db: Db;
beforeEach(() => {
	db = createDb(':memory:');
	migrate(db, { migrationsFolder: './drizzle' });
	db.insert(users).values({
		id: 'user-1',
		username: 'alice',
		passwordHash: 'hash',
		mustChangePassword: false,
		instanceRole: 'user',
		notifyMinuteOfDay: 540,
		createdAt: 1
	}).run();
});

describe('認証試行制限', () => {
	it('同じユーザー名は15分以内の5回目の失敗から一時ブロックされる', () => {
		for (let i = 0; i < 4; i++) {
			recordAuthFailure('alice', '10.0.0.1', db, 1_000 + i);
			expect(isAuthRateLimited('alice', '10.0.0.1', db, 1_000 + i)).toBe(false);
		}
		recordAuthFailure('alice', '10.0.0.1', db, 2_000);
		expect(isAuthRateLimited('alice', '10.0.0.1', db, 2_000)).toBe(true);
		expect(isAuthRateLimited('alice', '10.0.0.2', db, 2_000)).toBe(true);
		expect(isAuthRateLimited('alice', '10.0.0.1', db, 2_000 + 15 * 60 * 1000)).toBe(false);
	});

	it('同じIPはユーザーをまたいで15分以内の20回目の失敗からブロックされる', () => {
		for (let i = 0; i < 19; i++) recordAuthFailure(`user-${i}`, '10.0.0.1', db, 1_000 + i);
		expect(isAuthRateLimited('another-user', '10.0.0.1', db, 2_000)).toBe(false);
		recordAuthFailure('another-user', '10.0.0.1', db, 2_000);
		expect(isAuthRateLimited('another-user', '10.0.0.1', db, 2_000)).toBe(true);
	});

	it('成功時はユーザー単位だけをリセットし、IP単位の制限は維持する', () => {
		for (let i = 0; i < 5; i++) recordAuthFailure('alice', '10.0.0.1', db, 1_000 + i);
		resetUserAuthRateLimit('alice', db, 2_000);
		expect(isAuthRateLimited('alice', '10.0.0.1', db, 2_000)).toBe(false);
		for (let i = 0; i < 15; i++) recordAuthFailure(`user-${i}`, '10.0.0.1', db, 3_000 + i);
		expect(isAuthRateLimited('another-user', '10.0.0.1', db, 4_000)).toBe(true);
	});

	it('super_adminのリセットは対象ユーザー単位だけを解除する', () => {
		for (let i = 0; i < 5; i++) recordAuthFailure('alice', '10.0.0.1', db, 1_000 + i);
		for (let i = 0; i < 19; i++) recordAuthFailure(`user-${i}`, '10.0.0.1', db, 1_000 + i);
		expect(isAuthRateLimited('alice', '10.0.0.1', db, 2_000)).toBe(true);
		resetUserAuthRateLimitById('user-1', db, 2_000);
		expect(db.select().from(authAttempts).all().find((row) => row.id === authAttemptKeyForTest('user', 'alice'))).toBeUndefined();
		expect(isAuthRateLimited('alice', '10.0.0.2', db, 2_000)).toBe(false);
		expect(isAuthRateLimited('another-user', '10.0.0.1', db, 2_000)).toBe(true);
	});

	it('24時間より古い状態は認証処理時に削除される', () => {
		db.insert(authAttempts).values({
		id: authAttemptKeyForTest('user', 'old-user'),
		scope: 'user',
		failedCount: 1,
		windowStartedAt: 1,
		blockedUntil: null,
		updatedAt: 1
		}).run();
		isAuthRateLimited('alice', '10.0.0.1', db, 24 * 60 * 60 * 1000 + 2);
		expect(db.select().from(authAttempts).all()).toHaveLength(0);
	});
});
