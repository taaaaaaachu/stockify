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
});
