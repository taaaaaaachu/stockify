import { describe, it, expect, beforeEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb, type Db } from './db';
import {
	countUsers,
	createHousehold,
	getMembership,
	listUserHouseholds,
	createInvite,
	inviteState,
	listHouseholdInvites,
	revokeInvite,
	registerUser
} from './households';

let db: Db;

beforeEach(() => {
	db = createDb(':memory:');
	migrate(db, { migrationsFolder: './drizzle' });
});

describe('ブートストラップ登録', () => {
	it('最初の登録は super_admin になり世帯 owner として世帯が作られる', () => {
		expect(countUsers(db)).toBe(0);
		const r = registerUser(db, {
			username: 'alice',
			passwordHash: 'x',
			requireInvite: false,
			householdName: '自分の家'
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.user.instanceRole).toBe('super_admin');
		const households = listUserHouseholds(db, r.user.id);
		expect(households).toHaveLength(1);
		expect(households[0].name).toBe('自分の家');
		expect(households[0].role).toBe('owner');
	});
});

describe('招待経由の登録', () => {
	it('招待コードで既存世帯へ member として参加し、招待が消費される', () => {
		const owner = registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false });
		if (!owner.ok) throw new Error('setup failed');
		const invite = createInvite(db, owner.householdId, owner.user.id, null);

		const joiner = registerUser(db, {
			username: 'bob',
			passwordHash: 'x',
			requireInvite: true,
			inviteCode: invite.code
		});
		expect(joiner.ok).toBe(true);
		if (!joiner.ok) return;
		expect(joiner.user.instanceRole).toBe('user');
		expect(joiner.householdId).toBe(owner.householdId);
		expect(getMembership(db, joiner.user.id, owner.householdId)).toBe('member');

		const invites = listHouseholdInvites(db, owner.householdId);
		expect(invites[0].state).toBe('used');
		expect(invites[0].invitee).toBe('bob');
	});

	it('無効な招待コードは拒否される', () => {
		registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false });
		const r = registerUser(db, {
			username: 'bob',
			passwordHash: 'x',
			requireInvite: true,
			inviteCode: 'nope'
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe('invite_invalid');
	});

	it('使用済み招待は再利用できない', () => {
		const owner = registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false });
		if (!owner.ok) throw new Error('setup failed');
		const invite = createInvite(db, owner.householdId, owner.user.id, null);
		registerUser(db, { username: 'bob', passwordHash: 'x', requireInvite: true, inviteCode: invite.code });
		const again = registerUser(db, {
			username: 'carol',
			passwordHash: 'x',
			requireInvite: true,
			inviteCode: invite.code
		});
		expect(again.ok).toBe(false);
		if (again.ok) return;
		expect(again.error).toBe('invite_used');
	});

	it('無効化された招待は使えない', () => {
		const owner = registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false });
		if (!owner.ok) throw new Error('setup failed');
		const invite = createInvite(db, owner.householdId, owner.user.id, null);
		expect(revokeInvite(db, owner.householdId, invite.id)).toBe(true);
		const r = registerUser(db, {
			username: 'bob',
			passwordHash: 'x',
			requireInvite: true,
			inviteCode: invite.code
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe('invite_revoked');
	});

	it('ユーザー名重複は拒否される', () => {
		registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false });
		const owner2 = registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false });
		expect(owner2.ok).toBe(false);
		if (owner2.ok) return;
		expect(owner2.error).toBe('username_taken');
	});
});

describe('複数世帯所属', () => {
	it('1 ユーザーが複数世帯に owner として所属できる', () => {
		const r = registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false });
		if (!r.ok) throw new Error('setup failed');
		createHousehold(db, '実家', r.user.id);
		const households = listUserHouseholds(db, r.user.id);
		expect(households).toHaveLength(2);
		expect(households.every((h) => h.role === 'owner')).toBe(true);
	});
});

describe('inviteState', () => {
	it('期限切れを判定する', () => {
		expect(inviteState({ usedBy: null, expiresAt: 100, revokedAt: null }, 200)).toBe('expired');
		expect(inviteState({ usedBy: null, expiresAt: 300, revokedAt: null }, 200)).toBe('active');
	});
});
