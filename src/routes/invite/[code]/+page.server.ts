import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { joinHouseholdByInvite, previewInvite, REGISTER_ERROR_MESSAGES } from '#lib/server/households.js';
import { setHouseholdCookie } from '#lib/server/sessionCookie.js';
import type { Actions, PageServerLoad } from './$types';

// 開いただけでは参加しない(リンクのプレビュー取得でコードを消費しないため)。参加は POST のみ。
export const load: PageServerLoad = ({ params, locals }) => {
	const invite = previewInvite(db, params.code, locals.user?.id ?? null);
	if (!invite) throw error(404, '招待コードが正しくありません。');
	return { invite, code: params.code, loggedIn: locals.user !== null };
};

export const actions: Actions = {
	default: ({ params, locals, cookies }) => {
		if (!locals.user) throw redirect(303, `/login?next=${encodeURIComponent(`/invite/${params.code}`)}`);
		// 参加済みの世帯なら、コードの状態(自分で使って使用済み等)に関係なく切り替えるだけ。
		const invite = previewInvite(db, params.code, locals.user.id);
		if (!invite) throw error(404, '招待コードが正しくありません。');
		if (invite.alreadyMember) {
			setHouseholdCookie(cookies, invite.householdId);
			throw redirect(303, '/');
		}
		const result = joinHouseholdByInvite(db, locals.user.id, params.code);
		if (!result.ok) {
			const message =
				result.error === 'already_member' ? 'この世帯には既に所属しています。' : REGISTER_ERROR_MESSAGES[result.error];
			return fail(400, { error: message });
		}
		setHouseholdCookie(cookies, result.householdId);
		throw redirect(303, '/');
	}
};
