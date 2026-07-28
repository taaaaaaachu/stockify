import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';

/** 購入リマインドを送る時刻(0:00 からの分・15分刻み)を設定する。 */
export const PATCH: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals);
	const body = await request.json().catch(() => null);
	const minute = Number(body?.minuteOfDay);
	if (!Number.isInteger(minute) || minute < 0 || minute > 1439 || minute % 15 !== 0) {
		throw error(400, '通知時刻は 15 分刻み(0〜1439 分)で指定してください。');
	}
	db.update(users).set({ notifyMinuteOfDay: minute }).where(eq(users.id, user.id)).run();
	return json({ minuteOfDay: minute });
};
