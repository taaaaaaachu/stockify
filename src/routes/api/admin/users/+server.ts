import { json, error } from '@sveltejs/kit';
import { listUsers } from '$lib/server/auth';
import type { RequestHandler } from './$types';

function requireSuperAdmin(locals: App.Locals) {
	if (!locals.user) throw error(401, 'ログインが必要です。');
	if (locals.user.instanceRole !== 'super_admin') throw error(403, '権限がありません。');
	return locals.user;
}

export const GET: RequestHandler = ({ locals }) => {
	const user = requireSuperAdmin(locals);
	return json(listUsers().filter((candidate) => candidate.id !== user.id));
};
