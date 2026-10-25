import { describe, it, expect } from 'vitest';
import { isCsrfForbidden, csrfForbiddenResponse } from './csrf';

const SELF = 'https://stock.example.com';

function check(path: string, init: { method?: string; origin?: string; type?: string | null } = {}) {
	const headers = new Headers();
	if (init.origin) headers.set('origin', init.origin);
	if (init.type !== null) headers.set('content-type', init.type ?? 'application/x-www-form-urlencoded');
	const url = new URL(path, SELF);
	return isCsrfForbidden(new Request(url, { method: init.method ?? 'POST', headers, body: init.method === 'GET' ? undefined : '' }), url, SELF);
}

describe('isCsrfForbidden', () => {
	it('同じオリジンのフォーム POST は通す', () => {
		expect(check('/login', { origin: SELF })).toBe(false);
	});

	it('別オリジン・Origin なし・http のフォーム POST は拒否する', () => {
		expect(check('/login', { origin: 'https://evil.example' })).toBe(true);
		expect(check('/login')).toBe(true);
		expect(check('/login', { origin: 'http://stock.example.com' })).toBe(true);
	});

	it('Content-Type なし・multipart・text/plain(大文字や引数付きも)も対象', () => {
		expect(check('/logout', { type: null })).toBe(true);
		expect(check('/logout', { type: 'multipart/form-data; boundary=x' })).toBe(true);
		expect(check('/logout', { type: 'Text/Plain;charset=UTF-8' })).toBe(true);
	});

	it('JSON や GET は対象外(SvelteKit と同じ)', () => {
		expect(check('/api/items', { type: 'application/json' })).toBe(false);
		expect(check('/login', { method: 'GET' })).toBe(false);
	});

	it('PUT・PATCH・DELETE も対象', () => {
		for (const method of ['PUT', 'PATCH', 'DELETE']) expect(check('/x', { method })).toBe(true);
	});

	it('OAuth のトークン・取り消しだけは Origin なしのフォーム POST を通す', () => {
		expect(check('/oauth/token')).toBe(false);
		expect(check('/oauth/revoke', { origin: 'https://evil.example' })).toBe(false);
		expect(check('/oauth/authorize')).toBe(true);
		expect(check('/oauth/token/x')).toBe(true);
	});
});

describe('csrfForbiddenResponse', () => {
	it('Accept が JSON なら JSON、それ以外はテキストの 403', async () => {
		const json = csrfForbiddenResponse(new Request(SELF, { method: 'POST', headers: { accept: 'application/json' } }));
		expect(json.status).toBe(403);
		expect(await json.json()).toEqual({ message: 'Cross-site POST form submissions are forbidden' });
		const text = csrfForbiddenResponse(new Request(SELF, { method: 'DELETE' }));
		expect(await text.text()).toBe('Cross-site DELETE form submissions are forbidden');
	});
});
