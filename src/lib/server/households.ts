import { and, eq, desc, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { randomBytes } from 'node:crypto';
import type { Db } from './db';
import {
	users,
	households,
	memberships,
	invites,
	type UserRow,
	type HouseholdRow,
	type InviteRow
} from './db/schema';
import type { HouseholdRole } from '$lib/rbac';

function newId(): string {
	return randomBytes(16).toString('hex');
}

/** 人が入力しうる招待コード(base64url・12文字程度)。 */
function newInviteCode(): string {
	return randomBytes(9).toString('base64url');
}

/** 登録済みユーザー数。0 のときだけ招待コードなしの登録を許す(ブートストラップ)。 */
export function countUsers(db: Db): number {
	return db.select({ id: users.id }).from(users).all().length;
}

/** 世帯を作成し、作成者を owner として所属させる。 */
export function createHousehold(db: Db, name: string, ownerUserId: string): HouseholdRow {
	const now = Date.now();
	const household: HouseholdRow = {
		id: newId(),
		name: name.trim() || '自宅',
		defaultLeadTimeDays: 7,
		createdAt: now
	};
	db.transaction((tx) => {
		tx.insert(households).values(household).run();
		tx.insert(memberships)
			.values({ id: newId(), userId: ownerUserId, householdId: household.id, role: 'owner', createdAt: now })
			.run();
	});
	return household;
}

/** ユーザーの、ある世帯での役割。非所属なら null。 */
export function getMembership(db: Db, userId: string, householdId: string): HouseholdRole | null {
	const row = db
		.select({ role: memberships.role })
		.from(memberships)
		.where(and(eq(memberships.userId, userId), eq(memberships.householdId, householdId)))
		.get();
	return row?.role ?? null;
}

export interface HouseholdMember {
	userId: string;
	username: string;
	role: HouseholdRole;
}

/** 世帯のメンバー一覧を返す。 */
export function listHouseholdMembers(db: Db, householdId: string): HouseholdMember[] {
	return db
		.select({ userId: users.id, username: users.username, role: memberships.role })
		.from(memberships)
		.innerJoin(users, eq(memberships.userId, users.id))
		.where(eq(memberships.householdId, householdId))
		.orderBy(users.username)
		.all();
}

/** 世帯のmemberをownerへ昇格する。既にownerまたは非所属ならfalse。 */
export function promoteMemberToOwner(db: Db, householdId: string, userId: string): boolean {
	const result = db
		.update(memberships)
		.set({ role: 'owner' })
		.where(
			and(
				eq(memberships.householdId, householdId),
				eq(memberships.userId, userId),
				eq(memberships.role, 'member')
			)
		)
		.run();
	return result.changes > 0;
}

export interface UserHousehold {
	id: string;
	name: string;
	role: HouseholdRole;
	defaultLeadTimeDays: number;
}

/** ユーザーが所属する世帯の一覧(作成順)。 */
export function listUserHouseholds(db: Db, userId: string): UserHousehold[] {
	return db
		.select({
			id: households.id,
			name: households.name,
			role: memberships.role,
			defaultLeadTimeDays: households.defaultLeadTimeDays
		})
		.from(memberships)
		.innerJoin(households, eq(memberships.householdId, households.id))
		.where(eq(memberships.userId, userId))
		.orderBy(households.createdAt)
		.all();
}

/** 世帯設定(既定リードタイム)を更新する。 */
export function updateHouseholdSettings(
	db: Db,
	householdId: string,
	patch: { defaultLeadTimeDays?: number }
): void {
	if (patch.defaultLeadTimeDays === undefined) return;
	db.update(households)
		.set({ defaultLeadTimeDays: patch.defaultLeadTimeDays })
		.where(eq(households.id, householdId))
		.run();
}

// --- 招待 ---

export function createInvite(
	db: Db,
	householdId: string,
	userId: string,
	expiresAt: number | null
): InviteRow {
	for (let i = 0; i < 5; i++) {
		const row: InviteRow = {
			id: newId(),
			code: newInviteCode(),
			householdId,
			createdBy: userId,
			createdAt: Date.now(),
			expiresAt,
			usedBy: null,
			usedAt: null,
			revokedAt: null
		};
		try {
			db.insert(invites).values(row).run();
			return row;
		} catch {
			// code の UNIQUE 衝突 → 生成し直し。
		}
	}
	throw new Error('招待コードの生成に失敗しました。');
}

export type InviteState = 'active' | 'used' | 'expired' | 'revoked';

/** 招待の状態。優先順位: revoked > used > expired > active。 */
export function inviteState(
	inv: Pick<InviteRow, 'usedBy' | 'expiresAt' | 'revokedAt'>,
	now = Date.now()
): InviteState {
	if (inv.revokedAt !== null) return 'revoked';
	if (inv.usedBy) return 'used';
	if (inv.expiresAt !== null && now >= inv.expiresAt) return 'expired';
	return 'active';
}

export interface HouseholdInvite {
	id: string;
	code: string;
	createdAt: number;
	expiresAt: number | null;
	usedAt: number | null;
	revokedAt: number | null;
	issuer: string | null;
	invitee: string | null;
	state: InviteState;
}

/** ある世帯の招待を新しい順に返す。 */
export function listHouseholdInvites(db: Db, householdId: string): HouseholdInvite[] {
	const issuer = alias(users, 'issuer');
	const invitee = alias(users, 'invitee');
	const now = Date.now();
	return db
		.select({
			id: invites.id,
			code: invites.code,
			createdAt: invites.createdAt,
			expiresAt: invites.expiresAt,
			usedAt: invites.usedAt,
			revokedAt: invites.revokedAt,
			usedBy: invites.usedBy,
			issuer: issuer.username,
			invitee: invitee.username
		})
		.from(invites)
		.leftJoin(issuer, eq(invites.createdBy, issuer.id))
		.leftJoin(invitee, eq(invites.usedBy, invitee.id))
		.where(eq(invites.householdId, householdId))
		.orderBy(desc(invites.createdAt))
		.all()
		.map((r) => ({
			id: r.id,
			code: r.code,
			createdAt: r.createdAt,
			expiresAt: r.expiresAt,
			usedAt: r.usedAt,
			revokedAt: r.revokedAt,
			issuer: r.issuer,
			invitee: r.invitee,
			state: inviteState({ usedBy: r.usedBy, expiresAt: r.expiresAt, revokedAt: r.revokedAt }, now)
		}));
}

/** 招待を無効化する(その世帯のもののみ、未使用・未無効化が対象)。 */
export function revokeInvite(db: Db, householdId: string, id: string): boolean {
	const res = db
		.update(invites)
		.set({ revokedAt: Date.now() })
		.where(
			and(
				eq(invites.id, id),
				eq(invites.householdId, householdId),
				isNull(invites.usedBy),
				isNull(invites.revokedAt)
			)
		)
		.run();
	return res.changes > 0;
}

/** 招待を完全に削除する(その世帯のもののみ)。 */
export function deleteInvite(db: Db, householdId: string, id: string): boolean {
	const res = db
		.delete(invites)
		.where(and(eq(invites.id, id), eq(invites.householdId, householdId)))
		.run();
	return res.changes > 0;
}

// --- ユーザー登録(ブートストラップ or 招待経由) ---

export type RegisterResult =
	| { ok: true; user: UserRow; householdId: string }
	| {
			ok: false;
			error:
				| 'invite_invalid'
				| 'invite_expired'
				| 'invite_used'
				| 'invite_revoked'
				| 'invite_required'
				| 'username_taken';
		};

/**
 * ユーザーを作成する。
 * - requireInvite=false(ブートストラップ): super_admin として作成し、最初の世帯を作って owner にする。
 * - requireInvite=true: 招待コードを検証・消費し、その世帯に member として所属させる。
 * 招待検証・ユーザー作成・所属作成を 1 トランザクションで行う。
 */
export function registerUser(
	db: Db,
	params: {
		username: string;
		passwordHash: string;
		requireInvite: boolean;
		inviteCode?: string;
		/** ブートストラップ時に作る世帯名(既定「自宅」)。 */
		householdName?: string;
	}
): RegisterResult {
	const now = Date.now();
	return db.transaction((tx): RegisterResult => {
			let targetHouseholdId: string;
			let invite: InviteRow | undefined;

			if (params.requireInvite) {
				invite = tx
					.select()
					.from(invites)
					.where(eq(invites.code, params.inviteCode ?? ''))
					.get();
				if (!invite) return { ok: false, error: 'invite_invalid' };
				if (invite.revokedAt !== null) return { ok: false, error: 'invite_revoked' };
				if (invite.usedBy) return { ok: false, error: 'invite_used' };
				if (invite.expiresAt !== null && now >= invite.expiresAt) {
					return { ok: false, error: 'invite_expired' };
				}
				targetHouseholdId = invite.householdId;
			} else {
				// 呼び出し側の事前確認は競合しうるため、トランザクション内でも再確認する。
				if (countUsers(tx) > 0) return { ok: false, error: 'invite_required' };
				targetHouseholdId = newId();
			}

			const user: UserRow = {
				id: newId(),
				username: params.username.trim(),
				passwordHash: params.passwordHash,
				mustChangePassword: false,
				instanceRole: params.requireInvite ? 'user' : 'super_admin',
				notifyMinuteOfDay: 540,
				createdAt: now
			};
			try {
				tx.insert(users).values(user).run();
			} catch (cause) {
				if ((cause as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE')
					return { ok: false, error: 'username_taken' };
				throw cause;
			}

			if (params.requireInvite && invite) {
				// 招待経由 → その世帯へ member として所属し、招待を消費する。
				tx.insert(memberships)
					.values({
						id: newId(),
						userId: user.id,
						householdId: targetHouseholdId,
						role: 'member',
						createdAt: now
					})
					.run();
				tx.update(invites)
					.set({ usedBy: user.id, usedAt: now })
					.where(and(eq(invites.id, invite.id), eq(invites.code, invite.code)))
					.run();
			} else {
				// ブートストラップ → 最初の世帯を作り owner として所属。
				tx.insert(households)
					.values({
						id: targetHouseholdId,
						name: (params.householdName ?? '').trim() || '自宅',
						defaultLeadTimeDays: 7,
						createdAt: now
					})
					.run();
				tx.insert(memberships)
					.values({
						id: newId(),
						userId: user.id,
						householdId: targetHouseholdId,
						role: 'owner',
						createdAt: now
					})
					.run();
			}

			return { ok: true, user, householdId: targetHouseholdId };
	});
}
