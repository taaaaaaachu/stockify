import { db } from '#lib/server/db/index.js';
import { revokeByToken } from '#lib/server/agentConnections.js';
import type { RequestHandler } from './$types';

/** トークンの取り消し(RFC 7009)。接続ごと消す。不明なトークンでも 200 を返す。 */
export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	const token = form?.get('token');
	const clientId = form?.get('client_id');
	if (typeof token !== 'string' || typeof clientId !== 'string' || !token || !clientId)
		return Response.json({ error: 'invalid_request', error_description: 'token と client_id が必要です。' }, { status: 400 });
	revokeByToken(db, token, clientId);
	return new Response(null, { status: 200, headers: { 'access-control-allow-origin': '*' } });
};
