import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { createInvite, listHouseholdInvites } from '$lib/server/households';
import { requireUser } from '$lib/server/apiGuard';
import { parsePositiveNumber } from '$lib/server/inputValidation';
import type { RequestHandler } from './$types';

function requireAdmin(locals: App.Locals) {
	const user = requireUser(locals);
	if (user.instanceRole !== 'super_admin') throw error(403, 'super_adminのみ利用できます。');
	return user;
}

export const GET: RequestHandler = ({ locals, params }) => {
	requireAdmin(locals);
	return json(listHouseholdInvites(db, params.id));
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = requireAdmin(locals);
	const body = await request.json().catch(() => null);
	let expiresAt: number | null = null;
	if (body?.expiresInDays !== undefined && body?.expiresInDays !== null) {
		const days = parsePositiveNumber(body.expiresInDays);
		if (days === null) throw error(400, '有効期限が不正です。');
		expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
	}
	const invite = createInvite(db, params.id, user.id, expiresAt);
	return json({ id: invite.id, code: invite.code }, { status: 201 });
};
