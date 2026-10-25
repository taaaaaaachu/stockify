import { publicOrigin } from '#lib/server/origin.js';
import type { RequestHandler } from './$types';

/** 認可サーバーのメタデータ(RFC 8414)。クライアント登録は CIMD だけ(ADR 0012)。 */
export const GET: RequestHandler = ({ url }) => {
	const issuer = publicOrigin(url);
	return Response.json(
		{
			issuer,
			authorization_endpoint: `${issuer}/oauth/authorize`,
			token_endpoint: `${issuer}/oauth/token`,
			revocation_endpoint: `${issuer}/oauth/revoke`,
			response_types_supported: ['code'],
			grant_types_supported: ['authorization_code', 'refresh_token'],
			code_challenge_methods_supported: ['S256'],
			token_endpoint_auth_methods_supported: ['none'],
			revocation_endpoint_auth_methods_supported: ['none'],
			client_id_metadata_document_supported: true,
			authorization_response_iss_parameter_supported: true
		},
		{ headers: { 'access-control-allow-origin': '*' } }
	);
};
