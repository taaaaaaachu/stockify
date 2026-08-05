import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { revokeInvite } from '$lib/server/households';
import { requireUser } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, params }) => {
	const user = requireUser(locals);
	if (user.instanceRole !== 'super_admin') throw error(403, 'super_adminのみ利用できます。');
	if (!revokeInvite(db, params.id, params.inviteId)) throw error(400, 'この招待は無効化できません。');
	return json({ ok: true });
};
