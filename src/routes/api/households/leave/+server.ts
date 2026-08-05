import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { leaveHousehold } from '$lib/server/households';
import { requireHousehold } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals }) => {
	const { householdId, user } = requireHousehold(locals);
	if (!leaveHousehold(db, householdId, user.id)) throw error(400, 'ownerは後任への交代後に脱退してください。');
	return json({ ok: true });
};
