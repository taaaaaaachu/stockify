import { describe, it, expect } from 'vitest';
import { encode } from 'uqr';
import { inviteLinkUrl, qrPath } from './inviteLink';

describe('inviteLinkUrl', () => {
	it('オリジンの /invite/ 配下にコードを置く', () => {
		expect(inviteLinkUrl('https://example.test', 'Ab-_9')).toBe('https://example.test/invite/Ab-_9');
	});
});

describe('qrPath', () => {
	it('暗いマスの数だけ正方形を描き、余白込みの大きさを返す', () => {
		const text = 'https://example.test/invite/abc';
		const { size, data } = encode(text, { border: 2 });
		const dark = data.flat().filter(Boolean).length;
		const result = qrPath(text);
		expect(result.size).toBe(size);
		expect(result.d.match(/M/g)?.length).toBe(dark);
		expect(data[0].some(Boolean)).toBe(false);
	});
});
