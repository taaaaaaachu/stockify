import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { deleteInvite } from '$lib/server/households';
import { requireUser } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ locals, params }) => {
	const user = requireUser(locals);
	if (user.instanceRole !== 'super_admin') throw error(403, 'super_adminのみ利用できます。');
	if (!deleteInvite(db, params.id, params.inviteId)) throw error(404, '招待が見つかりません。');
	return new Response(null, { status: 204 });
};
