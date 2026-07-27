import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { createInvite, listHouseholdInvites } from '$lib/server/households';
import { requireHousehold } from '$lib/server/apiGuard';
import { canManageHousehold } from '$lib/rbac';
import type { RequestHandler } from './$types';

/** 現在の世帯の招待一覧(owner のみ)。 */
export const GET: RequestHandler = ({ locals }) => {
	const { householdId, role, user } = requireHousehold(locals);
	if (!canManageHousehold(role, user.instanceRole)) throw error(403, '権限がありません。');
	return json(listHouseholdInvites(db, householdId));
};

/** 現在の世帯へ招くコードを発行(owner のみ)。expiresInDays が無ければ無期限。 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const { householdId, role, user } = requireHousehold(locals);
	if (!canManageHousehold(role, user.instanceRole)) throw error(403, '権限がありません。');
	const body = await request.json().catch(() => null);
	let expiresAt: number | null = null;
	if (body?.expiresInDays !== undefined && body.expiresInDays !== null) {
		const days = Number(body.expiresInDays);
		if (!Number.isFinite(days) || days <= 0) throw error(400, '有効期限が不正です。');
		expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
	}
	const invite = createInvite(db, householdId, user.id, expiresAt);
	return json({ id: invite.id, code: invite.code }, { status: 201 });
};
