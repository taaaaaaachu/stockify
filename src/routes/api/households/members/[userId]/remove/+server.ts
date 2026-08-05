import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { removeHouseholdMember } from '$lib/server/households';
import { requireHousehold } from '$lib/server/apiGuard';
import { canManageMembers } from '$lib/rbac';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { householdId, role } = requireHousehold(locals);
	if (!canManageMembers(role)) throw error(403, 'メンバーを除名できるのは代表ownerのみです。');
	if (!removeHouseholdMember(db, householdId, params.userId)) throw error(400, '対象ユーザーは除名できるmemberではありません。');
	return json({ ok: true });
};
