import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as stock from '$lib/server/stock';
import { requireHousehold } from '$lib/server/apiGuard';
import { parseNonNegativeNumber } from '$lib/server/inputValidation';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = await request.json().catch(() => null);
	const patch: Record<string, unknown> = {};
	if (typeof body?.name === 'string') {
		patch.name = body.name.trim();
		if (!patch.name) throw error(400, '品目名は必須です。');
	}
	if (typeof body?.unit === 'string') {
		patch.unit = body.unit.trim();
		if (!patch.unit) throw error(400, '単位は必須です。');
	}
	if ('category' in (body ?? {}))
		patch.category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : null;
	if ('leadTimeDays' in (body ?? {})) {
		const value = parseNonNegativeNumber(body.leadTimeDays);
		if (body.leadTimeDays !== null && body.leadTimeDays !== '' && value === null)
			throw error(400, 'リードタイムが不正です。');
		patch.leadTimeDays = value;
	}
	if ('provisionalDaysToDeplete' in (body ?? {})) {
		const value = parseNonNegativeNumber(body.provisionalDaysToDeplete);
		if (body.provisionalDaysToDeplete !== null && body.provisionalDaysToDeplete !== '' && value === null)
			throw error(400, '仮の消費日数が不正です。');
		patch.provisionalDaysToDeplete = value;
	}

	const item = stock.updateItem(db, householdId, params.id, patch);
	if (!item) throw error(404, '品目が見つかりません。');
	return json(item);
};

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { householdId } = requireHousehold(locals);
	if (!stock.deleteItem(db, householdId, params.id)) throw error(404, '品目が見つかりません。');
	return new Response(null, { status: 204 });
};
