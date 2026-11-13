import { fail, redirect } from '@sveltejs/kit';
import {
	createSession,
	hashPassword,
	validatePassword,
	validateUsername
} from '#lib/server/auth.js';
import { setSessionCookie, setHouseholdCookie } from '#lib/server/sessionCookie.js';
import { db } from '#lib/server/db/index.js';
import { countUsers, previewInvite, registerUser, REGISTER_ERROR_MESSAGES } from '#lib/server/households.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) throw redirect(303, '/');
	// 招待リンクから来た場合は、使える招待ならコード欄を隠して招待先を示す。
	const code = url.searchParams.get('invite')?.trim() ?? '';
	const preview = code ? previewInvite(db, code, null) : null;
	const invite = preview?.state === 'active' ? { code, householdName: preview.householdName } : null;
	// ユーザーが 0 人のときだけ招待コードなしで登録できる(ブートストラップ)。
	return { requireInvite: countUsers(db) > 0, invite };
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const username = String(data.get('username') ?? '');
		const password = String(data.get('password') ?? '');
		const inviteCode = String(data.get('invite') ?? '').trim();
		const householdName = String(data.get('household') ?? '').trim();

		const requireInvite = countUsers(db) > 0;

		const uErr = validateUsername(username);
		if (uErr) return fail(400, { username, error: uErr });
		const pErr = validatePassword(password);
		if (pErr) return fail(400, { username, error: pErr });
		if (requireInvite && !inviteCode) {
			return fail(400, { username, error: '招待コードを入力してください。' });
		}

		const passwordHash = await hashPassword(password);
		const result = registerUser(db, {
			username,
			passwordHash,
			requireInvite,
			inviteCode,
			householdName
		});
		if (!result.ok) {
			const status = result.error === 'username_taken' ? 409 : 400;
			return fail(status, { username, error: REGISTER_ERROR_MESSAGES[result.error] });
		}

		const { token, expiresAt } = createSession(result.user.id);
		setSessionCookie(cookies, token, expiresAt);
		setHouseholdCookie(cookies, result.householdId);
		throw redirect(303, '/');
	}
};
