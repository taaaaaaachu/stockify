import { error } from '@sveltejs/kit';
import { CRON_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.js';
import { notifyDueRestocks, sendWebPush, NOTIFY_COOLDOWN_MS } from '#lib/server/push.js';
import type { RequestHandler } from './$types';

/**
 * 通知評価cron。外部スケジューラ(Docker cron 等)から 15 分ごとに叩く。
 * 各ユーザーの設定時刻スロットに該当し、購入推奨品目があれば通知する。
 * CRON_SECRET を Authorization: Bearer <secret> または x-cron-secret で検証する。
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = CRON_SECRET;
	if (!secret) throw error(503, 'cron が設定されていません(CRON_SECRET 未設定)。');
	const auth = request.headers.get('authorization');
	const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
	const provided = bearer ?? request.headers.get('x-cron-secret');
	if (provided !== secret) throw error(401, '認証に失敗しました。');

	// サーバーのローカル時刻(compose で TZ=Asia/Tokyo を設定)での 0:00 からの分。
	const nowDate = new Date();
	const nowMinuteOfDay = nowDate.getHours() * 60 + nowDate.getMinutes();

	const result = await notifyDueRestocks(db, nowDate.getTime(), {
		send: sendWebPush,
		cooldownMs: NOTIFY_COOLDOWN_MS,
		nowMinuteOfDay
	});
	return Response.json(result);
};
