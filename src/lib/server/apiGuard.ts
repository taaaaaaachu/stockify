import { error } from '@sveltejs/kit';
import type { HouseholdRole } from '$lib/rbac';

interface AuthedUser {
	id: string;
	username: string;
	instanceRole: import('$lib/rbac').InstanceRole;
	mustChangePassword: boolean;
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

/** 操作日時を遡って認める上限(ADR 0009)。 */
export const MAX_OPERATION_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 日付検証の基準にする「今」。オフライン中の操作を後から送るとき、クライアントは
 * 操作日時を x-stockify-op-at で添える。未来や上限より昔は丸める。
 */
export function operationTime(request: Request, now = Date.now()): number {
	const at = Number(request.headers.get('x-stockify-op-at'));
	if (!Number.isFinite(at) || at <= 0) return now;
	return Math.min(now, Math.max(now - MAX_OPERATION_DELAY_MS, at));
}
