import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { cancelOwnershipTransfer } from '#lib/server/households.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import { canTransferOwnership } from '#lib/rbac.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals }) => {
	const { householdId, role, user } = requireHousehold(locals);
	if (!canTransferOwnership(role)) throw error(403, 'ownerのみ申請を取り消せます。');
	if (!cancelOwnershipTransfer(db, householdId, user.id)) throw error(404, '交代申請が見つかりません。');
	return Response.json({ ok: true });
};
