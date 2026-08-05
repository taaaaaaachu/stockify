import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { listHouseholdMembers } from '$lib/server/households';
import { requireHousehold } from '$lib/server/apiGuard';
import { canManageInvites } from '$lib/rbac';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	const { householdId, role } = requireHousehold(locals);
	if (!canManageInvites(role)) throw error(403, '権限がありません。');
	return json(listHouseholdMembers(db, householdId));
};
