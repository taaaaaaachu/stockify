/** 公開オリジン。SvelteKit と同じく、ビルド時の paths.origin があればそれ、なければリクエストの URL のオリジン。 */
export function publicOrigin(url: URL): string {
	return __PATHS_ORIGIN__ || url.origin;
}

/** MCP エンドポイントの URL(OAuth の resource)。 */
export function mcpResource(url: URL): string {
	return `${publicOrigin(url)}/mcp`;
}
