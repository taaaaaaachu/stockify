import { and, eq, desc, isNull, or, gt, count, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { randomBytes } from 'node:crypto';
import type { Db } from './db';
import {
	users,
	households,
	memberships,
	ownershipTransfers,
	invites,
	stockItems,
	passkeys,
	type UserRow,
	type PasskeyRow,
	type HouseholdRow,
	type InviteRow,
	type OwnershipTransferRow
} from './db/schema';
import type { HouseholdRole } from '#lib/rbac.js';

export function newId(): string {
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

/** 世帯を作成する。ownerUserIdがnullなら、招待待ちの空世帯にする。 */
export function createHousehold(db: Db, name: string, ownerUserId: string | null = null): HouseholdRow {
	const now = Date.now();
	const household: HouseholdRow = {
		id: newId(),
		name: name.trim() || '自宅',
		defaultLeadTimeDays: 7,
		createdAt: now
	};
	db.transaction((tx) => {
		tx.insert(households).values(household).run();
		if (ownerUserId) {
			tx.insert(memberships)
				.values({ id: newId(), userId: ownerUserId, householdId: household.id, role: 'owner', createdAt: now })
				.run();
		}
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

/** 世帯のmemberをmanagerへ任命する。既に管理者または非所属ならfalse。 */
export function promoteMemberToManager(db: Db, householdId: string, userId: string): boolean {
	const result = db
		.update(memberships)
		.set({ role: 'manager' })
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

/** managerをmemberへ戻す。 */
export function demoteManager(db: Db, householdId: string, userId: string): boolean {
	const result = db
		.update(memberships)
		.set({ role: 'member' })
		.where(and(eq(memberships.householdId, householdId), eq(memberships.userId, userId), eq(memberships.role, 'manager')))
		.run();
	return result.changes > 0;
}

/** owner以外の所属者を除名する。 */
export function removeHouseholdMember(db: Db, householdId: string, userId: string): boolean {
	const result = db
		.delete(memberships)
		.where(
			and(
				eq(memberships.householdId, householdId),
				eq(memberships.userId, userId),
				inArray(memberships.role, ['manager', 'member'])
			)
		)
		.run();
	return result.changes > 0;
}

/** manager/memberが脱退する。ownerと最後の所属者は脱退不可。 */
export function leaveHousehold(db: Db, householdId: string, userId: string): boolean {
	const membership = db
		.select({ role: memberships.role })
		.from(memberships)
		.where(and(eq(memberships.householdId, householdId), eq(memberships.userId, userId)))
		.get();
	if (!membership || membership.role === 'owner') return false;
	return db.delete(memberships).where(and(eq(memberships.householdId, householdId), eq(memberships.userId, userId))).run().changes > 0;
}

export interface OwnershipTransfer {
	id: string;
	householdId: string;
	householdName: string;
	currentOwnerId: string;
	currentOwnerName: string;
	candidateUserId: string;
	candidateUserName: string;
	createdAt: number;
}

function mapOwnershipTransfer(row: OwnershipTransferRow & { householdName: string; currentOwnerName: string; candidateUserName: string }): OwnershipTransfer {
	return { ...row, householdName: row.householdName, currentOwnerName: row.currentOwnerName, candidateUserName: row.candidateUserName };
}

/** ownerが交代候補を指名する。 */
export function requestOwnershipTransfer(db: Db, householdId: string, currentOwnerId: string, candidateUserId: string): OwnershipTransfer | null {
	const candidate = db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.householdId, householdId), eq(memberships.userId, candidateUserId))).get();
	if (!candidate || (candidate.role !== 'member' && candidate.role !== 'manager')) return null;
	const current = db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.householdId, householdId), eq(memberships.userId, currentOwnerId), eq(memberships.role, 'owner'))).get();
	if (!current) return null;
	const row: OwnershipTransferRow = { id: newId(), householdId, currentOwnerId, candidateUserId, createdAt: Date.now() };
	try {
		db.insert(ownershipTransfers).values(row).run();
	} catch {
		return null;
	}
	return getOwnershipTransfer(db, row.id);
}

