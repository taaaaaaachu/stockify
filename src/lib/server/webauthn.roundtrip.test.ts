import { describe, it, expect, beforeEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { createDb, type Db } from './db';
import { users, passkeys } from './db/schema';
import { addPasskey } from './credentials';
import { registrationOptions, verifyRegistration, authenticationOptions, verifyAuthentication } from './webauthn';

// --- テスト用のソフトウェア認証器(attestation: none / ES256) ---

/** 必要最小限の CBOR エンコーダ(整数・バイト列・文字列・マップ)。 */
function cbor(v: unknown): Buffer {
	const head = (major: number, n: number) =>
		n < 24
			? Buffer.from([(major << 5) | n])
			: n < 256
				? Buffer.from([(major << 5) | 24, n])
				: Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
	if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
	if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
	if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
	const entries = v instanceof Map ? [...v] : Object.entries(v as object);
	return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();
const b64u = (b: Buffer) => b.toString('base64url');

class SoftAuthenticator {
	private key: KeyObject;
	readonly coseKey: Buffer;
	readonly credId = Buffer.from('soft-credential-0001');
	private count = 0;

	constructor() {
		const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
		this.key = privateKey;
		const jwk = publicKey.export({ format: 'jwk' });
		this.coseKey = cbor(
			new Map<number, unknown>([
				[1, 2],
				[3, -7],
				[-1, 1],
				[-2, Buffer.from(jwk.x!, 'base64url')],
				[-3, Buffer.from(jwk.y!, 'base64url')]
			])
		);
	}

	private authData(rpId: string, flags: number, attested?: Buffer): Buffer {
		const counter = Buffer.alloc(4);
		counter.writeUInt32BE(++this.count);
		return Buffer.concat([sha256(rpId), Buffer.from([flags]), counter, attested ?? Buffer.alloc(0)]);
	}

	create(rpId: string, origin: string, challenge: string): RegistrationResponseJSON {
		const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin }));
		const len = Buffer.alloc(2);
		len.writeUInt16BE(this.credId.length);
		const attested = Buffer.concat([Buffer.alloc(16), len, this.credId, this.coseKey]);
		// UP | UV | AT
		const authData = this.authData(rpId, 0x45, attested);
		const attestationObject = cbor({ fmt: 'none', attStmt: new Map(), authData });
		return {
			id: b64u(this.credId),
			rawId: b64u(this.credId),
			type: 'public-key',
			clientExtensionResults: {},
			response: {
				clientDataJSON: b64u(clientData),
				attestationObject: b64u(attestationObject),
				transports: ['internal']
			}
		};
	}

	get(rpId: string, origin: string, challenge: string): AuthenticationResponseJSON {
		const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
		// UP | UV
		const authData = this.authData(rpId, 0x05);
		const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.key);
		return {
			id: b64u(this.credId),
			rawId: b64u(this.credId),
			type: 'public-key',
			clientExtensionResults: {},
			response: {
				clientDataJSON: b64u(clientData),
				authenticatorData: b64u(authData),
				signature: b64u(signature)
			}
		};
	}
}

// --- テスト本体 ---

const url = new URL('https://stockify.example.com/api/passkey/x');
let db: Db;

beforeEach(() => {
	db = createDb(':memory:');
	migrate(db, { migrationsFolder: './drizzle' });
	db.insert(users).values({ id: 'u', username: 'alice', passwordHash: null, createdAt: 0 }).run();
});

async function register(auth: SoftAuthenticator) {
	const opts = await registrationOptions(url, { id: 'u', username: 'alice' }, []);
	const cred = await verifyRegistration(url, auth.create(url.hostname, url.origin, opts.challenge), opts.challenge);
	expect(cred).not.toBeNull();
	addPasskey(db, { ...cred!, userId: 'u', name: 'soft', createdAt: 0 });
	return cred!;
}

describe('パスキーの登録→ログイン(ソフトウェア認証器)', () => {
	it('登録した公開鍵を DB から読み戻して認証でき、カウンタが進む', async () => {
		const auth = new SoftAuthenticator();
		const cred = await register(auth);
		expect(cred.transports).toBe('["internal"]');

		const opts = await authenticationOptions(url);
		const passkey = await verifyAuthentication(db, url, auth.get(url.hostname, url.origin, opts.challenge), opts.challenge);
		expect(passkey?.userId).toBe('u');

		const row = db.select().from(passkeys).get();
		expect(row?.counter).toBe(2);
		expect(row?.lastUsedAt).toBeTypeOf('number');
	});

	it('別オリジン・チャレンジ違い・同じ応答の再送(カウンタ巻き戻り)は失敗', async () => {
		const auth = new SoftAuthenticator();
		await register(auth);
		const { challenge } = await authenticationOptions(url);

		const phishing = auth.get(url.hostname, 'https://evil.example.com', challenge);
		expect(await verifyAuthentication(db, url, phishing, challenge)).toBeNull();

		const ok = auth.get(url.hostname, url.origin, challenge);
		expect(await verifyAuthentication(db, url, ok, 'other-challenge')).toBeNull();
		expect(await verifyAuthentication(db, url, ok, challenge)).not.toBeNull();
		expect(await verifyAuthentication(db, url, ok, challenge)).toBeNull();
	});

	it('登録時のオリジンが違えば登録できない', async () => {
		const auth = new SoftAuthenticator();
		const opts = await registrationOptions(url, { id: 'u', username: 'alice' }, []);
		const res = auth.create(url.hostname, 'https://evil.example.com', opts.challenge);
		expect(await verifyRegistration(url, res, opts.challenge)).toBeNull();
	});
});
