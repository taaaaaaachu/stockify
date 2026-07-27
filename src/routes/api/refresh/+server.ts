import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as stock from '$lib/server/stock';
import { requireHousehold } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';

/** 現在の世帯の定期便を遅延生成する(ADR 0002)。 */
export const POST: RequestHandler = ({ locals }) => {
	const { householdId } = requireHousehold(locals);
	return json(stock.materializeDueSubscriptions(db, householdId, Date.now()));
};
