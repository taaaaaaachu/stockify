/**
 * Service Worker が fetch をどう扱うかの判定(ADR 0009 Phase 1)。
 * - precache: ビルド成果物・静的ファイル。cache-first。
 * - page: 画面遷移の HTML。network-first、失敗時はキャッシュ。
 * - clear-pages: ログイン・登録の POST。ユーザー情報入りのページキャッシュを消してから素通し。
 * - clear-user-data: ログアウト(POST)・アカウント削除(DELETE)。ページキャッシュと会員のローカル DB を消してから素通し。
 * - network: それ以外(API など)。SW は関与しない。
 */
export type Strategy = 'precache' | 'page' | 'clear-pages' | 'clear-user-data' | 'network';

const SIGN_IN_PATHS = new Set(['/login', '/register']);
const SIGN_OUT_PATHS = new Set(['/logout', '/api/account/delete']);

export function strategyFor(
	req: { method: string; mode: string; url: string },
	origin: string,
	precached: ReadonlySet<string>
): Strategy {
	const url = new URL(req.url);
	if (url.origin !== origin) return 'network';
	if (req.method === 'POST' && SIGN_IN_PATHS.has(url.pathname)) return 'clear-pages';
	if (req.method !== 'GET' && SIGN_OUT_PATHS.has(url.pathname)) return 'clear-user-data';
	if (req.method !== 'GET') return 'network';
	if (precached.has(url.pathname)) return 'precache';
	if (req.mode === 'navigate' && !url.pathname.startsWith('/api/')) return 'page';
	return 'network';
}
