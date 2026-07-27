import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as stock from '$lib/server/stock';
import { requireHousehold } from '$lib/server/apiGuard';
import type { Snapshot } from '$lib/repo/types';
import type { RequestHandler } from './$types';

/** ゲスト(IndexedDB)のスナップショットを現在の世帯へ取り込む(単純追記)。 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const { householdId } = requireHousehold(locals);
	const body = (await request.json().catch(() => null)) as Snapshot | null;
	if (!body || !Array.isArray(body.items)) throw error(400, '取り込みデータが不正です。');
	const snapshot: Snapshot = {
		settings: body.settings ?? { defaultLeadTimeDays: 7 },
		items: body.items ?? [],
		purchases: body.purchases ?? [],
		ranOutEvents: body.ranOutEvents ?? [],
		adjustments: body.adjustments ?? [],
		subscriptions: body.subscriptions ?? []
	};
	return json(stock.importSnapshot(db, householdId, snapshot));
};
