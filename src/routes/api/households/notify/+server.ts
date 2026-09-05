import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { requireUser } from '$lib/server/apiGuard';
import { setHouseholdNotifyEnabled } from '$lib/server/households';
import type { RequestHandler } from './$types';

/** 世帯ごとの購入リマインド通知の受け取り可否を切り替える。所属している世帯のみ設定できる。 */
export const PATCH: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals);
	const body = await request.json().catch(() => null);
	const householdId = typeof body?.householdId === 'string' ? body.householdId : '';
	const enabled = body?.enabled;
	if (typeof enabled !== 'boolean') {
		throw error(400, 'enabled は真偽値で指定してください。');
	}
	if (!locals.households.some((h) => h.id === householdId)) {
		throw error(400, 'その世帯には所属していません。');
	}
	setHouseholdNotifyEnabled(db, user.id, householdId, enabled);
	return json({ householdId, enabled });
};
