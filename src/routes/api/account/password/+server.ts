import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { requireRecentAuth, requireUser } from '$lib/server/apiGuard';
import { getCredentialSummary, removePassword } from '$lib/server/credentials';
import {
	changePassword,
	hashPassword,
	SESSION_COOKIE,
	validatePassword,
	verifyCredentials
} from '$lib/server/auth';
import type { RequestHandler } from './$types';
import { isAuthRateLimited, recordAuthFailure, resetUserAuthRateLimit } from '$lib/server/authRateLimit';

/**
 * 本人によるパスワードの変更・設定。操作端末以外のセッションを無効化する。
 * パスワードを持つ会員は現在のパスワードで、持たない会員(パスキーのみ)は直近の本人確認で確かめる。
 * 強制パスワード変更中は一時パスワードの再入力の代わりに直近の本人確認を求め、一時パスワードと同じものは拒否する(ADR 0011)。
 */
export const POST: RequestHandler = async ({ locals, cookies, request, getClientAddress }) => {
	const user = requireUser(locals);
	const { hasPassword } = getCredentialSummary(db, user.id);
	const verifyCurrent = !user.mustChangePassword && hasPassword;
	const body = await request.json().catch(() => null);
	const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
	const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
	const confirmPassword = typeof body?.confirmPassword === 'string' ? body.confirmPassword : '';
	if (verifyCurrent && !currentPassword)
		throw error(400, '現在のパスワードを入力してください。');
	const passwordError = validatePassword(newPassword);
	if (passwordError) throw error(400, passwordError);
	if (newPassword !== confirmPassword)
		throw error(400, '新しいパスワードと確認用パスワードが一致しません。');
	if (verifyCurrent && currentPassword === newPassword)
		throw error(400, '現在のパスワードと異なるパスワードを設定してください。');
	if (user.mustChangePassword || !hasPassword) requireRecentAuth(locals);
	if (user.mustChangePassword && (await verifyCredentials(user.username, newPassword)))
		throw error(400, '一時パスワードとは別のパスワードにしてください。');
	if (verifyCurrent) {
		const ip = getClientAddress();
		if (isAuthRateLimited(user.username, ip)) throw error(400, '現在のパスワードが違います。');
		if (!(await verifyCredentials(user.username, currentPassword))) {
			recordAuthFailure(user.username, ip);
			throw error(400, '現在のパスワードが違います。');
		}
		resetUserAuthRateLimit(user.username);
	}
	const token = cookies.get(SESSION_COOKIE);
	if (!token) throw error(401, 'ログインが必要です。');
	changePassword(user.id, await hashPassword(newPassword), token);
	return json({ ok: true });
};

/** パスワードの削除(パスキーのみの会員にする)。パスキーが無ければ 409。 */
export const DELETE: RequestHandler = async ({ locals }) => {
	const user = requireRecentAuth(locals);
	// 強制パスワード変更中は、変更以外の操作をさせない(このパスは hooks の許可リストに入っている)。
	if (user.mustChangePassword) throw error(403, 'パスワード変更が必要です。');
	const result = removePassword(db, user.id, user.sessionId);
	if (!result.ok) {
		if (result.error === 'last_credential') {
			throw error(409, 'パスキーを登録してから削除してください。');
		}
		throw error(404, 'パスワードは設定されていません。');
	}
	return json({ ok: true });
};
