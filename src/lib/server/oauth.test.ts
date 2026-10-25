import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb, type Db } from './db';
import { users, households, memberships, oauthClients } from './db/schema';
import { createOAuthConnection } from './agentConnections';
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
	registerClient,
	validateRegistration,
	findRegisteredClient,
	UNUSED_CLIENT_TTL_MS,
	type FetchJson
} from './oauth';

const CLIENT = 'https://muse.example/oauth/client.json';
const RESOURCE = 'https://stock.example.com/mcp';
const VERIFIER = 'a'.repeat(43);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

let db: Db;
beforeEach(() => {
	db = createDb(':memory:');
	migrate(db, { migrationsFolder: './drizzle' });
});

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
		expect(validateClientMetadata(CLIENT, doc)).toEqual({ clientId: CLIENT, clientName: 'muse', redirectUris: ['https://muse.example/cb'], kind: 'cimd' });
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
		expect(await resolveClient(db, CLIENT, fetchJson, 0)).toMatchObject({ clientId: CLIENT });
		await resolveClient(db, CLIENT, fetchJson, 999);
		expect(calls).toBe(1);
		await resolveClient(db, CLIENT, fetchJson, 1000);
		expect(calls).toBe(2);
	});

	it('取得の失敗や不正な client_id は理由を返す', async () => {
		const failing: FetchJson = async () => {
			throw new Error('公開されていないアドレスです。');
		};
		expect(await resolveClient(db, CLIENT, failing)).toContain('公開されていないアドレス');
		expect(await resolveClient(db, 'http://muse.example/c', failing)).toContain('https');
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

describe('validateRegistration', () => {
	const ok = { client_name: ' muse ', redirect_uris: ['https://muse.example/cb', 'http://127.0.0.1:8000/cb'] };
	it('https とループバックの戻り先を受け付け、認証方式は問わない', () => {
		expect(validateRegistration({ ...ok, token_endpoint_auth_method: 'client_secret_basic', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] })).toEqual({
			clientName: 'muse',
			redirectUris: ok.redirect_uris
		});
	});
	it('戻り先がない・http・独自スキーム・フラグメント付き・多すぎは invalid_redirect_uri', () => {
		for (const redirect_uris of [undefined, [], ['http://muse.example/cb'], ['muse://cb'], ['https://muse.example/cb#x'], Array(11).fill('https://muse.example/cb')])
			expect(validateRegistration({ redirect_uris })).toMatchObject({ error: 'invalid_redirect_uri' });
	});
	it('対応しない grant_types・response_types は invalid_client_metadata', () => {
		expect(validateRegistration({ ...ok, grant_types: ['client_credentials'] })).toMatchObject({ error: 'invalid_client_metadata' });
		expect(validateRegistration({ ...ok, grant_types: ['refresh_token'] })).toMatchObject({ error: 'invalid_client_metadata' });
		expect(validateRegistration({ ...ok, response_types: ['token'] })).toMatchObject({ error: 'invalid_client_metadata' });
		expect(validateRegistration('x')).toMatchObject({ error: 'invalid_client_metadata' });
	});
});

describe('DCR の登録と参照', () => {
	it('登録したクライアントは client_id で引け、resolveClient も DB から返す', async () => {
		const c = registerClient(db, { clientName: 'muse', redirectUris: ['https://muse.example/cb'] });
		expect(c.clientId.startsWith('dcr_')).toBe(true);
		expect(findRegisteredClient(db, c.clientId)).toEqual(c);
		const failing: FetchJson = async () => {
			throw new Error('取りに行かない');
		};
		expect(await resolveClient(db, c.clientId, failing)).toEqual({ ...c, kind: 'dcr' });
		expect(await resolveClient(db, 'dcr_unknown', failing)).toContain('登録されていない');
	});

	it('使われないまま30日過ぎた登録は次の登録で消える。接続に使われたものは残る', () => {
		db.insert(users).values({ id: 'u', username: 'u', passwordHash: 'x', createdAt: 0 }).run();
		db.insert(households).values({ id: 'h1', name: 'h', createdAt: 0 }).run();
		db.insert(memberships).values({ id: 'm1', userId: 'u', householdId: 'h1', role: 'owner', createdAt: 0 }).run();
		const unused = registerClient(db, { clientName: null, redirectUris: ['https://a.example/cb'] }, 0);
		const used = registerClient(db, { clientName: null, redirectUris: ['https://b.example/cb'] }, 0);
		createOAuthConnection(db, 'u', 'h1', used.clientId, 'b', 0);
		registerClient(db, { clientName: null, redirectUris: ['https://c.example/cb'] }, UNUSED_CLIENT_TTL_MS + 1);
		const ids = db.select().from(oauthClients).all().map((r) => r.id);
		expect(ids).not.toContain(unused.clientId);
		expect(ids).toContain(used.clientId);
		expect(ids).toHaveLength(2);
	});
});
