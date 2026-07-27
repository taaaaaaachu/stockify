import { fail, redirect } from '@sveltejs/kit';
import {
	createSession,
	hashPassword,
	validatePassword,
	validateUsername
} from '$lib/server/auth';
import { setSessionCookie, setHouseholdCookie } from '$lib/server/sessionCookie';
import { db } from '$lib/server/db';
import { countUsers, registerUser } from '$lib/server/households';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) throw redirect(303, '/');
	// ユーザーが 0 人のときだけ招待コードなしで登録できる(ブートストラップ)。
	return { requireInvite: countUsers(db) > 0 };
};

const ERROR_MESSAGES: Record<string, string> = {
	invite_invalid: '招待コードが正しくありません。',
	invite_expired: 'この招待コードは有効期限が切れています。',
	invite_used: 'この招待コードは既に使われています。',
	invite_revoked: 'この招待コードは無効化されています。',
	username_taken: 'このユーザー名は既に使われています。'
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
			return fail(status, { username, error: ERROR_MESSAGES[result.error] });
		}

		const { token, expiresAt } = createSession(result.user.id);
		setSessionCookie(cookies, token, expiresAt);
		setHouseholdCookie(cookies, result.householdId);
		throw redirect(303, '/');
	}
};
