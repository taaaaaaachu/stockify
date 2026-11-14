import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import * as stock from '#lib/server/stock.js';
import { operationTime, requireHousehold } from '#lib/server/apiGuard.js';
import { parseClientId, parseNonNegativeNumber, parseTrackingMode } from '#lib/server/inputValidation.js';
import { CURRENT_REMAINING_REQUIRED, type StockItemPatch } from '#lib/repo/types.js';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = await request.json().catch(() => null);
	const patch: Record<string, unknown> & StockItemPatch = {};
	if (typeof body?.name === 'string') {
		patch.name = body.name.trim();
		if (!patch.name) throw error(400, '品目名は必須です。');
	}
	if (typeof body?.unit === 'string') {
		patch.unit = body.unit.trim();
		if (!patch.unit) throw error(400, '単位は必須です。');
	}
	if ('category' in (body ?? {}))
		patch.category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : null;
	if ('leadTimeDays' in (body ?? {})) {
		const value = parseNonNegativeNumber(body.leadTimeDays);
		if (body.leadTimeDays !== null && body.leadTimeDays !== '' && value === null)
			throw error(400, 'リードタイムが不正です。');
		patch.leadTimeDays = value;
	}
	if ('provisionalDaysToDeplete' in (body ?? {})) {
		const value = parseNonNegativeNumber(body.provisionalDaysToDeplete);
		if (body.provisionalDaysToDeplete !== null && body.provisionalDaysToDeplete !== '' && value === null)
			throw error(400, '仮の消費日数が不正です。');
		patch.provisionalDaysToDeplete = value;
	}

	if ('trackingMode' in (body ?? {})) patch.trackingMode = parseTrackingMode(body.trackingMode);
	if ('lowStockThreshold' in (body ?? {})) {
		const value = parseNonNegativeNumber(body.lowStockThreshold);
		if (body.lowStockThreshold !== null && body.lowStockThreshold !== '' && value === null)
			throw error(400, '在庫わずかの閾値が不正です。');
		patch.lowStockThreshold = value;
	}
	// 推定 → 手動の切替のアンカー(ADR 0013)。補正の日時はオフライン操作でも操作した時点にする。
	if (body?.currentRemaining !== undefined) {
		const value = parseNonNegativeNumber(body.currentRemaining);
		if (value === null) throw error(400, '今の残量が不正です。');
		patch.currentRemaining = value;
	}
	const adjustmentId = parseClientId(body?.adjustmentId);
	if (adjustmentId === null) throw error(400, 'IDが不正です。');
	patch.adjustmentId = adjustmentId;

	let item;
	try {
		item = stock.updateItem(db, householdId, params.id, patch, operationTime(request));
	} catch (e) {
		if (e instanceof Error && e.message === CURRENT_REMAINING_REQUIRED) throw error(400, e.message);
		throw e;
	}
	if (!item) throw error(404, '品目が見つかりません。');
	return Response.json(item);
};

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { householdId } = requireHousehold(locals);
	if (!stock.deleteItem(db, householdId, params.id)) throw error(404, '品目が見つかりません。');
	return new Response(null, { status: 204 });
};
