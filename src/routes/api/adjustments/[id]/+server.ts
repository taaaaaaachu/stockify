import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import * as stock from '#lib/server/stock.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { householdId } = requireHousehold(locals);
	if (!stock.deleteAdjustment(db, householdId, params.id))
		throw error(404, '残量補正が見つかりません。');
	return new Response(null, { status: 204 });
};
