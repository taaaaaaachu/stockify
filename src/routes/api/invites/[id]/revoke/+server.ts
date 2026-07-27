import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { revokeInvite } from '$lib/server/households';
import { requireHousehold } from '$lib/server/apiGuard';
import { canManageHousehold } from '$lib/rbac';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, params }) => {
	const { householdId, role, user } = requireHousehold(locals);
	if (!canManageHousehold(role, user.instanceRole)) throw error(403, '権限がありません。');
	if (!revokeInvite(db, householdId, params.id))
		throw error(400, 'この招待は無効化できません(使用済みなど)。');
	return json({ ok: true });
};
