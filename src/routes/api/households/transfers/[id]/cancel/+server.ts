import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { cancelOwnershipTransfer } from '$lib/server/households';
import { requireHousehold } from '$lib/server/apiGuard';
import { canTransferOwnership } from '$lib/rbac';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals }) => {
	const { householdId, role, user } = requireHousehold(locals);
	if (!canTransferOwnership(role)) throw error(403, 'ownerのみ申請を取り消せます。');
	if (!cancelOwnershipTransfer(db, householdId, user.id)) throw error(404, '交代申請が見つかりません。');
	return json({ ok: true });
};
