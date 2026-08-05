import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { deleteHousehold } from '$lib/server/households';
import { requireUser } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ locals, params, request }) => {
	const user = requireUser(locals);
	if (user.instanceRole !== 'super_admin') throw error(403, 'super_adminのみ利用できます。');
	const body = await request.json().catch(() => null);
	const expectedName = typeof body?.expectedName === 'string' ? body.expectedName : '';
	if (!deleteHousehold(db, params.id, expectedName)) throw error(400, '世帯名の確認に失敗したか、世帯が存在しません。');
	return new Response(null, { status: 204 });
};
