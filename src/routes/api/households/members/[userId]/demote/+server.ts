import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { demoteManager } from '$lib/server/households';
import { requireHousehold } from '$lib/server/apiGuard';
import { canManageMembers } from '$lib/rbac';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, params }) => {
	const { householdId, role } = requireHousehold(locals);
	if (!canManageMembers(role)) throw error(403, 'managerを変更できるのはownerのみです。');
	if (!demoteManager(db, householdId, params.userId)) throw error(400, '対象ユーザーはmanagerではありません。');
	return json({ ok: true });
};
