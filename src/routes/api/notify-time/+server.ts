import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { users } from '#lib/server/db/schema.js';
import { requireUser } from '#lib/server/apiGuard.js';
import { normalizeNotifyMinute } from '#lib/notify-time.js';
import { parseInteger } from '#lib/server/inputValidation.js';
import type { RequestHandler } from './$types';

/** 購入リマインドを送る時刻(0:00 からの分)を15分単位へ切り捨てて設定する。 */
export const PATCH: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals);
	const body = await request.json().catch(() => null);
	const minute = parseInteger(body?.minuteOfDay);
	if (minute === null || minute < 0 || minute > 1439) {
		throw error(400, '通知時刻は 0〜1439 分の整数で指定してください。');
	}
	const normalizedMinute = normalizeNotifyMinute(minute);
	db.update(users).set({ notifyMinuteOfDay: normalizedMinute }).where(eq(users.id, user.id)).run();
	return Response.json({ minuteOfDay: normalizedMinute });
};
