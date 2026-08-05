import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { deleteUserAccount, verifyUserPassword } from '$lib/server/auth';
import { clearSessionCookie } from '$lib/server/sessionCookie';
import { requireUser } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ locals, request, cookies }) => {
	const user = requireUser(locals);
	const body = await request.json().catch(() => null);
	const username = typeof body?.username === 'string' ? body.username.trim() : '';
	const password = typeof body?.password === 'string' ? body.password : '';
	if (username !== user.username) throw error(400, 'ユーザー名の確認に失敗しました。');
	if (!(await verifyUserPassword(user.id, password, db))) throw error(400, '現在のパスワードが正しくありません。');
	const result = deleteUserAccount(user.id, db);
	if (!result.ok) {
		if (result.error === 'owns_household') throw error(400, 'ownerになっている世帯のownerを先に委任してください。');
		if (result.error === 'last_super_admin') throw error(400, '最後のsuper_adminは削除できません。');
		throw error(404, 'ユーザーが見つかりません。');
	}
	clearSessionCookie(cookies);
	return json({ ok: true });
};
