import { error } from '@sveltejs/kit';
import type { HouseholdRole } from '$lib/rbac';

interface AuthedUser {
	id: string;
	username: string;
	instanceRole: import('$lib/rbac').InstanceRole;
}

/** ログイン必須。未ログインなら 401。 */
export function requireUser(locals: App.Locals): AuthedUser {
	if (!locals.user) throw error(401, 'ログインが必要です。');
	return locals.user;
}

export interface ActiveContext {
	user: AuthedUser;
	householdId: string;
	role: HouseholdRole;
}

/**
 * ログイン + 有効な世帯を必須にする。世帯未選択なら 400。
 * 在庫系 API はすべてこれを通す。
 */
export function requireHousehold(locals: App.Locals): ActiveContext {
	const user = requireUser(locals);
	if (!locals.activeHousehold) throw error(400, '世帯が選択されていません。');
	return { user, householdId: locals.activeHousehold.id, role: locals.activeHousehold.role };
}
