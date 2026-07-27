import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { deleteInvite } from '$lib/server/households';
import { requireHousehold } from '$lib/server/apiGuard';
import { canManageHousehold } from '$lib/rbac';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { householdId, role, user } = requireHousehold(locals);
	if (!canManageHousehold(role, user.instanceRole)) throw error(403, '権限がありません。');
	if (!deleteInvite(db, householdId, params.id)) throw error(404, '招待が見つかりません。');
	return new Response(null, { status: 204 });
};
