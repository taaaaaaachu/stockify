import { fail, redirect } from '@sveltejs/kit';
import { createSession, verifyCredentials } from '#lib/server/auth.js';
import { setSessionCookie, setHouseholdCookie } from '#lib/server/sessionCookie.js';
import { db } from '#lib/server/db/index.js';
import { listUserHouseholds } from '#lib/server/households.js';
import type { Actions, PageServerLoad } from './$types';
import { safeNext } from '#lib/safeNext.js';
import { isAuthRateLimited, recordAuthFailure, resetUserAuthRateLimit } from '#lib/server/authRateLimit.js';

export const load: PageServerLoad = ({ locals, url }) => {
	// next: ログイン後の戻り先(OAuth の同意画面など)。
	const next = safeNext(url.searchParams.get('next'));
	if (locals.user) throw redirect(303, next);
	return { deleted: url.searchParams.get('deleted') === '1', next };
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress, url }) => {
		const data = await request.formData();
		const username = String(data.get('username') ?? '');
		const password = String(data.get('password') ?? '');

		const ip = getClientAddress();
		if (isAuthRateLimited(username, ip))
			return fail(401, { username, error: 'ユーザー名またはパスワードが違います。' });
		const user = await verifyCredentials(username, password);
		if (!user) {
			recordAuthFailure(username, ip);
			return fail(401, { username, error: 'ユーザー名またはパスワードが違います。' });
		}
		resetUserAuthRateLimit(user.username);

		const { token, expiresAt } = createSession(user.id);
		setSessionCookie(cookies, token, expiresAt);
		// 先頭の世帯をアクティブにしておく。
		const households = listUserHouseholds(db, user.id);
		if (households[0]) setHouseholdCookie(cookies, households[0].id);
		throw redirect(303, user.mustChangePassword ? '/account?password=required' : safeNext(url.searchParams.get('next')));
	}
};
