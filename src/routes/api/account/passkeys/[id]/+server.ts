import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { requireRecentAuth, requireUser } from '#lib/server/apiGuard.js';
import { deletePasskey, normalizePasskeyName, renamePasskey } from '#lib/server/credentials.js';
import type { RequestHandler } from './$types';

/** パスキー名の変更(認証情報そのものは変わらないので本人確認は不要)。body: { name }。 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const user = requireUser(locals);
	const body = await request.json().catch(() => null);
	const name = normalizePasskeyName(body?.name);
	if (name === null) throw error(400, 'パスキー名は50文字以内にしてください。');
	const result = renamePasskey(db, user.id, params.id, name);
	if (!result.ok) throw error(404, 'パスキーが見つかりません。');
	return Response.json({ ok: true });
};

/** パスキーの削除。最後の認証情報は消せない。操作端末以外のセッションを無効化する。 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const user = requireRecentAuth(locals);
	const result = deletePasskey(db, user.id, params.id, user.sessionId);
	if (!result.ok) {
		if (result.error === 'last_credential') {
			throw error(409, 'パスワードがないため、最後のパスキーは削除できません。');
		}
		throw error(404, 'パスキーが見つかりません。');
	}
	return Response.json({ ok: true });
};
