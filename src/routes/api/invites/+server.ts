import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { createInvite, listHouseholdInvites } from '#lib/server/households.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import { canManageInvites } from '#lib/rbac.js';
import { parsePositiveNumber } from '#lib/server/inputValidation.js';
import type { RequestHandler } from './$types';

/** 現在の世帯の招待一覧(owner のみ)。 */
export const GET: RequestHandler = ({ locals }) => {
	const { householdId, role } = requireHousehold(locals);
	if (!canManageInvites(role)) throw error(403, '権限がありません。');
	return Response.json(listHouseholdInvites(db, householdId));
};

/** 現在の世帯へ招くコードを発行(owner のみ)。expiresInDays が無ければ無期限。 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const { householdId, role, user } = requireHousehold(locals);
	if (!canManageInvites(role)) throw error(403, '権限がありません。');
	const body = await request.json().catch(() => null);
	let expiresAt: number | null = null;
	if (body?.expiresInDays !== undefined && body.expiresInDays !== null) {
		const days = parsePositiveNumber(body.expiresInDays);
		if (days === null) throw error(400, '有効期限が不正です。');
		expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
	}
	const invite = createInvite(db, householdId, user.id, expiresAt);
	return Response.json({ id: invite.id, code: invite.code }, { status: 201 });
};
