import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { createSession } from '$lib/server/auth';
import { setSessionCookie, setHouseholdCookie } from '$lib/server/sessionCookie';
import { listUserHouseholds } from '$lib/server/households';
import { takeChallenge, verifyAuthentication } from '$lib/server/webauthn';
import type { RequestHandler } from './$types';

/** パスキーでログインする。body: { response }。署名検証なので試行制限の対象外(ADR 0010)。 */
export const POST: RequestHandler = async ({ request, cookies, url }) => {
	const stored = takeChallenge(cookies, 'auth');
	if (!stored) throw error(400, 'ログインの有効期限が切れました。もう一度お試しください。');
	const body = await request.json().catch(() => null);

	const passkey = await verifyAuthentication(db, url, body?.response, stored.challenge);
	if (!passkey) throw error(401, 'パスキーでログインできませんでした。');

	const { token, expiresAt } = createSession(passkey.userId);
	setSessionCookie(cookies, token, expiresAt);
	// パスワードでのログインと同じく、先頭の世帯をアクティブにしておく。
	const households = listUserHouseholds(db, passkey.userId);
	if (households[0]) setHouseholdCookie(cookies, households[0].id);
	return json({ ok: true });
};
