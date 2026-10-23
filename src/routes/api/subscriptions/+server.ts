import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import * as stock from '#lib/server/stock.js';
import { operationTime, requireHousehold } from '#lib/server/apiGuard.js';
import { parseClientId, parseFiniteNumber, parsePositiveNumber } from '#lib/server/inputValidation.js';
import { isAcceptableNextDelivery } from '#lib/domain/subscription.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = await request.json().catch(() => null);
	const itemId = typeof body?.itemId === 'string' ? body.itemId : '';
	const intervalDays = parsePositiveNumber(body?.intervalDays);
	const nextDeliveryAt = parseFiniteNumber(body?.nextDeliveryAt);
	const volumePerDelivery = parsePositiveNumber(body?.volumePerDelivery);
	const quantityPerDelivery = parsePositiveNumber(body?.quantityPerDelivery ?? 1);
	if (!itemId) throw error(400, '品目IDは必須です。');
	if (intervalDays === null) throw error(400, '間隔が不正です。');
	if (nextDeliveryAt === null || !isAcceptableNextDelivery(nextDeliveryAt, operationTime(request)))
		throw error(400, '次回予定日は今日以降で指定してください。');
	if (volumePerDelivery === null) throw error(400, '内容量が不正です。');
	if (quantityPerDelivery === null) throw error(400, '個数が不正です。');
	if (body?.paused !== undefined && typeof body.paused !== 'boolean')
		throw error(400, 'paused が不正です。');
	const id = parseClientId(body?.id);
	if (id === null) throw error(400, 'IDが不正です。');

	const sub = stock.createSubscription(db, householdId, {
		itemId,
		intervalDays,
		nextDeliveryAt,
		volumePerDelivery,
		quantityPerDelivery,
		paused: body?.paused ?? false
	}, id);
	if (!sub) throw error(404, '品目が見つかりません。');
	// 追加直後に過去分があれば生成しておく。
	stock.materializeDueSubscriptions(db, householdId, Date.now());
	return Response.json(sub, { status: 201 });
};
