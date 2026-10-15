import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { deleteUserAccount, verifyUserPassword } from '$lib/server/auth';
import { clearSessionCookie } from '$lib/server/sessionCookie';
import { requireRecentAuth, requireUser } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';
import { isAuthRateLimited, recordAuthFailure, resetUserAuthRateLimit } from '$lib/server/authRateLimit';

/**
 * 本人のアカウント削除。password が送られたらそれで確認し(試行制限込み)、
 * 送られなければ直近の本人確認を求める(パスキーのみの会員向け。ADR 0010)。
 */
export const DELETE: RequestHandler = async ({ locals, request, cookies, getClientAddress }) => {
	const user = requireUser(locals);
	const body = await request.json().catch(() => null);
	const username = typeof body?.username === 'string' ? body.username.trim() : '';
	const password = typeof body?.password === 'string' ? body.password : '';
	if (username !== user.username) throw error(400, 'ユーザー名の確認に失敗しました。');
	if (password) {
		const ip = getClientAddress();
		const limited = isAuthRateLimited(user.username, ip);
		if (limited || !(await verifyUserPassword(user.id, password, db))) {
			if (!limited) recordAuthFailure(user.username, ip);
			throw error(400, '現在のパスワードが正しくありません。');
		}
		resetUserAuthRateLimit(user.username);
	} else {
		requireRecentAuth(locals);
	}
	const result = deleteUserAccount(user.id, db);
	if (!result.ok) {
		if (result.error === 'owns_household') throw error(400, 'ownerになっている世帯のownerを先に委任してください。');
		if (result.error === 'last_super_admin') throw error(400, '最後のsuper_adminは削除できません。');
		throw error(404, 'ユーザーが見つかりません。');
	}
	clearSessionCookie(cookies);
	return json({ ok: true });
};
