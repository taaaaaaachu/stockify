import { db } from '#lib/server/db/index.js';
import * as stock from '#lib/server/stock.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	const { householdId } = requireHousehold(locals);
	return Response.json(stock.exportAll(db, householdId));
};
