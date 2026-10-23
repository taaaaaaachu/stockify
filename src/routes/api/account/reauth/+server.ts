import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { markSessionVerified, verifyCredentials } from '#lib/server/auth.js';
import { requireUser } from '#lib/server/apiGuard.js';
import { isAuthRateLimited, recordAuthFailure, resetUserAuthRateLimit } from '#lib/server/authRateLimit.js';
import { takeChallenge, verifyAuthentication } from '#lib/server/webauthn.js';
import type { RequestHandler } from './$types';

const FAILED = '本人確認できませんでした。';

/**
 * 本人確認(再認証)。body: { password } または { response }(パスキーの認証応答)。
 * パスワード経路は他の入口と共通の試行制限を通す。パスキー経路は署名検証なので対象外(ADR 0007, 0010)。
 */
export const POST: RequestHandler = async ({ locals, request, cookies, url, getClientAddress }) => {
	const user = requireUser(locals);
	const body = await request.json().catch(() => null);

	if (typeof body?.password === 'string') {
		const ip = getClientAddress();
		if (isAuthRateLimited(user.username, ip)) throw error(400, FAILED);
		if (!(await verifyCredentials(user.username, body.password))) {
			recordAuthFailure(user.username, ip);
			throw error(400, FAILED);
		}
		resetUserAuthRateLimit(user.username);
	} else {
		const stored = takeChallenge(cookies, 'auth');
		const passkey = stored && (await verifyAuthentication(db, url, body?.response, stored.challenge));
		// 他人のパスキーでは本人確認にならない。
		if (!passkey || passkey.userId !== user.id) throw error(400, FAILED);
	}

	markSessionVerified(locals.session!.id);
	return Response.json({ ok: true });
};
