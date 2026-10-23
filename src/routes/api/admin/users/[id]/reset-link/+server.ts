import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { issueResetLink, revokeResetLink } from '$lib/server/resetLinks';
import type { RequestHandler } from './$types';

/** 管理者リセットと同じく、super_admin が自分以外を対象にする(ADR 0004, 0011)。 */
function requireResetTarget(locals: App.Locals, targetId: string) {
	if (!locals.user) throw error(401, 'ログインが必要です。');
	if (locals.user.instanceRole !== 'super_admin') throw error(403, '権限がありません。');
	if (targetId === locals.user.id) throw error(400, '自分の認証情報はアカウント画面で変更してください。');
	return locals.user;
}

/** リセットリンクの発行。URL は発行時の応答でしか返さない(DB にはハッシュだけ残す)。 */
export const POST: RequestHandler = ({ locals, params, url }) => {
	const admin = requireResetTarget(locals, params.id);
	const issued = issueResetLink(db, admin.id, params.id);
	if (!issued) throw error(404, 'ユーザーが見つかりません。');
	return json({ url: `${url.origin}/reset/${issued.token}`, expiresAt: issued.expiresAt });
};

/** 未使用のリセットリンクの取り消し。 */
export const DELETE: RequestHandler = ({ locals, params }) => {
	requireResetTarget(locals, params.id);
	revokeResetLink(db, params.id);
	return new Response(null, { status: 204 });
};
