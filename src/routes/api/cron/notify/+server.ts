import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { notifyDueRestocks } from '$lib/server/push';
import type { RequestHandler } from './$types';

/**
 * 通知評価cron。外部スケジューラ(Docker cron 等)から定期的に叩く。
 * CRON_SECRET を Authorization: Bearer <secret> または x-cron-secret で検証する。
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(503, 'cron が設定されていません(CRON_SECRET 未設定)。');
	const auth = request.headers.get('authorization');
	const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
	const provided = bearer ?? request.headers.get('x-cron-secret');
	if (provided !== secret) throw error(401, '認証に失敗しました。');

	const result = await notifyDueRestocks(db, Date.now());
	return json(result);
};
