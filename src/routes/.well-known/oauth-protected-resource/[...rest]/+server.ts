import { publicOrigin, mcpResource } from '#lib/server/origin.js';
import type { RequestHandler } from './$types';

/**
 * 保護リソースのメタデータ(RFC 9728)。MCP の resource は /mcp なので本来の在処は
 * /.well-known/oauth-protected-resource/mcp だが、末尾なしで探すクライアントにも同じものを返す。
 */
export const GET: RequestHandler = ({ url, params }) => {
	if (params.rest !== '' && params.rest !== 'mcp') return new Response('Not Found', { status: 404 });
	return Response.json(
		{
			resource: mcpResource(url),
			authorization_servers: [publicOrigin(url)],
			bearer_methods_supported: ['header'],
			resource_name: 'Stockify'
		},
		{ headers: { 'access-control-allow-origin': '*' } }
	);
};
