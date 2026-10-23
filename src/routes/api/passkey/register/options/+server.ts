import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { validateUsername } from '$lib/server/auth';
import { requireRecentAuth } from '$lib/server/apiGuard';
import { listPasskeyIds } from '$lib/server/credentials';
import { countUsers, newId, precheckRegistration, REGISTER_ERROR_MESSAGES } from '$lib/server/households';
import { registrationOptions, saveChallenge } from '$lib/server/webauthn';
import { findResetLink, RESET_LINK_INVALID } from '$lib/server/resetLinks';
import type { RequestHandler } from './$types';

/**
 * パスキー登録の開始。リセットリンクでの再設定(body: { resetToken })、
 * ログイン中ならパスキーの追加(直近の本人確認が必要)、
 * 未ログインならパスキーでの会員登録(body: { username, invite, household })。
 */
export const POST: RequestHandler = async ({ locals, request, cookies, url }) => {
	const body = await request.json().catch(() => null);

	// ログイン中でも別の人のリンクを開くことがあるので、ログイン状態より先に見る。
	if (typeof body?.resetToken === 'string') {
		const link = findResetLink(db, body.resetToken);
		if (!link) throw error(410, RESET_LINK_INVALID);
		// 既存のパスキーは再設定で消えるので除外しない。
		const opts = await registrationOptions(url, { id: link.userId, username: link.username }, []);
		saveChallenge(cookies, 'reg', opts.challenge, { kind: 'reset', token: body.resetToken });
		return json(opts);
	}

	if (locals.user) {
		const user = requireRecentAuth(locals);
		const opts = await registrationOptions(url, user, listPasskeyIds(db, user.id));
		saveChallenge(cookies, 'reg', opts.challenge, { kind: 'add', userId: user.id });
		return json(opts);
	}

	const username = String(body?.username ?? '').trim();
	const inviteCode = String(body?.invite ?? '').trim();
	const householdName = String(body?.household ?? '').trim();

	const uErr = validateUsername(username);
	if (uErr) throw error(400, uErr);
	const requireInvite = countUsers(db) > 0;
	if (requireInvite && !inviteCode) throw error(400, '招待コードを入力してください。');
	// ブラウザでパスキーを作らせる前に弾けるものは弾く(作った後の失敗は端末に不要なパスキーが残る)。
	const pre = precheckRegistration(db, { username, requireInvite, inviteCode });
	if (pre) throw error(pre === 'username_taken' ? 409 : 400, REGISTER_ERROR_MESSAGES[pre]);

	const userId = newId();
	const opts = await registrationOptions(url, { id: userId, username }, []);
	saveChallenge(cookies, 'reg', opts.challenge, {
		kind: 'signup',
		userId,
		username,
		requireInvite,
		inviteCode,
		householdName
	});
	return json(opts);
};
