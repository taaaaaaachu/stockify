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
	registerUser,
	promoteMemberToManager,
	requestOwnershipTransfer,
	acceptOwnershipTransfer,
	joinHouseholdByInvite,
	listPendingOwnershipTransfers,
	listHouseholdSummaries,
	removeHouseholdMember,
	setHouseholdNotifyEnabled
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
		const owner = registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false });
		if (!owner.ok) throw new Error('setup failed');
		const invite = createInvite(db, owner.householdId, owner.user.id, null);
		const owner2 = registerUser(db, {
			username: 'alice',
			passwordHash: 'x',
			requireInvite: true,
			inviteCode: invite.code
		});
		expect(owner2.ok).toBe(false);
		if (owner2.ok) return;
		expect(owner2.error).toBe('username_taken');
	});

	it('ブートストラップ判定を登録処理内でも再確認する', () => {
		registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false });
		const result = registerUser(db, { username: 'bob', passwordHash: 'x', requireInvite: false });
		expect(result).toEqual({ ok: false, error: 'invite_required' });
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

describe('世帯ごとの通知ON/OFF', () => {
	it('既定では全世帯が通知ONで、世帯単位で切り替えられる', () => {
		const r = registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false, householdName: '自宅' });
		if (!r.ok) throw new Error('setup failed');
		const jikka = createHousehold(db, '実家', r.user.id);

		expect(listUserHouseholds(db, r.user.id).every((h) => h.notifyEnabled)).toBe(true);

		expect(setHouseholdNotifyEnabled(db, r.user.id, jikka.id, false)).toBe(true);

		const after = listUserHouseholds(db, r.user.id);
		expect(after.find((h) => h.id === jikka.id)?.notifyEnabled).toBe(false);
		expect(after.find((h) => h.name === '自宅')?.notifyEnabled).toBe(true);

		// 元に戻せる。
		expect(setHouseholdNotifyEnabled(db, r.user.id, jikka.id, true)).toBe(true);
		expect(listUserHouseholds(db, r.user.id).every((h) => h.notifyEnabled)).toBe(true);
	});

	it('所属していない世帯を指定しても他ユーザーの設定は変えない', () => {
		const alice = registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false });
		if (!alice.ok) throw new Error('setup failed');
		const bobHouse = createHousehold(db, 'ボブの家');
		const invite = createInvite(db, bobHouse.id, alice.user.id, null);
		const bob = registerUser(db, { username: 'bob', passwordHash: 'x', requireInvite: true, inviteCode: invite.code });
		if (!bob.ok) throw new Error('setup failed');

		expect(setHouseholdNotifyEnabled(db, alice.user.id, bobHouse.id, false)).toBe(false);
		expect(listUserHouseholds(db, bob.user.id)[0].notifyEnabled).toBe(true);
	});
});

describe('世帯ロール管理', () => {
	it('空世帯への最初の参加者がownerになり、memberをmanagerへ任命できる', () => {
		const owner = registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false });
		if (!owner.ok) throw new Error('setup failed');
		const household = createHousehold(db, '新しい世帯');
		const invite = createInvite(db, household.id, owner.user.id, null);
		const member = registerUser(db, {
			username: 'bob',
			passwordHash: 'x',
			requireInvite: true,
			inviteCode: invite.code
		});
		if (!member.ok) throw new Error('setup failed');
		expect(getMembership(db, member.user.id, household.id)).toBe('owner');
		const secondInvite = createInvite(db, household.id, member.user.id, null);
		const third = registerUser(db, { username: 'carol', passwordHash: 'x', requireInvite: true, inviteCode: secondInvite.code });
		if (!third.ok) throw new Error('setup failed');
		expect(getMembership(db, third.user.id, household.id)).toBe('member');
		expect(promoteMemberToManager(db, household.id, third.user.id)).toBe(true);
		expect(getMembership(db, third.user.id, household.id)).toBe('manager');
		expect(promoteMemberToManager(db, household.id, third.user.id)).toBe(false);
	});

	it('ownerはmemberとmanagerを除名できるがownerは除名できない', () => {
		const first = registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false });
		if (!first.ok) throw new Error('setup failed');
		const invite = createInvite(db, first.householdId, first.user.id, null);
		const second = registerUser(db, { username: 'bob', passwordHash: 'x', requireInvite: true, inviteCode: invite.code });
		if (!second.ok) throw new Error('setup failed');
		const invite2 = createInvite(db, first.householdId, first.user.id, null);
		const third = registerUser(db, { username: 'carol', passwordHash: 'x', requireInvite: true, inviteCode: invite2.code });
		if (!third.ok) throw new Error('setup failed');
		expect(promoteMemberToManager(db, first.householdId, third.user.id)).toBe(true);
		expect(removeHouseholdMember(db, first.householdId, second.user.id)).toBe(true);
		expect(removeHouseholdMember(db, first.householdId, third.user.id)).toBe(true);
		expect(removeHouseholdMember(db, first.householdId, first.user.id)).toBe(false);
	});
});

describe('owner交代', () => {
	it('候補本人の承認でownerを交代し、旧ownerをmanagerにする', () => {
		const first = registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false });
		if (!first.ok) throw new Error('setup failed');
		const invite = createInvite(db, first.householdId, first.user.id, null);
		const second = registerUser(db, { username: 'bob', passwordHash: 'x', requireInvite: true, inviteCode: invite.code });
		if (!second.ok) throw new Error('setup failed');
		const transfer = requestOwnershipTransfer(db, first.householdId, first.user.id, second.user.id);
		if (!transfer) throw new Error('transfer request failed');
		expect(listPendingOwnershipTransfers(db, second.user.id)).toHaveLength(1);
		expect(acceptOwnershipTransfer(db, transfer.id, second.user.id)).toBe(true);
		expect(getMembership(db, first.user.id, first.householdId)).toBe('manager');
		expect(getMembership(db, second.user.id, first.householdId)).toBe('owner');
		expect(listPendingOwnershipTransfers(db, second.user.id)).toHaveLength(0);
	});
});

describe('既存アカウントの招待参加', () => {
	it('参加後は招待先世帯へ所属し、空世帯ならownerになる', () => {
		const first = registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false });
		if (!first.ok) throw new Error('setup failed');
		const household = createHousehold(db, '実家');
		const invite = createInvite(db, household.id, first.user.id, null);
		expect(joinHouseholdByInvite(db, first.user.id, invite.code)).toEqual({ ok: true, householdId: household.id, role: 'owner' });
		expect(getMembership(db, first.user.id, household.id)).toBe('owner');
	});
});

describe('アカウント画面の世帯情報', () => {
	it('マイグレーション後は交代申請と世帯サマリーを空状態でも取得できる', () => {
		expect(listPendingOwnershipTransfers(db, 'unknown-user')).toEqual([]);
		expect(listHouseholdSummaries(db)).toEqual([]);
	});

	it('世帯サマリーは所属数とowner数を集計する', () => {
		const result = registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false });
		if (!result.ok) throw new Error('setup failed');
		expect(listHouseholdSummaries(db)).toEqual([
			expect.objectContaining({ name: '自宅', memberCount: 1, ownerCount: 1, itemCount: 0, activeInviteCount: 0 })
		]);
	});
});

describe('inviteState', () => {
	it('期限切れを判定する', () => {
		expect(inviteState({ usedBy: null, expiresAt: 100, revokedAt: null }, 200)).toBe('expired');
		expect(inviteState({ usedBy: null, expiresAt: 300, revokedAt: null }, 200)).toBe('active');
	});
});
