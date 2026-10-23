import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { hashPassword, validatePassword } from '$lib/server/auth';
import { logInAfterReset } from '$lib/server/sessionCookie';
import { consumeResetLink, findResetLink, RESET_LINK_INVALID } from '$lib/server/resetLinks';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	return { username: findResetLink(db, params.token)?.username ?? null };
};

export const actions: Actions = {
	/** 新しいパスワードを設定してログインする(パスキーは /api/passkey/register で行う。ADR 0011)。 */
	default: async ({ params, request, cookies }) => {
		const data = await request.formData();
		const password = String(data.get('password') ?? '');
		const pErr = validatePassword(password);
		if (pErr) return fail(400, { error: pErr });
		if (password !== String(data.get('confirmPassword') ?? '')) {
			return fail(400, { error: '新しいパスワードと確認用パスワードが一致しません。' });
		}

		const userId = consumeResetLink(db, params.token, { passwordHash: await hashPassword(password) });
		if (!userId) return fail(410, { error: RESET_LINK_INVALID });
		logInAfterReset(cookies, userId);
		throw redirect(303, '/');
	}
};
