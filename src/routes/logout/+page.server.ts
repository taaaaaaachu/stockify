import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, invalidateSession } from '#lib/server/auth.js';
import { clearSessionCookie } from '#lib/server/sessionCookie.js';
import type { Actions } from './$types';

export const actions: Actions = {
	default: ({ cookies }) => {
		const token = cookies.get(SESSION_COOKIE);
		if (token) invalidateSession(token);
		clearSessionCookie(cookies);
		throw redirect(303, '/');
	}
};
