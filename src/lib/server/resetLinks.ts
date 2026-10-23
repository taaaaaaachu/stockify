import { and, eq, gt } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db';
import { users, sessions, passkeys, resetLinks, type PasskeyRow } from './db/schema';

/**
 * リセットリンク(ADR 0011)。発行しただけでは何も変えず、使った時点で
 * 認証情報(パスワード・全パスキー・全セッション)を初期化して新しいものに置き換える。
 * 発行・取り消しの権限(super_admin が自分以外に)は呼び出し側で確かめる。
 */

export const RESET_LINK_TTL_MS = 1000 * 60 * 60 * 24;

export const RESET_LINK_INVALID = 'このリンクは使えません(期限切れ・使用済み・取り消し済み)。管理者に再発行を依頼してください。';

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** リンクを発行する。未使用の古いリンクは置き換わって使えなくなる。対象が居なければ null。 */
export function issueResetLink(
	db: Db,
	createdBy: string,
	userId: string,
	now = Date.now()
): { token: string; expiresAt: number } | null {
	if (!db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get()) return null;
	const token = randomBytes(32).toString('base64url');
	const expiresAt = now + RESET_LINK_TTL_MS;
	db.transaction(() => {
		db.delete(resetLinks).where(eq(resetLinks.userId, userId)).run();
		db.insert(resetLinks).values({ id: hashToken(token), userId, createdBy, createdAt: now, expiresAt }).run();
	});
	return { token, expiresAt };
}

/** 未使用のリンクを取り消す。 */
export function revokeResetLink(db: Db, userId: string): void {
	db.delete(resetLinks).where(eq(resetLinks.userId, userId)).run();
}

/** 有効なリンクの対象者。無効(不明・期限切れ・使用済み・取り消し済み)なら null。 */
export function findResetLink(db: Db, token: string, now = Date.now()): { userId: string; username: string } | null {
	return (
		db
			.select({ userId: users.id, username: users.username })
			.from(resetLinks)
			.innerJoin(users, eq(resetLinks.userId, users.id))
			.where(and(eq(resetLinks.id, hashToken(token)), gt(resetLinks.expiresAt, now)))
			.get() ?? null
	);
}

/** リンクで設定する新しい認証情報。パスワード(強制変更にはしない)かパスキー。 */
export type NewCredential = { passwordHash: string } | { passkey: Omit<PasskeyRow, 'userId' | 'lastUsedAt'> };

/**
 * リンクを使う。認証情報を全初期化して新しいものに置き換え、リンクを消費する。
 * 成功なら対象者の id、リンクが無効なら null。
 */
export function consumeResetLink(db: Db, token: string, credential: NewCredential, now = Date.now()): string | null {
	// better-sqlite3 は同期・単一接続なので、コールバック内の db 操作も同じトランザクションに入る。
	return db.transaction(() => {
		const link = findResetLink(db, token, now);
		if (!link) return null;
		const { userId } = link;
		db.delete(passkeys).where(eq(passkeys.userId, userId)).run();
		db.delete(sessions).where(eq(sessions.userId, userId)).run();
		db.delete(resetLinks).where(eq(resetLinks.userId, userId)).run();
		const passwordHash = 'passwordHash' in credential ? credential.passwordHash : null;
		db.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, userId)).run();
		if ('passkey' in credential) db.insert(passkeys).values({ ...credential.passkey, userId }).run();
		return userId;
	});
}
