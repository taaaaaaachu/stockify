import { describe, it, expect, beforeEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { createDb, type Db } from './db';
import { users, sessions, passkeys, resetLinks } from './db/schema';
import { listUsers, resetPassword } from './auth';
import { issueResetLink, revokeResetLink, findResetLink, consumeResetLink, RESET_LINK_TTL_MS } from './resetLinks';

let db: Db;

beforeEach(() => {
	db = createDb(':memory:');
	migrate(db, { migrationsFolder: './drizzle' });
	addUser('sa');
});

function addUser(username: string): string {
	const id = `id-${username}`;
	db.insert(users).values({ id, username, passwordHash: 'old', createdAt: 0 }).run();
	db.insert(sessions).values({ id: `s-${username}`, userId: id, expiresAt: 9e15 }).run();
	db.insert(passkeys)
		.values({ id: `pk-${username}`, userId: id, publicKey: Buffer.from([1]), counter: 0, name: 'p', createdAt: 0 })
		.run();
	return id;
}
const newPasskey = { id: 'pk-new', publicKey: Buffer.from([2]), counter: 0, transports: null, name: 'n', createdAt: 0 };
function issue(target: string, now = 0): string {
	const r = issueResetLink(db, 'id-sa', target, now);
	if (!r) throw new Error('not found');
	return r.token;
}
const userRow = (id: string) => db.select().from(users).where(eq(users.id, id)).get();
const countOf = (table: typeof sessions | typeof passkeys, userId: string) =>
	db.select().from(table).where(eq(table.userId, userId)).all().length;

describe('issueResetLink', () => {
	it('発行しただけでは認証情報は変わらない', () => {
		const u = addUser('u');
		expect(issueResetLink(db, 'id-sa', u, 1000)).toMatchObject({ expiresAt: 1000 + RESET_LINK_TTL_MS });
		expect(userRow(u)?.passwordHash).toBe('old');
		expect(countOf(sessions, u)).toBe(1);
		expect(countOf(passkeys, u)).toBe(1);
	});

	it('再発行すると古いリンクは使えなくなる', () => {
		const u = addUser('u');
		const old = issue(u);
		const fresh = issue(u);
		expect(findResetLink(db, old, 0)).toBeNull();
		expect(findResetLink(db, fresh, 0)).toEqual({ userId: u, username: 'u' });
	});

	it('居ないユーザーには発行できない', () => {
		expect(issueResetLink(db, 'id-sa', 'nobody')).toBeNull();
	});

	it('DB にはトークンそのものを残さない', () => {
		const token = issue(addUser('u'));
		expect(db.select().from(resetLinks).all().map((l) => l.id)).not.toContain(token);
	});
});

describe('findResetLink', () => {
	it('期限切れ・不明なトークンは null', () => {
		const token = issue(addUser('u'), 0);
		expect(findResetLink(db, token, RESET_LINK_TTL_MS - 1)).not.toBeNull();
		expect(findResetLink(db, token, RESET_LINK_TTL_MS)).toBeNull();
		expect(findResetLink(db, 'x', 0)).toBeNull();
	});

	it('取り消し・一時パスワードの発行で使えなくなる', () => {
		const u = addUser('u');
		const t1 = issue(u);
		revokeResetLink(db, u);
		expect(findResetLink(db, t1, 0)).toBeNull();

		const t2 = issue(u);
		resetPassword(u, 'temp', db);
		expect(findResetLink(db, t2, 0)).toBeNull();
	});

	it('発行者が削除・対象者が昇格しても有効、対象者が削除されたら消える', () => {
		const issuer = addUser('issuer');
		const u = addUser('u');
		const r = issueResetLink(db, issuer, u, 0)!;
		db.update(users).set({ instanceRole: 'super_admin' }).where(eq(users.id, u)).run();
		db.delete(users).where(eq(users.id, issuer)).run();
		expect(findResetLink(db, r.token, 0)).toEqual({ userId: u, username: 'u' });

		db.delete(users).where(eq(users.id, u)).run();
		expect(db.select().from(resetLinks).all()).toHaveLength(0);
	});
});

describe('consumeResetLink', () => {
	it('パスワードで使うと全初期化し、強制変更にしないパスワードを設定してリンクを消費する', () => {
		const u = addUser('u');
		db.update(users).set({ mustChangePassword: true }).where(eq(users.id, u)).run();
		const token = issue(u);
		expect(consumeResetLink(db, token, { passwordHash: 'mine' }, 0)).toBe(u);

		expect(userRow(u)).toMatchObject({ passwordHash: 'mine', mustChangePassword: false });
		expect(countOf(passkeys, u)).toBe(0);
		expect(countOf(sessions, u)).toBe(0);
		expect(consumeResetLink(db, token, { passwordHash: 'again' }, 0)).toBeNull();
	});

	it('パスキーで使うとパスワードを消し、そのパスキーだけを持つ', () => {
		const u = addUser('u');
		expect(consumeResetLink(db, issue(u), { passkey: newPasskey }, 0)).toBe(u);
		expect(userRow(u)?.passwordHash).toBeNull();
		expect(db.select().from(passkeys).where(eq(passkeys.userId, u)).all().map((p) => p.id)).toEqual(['pk-new']);
	});

	it('期限切れのリンクでは何も変えない', () => {
		const u = addUser('u');
		expect(consumeResetLink(db, issue(u, 0), { passwordHash: 'mine' }, RESET_LINK_TTL_MS)).toBeNull();
		expect(userRow(u)?.passwordHash).toBe('old');
		expect(countOf(sessions, u)).toBe(1);
	});

	it('他の会員の認証情報には触れない', () => {
		consumeResetLink(db, issue(addUser('u')), { passwordHash: 'mine' }, 0);
		expect(countOf(passkeys, 'id-sa')).toBe(1);
		expect(countOf(sessions, 'id-sa')).toBe(1);
	});
});

describe('listUsers のリンク表示', () => {
	it('期限内の未使用リンクだけ期限を返す', () => {
		const u = addUser('u');
		issue(u, 0);
		const linkOf = (id: string, now: number) => listUsers(db, now).find((x) => x.id === id)?.resetLinkExpiresAt;
		expect(linkOf(u, 0)).toBe(RESET_LINK_TTL_MS);
		expect(linkOf(u, RESET_LINK_TTL_MS)).toBeNull();
		expect(linkOf('id-sa', 0)).toBeNull();
	});
});
