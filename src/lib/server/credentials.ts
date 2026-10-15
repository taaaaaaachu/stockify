import { and, eq, ne, asc } from 'drizzle-orm';
import type { Db } from './db';
import { users, sessions, passkeys, type PasskeyRow } from './db/schema';

/**
 * 会員の認証情報(パスワード 0〜1 + パスキー 0〜n)の操作。
 * 「常にどちらか1つ以上を持つ」をここで保証する(ADR 0010)。
 */

export interface PasskeySummary {
	id: string;
	name: string;
	createdAt: number;
	lastUsedAt: number | null;
}

export interface CredentialSummary {
	hasPassword: boolean;
	passkeys: PasskeySummary[];
}

export type CredentialError = 'not_found' | 'last_credential';
export type CredentialResult = { ok: true } | { ok: false; error: CredentialError };

export const DEFAULT_PASSKEY_NAME = 'パスキー';

/** パスキー名を整える。空なら既定名。長すぎれば null。 */
export function normalizePasskeyName(name: unknown): string | null {
	const n = typeof name === 'string' ? name.trim() : '';
	if (n.length > 50) return null;
	return n || DEFAULT_PASSKEY_NAME;
}

export function getCredentialSummary(db: Db, userId: string): CredentialSummary {
	const user = db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).get();
	return {
		hasPassword: !!user?.passwordHash,
		passkeys: db
			.select({
				id: passkeys.id,
				name: passkeys.name,
				createdAt: passkeys.createdAt,
				lastUsedAt: passkeys.lastUsedAt
			})
			.from(passkeys)
			.where(eq(passkeys.userId, userId))
			.orderBy(asc(passkeys.createdAt))
			.all()
	};
}

export function getPasskey(db: Db, id: string): PasskeyRow | undefined {
	return db.select().from(passkeys).where(eq(passkeys.id, id)).get();
}

export function listPasskeyIds(db: Db, userId: string): { id: string; transports: string | null }[] {
	return db
		.select({ id: passkeys.id, transports: passkeys.transports })
		.from(passkeys)
		.where(eq(passkeys.userId, userId))
		.all();
}

export function addPasskey(db: Db, row: Omit<PasskeyRow, 'lastUsedAt'>): void {
	db.insert(passkeys).values(row).run();
}

/** ログインに使われたパスキーのカウンタと最終使用日時を更新する。 */
export function recordPasskeyUse(db: Db, id: string, counter: number): void {
	db.update(passkeys).set({ counter, lastUsedAt: Date.now() }).where(eq(passkeys.id, id)).run();
}

export function renamePasskey(db: Db, userId: string, id: string, name: string): CredentialResult {
	const res = db
		.update(passkeys)
		.set({ name })
		.where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
		.run();
	return res.changes > 0 ? { ok: true } : { ok: false, error: 'not_found' };
}

/** 操作端末(keepSessionId)以外の、そのユーザーのセッションを無効化する。 */
function deleteOtherSessions(db: Db, userId: string, keepSessionId: string): void {
	db.delete(sessions)
		.where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)))
		.run();
}

/** パスキーを削除する。最後の認証情報なら拒否。操作端末以外のセッションを無効化する。 */
export function deletePasskey(db: Db, userId: string, id: string, keepSessionId: string): CredentialResult {
	// better-sqlite3 は同期・単一接続なので、コールバック内の db 操作も同じトランザクションに入る。
	return db.transaction((): CredentialResult => {
		const summary = getCredentialSummary(db, userId);
		if (!summary.passkeys.some((p) => p.id === id)) return { ok: false, error: 'not_found' };
		if (!summary.hasPassword && summary.passkeys.length <= 1) {
			return { ok: false, error: 'last_credential' };
		}
		db.delete(passkeys).where(eq(passkeys.id, id)).run();
		deleteOtherSessions(db, userId, keepSessionId);
		return { ok: true };
	});
}

/** パスワードを削除する(パスキーのみの会員にする)。パスキーが無ければ拒否。 */
export function removePassword(db: Db, userId: string, keepSessionId: string): CredentialResult {
	// better-sqlite3 は同期・単一接続なので、コールバック内の db 操作も同じトランザクションに入る。
	return db.transaction((): CredentialResult => {
		const summary = getCredentialSummary(db, userId);
		if (!summary.hasPassword) return { ok: false, error: 'not_found' };
		if (summary.passkeys.length === 0) return { ok: false, error: 'last_credential' };
		db.update(users).set({ passwordHash: null }).where(eq(users.id, userId)).run();
		deleteOtherSessions(db, userId, keepSessionId);
		return { ok: true };
	});
}
