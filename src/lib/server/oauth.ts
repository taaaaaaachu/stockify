import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

/**
 * 自前の OAuth 2.1 認可サーバー(ADR 0012)。クライアントは Client ID Metadata Document(CIMD)だけで受け付け、
 * 公開クライアント(PKCE S256、クライアント認証なし)として扱う。
 */

// --- クライアント(CIMD) ---

export interface ClientMetadata {
	clientId: string;
	clientName: string | null;
	redirectUris: string[];
}

/** client_id として受け付ける URL か。https でパスを持ち、資格情報・フラグメント・ドットセグメントを含まない。 */
export function parseClientIdUrl(value: string): URL | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' || url.username || url.password || url.hash || value.includes('#')) return null;
	if (url.pathname === '/' || /\/\.\.?(\/|$)/.test(value.slice(url.origin.length))) return null;
	return url.href === value ? url : null;
}

/** 取得した文書を検証する。仕様に合わなければ理由を返す。 */
export function validateClientMetadata(clientId: string, doc: unknown): ClientMetadata | string {
	if (typeof doc !== 'object' || doc === null) return 'クライアントの情報が JSON オブジェクトではありません。';
	const d = doc as Record<string, unknown>;
	if (d.client_id !== clientId) return 'クライアントの情報の client_id が URL と一致しません。';
	const uris = d.redirect_uris;
	if (!Array.isArray(uris) || uris.length === 0 || !uris.every((u) => typeof u === 'string' && URL.canParse(u)))
		return 'クライアントの情報に redirect_uris がありません。';
	const method = d.token_endpoint_auth_method;
	if (method !== undefined && method !== 'none') return '公開クライアント(token_endpoint_auth_method: none)だけに対応しています。';
	const name = typeof d.client_name === 'string' && d.client_name.trim() ? d.client_name.trim().slice(0, 100) : null;
	return { clientId, clientName: name, redirectUris: uris as string[] };
}

/**
 * 戻り先が登録済みのものと一致するか。完全一致だけを認める。ただしループバック(http の
 * 127.0.0.1・[::1]・localhost)は、ポートだけ違ってよい(RFC 8252)。
 */
export function isRegisteredRedirectUri(registered: string[], redirectUri: string): boolean {
	if (registered.includes(redirectUri)) return true;
	let target: URL;
	try {
		target = new URL(redirectUri);
	} catch {
		return false;
	}
	if (!isLoopback(target)) return false;
	return registered.some((r) => {
		const u = URL.canParse(r) ? new URL(r) : null;
		return u !== null && isLoopback(u) && u.hostname === target.hostname && u.pathname === target.pathname && u.search === target.search;
	});
}

function isLoopback(u: URL): boolean {
	return u.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname);
}

/** 公開されていないアドレス(SSRF 対策で取得を拒む)。 */
const NON_PUBLIC = new BlockList();
for (const [net, prefix] of [
	['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
	['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
	['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
] as const) NON_PUBLIC.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
	// IPv4 射影(::ffff:0:0/96)は BlockList が IPv4 にも当てはめてしまうので入れず、isPublicAddress で中の IPv4 を見る。
	['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]
] as const) NON_PUBLIC.addSubnet(net, prefix, 'ipv6');

export function isPublicAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 0) return false;
	// IPv4 射影アドレスは中の IPv4 で判定する。
	if (family === 6) {
		const dotted = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
		if (dotted) return isPublicAddress(dotted);
		// URL は ::ffff:127.0.0.1 を ::ffff:7f00:1 に正規化する。
		const hex = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
		if (hex) {
			const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
			return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
		}
	}
	return !NON_PUBLIC.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

const FETCH_TIMEOUT_MS = 5000;
const FETCH_MAX_BYTES = 10 * 1024;
const CACHE_MAX_MS = 24 * 60 * 60 * 1000;

/** 文書の取得結果。cacheMs は Cache-Control の max-age(no-store なら 0)。 */
export type FetchJson = (url: URL) => Promise<{ json: unknown; cacheMs: number }>;

/**
 * 公開アドレスだけに繋ぐ https GET。名前解決の結果を確かめたうえで、そのアドレスに接続する
 * (確認後に別のアドレスへ解決し直させる DNS リバインディングを防ぐ)。リダイレクトは追わない。
 */
const httpsGetJson: FetchJson = (url) =>
	new Promise((resolve, reject) => {
		if (isIP(url.hostname.replace(/^\[|\]$/g, '')) && !isPublicAddress(url.hostname.replace(/^\[|\]$/g, '')))
			return reject(new Error('公開されていないアドレスです。'));
		const req = httpsRequest(
			url,
			{
				headers: { accept: 'application/json' },
				timeout: FETCH_TIMEOUT_MS,
				lookup: (hostname, options, callback) =>
					dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
						if (err) return callback(err, '', 0);
						if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address)))
							return callback(new Error('公開されていないアドレスです。'), '', 0);
						if (options.all) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
						else callback(null, addresses[0].address, addresses[0].family);
					})
			},
			(res) => {
				if (res.statusCode !== 200) {
					res.resume();
					return reject(new Error(`HTTP ${res.statusCode}`));
				}
				let size = 0;
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => {
					size += chunk.length;
					if (size > FETCH_MAX_BYTES) req.destroy(new Error('大きすぎます。'));
					else chunks.push(chunk);
				});
				res.on('end', () => {
					try {
						resolve({ json: JSON.parse(Buffer.concat(chunks).toString('utf8')), cacheMs: cacheMsOf(res.headers['cache-control']) });
					} catch {
						reject(new Error('JSON ではありません。'));
					}
				});
				res.on('error', reject);
			}
		);
		req.on('timeout', () => req.destroy(new Error('時間切れです。')));
		req.on('error', reject);
		req.end();
	});

