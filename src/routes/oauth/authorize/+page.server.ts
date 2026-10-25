import { fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { isRecentlyVerified } from '#lib/server/auth.js';
import { getCredentialSummary } from '#lib/server/credentials.js';
import { normalizeAgentName } from '#lib/server/agentConnections.js';
import { isRegisteredRedirectUri, issueAuthorizationCode, parseAuthorizeRequest, redirectWith, resolveClient } from '#lib/server/oauth.js';
import { mcpResource, publicOrigin } from '#lib/server/origin.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * 認可リクエストを確かめる。戻り先が確かめられないうちの誤りは画面に出し、
 * 確かめた後の誤りは error パラメーター付きで戻り先へ返す(OAuth 2.1)。
 * 戻り先は登録済みのものと照合した後なので、外部へのリダイレクトを許す。
 */
async function check(url: URL) {
	const parsed = parseAuthorizeRequest(url.searchParams, mcpResource(url));
	if ('fatal' in parsed) return { error: parsed.fatal } as const;
	const clientId = url.searchParams.get('client_id') ?? '';
	const client = await resolveClient(clientId);
	if (typeof client === 'string') return { error: client } as const;
	const redirectUri = 'ok' in parsed ? parsed.ok.redirectUri : parsed.request.redirectUri;
	if (!isRegisteredRedirectUri(client.redirectUris, redirectUri))
		return { error: '戻り先(redirect_uri)がクライアントの情報に登録されていません。' } as const;
	if ('redirectError' in parsed) {
		const { redirectError, description, request } = parsed;
		throw redirect(303, redirectWith(request.redirectUri, { error: redirectError, error_description: description, state: request.state }, publicOrigin(url)), { external: true });
	}
	return { request: parsed.ok, client } as const;
}

export const load: PageServerLoad = async ({ url, locals, setHeaders }) => {
	// 同意画面を他サイトに埋め込ませない(クリックジャッキング対策)。
	setHeaders({ 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" });
	const checked = await check(url);
	if ('error' in checked) return { error: checked.error };
	if (!locals.user) throw redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	const { client, request } = checked;
	const credentials = getCredentialSummary(db, locals.user.id);
	return {
		client: { name: client.clientName, host: new URL(client.clientId).host, redirectHost: new URL(request.redirectUri).host },
		households: locals.households.map((h) => ({ id: h.id, name: h.name })),
		hasPassword: credentials.hasPassword,
		hasPasskey: credentials.passkeys.length > 0,
		needsReauth: !isRecentlyVerified(locals.session?.verifiedAt ?? null)
	};
};

export const actions: Actions = {
	allow: async ({ url, locals, request }) => {
		if (!locals.user) throw redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
		const checked = await check(url);
		if ('error' in checked) return fail(400, { error: checked.error });
		// エージェント接続を作るのは認証情報を増やすのと同じなので、直近の本人確認を求める(ADR 0012)。
		if (!isRecentlyVerified(locals.session?.verifiedAt ?? null)) return fail(428, { reauth: true });
		const form = await request.formData();
		const householdId = String(form.get('householdId') ?? '');
		if (!locals.households.some((h) => h.id === householdId)) return fail(400, { error: '世帯を選んでください。' });
		const { client, request: req } = checked;
		const name = normalizeAgentName(form.get('name')) ?? normalizeAgentName(client.clientName) ?? new URL(client.clientId).host;
		const code = issueAuthorizationCode({
			clientId: client.clientId,
			redirectUri: req.redirectUri,
			codeChallenge: req.codeChallenge,
			userId: locals.user.id,
			householdId,
			name
		});
		throw redirect(303, redirectWith(req.redirectUri, { code, state: req.state }, publicOrigin(url)), { external: true });
	},
	deny: async ({ url }) => {
		const checked = await check(url);
		if ('error' in checked) return fail(400, { error: checked.error });
		const { request } = checked;
		throw redirect(303, redirectWith(request.redirectUri, { error: 'access_denied', state: request.state }, publicOrigin(url)), { external: true });
	}
};
