import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as stock from '$lib/server/stock';
import { requireHousehold } from '$lib/server/apiGuard';
import { parsePositiveNumber } from '$lib/server/inputValidation';
import { isAcceptableNextDelivery } from '$lib/domain/subscription';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = await request.json().catch(() => null);
	const patch: Record<string, unknown> = {};
	for (const key of [
		'intervalDays',
		'nextDeliveryAt',
		'volumePerDelivery',
		'quantityPerDelivery'
	] as const) {
		if (body?.[key] !== undefined) {
			const n = parsePositiveNumber(body[key]);
			if (n === null) throw error(400, `${key} が不正です。`);
			patch[key] = n;
		}
	}
	if (body?.nextDeliveryAt !== undefined) {
		const nextDeliveryAt = parsePositiveNumber(body.nextDeliveryAt);
		if (nextDeliveryAt === null || !isAcceptableNextDelivery(nextDeliveryAt, Date.now()))
			throw error(400, '次回予定日は今日以降で指定してください。');
	}
	if (body?.paused !== undefined) {
		if (typeof body.paused !== 'boolean') throw error(400, 'paused が不正です。');
		patch.paused = body.paused;
	}

	const sub = stock.updateSubscription(db, householdId, params.id, patch);
	if (!sub) throw error(404, '定期便が見つかりません。');
	return json(sub);
};

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { householdId } = requireHousehold(locals);
	if (!stock.deleteSubscription(db, householdId, params.id))
		throw error(404, '定期便が見つかりません。');
	return new Response(null, { status: 204 });
};
