import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { acceptOwnershipTransfer } from '#lib/server/households.js';
import { requireUser } from '#lib/server/apiGuard.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, params }) => {
	if (!acceptOwnershipTransfer(db, params.id, requireUser(locals).id)) throw error(400, '交代申請を承認できません。');
	return Response.json({ ok: true });
};
