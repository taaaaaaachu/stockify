import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@simplewebauthn/browser', () => ({
	startAuthentication: vi.fn(async () => ({ id: 'cred' })),
	startRegistration: vi.fn()
}));

import { api, ApiError, isPasskeyCancel, withPasskeyReauth } from './passkey';

const reply = (status: number, body: unknown = {}) =>
	new Response(status === 204 ? null : JSON.stringify(body), { status });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
	it('失敗はサーバーのメッセージとステータスを持つ ApiError、204 は undefined', async () => {
		fetchMock.mockResolvedValueOnce(reply(409, { message: '消せません' }));
		await expect(api('/x')).rejects.toMatchObject({ message: '消せません', status: 409 });
		fetchMock.mockResolvedValueOnce(reply(204));
		expect(await api('/x')).toBeUndefined();
	});
});

describe('withPasskeyReauth', () => {
	it('428 ならパスキーで本人確認してから1回だけやり直す', async () => {
		const action = vi
			.fn()
			.mockRejectedValueOnce(new ApiError('本人確認が必要です。', 428))
			.mockResolvedValueOnce('done');
		fetchMock.mockResolvedValueOnce(reply(200, { challenge: 'c' })).mockResolvedValueOnce(reply(200, { ok: true }));

		expect(await withPasskeyReauth(action)).toBe('done');
		expect(action).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/passkey/auth/options', '/api/account/reauth']);
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ response: { id: 'cred' } });
	});

	it('428 以外の失敗・本人確認の失敗はそのまま投げる', async () => {
		await expect(withPasskeyReauth(() => Promise.reject(new ApiError('x', 400)))).rejects.toMatchObject({ status: 400 });

		const action = vi.fn().mockRejectedValue(new ApiError('本人確認が必要です。', 428));
		fetchMock.mockResolvedValueOnce(reply(200, {})).mockResolvedValueOnce(reply(400, { message: '本人確認できませんでした。' }));
		await expect(withPasskeyReauth(action)).rejects.toMatchObject({ status: 400 });
		expect(action).toHaveBeenCalledTimes(1);
	});
});

describe('isPasskeyCancel', () => {
	it('ユーザーの取り消し(NotAllowedError / AbortError)だけ true', () => {
		expect(isPasskeyCancel(Object.assign(new Error(), { name: 'NotAllowedError' }))).toBe(true);
		expect(isPasskeyCancel(Object.assign(new Error(), { name: 'AbortError' }))).toBe(true);
		expect(isPasskeyCancel(new ApiError('x', 400))).toBe(false);
	});
});
