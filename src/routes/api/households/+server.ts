import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { createHousehold } from '#lib/server/households.js';
import { requireUser } from '#lib/server/apiGuard.js';
import type { RequestHandler } from './$types';

/** super_adminが所属者なしの空世帯を作成する。 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals);
	if (user.instanceRole !== 'super_admin') throw error(403, '世帯を作成できるのはsuper_adminのみです。');
	const body = await request.json().catch(() => null);
	const name = typeof body?.name === 'string' ? body.name.trim() : '';
	if (!name) throw error(400, '世帯名は必須です。');
	const household = createHousehold(db, name);
	return Response.json({ id: household.id, name: household.name }, { status: 201 });
};
