import { hash, verify } from '@node-rs/argon2';
import { randomBytes, createHash } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { db } from './db';
import { users, sessions, type UserRow } from './db/schema';
import type { Db } from './db';

export const SESSION_COOKIE = 'session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30日
const SESSION_RENEW_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 15; // 残り15日を切ったら延長

// argon2 パラメータ(OWASP 推奨相当)。
const ARGON2_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

/** セッショントークンからDB保存用の id(ハッシュ)を作る。平文トークンはDBに残さない。 */
export function hashSessionToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}
const hashToken = hashSessionToken;

export function validateUsername(username: string): string | null {
	const u = username.trim();
	if (u.length < 3 || u.length > 32) return 'ユーザー名は3〜32文字にしてください。';
	if (!/^[A-Za-z0-9_.-]+$/.test(u)) return 'ユーザー名は英数字と _ . - のみ使えます。';
	return null;
}

export function validatePassword(password: string): string | null {
	if (password.length < 8 || password.length > 256)
		return 'パスワードは8〜256文字にしてください。';
	return null;
}

/** パスワードを argon2 でハッシュ化する。 */
export function hashPassword(password: string): Promise<string> {
	return hash(password, ARGON2_OPTS);
}

export interface AdminUser {
	id: string;
	username: string;
}

/** 管理者画面で表示するユーザー一覧。認証情報は返さない。 */
export function listUsers(database: Db = db): AdminUser[] {
	return database.select({ id: users.id, username: users.username }).from(users).orderBy(users.username).all();
}

/** ユーザー本人のパスワードを更新し、現在のセッション以外を無効化する。 */
export function changePassword(
	userId: string,
	passwordHash: string,
	currentToken: string,
	database: Db = db
): void {
	database.transaction((tx) => {
		tx.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, userId)).run();
		tx.delete(sessions)
			.where(and(eq(sessions.userId, userId), ne(sessions.id, hashToken(currentToken))))
			.run();
	});
}

/** 管理者リセット用。全セッションを無効化し、次回ログインで変更を要求する。 */
export function resetPassword(userId: string, passwordHash: string, database: Db = db): boolean {
	return database.transaction((tx) => {
		const result = tx
			.update(users)
			.set({ passwordHash, mustChangePassword: true })
			.where(eq(users.id, userId))
			.run();
		if (result.changes === 0) return false;
		tx.delete(sessions).where(eq(sessions.userId, userId)).run();
		return true;
	});
}

/** 管理者リセット時に表示する一時パスワードを生成する。 */
export function generateTemporaryPassword(): string {
	return `Stockify-${randomBytes(12).toString('base64url')}!`;
}

/** ユーザー名+パスワードを検証し、一致すればユーザーを返す。 */
export async function verifyCredentials(
	username: string,
	password: string
): Promise<UserRow | null> {
	const user = db.select().from(users).where(eq(users.username, username.trim())).get();
	if (!user) {
		// ユーザー不在でも一定のハッシュ計算を行い、存在有無をタイミングで漏らさない。
		await hash(password, ARGON2_OPTS).catch(() => undefined);
		return null;
	}
	const ok = await verify(user.passwordHash, password).catch(() => false);
	return ok ? user : null;
}

export interface SessionValidation {
	user: Pick<UserRow, 'id' | 'username' | 'instanceRole' | 'notifyMinuteOfDay' | 'mustChangePassword'>;
	/** Cookie の有効期限を更新すべき場合の新しい期限(延長時のみ)。 */
	renewedExpiresAt: number | null;
}

/** 新しいセッションを作成し、Cookie に入れる生トークンを返す。 */
export function createSession(userId: string): { token: string; expiresAt: number } {
	const token = randomBytes(32).toString('hex');
	const expiresAt = Date.now() + SESSION_TTL_MS;
	db.insert(sessions).values({ id: hashToken(token), userId, expiresAt }).run();
	return { token, expiresAt };
}

/** Cookie のトークンを検証する。期限切れは破棄、残り僅かなら延長する。 */
export function validateSessionToken(token: string): SessionValidation | null {
	const id = hashToken(token);
	const row = db.select().from(sessions).where(eq(sessions.id, id)).get();
	if (!row) return null;

	if (Date.now() >= row.expiresAt) {
		db.delete(sessions).where(eq(sessions.id, id)).run();
		return null;
	}

	const user = db
		.select({
			id: users.id,
			username: users.username,
			instanceRole: users.instanceRole,
			notifyMinuteOfDay: users.notifyMinuteOfDay,
			mustChangePassword: users.mustChangePassword
		})
		.from(users)
		.where(eq(users.id, row.userId))
		.get();
	if (!user) {
		db.delete(sessions).where(eq(sessions.id, id)).run();
		return null;
	}

	let renewedExpiresAt: number | null = null;
	if (row.expiresAt - Date.now() < SESSION_RENEW_THRESHOLD_MS) {
		renewedExpiresAt = Date.now() + SESSION_TTL_MS;
		db.update(sessions).set({ expiresAt: renewedExpiresAt }).where(eq(sessions.id, id)).run();
	}

	return { user, renewedExpiresAt };
}

/** セッションを無効化する(ログアウト)。 */
export function invalidateSession(token: string): void {
	db.delete(sessions).where(eq(sessions.id, hashToken(token))).run();
}
