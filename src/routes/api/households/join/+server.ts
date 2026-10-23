import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { joinHouseholdByInvite } from '#lib/server/households.js';
import { requireUser } from '#lib/server/apiGuard.js';
import { setHouseholdCookie } from '#lib/server/sessionCookie.js';
import type { RequestHandler } from './$types';

const messages: Record<string, string> = {
	invite_invalid: '招待コードが正しくありません。',
	invite_expired: 'この招待コードは有効期限が切れています。',
	invite_used: 'この招待コードは既に使われています。',
	invite_revoked: 'この招待コードは無効化されています。',
	already_member: 'この世帯には既に所属しています。'
};

export const POST: RequestHandler = async ({ locals, request, cookies }) => {
	const user = requireUser(locals);
	const body = await request.json().catch(() => null);
	const code = typeof body?.code === 'string' ? body.code.trim() : '';
	if (!code) throw error(400, '招待コードは必須です。');
	const result = joinHouseholdByInvite(db, user.id, code);
	if (!result.ok) throw error(400, messages[result.error] ?? '招待コードを使用できません。');
	setHouseholdCookie(cookies, result.householdId);
	return Response.json(result);
};
