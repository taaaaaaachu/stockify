import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { requireUser } from '$lib/server/apiGuard';
import { saveSubscription } from '$lib/server/push';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals);
	const body = await request.json().catch(() => null);
	const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
	const p256dh = body?.keys?.p256dh;
	const auth = body?.keys?.auth;
	if (!endpoint || typeof p256dh !== 'string' || typeof auth !== 'string') {
		throw error(400, '購読情報が不正です。');
	}
	saveSubscription(db, user.id, { endpoint, keys: { p256dh, auth } });
	return json({ ok: true }, { status: 201 });
};
