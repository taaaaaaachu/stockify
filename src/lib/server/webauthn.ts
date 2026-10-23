import type { Cookies } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import {
	generateRegistrationOptions,
	verifyRegistrationResponse,
	generateAuthenticationOptions,
	verifyAuthenticationResponse,
	type AuthenticatorTransport,
	type RegistrationResponseJSON,
	type AuthenticationResponseJSON
} from '@simplewebauthn/server';
import { dev } from '$app/environment';
import type { Db } from './db';
import type { PasskeyRow } from './db/schema';
import { getPasskey, recordPasskeyUse } from './credentials';

/**
 * WebAuthn(パスキー)の儀式まわり。RP ID / オリジンはリクエスト URL から取る
 * (本番は adapter-node の ORIGIN で公開ドメインになる)。
 */

const RP_NAME = 'Stockify';
const CHALLENGE_TTL_MS = 1000 * 60 * 5;

/**
 * 登録の待ち状態。signup = 未登録者の会員登録(世帯処理は確定時に registerUser で行う)、
 * add = ログイン中の会員のパスキー追加、reset = リセットリンクでの再設定(ADR 0011)。
 */
export type RegistrationPending =
	| {
			kind: 'signup';
			userId: string;
			username: string;
			requireInvite: boolean;
			inviteCode: string;
			householdName: string;
	  }
	| { kind: 'add'; userId: string }
	| { kind: 'reset'; token: string };

type Purpose = 'reg' | 'auth';
interface Stored {
	challenge: string;
	pending?: RegistrationPending;
	expiresAt: number;
}

// ponytail: プロセス内メモリ。再起動で進行中の儀式は失敗する(やり直せば済む)。複数プロセス化するなら DB へ。
const store = new Map<string, Stored>();

function cookieName(purpose: Purpose): string {
	return `wa_${purpose}`;
}

/** チャレンジを保存し、ブラウザとは httpOnly Cookie のキーで紐づける。 */
export function saveChallenge(
	cookies: Pick<Cookies, 'set'>,
	purpose: Purpose,
	challenge: string,
	pending?: RegistrationPending,
	now = Date.now()
): void {
	for (const [k, v] of store) if (v.expiresAt <= now) store.delete(k);
	const key = randomBytes(16).toString('hex');
	store.set(`${purpose}:${key}`, { challenge, pending, expiresAt: now + CHALLENGE_TTL_MS });
	cookies.set(cookieName(purpose), key, {
		path: '/api',
		httpOnly: true,
		sameSite: 'strict',
		secure: !dev,
		maxAge: CHALLENGE_TTL_MS / 1000
	});
}

/** チャレンジを取り出す(1回限り)。期限切れ・不明なら null。 */
export function takeChallenge(
	cookies: Pick<Cookies, 'get' | 'delete'>,
	purpose: Purpose,
	now = Date.now()
): Omit<Stored, 'expiresAt'> | null {
	const key = cookies.get(cookieName(purpose));
	if (!key) return null;
	cookies.delete(cookieName(purpose), { path: '/api' });
	const entry = store.get(`${purpose}:${key}`);
	store.delete(`${purpose}:${key}`);
	if (!entry || entry.expiresAt <= now) return null;
	return { challenge: entry.challenge, pending: entry.pending };
}

function parseTransports(json: string | null): AuthenticatorTransport[] | undefined {
	return json ? (JSON.parse(json) as AuthenticatorTransport[]) : undefined;
}

export function registrationOptions(
	url: URL,
	user: { id: string; username: string },
	exclude: { id: string; transports: string | null }[]
) {
	return generateRegistrationOptions({
		rpName: RP_NAME,
		rpID: url.hostname,
		userName: user.username,
		userID: new TextEncoder().encode(user.id),
		attestationType: 'none',
		excludeCredentials: exclude.map((c) => ({ id: c.id, transports: parseTransports(c.transports) })),
		// ユーザー名なしログインのため端末に保存させる。パスワード代わりなので本人確認も必須。
		authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
	});
}

/** 登録応答を検証する。成功なら保存用の認証情報、失敗なら null。 */
export async function verifyRegistration(
	url: URL,
	response: RegistrationResponseJSON,
	expectedChallenge: string
): Promise<Pick<PasskeyRow, 'id' | 'publicKey' | 'counter' | 'transports'> | null> {
	try {
		const v = await verifyRegistrationResponse({
			response,
			expectedChallenge,
			expectedOrigin: url.origin,
			expectedRPID: url.hostname,
			requireUserVerification: true
		});
		if (!v.verified) return null;
		const { credential } = v.registrationInfo;
		return {
			id: credential.id,
			publicKey: Buffer.from(credential.publicKey),
			counter: credential.counter,
			transports: credential.transports ? JSON.stringify(credential.transports) : null
		};
	} catch {
		return null;
	}
}

export function authenticationOptions(url: URL) {
	// allowCredentials を空にして、端末に保存されたパスキーから選ばせる(ユーザー名不要)。
	return generateAuthenticationOptions({ rpID: url.hostname, userVerification: 'required' });
}

/** 認証応答を検証する。成功ならそのパスキー(使用記録を更新済み)、失敗なら null。 */
export async function verifyAuthentication(
	db: Db,
	url: URL,
	response: AuthenticationResponseJSON,
	expectedChallenge: string
): Promise<PasskeyRow | null> {
	const passkey = typeof response?.id === 'string' ? getPasskey(db, response.id) : undefined;
	if (!passkey) return null;
	try {
		const v = await verifyAuthenticationResponse({
			response,
			expectedChallenge,
			expectedOrigin: url.origin,
			expectedRPID: url.hostname,
			requireUserVerification: true,
			credential: {
				id: passkey.id,
				publicKey: new Uint8Array(passkey.publicKey),
				counter: passkey.counter,
				transports: parseTransports(passkey.transports)
			}
		});
		if (!v.verified) return null;
		recordPasskeyUse(db, passkey.id, v.authenticationInfo.newCounter);
		return passkey;
	} catch {
		return null;
	}
}
