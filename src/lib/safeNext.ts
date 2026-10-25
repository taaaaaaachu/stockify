/** ログイン後の戻り先。自サイト内のパスだけを許し、それ以外は '/'(オープンリダイレクト対策)。 */
export function safeNext(value: string | null | undefined): string {
	return value && /^\/(?![/\\])/.test(value) ? value : '/';
}
