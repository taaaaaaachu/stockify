import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as stock from '$lib/server/stock';
import { requireHousehold } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';

function numOrNull(v: unknown): number | null {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = await request.json().catch(() => null);
	const patch: Record<string, unknown> = {};
	if (typeof body?.name === 'string') patch.name = body.name.trim();
	if (typeof body?.unit === 'string') patch.unit = body.unit.trim();
	if ('category' in (body ?? {}))
		patch.category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : null;
	if ('leadTimeDays' in (body ?? {})) patch.leadTimeDays = numOrNull(body.leadTimeDays);
	if ('provisionalDaysToDeplete' in (body ?? {}))
		patch.provisionalDaysToDeplete = numOrNull(body.provisionalDaysToDeplete);

	const item = stock.updateItem(db, householdId, params.id, patch);
	if (!item) throw error(404, '品目が見つかりません。');
	return json(item);
};

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { householdId } = requireHousehold(locals);
	if (!stock.deleteItem(db, householdId, params.id)) throw error(404, '品目が見つかりません。');
	return new Response(null, { status: 204 });
};
