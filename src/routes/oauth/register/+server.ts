import { db } from '#lib/server/db/index.js';
import { registerClient, validateRegistration } from '#lib/server/oauth.js';
import type { RequestHandler } from './$types';

/**
 * Dynamic Client Registration(RFC 7591)。誰でも登録できるが、使えるのは本人が同意画面で
 * 許可した後だけ。DCR にしか対応しないエージェントのために用意する(ADR 0012)。
 */
const cors = { 'access-control-allow-origin': '*' };

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const input = validateRegistration(body);
	if ('error' in input) return Response.json({ error: input.error, error_description: input.description }, { status: 400, headers: cors });
	const client = registerClient(db, input);
	return Response.json(
		{
			client_id: client.clientId,
			client_id_issued_at: Math.floor(Date.now() / 1000),
			client_name: client.clientName ?? undefined,
			redirect_uris: client.redirectUris,
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none'
		},
		{ status: 201, headers: { ...cors, 'cache-control': 'no-store' } }
	);
};

/** ブラウザで動くクライアントの事前確認(JSON の POST なので必要)。 */
export const OPTIONS: RequestHandler = () =>
	new Response(null, { status: 204, headers: { ...cors, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' } });
