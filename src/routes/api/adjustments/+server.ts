import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as stock from '$lib/server/stock';
import { requireHousehold } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = await request.json().catch(() => null);
	const itemId = typeof body?.itemId === 'string' ? body.itemId : '';
	const at = Number(body?.at);
	const remaining = Number(body?.remaining);
	if (!itemId) throw error(400, '品目IDは必須です。');
	if (!Number.isFinite(at)) throw error(400, '日時が不正です。');
	if (!Number.isFinite(remaining) || remaining < 0) throw error(400, '残量が不正です。');
	const adj = stock.createAdjustment(db, householdId, { itemId, at, remaining });
	if (!adj) throw error(404, '品目が見つかりません。');
	return json(adj, { status: 201 });
};
