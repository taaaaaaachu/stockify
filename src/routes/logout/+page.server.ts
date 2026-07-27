import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, invalidateSession } from '$lib/server/auth';
import { clearSessionCookie } from '$lib/server/sessionCookie';
import type { Actions } from './$types';

export const actions: Actions = {
	default: ({ cookies }) => {
		const token = cookies.get(SESSION_COOKIE);
		if (token) invalidateSession(token);
		clearSessionCookie(cookies);
		throw redirect(303, '/');
	}
};
