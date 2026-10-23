import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { revokeInvite } from '#lib/server/households.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import { canManageInvites } from '#lib/rbac.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, params }) => {
	const { householdId, role } = requireHousehold(locals);
	if (!canManageInvites(role)) throw error(403, '権限がありません。');
	if (!revokeInvite(db, householdId, params.id))
		throw error(400, 'この招待は無効化できません(使用済みなど)。');
	return Response.json({ ok: true });
};
