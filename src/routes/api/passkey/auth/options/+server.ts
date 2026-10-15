import { json } from '@sveltejs/kit';
import { authenticationOptions, saveChallenge } from '$lib/server/webauthn';
import type { RequestHandler } from './$types';

/** パスキー認証の開始(ログインと本人確認で共用)。 */
export const POST: RequestHandler = async ({ cookies, url }) => {
	const opts = await authenticationOptions(url);
	saveChallenge(cookies, 'auth', opts.challenge);
	return json(opts);
};
