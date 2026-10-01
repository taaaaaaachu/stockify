import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as stock from '$lib/server/stock';
import { requireHousehold } from '$lib/server/apiGuard';
import { parseClientId, parseNonNegativeNumber } from '$lib/server/inputValidation';
import type { RequestHandler } from './$types';

function str(v: unknown): string {
	return typeof v === 'string' ? v.trim() : '';
}

function optionalNonNegativeNumber(value: unknown, label: string): number | null {
	if (value === null || value === undefined || value === '') return null;
	const number = parseNonNegativeNumber(value);
	if (number === null) throw error(400, `${label}が不正です。`);
	return number;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = await request.json().catch(() => null);
	const name = str(body?.name);
	const unit = str(body?.unit);
	if (!name) throw error(400, '品目名は必須です。');
	if (!unit) throw error(400, '単位は必須です。');
	const id = parseClientId(body?.id);
	if (id === null) throw error(400, 'IDが不正です。');
	const item = stock.createItem(db, householdId, {
		name,
		unit,
		category: str(body?.category) || null,
		leadTimeDays: optionalNonNegativeNumber(body?.leadTimeDays, 'リードタイム'),
		provisionalDaysToDeplete: optionalNonNegativeNumber(body?.provisionalDaysToDeplete, '仮の消費日数')
	}, id);
	if (!item) throw error(404, '品目が見つかりません。');
	return json(item, { status: 201 });
};
