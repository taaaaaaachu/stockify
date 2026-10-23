import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { deleteUserAccount, verifyUserPassword } from '#lib/server/auth.js';
import { users } from '#lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireRecentAuth, requireUser } from '#lib/server/apiGuard.js';
import type { RequestHandler } from './$types';
import { isAuthRateLimited, recordAuthFailure, resetUserAuthRateLimit } from '#lib/server/authRateLimit.js';

/**
 * super_admin による他ユーザー削除。操作者の password が送られたらそれで確認し(試行制限込み)、
 * 送られなければ操作者の直近の本人確認を求める(パスキーのみの super_admin 向け。ADR 0010)。
 */
export const DELETE: RequestHandler = async ({ locals, params, request, getClientAddress }) => {
	const admin = requireUser(locals);
	if (admin.instanceRole !== 'super_admin') throw error(403, '権限がありません。');
	if (params.id === admin.id) throw error(400, '自分自身はこの画面から削除できません。');
	const body = await request.json().catch(() => null);
	const username = typeof body?.username === 'string' ? body.username.trim() : '';
	const password = typeof body?.password === 'string' ? body.password : '';
	const targetUser = db.select({ username: users.username }).from(users).where(eq(users.id, params.id)).get();
	if (!targetUser || targetUser.username !== username) throw error(400, '削除対象ユーザー名の確認に失敗しました。');
	if (password) {
		const ip = getClientAddress();
		const limited = isAuthRateLimited(admin.username, ip);
		if (limited || !(await verifyUserPassword(admin.id, password, db))) {
			if (!limited) recordAuthFailure(admin.username, ip);
			throw error(400, 'super_adminの現在のパスワードが正しくありません。');
		}
		resetUserAuthRateLimit(admin.username);
	} else {
		requireRecentAuth(locals);
	}
	const result = deleteUserAccount(params.id, db);
	if (!result.ok) {
		if (result.error === 'owns_household') throw error(400, '対象ユーザーがownerの世帯を先に委任してください。');
		if (result.error === 'last_super_admin') throw error(400, '最後のsuper_adminは削除できません。');
		throw error(404, 'ユーザーが見つかりません。');
	}
	return new Response(null, { status: 204 });
};
