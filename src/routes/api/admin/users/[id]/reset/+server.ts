import { json, error } from '@sveltejs/kit';
import { generateTemporaryPassword, hashPassword, resetPassword } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'ログインが必要です。');
	if (locals.user.instanceRole !== 'super_admin') throw error(403, '権限がありません。');
	if (params.id === locals.user.id) throw error(400, '自分のパスワードはこの操作ではリセットできません。');
	const temporaryPassword = generateTemporaryPassword();
	const updated = resetPassword(params.id, await hashPassword(temporaryPassword));
	if (!updated) throw error(404, 'ユーザーが見つかりません。');
	return json({ temporaryPassword });
};
