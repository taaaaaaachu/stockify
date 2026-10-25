import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// hooks の CSRF 判定が、SvelteKit と同じく paths.origin を自分のオリジンとして使えるように焼き込む。
	define: { __PATHS_ORIGIN__: JSON.stringify(process.env.ORIGIN || '') },
	plugins: [
		sveltekit({
			compilerOptions: {
				// プロジェクトを runes モードに固定(ライブラリは除く)。svelte 6 で不要になる想定。
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// 公開オリジン。本番(Cloudflare Tunnel 配下)は未指定で、Host ヘッダーと https から決まる。
			// http で直接アクセスするローカル compose だけ、ビルド時の ORIGIN で明示する(CSRF とパスキーの検証に使う)。
			paths: { origin: process.env.ORIGIN || undefined },
			// CSRF の判定は hooks で同じものを行い、OAuth のトークン・取り消しだけ除く(ADR 0012、src/lib/server/csrf.ts)。
			csrf: { trustedOrigins: ['*'] },
			serviceWorker: {
				// Cloudflare の静的ファイルキャッシュを避けるため、layout からversion付きURLで登録する。
				register: false
			}
		})
	],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});
