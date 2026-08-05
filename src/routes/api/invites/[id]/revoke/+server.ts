import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { revokeInvite } from '$lib/server/households';
import { requireHousehold } from '$lib/server/apiGuard';
import { canManageInvites } from '$lib/rbac';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, params }) => {
	const { householdId, role } = requireHousehold(locals);
	if (!canManageInvites(role)) throw error(403, '権限がありません。');
	if (!revokeInvite(db, householdId, params.id))
		throw error(400, 'この招待は無効化できません(使用済みなど)。');
	return json({ ok: true });
};
