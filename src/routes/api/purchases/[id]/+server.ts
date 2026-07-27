import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as stock from '$lib/server/stock';
import { requireHousehold } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { householdId } = requireHousehold(locals);
	if (!stock.deletePurchase(db, householdId, params.id)) throw error(404, '購入が見つかりません。');
	return new Response(null, { status: 204 });
};
