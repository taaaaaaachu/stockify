import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { rejectOwnershipTransfer } from '#lib/server/households.js';
import { requireUser } from '#lib/server/apiGuard.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, params }) => {
	if (!rejectOwnershipTransfer(db, params.id, requireUser(locals).id)) throw error(404, '交代申請が見つかりません。');
	return Response.json({ ok: true });
};
