import { error } from '@sveltejs/kit';
import { requireUser } from '#lib/server/apiGuard.js';
import { setHouseholdCookie } from '#lib/server/sessionCookie.js';
import type { RequestHandler } from './$types';

/** 現在の世帯を切り替える。所属している世帯のみ選択できる。 */
export const POST: RequestHandler = async ({ locals, request, cookies }) => {
	requireUser(locals);
	const body = await request.json().catch(() => null);
	const householdId = typeof body?.householdId === 'string' ? body.householdId : '';
	const belongs = locals.households.some((h) => h.id === householdId);
	if (!belongs) throw error(400, 'その世帯には所属していません。');
	setHouseholdCookie(cookies, householdId);
	return Response.json({ ok: true });
};
