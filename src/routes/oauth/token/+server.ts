import { db } from '#lib/server/db/index.js';
import { consumeAuthorizationCode } from '#lib/server/oauth.js';
import { createOAuthConnection, refreshConnection, type OAuthTokens } from '#lib/server/agentConnections.js';
import type { RequestHandler } from './$types';

/**
 * トークンエンドポイント(OAuth 2.1)。公開クライアントなのでクライアント認証はなく、
 * 認可コードは PKCE で、リフレッシュはトークンそのもので確かめる。Cookie は読まない(CSRF の判定から除いている)。
 */
const headers = { 'cache-control': 'no-store', 'access-control-allow-origin': '*' };

function oauthError(error: string, description: string): Response {
	return Response.json({ error, error_description: description }, { status: 400, headers });
}

function tokenResponse(t: OAuthTokens): Response {
	return Response.json({ access_token: t.accessToken, token_type: 'Bearer', expires_in: t.expiresIn, refresh_token: t.refreshToken }, { headers });
}

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	const get = (key: string) => {
		const v = form?.get(key);
		return typeof v === 'string' && v !== '' ? v : null;
	};
	const clientId = get('client_id');
	if (!clientId) return oauthError('invalid_request', 'client_id がありません。');

	switch (get('grant_type')) {
		case 'authorization_code': {
			const code = get('code');
			const redirectUri = get('redirect_uri');
			const codeVerifier = get('code_verifier');
			if (!code || !redirectUri || !codeVerifier) return oauthError('invalid_request', 'code・redirect_uri・code_verifier が必要です。');
			const grant = consumeAuthorizationCode(code, { clientId, redirectUri, codeVerifier });
			if (!grant) return oauthError('invalid_grant', '認可コードが無効です(期限切れ・使用済み・不一致)。');
			const tokens = createOAuthConnection(db, grant.userId, grant.householdId, clientId, grant.name);
			// 同意してからの1分の間に世帯から外れた場合。
			if (!tokens) return oauthError('invalid_grant', '世帯に所属していません。');
			return tokenResponse(tokens);
		}
		case 'refresh_token': {
			const refreshToken = get('refresh_token');
			if (!refreshToken) return oauthError('invalid_request', 'refresh_token がありません。');
			const tokens = refreshConnection(db, refreshToken, clientId);
			return tokens ? tokenResponse(tokens) : oauthError('invalid_grant', 'リフレッシュトークンが無効です。接続し直してください。');
		}
		default:
			return oauthError('unsupported_grant_type', 'authorization_code と refresh_token だけに対応しています。');
	}
};
