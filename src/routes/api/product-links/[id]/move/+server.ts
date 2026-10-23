import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import * as stock from '#lib/server/stock.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = await request.json().catch(() => null);
	if (body?.direction !== 'up' && body?.direction !== 'down') throw error(400, '並べ替え方向が不正です。');
	const fromPosition = body?.fromPosition;
	if (fromPosition !== undefined && !Number.isInteger(fromPosition)) throw error(400, '並べ替え元の位置が不正です。');
	if (!stock.moveProductLink(db, householdId, params.id, body.direction, fromPosition)) throw error(404, '商品リンクが見つかりません。');
	return Response.json({ ok: true });
};
