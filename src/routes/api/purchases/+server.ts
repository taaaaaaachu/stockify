import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as stock from '$lib/server/stock';
import { requireHousehold } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = await request.json().catch(() => null);
	const itemId = typeof body?.itemId === 'string' ? body.itemId : '';
	const volume = Number(body?.volume);
	const purchasedAt = Number(body?.purchasedAt);
	if (!itemId) throw error(400, '品目IDは必須です。');
	if (!Number.isFinite(volume) || volume <= 0) throw error(400, '内容量が不正です。');
	if (!Number.isFinite(purchasedAt)) throw error(400, '購入日時が不正です。');
	const price = body?.price === null || body?.price === undefined ? null : Number(body.price);
	const source = body?.source === 'subscription' ? 'subscription' : 'manual';

	const purchase = stock.createPurchase(db, householdId, {
		itemId,
		volume,
		price: price !== null && Number.isFinite(price) ? price : null,
		purchasedAt,
		source
	});
	if (!purchase) throw error(404, '品目が見つかりません。');
	return json(purchase, { status: 201 });
};