export function getOwnershipTransfer(db: Db, id: string): OwnershipTransfer | null {
	const currentOwner = alias(users, 'transfer_current_owner');
	const candidate = alias(users, 'transfer_candidate');
	const row = db.select({ id: ownershipTransfers.id, householdId: ownershipTransfers.householdId, currentOwnerId: ownershipTransfers.currentOwnerId, candidateUserId: ownershipTransfers.candidateUserId, createdAt: ownershipTransfers.createdAt, householdName: households.name, currentOwnerName: currentOwner.username, candidateUserName: candidate.username }).from(ownershipTransfers).innerJoin(households, eq(ownershipTransfers.householdId, households.id)).innerJoin(currentOwner, eq(ownershipTransfers.currentOwnerId, currentOwner.id)).innerJoin(candidate, eq(ownershipTransfers.candidateUserId, candidate.id)).where(eq(ownershipTransfers.id, id)).get();
	return row ? mapOwnershipTransfer(row) : null;
}

export function listPendingOwnershipTransfers(db: Db, candidateUserId: string): OwnershipTransfer[] {
	const currentOwner = alias(users, 'pending_current_owner');
	const candidate = alias(users, 'pending_candidate');
	return db.select({ id: ownershipTransfers.id, householdId: ownershipTransfers.householdId, currentOwnerId: ownershipTransfers.currentOwnerId, candidateUserId: ownershipTransfers.candidateUserId, createdAt: ownershipTransfers.createdAt, householdName: households.name, currentOwnerName: currentOwner.username, candidateUserName: candidate.username }).from(ownershipTransfers).innerJoin(households, eq(ownershipTransfers.householdId, households.id)).innerJoin(currentOwner, eq(ownershipTransfers.currentOwnerId, currentOwner.id)).innerJoin(candidate, eq(ownershipTransfers.candidateUserId, candidate.id)).where(eq(ownershipTransfers.candidateUserId, candidateUserId)).all().map(mapOwnershipTransfer);
}

export function cancelOwnershipTransfer(db: Db, householdId: string, currentOwnerId: string): boolean {
	return db.delete(ownershipTransfers).where(and(eq(ownershipTransfers.householdId, householdId), eq(ownershipTransfers.currentOwnerId, currentOwnerId))).run().changes > 0;
}

export function rejectOwnershipTransfer(db: Db, id: string, candidateUserId: string): boolean {
	return db.delete(ownershipTransfers).where(and(eq(ownershipTransfers.id, id), eq(ownershipTransfers.candidateUserId, candidateUserId))).run().changes > 0;
}

export function acceptOwnershipTransfer(db: Db, id: string, candidateUserId: string): boolean {
	return db.transaction((tx) => {
		const transfer = tx.select().from(ownershipTransfers).where(and(eq(ownershipTransfers.id, id), eq(ownershipTransfers.candidateUserId, candidateUserId))).get();
		if (!transfer) return false;
		const oldOwner = tx.update(memberships).set({ role: 'manager' }).where(and(eq(memberships.householdId, transfer.householdId), eq(memberships.userId, transfer.currentOwnerId), eq(memberships.role, 'owner'))).run();
		const newOwner = tx.update(memberships).set({ role: 'owner' }).where(and(eq(memberships.householdId, transfer.householdId), eq(memberships.userId, candidateUserId), eq(memberships.role, 'member'))).run();
		const newOwnerFromManager = newOwner.changes > 0 ? newOwner : tx.update(memberships).set({ role: 'owner' }).where(and(eq(memberships.householdId, transfer.householdId), eq(memberships.userId, candidateUserId), eq(memberships.role, 'manager'))).run();
		if (oldOwner.changes === 0 || newOwnerFromManager.changes === 0) return false;
		tx.delete(ownershipTransfers).where(eq(ownershipTransfers.id, id)).run();
		return true;
	});
}

export interface UserHousehold {
	id: string;
	name: string;
	role: HouseholdRole;
	defaultLeadTimeDays: number;
	/** この世帯の購入リマインド通知を受け取るか。 */
	notifyEnabled: boolean;
}

export interface HouseholdSummary {
	id: string;
	name: string;
	memberCount: number;
	ownerCount: number;
	itemCount: number;
	createdAt: number;
	activeInviteCount: number;
}

