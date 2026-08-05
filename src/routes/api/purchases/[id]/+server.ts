import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as stock from '$lib/server/stock';
import { requireHousehold } from '$lib/server/apiGuard';
import { parseFiniteNumber, parseNonNegativeNumber, parsePositiveNumber } from '$lib/server/inputValidation';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { householdId } = requireHousehold(locals);
	if (!stock.deletePurchase(db, householdId, params.id)) throw error(404, '購入が見つかりません。');
	return new Response(null, { status: 204 });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = await request.json().catch(() => null);
	const patch: { volume?: number; price?: number | null; purchasedAt?: number } = {};
	if (body?.volume !== undefined) {
		const volume = parsePositiveNumber(body.volume);
		if (volume === null) throw error(400, '内容量が不正です。');
		patch.volume = volume;
	}
	if (body?.price !== undefined) {
		if (body.price === null || body.price === '') patch.price = null;
		else {
			const price = parseNonNegativeNumber(body.price);
			if (price === null) throw error(400, '価格が不正です。');
			patch.price = price;
		}
	}
	if (body?.purchasedAt !== undefined) {
		const purchasedAt = parseFiniteNumber(body.purchasedAt);
		if (purchasedAt === null) throw error(400, '購入日時が不正です。');
		patch.purchasedAt = purchasedAt;
	}
	const purchase = stock.updatePurchase(db, householdId, params.id, patch);
	if (!purchase) throw error(404, '購入が見つかりません。');
	return json(purchase);
};
