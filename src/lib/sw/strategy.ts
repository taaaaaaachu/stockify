/**
 * Service Worker が fetch をどう扱うかの判定(ADR 0009 Phase 1)。
 * - precache: ビルド成果物・静的ファイル。cache-first。
 * - page: 画面遷移の HTML。network-first、失敗時はキャッシュ。
 * - clear-pages: 認証状態が変わる POST。ユーザー情報入りのページキャッシュを消してから素通し。
 * - network: それ以外(API など)。SW は関与しない。
 */
export type Strategy = 'precache' | 'page' | 'clear-pages' | 'network';

/** 認証状態を変える POST 先。 */
const AUTH_CHANGE_PATHS = new Set(['/login', '/register', '/logout', '/api/account/delete']);

export function strategyFor(
	req: { method: string; mode: string; url: string },
	origin: string,
	precached: ReadonlySet<string>
): Strategy {
	const url = new URL(req.url);
	if (url.origin !== origin) return 'network';
	if (req.method === 'POST' && AUTH_CHANGE_PATHS.has(url.pathname)) return 'clear-pages';
	if (req.method !== 'GET') return 'network';
	if (precached.has(url.pathname)) return 'precache';
	if (req.mode === 'navigate' && !url.pathname.startsWith('/api/')) return 'page';
	return 'network';
}