/** super_admin向け。所属有無に関係なくメタデータだけを返す。 */
export function listHouseholdSummaries(db: Db): HouseholdSummary[] {
	const now = Date.now();
	return db
		.select({ id: households.id, name: households.name, createdAt: households.createdAt })
		.from(households)
		.orderBy(households.createdAt)
		.all()
		.map((household) => ({
			...household,
			memberCount: db
				.select({ value: count() })
				.from(memberships)
				.where(eq(memberships.householdId, household.id))
				.get()?.value ?? 0,
			ownerCount: db
				.select({ value: count() })
				.from(memberships)
				.where(and(eq(memberships.householdId, household.id), eq(memberships.role, 'owner')))
				.get()?.value ?? 0,
			itemCount: db
				.select({ value: count() })
				.from(stockItems)
				.where(eq(stockItems.householdId, household.id))
				.get()?.value ?? 0,
			activeInviteCount: db
				.select({ value: count() })
				.from(invites)
				.where(
					and(
						eq(invites.householdId, household.id),
						isNull(invites.usedBy),
						isNull(invites.revokedAt),
						or(isNull(invites.expiresAt), gt(invites.expiresAt, now))
					)
				)
				.get()?.value ?? 0
		}));
}

/** super_adminが世帯を完全削除する。関連データは外部キーのcascadeに任せる。 */
export function deleteHousehold(db: Db, householdId: string, expectedName: string): boolean {
	const household = db.select({ name: households.name }).from(households).where(eq(households.id, householdId)).get();
	if (!household || household.name !== expectedName.trim()) return false;
	return db.delete(households).where(eq(households.id, householdId)).run().changes > 0;
}

/** ユーザーが所属する世帯の一覧(作成順)。 */
export function listUserHouseholds(db: Db, userId: string): UserHousehold[] {
	return db
		.select({
			id: households.id,
			name: households.name,
			role: memberships.role,
			defaultLeadTimeDays: households.defaultLeadTimeDays,
			notifyEnabled: memberships.notifyEnabled
		})
		.from(memberships)
		.innerJoin(households, eq(memberships.householdId, households.id))
		.where(eq(memberships.userId, userId))
		.orderBy(households.createdAt)
		.all();
}

/**
 * ある世帯の購入リマインド通知を受け取るかどうかを、ユーザーごとに設定する。
 * 所属していない世帯を指定したときは何もしない(false を返す)。
 */
