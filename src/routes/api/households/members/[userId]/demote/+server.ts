import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { demoteManager } from '#lib/server/households.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import { canManageMembers } from '#lib/rbac.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, params }) => {
	const { householdId, role } = requireHousehold(locals);
	if (!canManageMembers(role)) throw error(403, 'managerを変更できるのはownerのみです。');
	if (!demoteManager(db, householdId, params.userId)) throw error(400, '対象ユーザーはmanagerではありません。');
	return Response.json({ ok: true });
};
