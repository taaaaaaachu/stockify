import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as stock from '$lib/server/stock';
import { requireHousehold } from '$lib/server/apiGuard';
import { normalizeProductLinkInput } from '$lib/productLinks';
import { parseClientId } from '$lib/server/inputValidation';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = await request.json().catch(() => null);
	const input = normalizeProductLinkInput(body ?? {});
	const itemId = typeof body?.itemId === 'string' ? body.itemId : '';
	if (!itemId || !input) throw error(400, '商品リンクの表示名またはURLが不正です。');
	const id = parseClientId(body?.id);
	if (id === null) throw error(400, 'IDが不正です。');
	try {
		const link = stock.createProductLink(db, householdId, { itemId, ...input }, id);
		if (!link) throw error(404, '品目が見つかりません。');
		return json(link, { status: 201 });
	} catch (e) {
		if (e instanceof Error && e.message.includes('同じURL')) throw error(409, e.message);
		throw e;
	}
};
