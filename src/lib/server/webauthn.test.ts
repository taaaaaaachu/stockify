import { describe, it, expect, beforeEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { createDb, type Db } from './db';
import { users } from './db/schema';
import { addPasskey } from './credentials';
import { saveChallenge, takeChallenge, registrationOptions, verifyAuthentication } from './webauthn';

/** Cookies の最小モック。 */
function fakeCookies() {
	const jar = new Map<string, string>();
	return {
		jar,
		set: (name: string, value: string) => void jar.set(name, value),
		get: (name: string) => jar.get(name),
		delete: (name: string) => void jar.delete(name)
	};
}

describe('saveChallenge / takeChallenge', () => {
	it('保存したチャレンジと待ち状態を1回だけ取り出せる', () => {
		const c = fakeCookies();
		saveChallenge(c, 'reg', 'ch1', { kind: 'add', userId: 'u' });
		expect(takeChallenge(c, 'reg')).toEqual({ challenge: 'ch1', pending: { kind: 'add', userId: 'u' } });
		expect(takeChallenge(c, 'reg')).toBeNull();
	});

	it('用途ごとに別管理し、期限切れは null', () => {
		const c = fakeCookies();
		saveChallenge(c, 'auth', 'a', undefined, 0);
		expect(takeChallenge(c, 'reg')).toBeNull();
		expect(takeChallenge(c, 'auth', 10 * 60 * 1000)).toBeNull();
	});

	it('Cookie のキーを知らなければ取り出せない', () => {
		const c = fakeCookies();
		saveChallenge(c, 'auth', 'a');
		c.jar.set('wa_auth', 'forged');
		expect(takeChallenge(c, 'auth')).toBeNull();
	});
});

describe('registrationOptions', () => {
	it('RP ID はリクエストのホスト名、端末保存と本人確認を必須にする', async () => {
		const opts = await registrationOptions(
			new URL('https://stockify.example.com/api/x'),
			{ id: 'u1', username: 'alice' },
			[{ id: 'cred-1', transports: '["internal"]' }]
		);
		expect(opts.rp.id).toBe('stockify.example.com');
		expect(opts.user.name).toBe('alice');
		expect(opts.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
		expect(opts.excludeCredentials).toEqual([{ id: 'cred-1', type: 'public-key', transports: ['internal'] }]);
	});
});

describe('verifyAuthentication', () => {
	let db: Db;
	beforeEach(() => {
		db = createDb(':memory:');
		migrate(db, { migrationsFolder: './drizzle' });
		db.insert(users).values({ id: 'u', username: 'u', passwordHash: null, createdAt: 0 }).run();
		addPasskey(db, { id: 'cred-1', userId: 'u', publicKey: Buffer.from([1]), counter: 0, transports: null, name: 'p', createdAt: 0 });
	});
	const url = new URL('https://stockify.example.com/');

	it('未登録のクレデンシャル・不正な形の応答は null', async () => {
		expect(await verifyAuthentication(db, url, { id: 'unknown' } as AuthenticationResponseJSON, 'ch')).toBeNull();
		expect(await verifyAuthentication(db, url, null as unknown as AuthenticationResponseJSON, 'ch')).toBeNull();
	});

	it('署名が検証できない応答は例外にせず null', async () => {
		const res = {
			id: 'cred-1',
			rawId: 'cred-1',
			type: 'public-key',
			clientExtensionResults: {},
			response: { clientDataJSON: 'AA', authenticatorData: 'AA', signature: 'AA' }
		} as AuthenticationResponseJSON;
		expect(await verifyAuthentication(db, url, res, 'ch')).toBeNull();
	});
});
