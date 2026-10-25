import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { requireUser } from '#lib/server/apiGuard.js';
import { revokeAgentConnection } from '#lib/server/agentConnections.js';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ locals, params }) => {
	const user = requireUser(locals);
	if (!revokeAgentConnection(db, user.id, params.id)) throw error(404, 'エージェント接続が見つかりません。');
	return new Response(null, { status: 204 });
};
