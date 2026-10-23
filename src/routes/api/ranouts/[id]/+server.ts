import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import * as stock from '#lib/server/stock.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { householdId } = requireHousehold(locals);
	if (!stock.deleteRanOutEvent(db, householdId, params.id))
		throw error(404, '使い切り記録が見つかりません。');
	return new Response(null, { status: 204 });
};
