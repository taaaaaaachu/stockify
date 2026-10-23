import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { createSession } from '$lib/server/auth';
import { setSessionCookie, setHouseholdCookie, logInAfterReset } from '$lib/server/sessionCookie';
import { requireRecentAuth } from '$lib/server/apiGuard';
import { addPasskey, normalizePasskeyName } from '$lib/server/credentials';
import { registerUser, REGISTER_ERROR_MESSAGES } from '$lib/server/households';
import { takeChallenge, verifyRegistration } from '$lib/server/webauthn';
import { consumeResetLink, RESET_LINK_INVALID } from '$lib/server/resetLinks';
import type { RequestHandler } from './$types';

/** パスキー登録の完了。body: { response, name }。 */
export const POST: RequestHandler = async ({ locals, request, cookies, url }) => {
	const stored = takeChallenge(cookies, 'reg');
	if (!stored?.pending) throw error(400, '登録の有効期限が切れました。もう一度お試しください。');
	const { pending } = stored;

	const body = await request.json().catch(() => null);
	const name = normalizePasskeyName(body?.name);
	if (name === null) throw error(400, 'パスキー名は50文字以内にしてください。');

	const cred = await verifyRegistration(url, body?.response, stored.challenge);
	if (!cred) throw error(400, 'パスキーを確認できませんでした。');
	const passkey = { ...cred, name, createdAt: Date.now() };

	if (pending.kind === 'reset') {
		let userId: string | null;
		try {
			userId = consumeResetLink(db, pending.token, { passkey });
		} catch {
			throw error(409, 'このパスキーは登録済みです。');
		}
		if (!userId) throw error(410, RESET_LINK_INVALID);
		logInAfterReset(cookies, userId);
		return json({ ok: true });
	}

	if (pending.kind === 'add') {
		const user = requireRecentAuth(locals);
		if (user.id !== pending.userId) throw error(403, '権限がありません。');
		try {
			addPasskey(db, { ...passkey, userId: user.id }, user.sessionId);
		} catch {
			throw error(409, 'このパスキーは登録済みです。');
		}
		return json({ ok: true });
	}

	// パスワードでの登録と同じ世帯処理を通す。招待・ブートストラップの可否はトランザクション内で再検証される
	// (開始後に別の人がブートストラップした場合は invite_required になる)。
	const result = registerUser(db, {
		id: pending.userId,
		username: pending.username,
		passwordHash: null,
		passkey,
		requireInvite: pending.requireInvite,
		inviteCode: pending.inviteCode,
		householdName: pending.householdName
	});
	if (!result.ok) {
		throw error(result.error === 'username_taken' ? 409 : 400, REGISTER_ERROR_MESSAGES[result.error]);
	}

	const { token, expiresAt } = createSession(result.user.id);
	setSessionCookie(cookies, token, expiresAt);
	setHouseholdCookie(cookies, result.householdId);
	return json({ ok: true });
};
