import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as stock from '$lib/server/stock';
import { requireHousehold } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';

function str(v: unknown): string {
	return typeof v === 'string' ? v.trim() : '';
}
function numOrNull(v: unknown): number | null {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = await request.json().catch(() => null);
	const name = str(body?.name);
	const unit = str(body?.unit);
	if (!name) throw error(400, '品目名は必須です。');
	if (!unit) throw error(400, '単位は必須です。');
	const item = stock.createItem(db, householdId, {
		name,
		unit,
		category: str(body?.category) || null,
		leadTimeDays: numOrNull(body?.leadTimeDays),
		provisionalDaysToDeplete: numOrNull(body?.provisionalDaysToDeplete)
	});
	return json(item, { status: 201 });
};
