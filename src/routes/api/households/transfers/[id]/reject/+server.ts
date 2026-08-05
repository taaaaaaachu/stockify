import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { rejectOwnershipTransfer } from '$lib/server/households';
import { requireUser } from '$lib/server/apiGuard';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, params }) => {
	if (!rejectOwnershipTransfer(db, params.id, requireUser(locals).id)) throw error(404, '交代申請が見つかりません。');
	return json({ ok: true });
};
