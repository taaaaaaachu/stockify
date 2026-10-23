import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import * as stock from '#lib/server/stock.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import { normalizeProductLinkInput } from '#lib/productLinks.js';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = await request.json().catch(() => null);
	const current = stock.getProductLink(db, householdId, params.id);
	if (!current) throw error(404, '商品リンクが見つかりません。');
	const input = normalizeProductLinkInput({ label: body?.label ?? current.label, url: body?.url ?? current.url });
	if (!input) throw error(400, '商品リンクの表示名またはURLが不正です。');
	try {
		return Response.json(stock.updateProductLink(db, householdId, params.id, input));
	} catch (e) {
		if (e instanceof Error && e.message.includes('同じURL')) throw error(409, e.message);
		throw e;
	}
};

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { householdId } = requireHousehold(locals);
	if (!stock.deleteProductLink(db, householdId, params.id)) throw error(404, '商品リンクが見つかりません。');
	return new Response(null, { status: 204 });
};
