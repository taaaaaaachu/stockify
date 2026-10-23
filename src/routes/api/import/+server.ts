import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import * as stock from '#lib/server/stock.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import { isValidSnapshot } from '#lib/server/inputValidation.js';
import type { Snapshot } from '#lib/repo/types.js';
import type { RequestHandler } from './$types';

/** ゲスト(IndexedDB)のスナップショットを現在の世帯へ取り込む(単純追記)。 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const { householdId } = requireHousehold(locals);
	const body: unknown = await request.json().catch(() => null);
	if (!isValidSnapshot(body)) throw error(400, '取り込みデータが不正です。');
	const snapshot: Snapshot = {
		settings: body.settings ?? { defaultLeadTimeDays: 7 },
		items: body.items ?? [],
		productLinks: body.productLinks ?? [],
		purchases: body.purchases ?? [],
		ranOutEvents: body.ranOutEvents ?? [],
		adjustments: body.adjustments ?? [],
		subscriptions: body.subscriptions ?? []
	};
	return Response.json(stock.importSnapshot(db, householdId, snapshot));
};
