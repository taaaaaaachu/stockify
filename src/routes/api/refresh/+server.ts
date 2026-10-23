import { db } from '#lib/server/db/index.js';
import * as stock from '#lib/server/stock.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import type { RequestHandler } from './$types';

/** 現在の世帯の定期便を遅延生成する(ADR 0002)。 */
export const POST: RequestHandler = ({ locals }) => {
	const { householdId } = requireHousehold(locals);
	return Response.json(stock.materializeDueSubscriptions(db, householdId, Date.now()));
};
