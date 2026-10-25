import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import * as stock from '#lib/server/stock.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import { parseNonNegativeNumber } from '#lib/server/inputValidation.js';
import { canManageMembers } from '#lib/rbac.js';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals, request }) => {
	const { householdId, role } = requireHousehold(locals);
	if (!canManageMembers(role)) throw error(403, '世帯設定は owner だけが変更できます。');
	const body = await request.json().catch(() => null);
	const patch: { defaultLeadTimeDays?: number } = {};
	if (body?.defaultLeadTimeDays !== undefined) {
		const n = parseNonNegativeNumber(body.defaultLeadTimeDays);
		if (n === null) throw error(400, 'リードタイムが不正です。');
		patch.defaultLeadTimeDays = n;
	}
	return Response.json(stock.updateSettings(db, householdId, patch));
};