export function setHouseholdNotifyEnabled(
	db: Db,
	userId: string,
	householdId: string,
	enabled: boolean
): boolean {
	const result = db
		.update(memberships)
		.set({ notifyEnabled: enabled })
		.where(and(eq(memberships.userId, userId), eq(memberships.householdId, householdId)))
		.run();
	return result.changes > 0;
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

export type RegisterError =
	| 'invite_invalid'
	| 'invite_expired'
	| 'invite_used'
	| 'invite_revoked'
	| 'invite_required'
	| 'username_taken';
export const REGISTER_ERROR_MESSAGES: Record<RegisterError, string> = {
	invite_invalid: '招待コードが正しくありません。',
	invite_expired: 'この招待コードは有効期限が切れています。',
	invite_used: 'この招待コードは既に使われています。',
	invite_revoked: 'この招待コードは無効化されています。',
	invite_required: '現在は招待コードが必要です。',
	username_taken: 'このユーザー名は既に使われています。'
};
export type RegisterResult =
	| { ok: true; user: UserRow; householdId: string }
	| { ok: false; error: RegisterError };

/** 招待コードが登録に使えるか。使えなければ理由を返す。 */
function findInviteError(db: Db, code: string, now: number): { invite: InviteRow } | { error: RegisterError } {
	const invite = db.select().from(invites).where(eq(invites.code, code)).get();
	if (!invite) return { error: 'invite_invalid' };
	if (invite.revokedAt !== null) return { error: 'invite_revoked' };
	if (invite.usedBy) return { error: 'invite_used' };
	if (invite.expiresAt !== null && now >= invite.expiresAt) return { error: 'invite_expired' };
	return { invite };
}

/**
 * 登録できそうかを事前に確かめる(パスキー登録でブラウザの操作に入る前の検証)。
 * 確定の検証は registerUser のトランザクション内で改めて行う。
 */
export function precheckRegistration(
	db: Db,
	params: { username: string; requireInvite: boolean; inviteCode?: string }
): RegisterError | null {
	if (params.requireInvite) {
		const found = findInviteError(db, params.inviteCode ?? '', Date.now());
		if ('error' in found) return found.error;
	}
	const taken = db.select({ id: users.id }).from(users).where(eq(users.username, params.username.trim())).get();
	return taken ? 'username_taken' : null;
}

/**
 * ユーザーを作成する。
 * - requireInvite=false(ブートストラップ): super_admin として作成し、最初の世帯を作って owner にする。
 * - requireInvite=true: 招待コードを検証・消費し、その世帯に member として所属させる。
 * 招待検証・ユーザー作成・所属作成を 1 トランザクションで行う。
 */
export function registerUser(
	db: Db,
	params: {
		/** 省略時は新規採番。パスキー登録ではオプション生成時に決めた id を渡す。 */
		id?: string;
		username: string;
		/** null ならパスワードなし(passkey 必須)。 */
		passwordHash: string | null;
		/** パスキーで登録する場合の認証情報。ユーザー作成と同じトランザクションで保存する。 */
		passkey?: Omit<PasskeyRow, 'userId' | 'lastUsedAt'>;
		requireInvite: boolean;
		inviteCode?: string;
		/** ブートストラップ時に作る世帯名(既定「自宅」)。 */
		householdName?: string;
	}
): RegisterResult {
	if (!params.passwordHash && !params.passkey) {
		throw new Error('パスワードかパスキーのどちらかが必要です。');
	}
	const now = Date.now();
	return db.transaction((tx): RegisterResult => {
			let targetHouseholdId: string;
			let invite: InviteRow | undefined;

			if (params.requireInvite) {
				const found = findInviteError(tx, params.inviteCode ?? '', now);
				if ('error' in found) return { ok: false, error: found.error };
				invite = found.invite;
				targetHouseholdId = invite.householdId;
			} else {
				// 呼び出し側の事前確認は競合しうるため、トランザクション内でも再確認する。
				if (countUsers(tx) > 0) return { ok: false, error: 'invite_required' };
				targetHouseholdId = newId();
			}

			const user: UserRow = {
				id: params.id ?? newId(),
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

			if (params.passkey) {
				tx.insert(passkeys).values({ ...params.passkey, userId: user.id }).run();
			}

			if (params.requireInvite && invite) {
				// 招待経由 → 空世帯なら最初のowner、それ以外はmemberとして所属。
				const existingMembership = tx
					.select({ id: memberships.id })
					.from(memberships)
					.where(eq(memberships.householdId, targetHouseholdId))
					.get();
				tx.insert(memberships)
					.values({
						id: newId(),
						userId: user.id,
						householdId: targetHouseholdId,
						role: existingMembership ? 'member' : 'owner',
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

export type JoinHouseholdResult =
	| { ok: true; householdId: string; role: HouseholdRole }
	| { ok: false; error: Exclude<RegisterResult, { ok: true }>['error'] | 'already_member' };

/** ログイン済みユーザーが招待コードで世帯へ参加する。 */
export function joinHouseholdByInvite(db: Db, userId: string, inviteCode: string): JoinHouseholdResult {
	const now = Date.now();
	return db.transaction((tx): JoinHouseholdResult => {
		const invite = tx.select().from(invites).where(eq(invites.code, inviteCode.trim())).get();
		if (!invite) return { ok: false, error: 'invite_invalid' };
		if (invite.revokedAt !== null) return { ok: false, error: 'invite_revoked' };
		if (invite.usedBy) return { ok: false, error: 'invite_used' };
		if (invite.expiresAt !== null && now >= invite.expiresAt) return { ok: false, error: 'invite_expired' };
		const already = tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.householdId, invite.householdId))).get();
		if (already) return { ok: false, error: 'already_member' };
		const hasMember = tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.householdId, invite.householdId)).get();
		const role: HouseholdRole = hasMember ? 'member' : 'owner';
		tx.insert(memberships).values({ id: newId(), userId, householdId: invite.householdId, role, createdAt: now }).run();
		const consumed = tx.update(invites).set({ usedBy: userId, usedAt: now }).where(and(eq(invites.id, invite.id), isNull(invites.usedBy), isNull(invites.revokedAt))).run();
		if (consumed.changes === 0) return { ok: false, error: 'invite_used' };
		return { ok: true, householdId: invite.householdId, role };
	});
}
