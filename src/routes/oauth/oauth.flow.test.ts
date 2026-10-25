import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { isRedirect, type ActionFailure } from '@sveltejs/kit';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb, type Db } from '#lib/server/db/index.js';
import { users, households, memberships } from '#lib/server/db/schema.js';
import { authenticateAgent, listAgentConnections } from '#lib/server/agentConnections.js';

// 同意画面からトークン発行までの流れ。DB とクライアント情報の取得(CIMD)だけ差し替える。
const state = vi.hoisted(() => ({ db: null as unknown as Db }));
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	get db() {
		return state.db;
	}
}));
vi.mock('#lib/server/oauth.js', async (orig) => {
	const mod = await orig<typeof import('#lib/server/oauth.js')>();
	return {
		...mod,
		resolveClient: async (clientId: string) =>
			clientId === CLIENT ? { clientId, clientName: 'muse', redirectUris: [REDIRECT] } : 'クライアントの情報を取得できませんでした。'
	};
});

const CLIENT = 'https://muse.example/oauth/client.json';
const REDIRECT = 'https://muse.example/cb';
const ORIGIN = 'http://localhost';
const VERIFIER = 'v'.repeat(43);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

const { load, actions } = await import('./authorize/+page.server');
const { POST: token } = await import('./token/+server');
const { POST: revoke } = await import('./revoke/+server');

let now: number;

beforeEach(() => {
	state.db = createDb(':memory:');
	migrate(state.db, { migrationsFolder: './drizzle' });
	state.db.insert(users).values({ id: 'u', username: 'u', passwordHash: 'x', createdAt: 0 }).run();
	state.db.insert(households).values({ id: 'h1', name: '自宅', createdAt: 0 }).run();
	state.db.insert(memberships).values({ id: 'm1', userId: 'u', householdId: 'h1', role: 'owner', createdAt: 0 }).run();
	now = Date.now();
});

function authorizeUrl(over: Record<string, string> = {}): URL {
	const url = new URL('/oauth/authorize', ORIGIN);
	const params = { response_type: 'code', client_id: CLIENT, redirect_uri: REDIRECT, code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 'xyz', resource: `${ORIGIN}/mcp`, ...over };
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	return url;
}

function locals(verifiedAt: number | null = now): App.Locals {
	return {
		user: { id: 'u', username: 'u', instanceRole: 'user', notifyMinuteOfDay: 540, mustChangePassword: false },
		session: { id: 's', verifiedAt },
		households: [{ id: 'h1', name: '自宅', role: 'owner', defaultLeadTimeDays: 7, notifyEnabled: true }],
		activeHousehold: { id: 'h1', name: '自宅', role: 'owner' }
	};
}

/** リダイレクトを投げたら Location を、それ以外は結果を返す。 */
async function run(fn: () => unknown): Promise<{ location: URL } | { result: unknown }> {
	try {
		return { result: await fn() };
	} catch (e) {
		if (isRedirect(e)) return { location: new URL(e.location, ORIGIN) };
		throw e;
	}
}

function form(fields: Record<string, string>): Request {
	return new Request(`${ORIGIN}/x`, { method: 'POST', body: new URLSearchParams(fields) });
}

// テスト用に、型の細部を問わず load / action / endpoint を呼ぶ。
const call = (fn: unknown, event: Record<string, unknown>) => (fn as (e: unknown) => unknown)(event);

async function allow(url = authorizeUrl(), l = locals()) {
	return run(() => call(actions.allow, { url, locals: l, request: form({ householdId: 'h1', name: '' }) }));
}

async function exchange(fields: Record<string, string>) {
	const res = (await call(token, { request: form(fields) })) as Response;
	return { status: res.status, body: await res.json() };
}

