import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { SESSION_COOKIE } from './auth';

/** 現在の世帯を保持する Cookie 名。 */
export const HOUSEHOLD_COOKIE = 'household';

/** ログイン成功時にセッション Cookie を設定する。 */
export function setSessionCookie(cookies: Cookies, token: string, expiresAt: number): void {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		expires: new Date(expiresAt)
	});
}

/** ログアウト時に Cookie を消す。 */
export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
	cookies.delete(HOUSEHOLD_COOKIE, { path: '/' });
}

/** 現在の世帯 Cookie を設定する。 */
export function setHouseholdCookie(cookies: Cookies, householdId: string): void {
	cookies.set(HOUSEHOLD_COOKIE, householdId, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		maxAge: 60 * 60 * 24 * 365
	});
}
