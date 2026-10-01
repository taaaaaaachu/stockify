import { describe, expect, it } from 'vitest';
import { strategyFor } from './strategy';

const origin = 'https://stockify.example';
const precached = new Set(['/_app/immutable/entry/start.js', '/offline.html']);
const req = (url: string, method = 'GET', mode = 'cors') => ({ url: origin + url, method, mode });

describe('strategyFor', () => {
	it('プリキャッシュ対象は cache-first', () => {
		expect(strategyFor(req('/_app/immutable/entry/start.js'), origin, precached)).toBe('precache');
		expect(strategyFor(req('/offline.html', 'GET', 'navigate'), origin, precached)).toBe('precache');
	});

	it('画面遷移は page(クエリ付きも)', () => {
		expect(strategyFor(req('/', 'GET', 'navigate'), origin, precached)).toBe('page');
		expect(strategyFor(req('/items/abc?x=1', 'GET', 'navigate'), origin, precached)).toBe('page');
	});

	it('API と他オリジンには関与しない', () => {
		expect(strategyFor(req('/api/state'), origin, precached)).toBe('network');
		expect(strategyFor(req('/api/state', 'GET', 'navigate'), origin, precached)).toBe('network');
		expect(
			strategyFor({ url: 'https://other.example/', method: 'GET', mode: 'navigate' }, origin, precached)
		).toBe('network');
	});

	it('ログイン・登録の POST でページキャッシュを消す', () => {
		for (const path of ['/login', '/register']) {
			expect(strategyFor(req(path, 'POST', 'navigate'), origin, precached)).toBe('clear-pages');
		}
	});

	it('ログアウト・アカウント削除で会員データも消す', () => {
		expect(strategyFor(req('/logout', 'POST', 'navigate'), origin, precached)).toBe('clear-user-data');
		expect(strategyFor(req('/api/account/delete', 'DELETE'), origin, precached)).toBe('clear-user-data');
		expect(strategyFor(req('/logout', 'GET', 'navigate'), origin, precached)).toBe('page');
	});

	it('その他の POST は素通し', () => {
		expect(strategyFor(req('/api/purchases', 'POST'), origin, precached)).toBe('network');
		expect(strategyFor(req('/settings', 'POST', 'navigate'), origin, precached)).toBe('network');
	});
});
