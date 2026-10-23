import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { deleteInvite } from '#lib/server/households.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import { canManageInvites } from '#lib/rbac.js';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { householdId, role } = requireHousehold(locals);
	if (!canManageInvites(role)) throw error(403, '権限がありません。');
	if (!deleteInvite(db, householdId, params.id)) throw error(404, '招待が見つかりません。');
	return new Response(null, { status: 204 });
};
