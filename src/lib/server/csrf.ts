/**
 * SvelteKit 組み込みの CSRF 判定(`@sveltejs/kit/src/runtime/server/csrf.js` の is_csrf_forbidden)の写し。
 * OAuth のトークン・取り消しエンドポイントは、エージェントのサーバーから Origin なしの
 * フォーム POST で呼ばれる。SvelteKit はパス単位で除外できないので、組み込みの判定を止めて
 * ここで同じ判定をし、その2つだけを除く(ADR 0012)。どちらも Cookie を読まないので除外しても CSRF は成り立たない。
 * SvelteKit がパス単位の除外に対応したら、この写しはやめて組み込みに戻す。
 */

const FORM_CONTENT_TYPES = [
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain',
	'application/x-sveltekit-formdata'
];
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Cookie を読まず、Origin なしのフォーム POST を受ける OAuth のエンドポイント。 */
export const CSRF_EXEMPT_PATHS = new Set(['/oauth/token', '/oauth/revoke']);

function isFormContentType(request: Request): boolean {
	const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
	return FORM_CONTENT_TYPES.includes(type);
}

/** selfOrigin はビルド時の公開オリジン(paths.origin)か、なければリクエストの URL のオリジン。 */
export function isCsrfForbidden(request: Request, url: URL, selfOrigin: string): boolean {
	if (CSRF_EXEMPT_PATHS.has(url.pathname)) return false;
	const origin = request.headers.get('origin');
	return (!request.headers.get('content-type') || isFormContentType(request)) && MUTATING_METHODS.has(request.method) && origin !== selfOrigin;
}

/** SvelteKit と同じ形の 403。 */
export function csrfForbiddenResponse(request: Request): Response {
	const message = `Cross-site ${request.method} form submissions are forbidden`;
	return request.headers.get('accept') === 'application/json'
		? Response.json({ message }, { status: 403 })
		: new Response(message, { status: 403, headers: { 'content-type': 'text/plain;charset=UTF-8' } });
}
