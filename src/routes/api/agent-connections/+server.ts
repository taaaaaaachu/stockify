import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { requireRecentAuth, requireUser } from '#lib/server/apiGuard.js';
import { issueManualConnection, listAgentConnections, normalizeAgentName } from '#lib/server/agentConnections.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	const user = requireUser(locals);
	return Response.json(listAgentConnections(db, user.id));
};

/** エージェント接続を手動発行する。トークンはこの応答でしか分からない(ADR 0012)。 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireRecentAuth(locals);
	const body = await request.json().catch(() => null);
	const name = normalizeAgentName(body?.name);
	if (!name) throw error(400, '名前は1〜50文字で入力してください。');
	const householdId = typeof body?.householdId === 'string' ? body.householdId : '';
	const issued = issueManualConnection(db, user.id, householdId, name);
	if (!issued) throw error(404, '世帯が見つかりません。');
	return Response.json(issued, { status: 201 });
};
