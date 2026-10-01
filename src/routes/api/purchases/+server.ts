import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as stock from '$lib/server/stock';
import { requireHousehold } from '$lib/server/apiGuard';
import { parseClientId, parseFiniteNumber, parseNonNegativeNumber, parsePositiveNumber } from '$lib/server/inputValidation';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = await request.json().catch(() => null);
	const itemId = typeof body?.itemId === 'string' ? body.itemId : '';
	const volume = parsePositiveNumber(body?.volume);
	const purchasedAt = parseFiniteNumber(body?.purchasedAt);
	if (!itemId) throw error(400, '品目IDは必須です。');
	if (volume === null) throw error(400, '内容量が不正です。');
	if (purchasedAt === null) throw error(400, '購入日時が不正です。');
	let price: number | null = null;
	if (body?.price !== null && body?.price !== undefined && body?.price !== '') {
		price = parseNonNegativeNumber(body.price);
		if (price === null) throw error(400, '価格が不正です。');
	}
	const source = body?.source === undefined ? 'manual' : body.source;
	if (source !== 'manual' && source !== 'subscription') throw error(400, '購入元が不正です。');
	const id = parseClientId(body?.id);
	if (id === null) throw error(400, 'IDが不正です。');

	const purchase = stock.createPurchase(db, householdId, {
		itemId,
		volume,
		price,
		purchasedAt,
		source
	}, id);
	if (!purchase) throw error(404, '品目が見つかりません。');
	return json(purchase, { status: 201 });
};
