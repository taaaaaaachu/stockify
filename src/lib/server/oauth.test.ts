import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
	cacheMsOf,
	clearClientCache,
	consumeAuthorizationCode,
	isPublicAddress,
	isRegisteredRedirectUri,
	issueAuthorizationCode,
	parseAuthorizeRequest,
	parseClientIdUrl,
	redirectWith,
	resolveClient,
	validateClientMetadata,
	verifyPkce,
	type FetchJson
} from './oauth';

const CLIENT = 'https://muse.example/oauth/client.json';
const RESOURCE = 'https://stock.example.com/mcp';
const VERIFIER = 'a'.repeat(43);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

describe('parseClientIdUrl', () => {
	it('パス付きの https URL だけを受け付ける', () => {
		expect(parseClientIdUrl(CLIENT)?.host).toBe('muse.example');
		for (const bad of [
			'http://muse.example/c.json',
			'https://muse.example',
			'https://muse.example/',
			'https://u:p@muse.example/c.json',
			'https://muse.example/c.json#x',
			'https://muse.example/a/../c.json',
			'not a url'
		])
			expect(parseClientIdUrl(bad)).toBeNull();
	});
});

describe('validateClientMetadata', () => {
	const doc = { client_id: CLIENT, client_name: ' muse ', redirect_uris: ['https://muse.example/cb'] };
	it('公開クライアントの文書を受け付ける', () => {
		expect(validateClientMetadata(CLIENT, doc)).toEqual({ clientId: CLIENT, clientName: 'muse', redirectUris: ['https://muse.example/cb'] });
		expect(validateClientMetadata(CLIENT, { ...doc, client_name: undefined })).toMatchObject({ clientName: null });
	});
	it('client_id の不一致・redirect_uris なし・機密クライアントは拒否', () => {
		expect(typeof validateClientMetadata(CLIENT, { ...doc, client_id: 'https://evil.example/c.json' })).toBe('string');
		expect(typeof validateClientMetadata(CLIENT, { ...doc, redirect_uris: [] })).toBe('string');
		expect(typeof validateClientMetadata(CLIENT, { ...doc, token_endpoint_auth_method: 'private_key_jwt' })).toBe('string');
		expect(typeof validateClientMetadata(CLIENT, 'x')).toBe('string');
	});
});

describe('isRegisteredRedirectUri', () => {
	it('完全一致だけ。ループバックはポート違いを許す', () => {
		expect(isRegisteredRedirectUri(['https://muse.example/cb'], 'https://muse.example/cb')).toBe(true);
		expect(isRegisteredRedirectUri(['https://muse.example/cb'], 'https://muse.example/cb2')).toBe(false);
		expect(isRegisteredRedirectUri(['https://muse.example/cb'], 'https://muse.example:8443/cb')).toBe(false);
		expect(isRegisteredRedirectUri(['http://127.0.0.1/cb'], 'http://127.0.0.1:53111/cb')).toBe(true);
		expect(isRegisteredRedirectUri(['http://127.0.0.1/cb'], 'http://127.0.0.1:53111/other')).toBe(false);
		expect(isRegisteredRedirectUri(['http://localhost/cb'], 'http://127.0.0.1:1/cb')).toBe(false);
	});
});

