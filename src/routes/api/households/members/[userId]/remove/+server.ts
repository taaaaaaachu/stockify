import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { removeHouseholdMember } from '#lib/server/households.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import { canManageMembers } from '#lib/rbac.js';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { householdId, role } = requireHousehold(locals);
	if (!canManageMembers(role)) throw error(403, 'メンバーを除名できるのはownerのみです。');
	if (!removeHouseholdMember(db, householdId, params.userId)) throw error(400, '対象ユーザーはowner以外の所属者ではありません。');
	return Response.json({ ok: true });
};
