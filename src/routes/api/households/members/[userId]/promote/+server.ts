import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { promoteMemberToOwner } from '$lib/server/households';
import { requireHousehold } from '$lib/server/apiGuard';
import { canManageHousehold } from '$lib/rbac';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, params }) => {
	const { householdId, role, user } = requireHousehold(locals);
	if (!canManageHousehold(role, user.instanceRole)) throw error(403, '権限がありません。');
	if (!promoteMemberToOwner(db, householdId, params.userId))
		throw error(400, '対象ユーザーは所属中のmemberではありません。');
	return json({ ok: true });
};
