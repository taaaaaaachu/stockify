import { json, error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/apiGuard';
import {
	changePassword,
	hashPassword,
	SESSION_COOKIE,
	validatePassword,
	verifyCredentials
} from '$lib/server/auth';
import type { RequestHandler } from './$types';
import { isAuthRateLimited, recordAuthFailure, resetUserAuthRateLimit } from '$lib/server/authRateLimit';

export const POST: RequestHandler = async ({ locals, cookies, request, getClientAddress }) => {
	const user = requireUser(locals);
	const body = await request.json().catch(() => null);
	const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
	const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
	const confirmPassword = typeof body?.confirmPassword === 'string' ? body.confirmPassword : '';
	if (!user.mustChangePassword && !currentPassword)
		throw error(400, '現在のパスワードを入力してください。');
	const passwordError = validatePassword(newPassword);
	if (passwordError) throw error(400, passwordError);
	if (newPassword !== confirmPassword)
		throw error(400, '新しいパスワードと確認用パスワードが一致しません。');
	if (!user.mustChangePassword && currentPassword === newPassword)
		throw error(400, '現在のパスワードと異なるパスワードを設定してください。');
	if (!user.mustChangePassword) {
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
