import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { deleteUserAccount, verifyUserPassword } from '$lib/server/auth';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ locals, params, request }) => {
	const admin = requireUser(locals);
	if (admin.instanceRole !== 'super_admin') throw error(403, '権限がありません。');
	if (params.id === admin.id) throw error(400, '自分自身はこの画面から削除できません。');
	const body = await request.json().catch(() => null);
	const username = typeof body?.username === 'string' ? body.username.trim() : '';
	const password = typeof body?.password === 'string' ? body.password : '';
	const targetUser = db.select({ username: users.username }).from(users).where(eq(users.id, params.id)).get();
	if (!targetUser || targetUser.username !== username) throw error(400, '削除対象ユーザー名の確認に失敗しました。');
	if (!(await verifyUserPassword(admin.id, password, db))) throw error(400, 'super_adminの現在のパスワードが正しくありません。');
	const result = deleteUserAccount(params.id, db);
	if (!result.ok) {
		if (result.error === 'owns_household') throw error(400, '対象ユーザーがownerの世帯を先に委任してください。');
		if (result.error === 'last_super_admin') throw error(400, '最後のsuper_adminは削除できません。');
		throw error(404, 'ユーザーが見つかりません。');
	}
	return new Response(null, { status: 204 });
};
