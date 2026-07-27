import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as stock from '$lib/server/stock';
import { requireHousehold } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	const { householdId } = requireHousehold(locals);
	return json(stock.exportAll(db, householdId));
};