export function cacheMsOf(cacheControl: string | undefined): number {
	if (!cacheControl || /no-store|no-cache/i.test(cacheControl)) return 0;
	const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] ?? 0);
	return Math.min(maxAge * 1000, CACHE_MAX_MS);
}

// ponytail: 単一プロセス前提のメモリキャッシュ。複数台で動かすなら共有キャッシュへ。
const metadataCache = new Map<string, { metadata: ClientMetadata; expiresAt: number }>();

/** クライアントの情報を取得して検証する。失敗なら理由の文字列。 */
export async function resolveClient(clientId: string, fetchJson: FetchJson = httpsGetJson, now = Date.now()): Promise<ClientMetadata | string> {
	const url = parseClientIdUrl(clientId);
	if (!url) return 'client_id は https の URL(パス付き)で指定してください。';
	const cached = metadataCache.get(clientId);
	if (cached && cached.expiresAt > now) return cached.metadata;
	let fetched: Awaited<ReturnType<FetchJson>>;
	try {
		fetched = await fetchJson(url);
	} catch (e) {
		return `クライアントの情報を取得できませんでした(${e instanceof Error ? e.message : '不明なエラー'})。`;
	}
	const result = validateClientMetadata(clientId, fetched.json);
	if (typeof result !== 'string' && fetched.cacheMs > 0) metadataCache.set(clientId, { metadata: result, expiresAt: now + fetched.cacheMs });
	return result;
}

export function clearClientCache(): void {
	metadataCache.clear();
}

// --- 認可コード ---

const CODE_TTL_MS = 60 * 1000;

export interface Grant {
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	userId: string;
	householdId: string;
	name: string;
}

// ponytail: 認可コードは寿命1分なのでメモリに置く。再起動で消えたら、エージェントが認可をやり直す。
const codes = new Map<string, Grant & { expiresAt: number }>();

const sha256 = (value: string) => createHash('sha256').update(value).digest();

export function issueAuthorizationCode(grant: Grant, now = Date.now()): string {
	for (const [k, v] of codes) if (v.expiresAt <= now) codes.delete(k);
	const code = randomBytes(32).toString('base64url');
	codes.set(sha256(code).toString('hex'), { ...grant, expiresAt: now + CODE_TTL_MS });
	return code;
}

/** PKCE S256 の検証。 */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
	if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier)) return false;
	const expected = Buffer.from(sha256(codeVerifier).toString('base64url'));
	const actual = Buffer.from(codeChallenge);
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * 認可コードを使う。1回きりで、クライアント・戻り先・PKCE が発行時と一致したときだけ許可内容を返す。
 * 失敗しても使ったコードは消す。
 */
export function consumeAuthorizationCode(
	code: string,
	check: { clientId: string; redirectUri: string; codeVerifier: string },
	now = Date.now()
): Grant | null {
	const key = sha256(code).toString('hex');
	const grant = codes.get(key);
	codes.delete(key);
	if (!grant || grant.expiresAt <= now) return null;
	if (grant.clientId !== check.clientId || grant.redirectUri !== check.redirectUri) return null;
	if (!verifyPkce(check.codeVerifier, grant.codeChallenge)) return null;
	return {
		clientId: grant.clientId,
		redirectUri: grant.redirectUri,
		codeChallenge: grant.codeChallenge,
		userId: grant.userId,
		householdId: grant.householdId,
		name: grant.name
	};
}

// --- 認可リクエスト ---

export interface AuthorizeRequest {
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	state: string | null;
}

/**
 * 認可リクエストのうち、戻り先を確かめる前に分かる誤り(戻り先へ返せない)と、
 * 確かめた後の誤り(error パラメーター付きで戻り先へ返す)を分けて検証する。
 * resource(RFC 8707)は指定があれば MCP エンドポイントと一致しなければならない。
 */
export function parseAuthorizeRequest(
	params: URLSearchParams,
	resource: string
): { ok: AuthorizeRequest } | { fatal: string } | { redirectError: string; description: string; request: Pick<AuthorizeRequest, 'redirectUri' | 'state'> } {
	const clientId = params.get('client_id');
	const redirectUri = params.get('redirect_uri');
	if (!clientId) return { fatal: 'client_id がありません。' };
	if (!redirectUri) return { fatal: 'redirect_uri がありません。' };
	const state = params.get('state');
	const fail = (redirectError: string, description: string) => ({ redirectError, description, request: { redirectUri, state } });
	if (params.get('response_type') !== 'code') return fail('unsupported_response_type', 'response_type は code だけに対応しています。');
	const codeChallenge = params.get('code_challenge');
	if (!codeChallenge || !/^[A-Za-z0-9\-_]{43}$/.test(codeChallenge)) return fail('invalid_request', 'code_challenge(PKCE)が必要です。');
	if (params.get('code_challenge_method') !== 'S256') return fail('invalid_request', 'code_challenge_method は S256 だけに対応しています。');
	const requested = params.getAll('resource');
	if (requested.some((r) => r.replace(/\/$/, '') !== resource)) return fail('invalid_target', `resource は ${resource} だけです。`);
	return { ok: { clientId, redirectUri, codeChallenge, state } };
}

/** 戻り先へのリダイレクト URL(RFC 9207 の iss を付ける)。 */
export function redirectWith(redirectUri: string, params: Record<string, string | null>, issuer: string): string {
	const url = new URL(redirectUri);
	for (const [k, v] of Object.entries({ ...params, iss: issuer })) if (v !== null) url.searchParams.set(k, v);
	return url.href;
}
