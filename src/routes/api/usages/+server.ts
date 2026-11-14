import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import * as stock from '#lib/server/stock.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import { parseClientId, parseFiniteNumber, parsePositiveNumber } from '#lib/server/inputValidation.js';
import { USAGE_NOT_MANUAL } from '#lib/repo/types.js';
import type { RequestHandler } from './$types';

/** 使用を記録する(手動モードの品目のみ。ADR 0013)。 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = await request.json().catch(() => null);
	const itemId = typeof body?.itemId === 'string' ? body.itemId : '';
	const at = parseFiniteNumber(body?.at);
	const volume = parsePositiveNumber(body?.volume);
	if (!itemId) throw error(400, '品目IDは必須です。');
	if (at === null) throw error(400, '日時が不正です。');
	if (volume === null) throw error(400, '使用量が不正です。');
	const id = parseClientId(body?.id);
	if (id === null) throw error(400, 'IDが不正です。');
	let usage;
	try {
		usage = stock.createUsageEvent(db, householdId, { itemId, at, volume }, id);
	} catch (e) {
		if (e instanceof Error && e.message === USAGE_NOT_MANUAL) throw error(400, e.message);
		throw e;
	}
	if (!usage) throw error(404, '品目が見つかりません。');
	return Response.json(usage, { status: 201 });
};
