import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface ManifestIcon {
	src: string;
	sizes: string;
	type: string;
	purpose?: string;
}

interface WebAppManifest {
	icons: ManifestIcon[];
}

const serviceWorkerSource = readFileSync(new URL('./service-worker.ts', import.meta.url), 'utf8');
const appTemplate = readFileSync(new URL('./app.html', import.meta.url), 'utf8');
const offlinePage = readFileSync(new URL('../static/offline.html', import.meta.url), 'utf8');
const rootLayout = readFileSync(new URL('./routes/+layout.svelte', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');

const manifest = JSON.parse(
	readFileSync(new URL('../static/manifest.webmanifest', import.meta.url), 'utf8')
) as WebAppManifest;

describe('PWA manifest', () => {
	it('Android WebAPKを生成できるアイコン構成にする', () => {
		expect(manifest.icons).not.toContainEqual(
			expect.objectContaining({ type: 'image/svg+xml', sizes: 'any' })
		);
		expect(manifest.icons).toContainEqual(
			expect.objectContaining({ type: 'image/png', sizes: '192x192', purpose: 'any' })
		);
		expect(manifest.icons).toContainEqual(
			expect.objectContaining({ type: 'image/png', sizes: '512x512', purpose: 'any' })
		);
	});

	it('ナビゲーションへオフライン応答できるService Workerを提供する', () => {
		expect(serviceWorkerSource).toContain("sw.addEventListener('fetch'");
		expect(serviceWorkerSource).toContain('networkFirstPage(event.request)');
		expect(serviceWorkerSource).toContain('cache.addAll([...PRECACHED])');
		expect(serviceWorkerSource).toContain("const OFFLINE_URL = '/offline.html'");
		expect(offlinePage).toContain('<title>オフライン | Stockify</title>');
	});

	it('HTMLにアプリ名とmanifest linkを含める', () => {
		expect(appTemplate).toContain('<title>Stockify</title>');
		expect(appTemplate).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
	});

	it('ビルドversion付きURLでService Workerを登録する', () => {
		expect(viteConfig).toMatch(/serviceWorker:\s*{\s*[^}]*register:\s*false/s);
		expect(rootLayout).toContain("import { version } from '$app/environment'");
		expect(rootLayout).toContain(
			'.register(`/service-worker.js?v=${encodeURIComponent(version)}`)'
		);
	});
});
