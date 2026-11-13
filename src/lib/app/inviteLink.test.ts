import { describe, it, expect } from 'vitest';
import { encode } from 'uqr';
import { inviteLinkUrl, qrPath, QR_OPTIONS } from './inviteLink';

describe('inviteLinkUrl', () => {
	it('オリジンの /invite/ 配下にコードを置く', () => {
		expect(inviteLinkUrl('https://example.test', 'Ab-_9')).toBe('https://example.test/invite/Ab-_9');
	});
});

describe('qrPath', () => {
	it('位置検出パターン以外の暗いマスをドットにし、3 つのパターンの位置を返す', () => {
		const text = 'https://example.test/invite/abc';
		const { size, data } = encode(text, QR_OPTIONS);
		const result = qrPath(text);
		expect(result.size).toBe(size);
		expect(result.finders).toEqual([
			{ x: 2, y: 2 },
			{ x: size - 9, y: 2 },
			{ x: 2, y: size - 9 }
		]);
		// 位置検出パターン 1 つは暗いマス 33 個(7x7 の枠 24 + 中央 3x3 の 9)。
		const dark = data.flat().filter(Boolean).length;
		expect(result.d.match(/M/g)?.length).toBe(dark - 33 * 3);
	});
});
