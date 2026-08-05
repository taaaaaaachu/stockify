import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { createHousehold } from '$lib/server/households';
import { requireUser } from '$lib/server/apiGuard';
import { setHouseholdCookie } from '$lib/server/sessionCookie';
import { isInstanceAdmin } from '$lib/rbac';
import type { RequestHandler } from './$types';

/** 新しい世帯を作成し、作成者を owner にする。作成した世帯をアクティブにする。 */
export const POST: RequestHandler = async ({ locals, request, cookies }) => {
	const user = requireUser(locals);
	if (!isInstanceAdmin(user.instanceRole)) throw error(403, '権限がありません。');
	const body = await request.json().catch(() => null);
	const name = typeof body?.name === 'string' ? body.name.trim() : '';
	if (!name) throw error(400, '世帯名は必須です。');
	const household = createHousehold(db, name, user.id);
	setHouseholdCookie(cookies, household.id);
	return json({ id: household.id, name: household.name }, { status: 201 });
};
