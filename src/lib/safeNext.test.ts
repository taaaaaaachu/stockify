import { describe, it, expect } from 'vitest';
import { safeNext } from './safeNext';

describe('safeNext', () => {
	it('自サイト内のパスはそのまま', () => {
		expect(safeNext('/oauth/authorize?client_id=https%3A%2F%2Fa.example%2Fc')).toBe('/oauth/authorize?client_id=https%3A%2F%2Fa.example%2Fc');
	});
	it('外部や不正な値は / にする', () => {
		for (const v of [null, undefined, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)'])
			expect(safeNext(v)).toBe('/');
	});
});
