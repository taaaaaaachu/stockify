import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { listHouseholdMembers } from '$lib/server/households';
import { requireHousehold } from '$lib/server/apiGuard';
import { canManageHousehold } from '$lib/rbac';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	const { householdId, role, user } = requireHousehold(locals);
	if (!canManageHousehold(role, user.instanceRole)) throw error(403, '権限がありません。');
	return json(listHouseholdMembers(db, householdId));
};