describe('同意画面', () => {
	it('未ログインならログイン画面へ戻り先付きで送る', async () => {
		const url = authorizeUrl();
		const r = await run(() => call(load, { url, locals: { ...locals(), user: null }, setHeaders: () => {} }));
		expect('location' in r && r.location.pathname).toBe('/login');
		expect('location' in r && r.location.searchParams.get('next')).toBe(url.pathname + url.search);
	});

	it('クライアントのドメインと世帯を出し、埋め込みを禁じる', async () => {
		const headers: Record<string, string> = {};
		const r = await run(() => call(load, { url: authorizeUrl(), locals: locals(), setHeaders: (h: Record<string, string>) => Object.assign(headers, h) }));
		expect('result' in r && r.result).toMatchObject({ client: { host: 'muse.example', name: 'muse', redirectHost: 'muse.example' }, needsReauth: false });
		expect(headers['x-frame-options']).toBe('DENY');
	});

	it('登録されていない戻り先や不明なクライアントは戻り先へ返さず画面に出す', async () => {
		const cases: Record<string, string>[] = [{ redirect_uri: 'https://evil.example/cb' }, { client_id: 'https://evil.example/c.json' }];
		for (const over of cases) {
			const r = await run(() => call(load, { url: authorizeUrl(over), locals: locals(), setHeaders: () => {} }));
			expect('result' in r && (r.result as { error: string }).error).toBeTruthy();
		}
	});

	it('戻り先を確かめた後の誤りは error 付きで戻り先へ返す', async () => {
		const r = await run(() => call(load, { url: authorizeUrl({ code_challenge_method: 'plain' }), locals: locals(), setHeaders: () => {} }));
		expect('location' in r && Object.fromEntries(r.location.searchParams)).toMatchObject({ error: 'invalid_request', state: 'xyz', iss: ORIGIN });
	});

	it('本人確認が古いと許可できない(428)', async () => {
		const r = await allow(authorizeUrl(), locals(now - 60 * 60 * 1000));
		expect('result' in r && (r.result as ActionFailure).status).toBe(428);
	});

	it('所属していない世帯は選べない', async () => {
		const r = await run(() => call(actions.allow, { url: authorizeUrl(), locals: locals(), request: form({ householdId: 'h2' }) }));
		expect('result' in r && (r.result as ActionFailure).status).toBe(400);
	});

	it('許可しないと access_denied で戻る', async () => {
		const r = await run(() => call(actions.deny, { url: authorizeUrl() }));
		expect('location' in r && Object.fromEntries(r.location.searchParams)).toMatchObject({ error: 'access_denied', state: 'xyz' });
	});
});

describe('許可からトークンまで', () => {
	it('認可コードをトークンに替え、MCP で使え、リフレッシュ・取り消しできる', async () => {
		const r = await allow();
		if (!('location' in r)) throw new Error('リダイレクトしていない');
		expect(r.location.origin + r.location.pathname).toBe(REDIRECT);
		expect(r.location.searchParams.get('state')).toBe('xyz');
		const code = r.location.searchParams.get('code')!;

		const t = await exchange({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: VERIFIER });
		expect(t.status).toBe(200);
		expect(t.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
		expect(authenticateAgent(state.db, t.body.access_token)).toMatchObject({ householdId: 'h1', role: 'owner' });
		// 名前を空にしたらクライアントの名乗り、一覧にはクライアントの URL が出る。
		expect(listAgentConnections(state.db, 'u')[0]).toMatchObject({ name: 'muse', clientId: CLIENT });

		// 同じコードは二度使えない。
		expect((await exchange({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: VERIFIER })).body.error).toBe('invalid_grant');

		const t2 = await exchange({ grant_type: 'refresh_token', refresh_token: t.body.refresh_token, client_id: CLIENT });
		expect(t2.status).toBe(200);
		expect(authenticateAgent(state.db, t.body.access_token)).toBeNull();

		const res = (await call(revoke, { request: form({ token: t2.body.refresh_token, client_id: CLIENT }) })) as Response;
		expect(res.status).toBe(200);
		expect(authenticateAgent(state.db, t2.body.access_token)).toBeNull();
	});

	it('PKCE が合わなければ invalid_grant', async () => {
		const r = await allow();
		const code = 'location' in r ? r.location.searchParams.get('code')! : '';
		expect((await exchange({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: 'w'.repeat(43) })).body.error).toBe('invalid_grant');
	});

	it('未対応の grant_type や client_id なしは 400', async () => {
		expect(await exchange({ grant_type: 'client_credentials', client_id: CLIENT })).toMatchObject({ status: 400, body: { error: 'unsupported_grant_type' } });
		expect(await exchange({ grant_type: 'refresh_token', refresh_token: 'x' })).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
	});
});
