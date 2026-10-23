import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { promoteMemberToManager } from '#lib/server/households.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import { canManageMembers } from '#lib/rbac.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, params }) => {
	const { householdId, role } = requireHousehold(locals);
	if (!canManageMembers(role)) throw error(403, '権限がありません。');
	if (!promoteMemberToManager(db, householdId, params.userId))
		throw error(400, '対象ユーザーは所属中のmemberではありません。');
	return Response.json({ ok: true });
};
