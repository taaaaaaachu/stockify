import { error } from '@sveltejs/kit';
import type { HouseholdRole } from '$lib/rbac';
import { isRecentlyVerified } from './auth';

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

/** 直近の本人確認を求める HTTP ステータス(428 Precondition Required)。 */
export const REAUTH_REQUIRED = 428;

/**
 * ログイン必須かつ直近に本人確認(ログイン・再認証)済み。満たさなければ 428。
 * 戻り値の sessionId は「操作端末以外のセッションを無効化」に使う。
 */
export function requireRecentAuth(locals: App.Locals): AuthedUser & { sessionId: string } {
	const user = requireUser(locals);
	if (!locals.session || !isRecentlyVerified(locals.session.verifiedAt)) {
		throw error(REAUTH_REQUIRED, '本人確認が必要です。');
	}
	return { ...user, sessionId: locals.session.id };
}

/** 強制パスワード変更中でも使える API。パスワード変更・パスキー登録と、その前の本人確認だけ(ADR 0011)。 */
const FORCED_CHANGE_APIS = new Set([
	'/api/account/password',
	'/api/account/reauth',
	'/api/passkey/register/options',
	'/api/passkey/register/verify'
]);

/** 強制パスワード変更中の会員がこのパスを開けるか。それ以外のページはアカウント画面へ戻す。 */
export function allowedDuringForcedChange(pathname: string): boolean {
	return (
		FORCED_CHANGE_APIS.has(pathname) ||
		pathname === '/account' ||
		pathname === '/account/__data.json' ||
		pathname === '/logout' ||
		pathname.startsWith('/_app/') ||
		pathname === '/manifest.webmanifest' ||
		pathname === '/service-worker.js' ||
		pathname.startsWith('/icon') ||
		pathname.startsWith('/apple-touch-icon')
	);
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