describe('isPublicAddress', () => {
	it('プライベート・ループバック・リンクローカル・射影アドレスを拒む', () => {
		for (const a of ['10.0.0.1', '127.0.0.1', '192.168.1.10', '172.16.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '0.0.0.0', 'x'])
			expect(isPublicAddress(a)).toBe(false);
		for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700::1111', '::ffff:8.8.8.8']) expect(isPublicAddress(a)).toBe(true);
	});
});

describe('cacheMsOf', () => {
	it('max-age を最大24時間で使う。no-store や指定なしはキャッシュしない', () => {
		expect(cacheMsOf('public, max-age=600')).toBe(600_000);
		expect(cacheMsOf('max-age=999999')).toBe(86_400_000);
		expect(cacheMsOf('no-store, max-age=600')).toBe(0);
		expect(cacheMsOf(undefined)).toBe(0);
	});
});

describe('resolveClient', () => {
	beforeEach(clearClientCache);
	const doc = { client_id: CLIENT, redirect_uris: ['https://muse.example/cb'] };

	it('取得して検証し、max-age の間はキャッシュする', async () => {
		let calls = 0;
		const fetchJson: FetchJson = async () => (calls++, { json: doc, cacheMs: 1000 });
		expect(await resolveClient(CLIENT, fetchJson, 0)).toMatchObject({ clientId: CLIENT });
		await resolveClient(CLIENT, fetchJson, 999);
		expect(calls).toBe(1);
		await resolveClient(CLIENT, fetchJson, 1000);
		expect(calls).toBe(2);
	});

	it('取得の失敗や不正な client_id は理由を返す', async () => {
		const failing: FetchJson = async () => {
			throw new Error('公開されていないアドレスです。');
		};
		expect(await resolveClient(CLIENT, failing)).toContain('公開されていないアドレス');
		expect(await resolveClient('http://muse.example/c', failing)).toContain('https');
	});
});

describe('認可コード', () => {
	const grant = { clientId: CLIENT, redirectUri: 'https://muse.example/cb', codeChallenge: CHALLENGE, userId: 'u', householdId: 'h1', name: 'muse' };
	const check = { clientId: CLIENT, redirectUri: 'https://muse.example/cb', codeVerifier: VERIFIER };

	it('一度だけ使える', () => {
		const code = issueAuthorizationCode(grant, 0);
		expect(consumeAuthorizationCode(code, check, 1)).toEqual(grant);
		expect(consumeAuthorizationCode(code, check, 2)).toBeNull();
	});

	it('1分で切れる', () => {
		const code = issueAuthorizationCode(grant, 0);
		expect(consumeAuthorizationCode(code, check, 60_000)).toBeNull();
	});

	it('クライアント・戻り先・PKCE が違えば使えず、コードも消える', () => {
		for (const bad of [{ clientId: 'https://evil.example/c.json' }, { redirectUri: 'https://muse.example/x' }, { codeVerifier: 'b'.repeat(43) }]) {
			const code = issueAuthorizationCode(grant, 0);
			expect(consumeAuthorizationCode(code, { ...check, ...bad }, 1)).toBeNull();
			expect(consumeAuthorizationCode(code, check, 1)).toBeNull();
		}
	});

	it('verifyPkce は形式も確かめる', () => {
		expect(verifyPkce(VERIFIER, CHALLENGE)).toBe(true);
		expect(verifyPkce('short', CHALLENGE)).toBe(false);
	});
});

describe('parseAuthorizeRequest', () => {
	const base = { response_type: 'code', client_id: CLIENT, redirect_uri: 'https://muse.example/cb', code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 's' };
	const parse = (over: Record<string, string | null> = {}) => {
		const p = new URLSearchParams();
		for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null) p.set(k, v);
		return parseAuthorizeRequest(p, RESOURCE);
	};

	it('正しいリクエスト', () => {
		expect(parse()).toEqual({ ok: { clientId: CLIENT, redirectUri: 'https://muse.example/cb', codeChallenge: CHALLENGE, state: 's' } });
		expect('ok' in parse({ resource: RESOURCE })).toBe(true);
		expect('ok' in parse({ resource: `${RESOURCE}/` })).toBe(true);
	});

	it('client_id・redirect_uri がなければ戻り先へ返せない誤り', () => {
		expect(parse({ client_id: null })).toHaveProperty('fatal');
		expect(parse({ redirect_uri: null })).toHaveProperty('fatal');
	});

	it('それ以外の誤りは error コードで戻り先へ返す', () => {
		expect(parse({ response_type: 'token' })).toMatchObject({ redirectError: 'unsupported_response_type' });
		expect(parse({ code_challenge: null })).toMatchObject({ redirectError: 'invalid_request' });
		expect(parse({ code_challenge_method: 'plain' })).toMatchObject({ redirectError: 'invalid_request' });
		expect(parse({ resource: 'https://other.example/mcp' })).toMatchObject({ redirectError: 'invalid_target' });
	});
});

describe('redirectWith', () => {
	it('既存のクエリを残し、iss を付ける', () => {
		const url = new URL(redirectWith('https://muse.example/cb?x=1', { code: 'c', state: null }, 'https://stock.example.com'));
		expect(Object.fromEntries(url.searchParams)).toEqual({ x: '1', code: 'c', iss: 'https://stock.example.com' });
	});
});
