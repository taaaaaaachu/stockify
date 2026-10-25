import { createMcpHandler } from '@modelcontextprotocol/server';
import { db } from '#lib/server/db/index.js';
import { authenticateAgent, type AgentContext } from '#lib/server/agentConnections.js';
import { createMcpServer } from '#lib/server/mcp.js';
import type { RequestHandler } from './$types';

/**
 * エージェント向けの MCP エンドポイント(ADR 0012)。セッションを持たず、
 * 毎リクエスト Bearer トークン(手動発行・OAuth)で接続を確かめる。Cookie は見ない。
 */
const handler = createMcpHandler(({ authInfo }) => createMcpServer(db, authInfo?.extra?.agent as AgentContext));

/** 401 で認可サーバーの在処を知らせる(RFC 9728)。 */
function unauthorized(url: URL): Response {
	const metadata = `${url.origin}/.well-known/oauth-protected-resource/mcp`;
	return Response.json(
		{ error: 'invalid_token', error_description: 'エージェント接続のトークンが必要です。' },
		{ status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${metadata}"` } }
	);
}

const serve: RequestHandler = async ({ request, url }) => {
	const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
	const agent = token ? authenticateAgent(db, token) : null;
	if (!token || !agent) return unauthorized(url);
	return handler.fetch(request, { authInfo: { token, clientId: agent.connectionId, scopes: [], extra: { agent } } });
};

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
