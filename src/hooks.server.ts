import { redirect, type Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, validateSessionToken, invalidateSession } from '$lib/server/auth';
import { HOUSEHOLD_COOKIE } from '$lib/server/sessionCookie';
import { db } from '$lib/server/db';
import { listUserHouseholds } from '$lib/server/households';
import { allowedDuringForcedChange } from '$lib/server/apiGuard';
import { dev } from '$app/environment';

function cookieOpts(expires: Date) {
	return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: !dev, expires };
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.session = null;
	event.locals.households = [];
	event.locals.activeHousehold = null;

	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		const result = validateSessionToken(token);
		if (result) {
			event.locals.user = result.user;
			event.locals.session = result.session;
			if (result.user.mustChangePassword) {
				const pathname = event.url.pathname;
				if (!allowedDuringForcedChange(pathname)) {
					if (pathname.startsWith('/api/'))
						return new Response(JSON.stringify({ message: 'パスワード変更が必要です。' }), {
							status: 403,
							headers: { 'content-type': 'application/json' }
						});
					throw redirect(303, '/account?password=required');
				}
			}
			if (result.renewedExpiresAt) {
				event.cookies.set(SESSION_COOKIE, token, cookieOpts(new Date(result.renewedExpiresAt)));
			}
		} else {
			invalidateSession(token);
			event.cookies.delete(SESSION_COOKIE, { path: '/' });
		}
	}

	// 強制パスワード変更中は世帯のデータも見せない(ADR 0011)。
	if (event.locals.user && !event.locals.user.mustChangePassword) {
		const households = listUserHouseholds(db, event.locals.user.id);
		event.locals.households = households;

		// 同期の再送は操作した世帯をヘッダーで明示する(ADR 0009)。所属していなければ世帯なし(=拒否)。
		const explicit = event.request.headers.get('x-stockify-household');
		// それ以外は現在の世帯を Cookie から解決。所属していなければ先頭にフォールバック。
		const wanted = event.cookies.get(HOUSEHOLD_COOKIE);
		const active = explicit
			? (households.find((h) => h.id === explicit) ?? null)
			: (households.find((h) => h.id === wanted) ?? households[0] ?? null);
		event.locals.activeHousehold = active
			? { id: active.id, name: active.name, role: active.role }
			: null;
	}

	return resolve(event);
};
