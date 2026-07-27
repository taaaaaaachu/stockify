import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as stock from '$lib/server/stock';
import { requireHousehold } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = await request.json().catch(() => null);
	const itemId = typeof body?.itemId === 'string' ? body.itemId : '';
	const intervalDays = Number(body?.intervalDays);
	const nextDeliveryAt = Number(body?.nextDeliveryAt);
	const volumePerDelivery = Number(body?.volumePerDelivery);
	const quantityPerDelivery = Number(body?.quantityPerDelivery ?? 1);
	if (!itemId) throw error(400, '品目IDは必須です。');
	if (!Number.isFinite(intervalDays) || intervalDays <= 0) throw error(400, '間隔が不正です。');
	if (!Number.isFinite(nextDeliveryAt)) throw error(400, '次回予定日が不正です。');
	if (!Number.isFinite(volumePerDelivery) || volumePerDelivery <= 0)
		throw error(400, '内容量が不正です。');
	if (!Number.isFinite(quantityPerDelivery) || quantityPerDelivery <= 0)
		throw error(400, '個数が不正です。');

	const sub = stock.createSubscription(db, householdId, {
		itemId,
		intervalDays,
		nextDeliveryAt,
		volumePerDelivery,
		quantityPerDelivery,
		paused: Boolean(body?.paused)
	});
	if (!sub) throw error(404, '品目が見つかりません。');
	// 追加直後に過去分があれば生成しておく。
	stock.materializeDueSubscriptions(db, householdId, Date.now());
	return json(sub, { status: 201 });
};
