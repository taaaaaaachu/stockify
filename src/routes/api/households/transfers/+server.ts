import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { requestOwnershipTransfer, listPendingOwnershipTransfers } from '$lib/server/households';
import { requireHousehold, requireUser } from '$lib/server/apiGuard';
import { canTransferOwnership } from '$lib/rbac';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => json(listPendingOwnershipTransfers(db, requireUser(locals).id));

export const POST: RequestHandler = async ({ locals, request }) => {
	const { householdId, role, user } = requireHousehold(locals);
	if (!canTransferOwnership(role)) throw error(403, 'ownerのみ交代を申請できます。');
	const body = await request.json().catch(() => null);
	const candidateUserId = typeof body?.candidateUserId === 'string' ? body.candidateUserId : '';
	const transfer = requestOwnershipTransfer(db, householdId, user.id, candidateUserId);
	if (!transfer) throw error(400, '対象ユーザーを交代候補にできません。保留中の申請がある可能性もあります。');
	return json(transfer, { status: 201 });
};
