import { describe, it, expect, beforeEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { createDb, type Db } from './db';
import { users, sessions, passkeys } from './db/schema';
import {
	getCredentialSummary,
	addPasskey,
	renamePasskey,
	deletePasskey,
	removePassword,
	recordPasskeyUse,
	normalizePasskeyName
} from './credentials';

let db: Db;

beforeEach(() => {
	db = createDb(':memory:');
	migrate(db, { migrationsFolder: './drizzle' });
});

function addUser(id: string, passwordHash: string | null): void {
	db.insert(users).values({ id, username: id, passwordHash, createdAt: 0 }).run();
	db.insert(sessions).values({ id: `${id}-keep`, userId: id, expiresAt: 9e15 }).run();
	db.insert(sessions).values({ id: `${id}-other`, userId: id, expiresAt: 9e15 }).run();
}
function addPk(userId: string, id: string): void {
	addPasskey(db, { id, userId, publicKey: Buffer.from([1]), counter: 0, transports: null, name: id, createdAt: 0 });
}
function sessionIds(userId: string): string[] {
	return db.select().from(sessions).where(eq(sessions.userId, userId)).all().map((s) => s.id);
}

describe('normalizePasskeyName', () => {
	it('前後の空白を除き、空なら既定名、51文字以上は null', () => {
		expect(normalizePasskeyName('  iPhone ')).toBe('iPhone');
		expect(normalizePasskeyName('')).toBe('パスキー');
		expect(normalizePasskeyName(undefined)).toBe('パスキー');
		expect(normalizePasskeyName('a'.repeat(50))).toBe('a'.repeat(50));
		expect(normalizePasskeyName('a'.repeat(51))).toBeNull();
	});
});

describe('getCredentialSummary', () => {
	it('パスワード有無とパスキー一覧を返す', () => {
		addUser('u', null);
		addPk('u', 'pk1');
		expect(getCredentialSummary(db, 'u')).toEqual({
			hasPassword: false,
			passkeys: [{ id: 'pk1', name: 'pk1', createdAt: 0, lastUsedAt: null }]
		});
	});
});

describe('removePassword', () => {
	it('パスキーがあれば削除でき、操作端末以外のセッションが消える', () => {
		addUser('u', 'h');
		addPk('u', 'pk1');
		expect(removePassword(db, 'u', 'u-keep')).toEqual({ ok: true });
		expect(getCredentialSummary(db, 'u').hasPassword).toBe(false);
		expect(sessionIds('u')).toEqual(['u-keep']);
	});

	it('パスキーが無ければ last_credential で拒否し、何も変えない', () => {
		addUser('u', 'h');
		expect(removePassword(db, 'u', 'u-keep')).toEqual({ ok: false, error: 'last_credential' });
		expect(getCredentialSummary(db, 'u').hasPassword).toBe(true);
		expect(sessionIds('u')).toHaveLength(2);
	});

	it('パスワードが無ければ not_found', () => {
		addUser('u', null);
		addPk('u', 'pk1');
		expect(removePassword(db, 'u', 'u-keep')).toEqual({ ok: false, error: 'not_found' });
	});
});

describe('deletePasskey', () => {
	it('パスワードなしで最後のパスキーは消せない', () => {
		addUser('u', null);
		addPk('u', 'pk1');
		expect(deletePasskey(db, 'u', 'pk1', 'u-keep')).toEqual({ ok: false, error: 'last_credential' });
		expect(getCredentialSummary(db, 'u').passkeys).toHaveLength(1);
		expect(sessionIds('u')).toHaveLength(2);
	});

	it('パスキーが他にあれば消せて、操作端末以外のセッションが消える', () => {
		addUser('u', null);
		addPk('u', 'pk1');
		addPk('u', 'pk2');
		expect(deletePasskey(db, 'u', 'pk1', 'u-keep')).toEqual({ ok: true });
		expect(getCredentialSummary(db, 'u').passkeys.map((p) => p.id)).toEqual(['pk2']);
		expect(sessionIds('u')).toEqual(['u-keep']);
	});

	it('パスワードがあれば最後のパスキーも消せる', () => {
		addUser('u', 'h');
		addPk('u', 'pk1');
		expect(deletePasskey(db, 'u', 'pk1', 'u-keep')).toEqual({ ok: true });
	});

	it('他人のパスキーは not_found で、他人のセッションにも触れない', () => {
		addUser('u', 'h');
		addUser('v', 'h');
		addPk('v', 'pkv');
		expect(deletePasskey(db, 'u', 'pkv', 'u-keep')).toEqual({ ok: false, error: 'not_found' });
		expect(db.select().from(passkeys).all()).toHaveLength(1);
		expect(sessionIds('v')).toHaveLength(2);
	});
});

describe('renamePasskey / recordPasskeyUse', () => {
	it('自分のパスキーだけ改名でき、使用記録でカウンタと最終使用日時が入る', () => {
		addUser('u', 'h');
		addUser('v', 'h');
		addPk('u', 'pk1');
		expect(renamePasskey(db, 'u', 'pk1', 'iPhone')).toEqual({ ok: true });
		expect(renamePasskey(db, 'v', 'pk1', 'x')).toEqual({ ok: false, error: 'not_found' });

		recordPasskeyUse(db, 'pk1', 5);
		const row = db.select().from(passkeys).where(eq(passkeys.id, 'pk1')).get();
		expect(row?.name).toBe('iPhone');
		expect(row?.counter).toBe(5);
		expect(row?.lastUsedAt).toBeTypeOf('number');
	});
});
