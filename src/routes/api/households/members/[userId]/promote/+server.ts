import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { promoteMemberToManager } from '$lib/server/households';
import { requireHousehold } from '$lib/server/apiGuard';
import { canManageMembers } from '$lib/rbac';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, params }) => {
	const { householdId, role } = requireHousehold(locals);
	if (!canManageMembers(role)) throw error(403, '権限がありません。');
	if (!promoteMemberToManager(db, householdId, params.userId))
		throw error(400, '対象ユーザーは所属中のmemberではありません。');
	return json({ ok: true });
};
