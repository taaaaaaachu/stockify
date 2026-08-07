import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as stock from '$lib/server/stock';
import { requireHousehold } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = await request.json().catch(() => null);
	if (body?.direction !== 'up' && body?.direction !== 'down') throw error(400, '並べ替え方向が不正です。');
	if (!stock.moveProductLink(db, householdId, params.id, body.direction)) throw error(404, '商品リンクが見つかりません。');
	return json({ ok: true });
};
