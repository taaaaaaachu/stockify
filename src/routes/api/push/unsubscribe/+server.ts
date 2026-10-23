import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { requireUser } from '#lib/server/apiGuard.js';
import { deleteSubscription } from '#lib/server/push.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals);
	const body = await request.json().catch(() => null);
	const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
	if (!endpoint) throw error(400, 'endpoint は必須です。');
	deleteSubscription(db, user.id, endpoint);
	return Response.json({ ok: true });
};
