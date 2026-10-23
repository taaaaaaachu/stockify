import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { listHouseholdMembers } from '#lib/server/households.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import { canManageInvites } from '#lib/rbac.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	const { householdId, role } = requireHousehold(locals);
	if (!canManageInvites(role)) throw error(403, '権限がありません。');
	return Response.json(listHouseholdMembers(db, householdId));
};
