import { describe, it, expect, beforeEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { createDb, type Db } from './db';
import { users, households, memberships, agentConnections } from './db/schema';
import { resetPassword } from './auth';
import { issueResetLink, consumeResetLink } from './resetLinks';
import {
	AGENT_IDLE_TTL_MS,
	ACCESS_TOKEN_TTL_MS,
	authenticateAgent,
	createOAuthConnection,
	deleteUserAgentConnections,
	issueManualConnection,
	listAgentConnections,
	normalizeAgentName,
	refreshConnection,
	revokeAgentConnection,
	revokeByToken
} from './agentConnections';

let db: Db;
const CLIENT = 'https://muse.example/oauth/client.json';

beforeEach(() => {
	db = createDb(':memory:');
	migrate(db, { migrationsFolder: './drizzle' });
	addUser('u');
	addUser('other');
	db.insert(households).values([
		{ id: 'h1', name: '自宅', createdAt: 0 },
		{ id: 'h2', name: '別の家', createdAt: 0 }
	]).run();
	join('u', 'h1', 'owner');
	join('u', 'h2', 'member');
	join('other', 'h1', 'member');
});

function addUser(name: string) {
	db.insert(users).values({ id: name, username: name, passwordHash: 'x', createdAt: 0 }).run();
}
function join(userId: string, householdId: string, role: 'owner' | 'member') {
	db.insert(memberships).values({ id: `${userId}-${householdId}`, userId, householdId, role, createdAt: 0 }).run();
}
const count = () => db.select().from(agentConnections).all().length;

function manual(now = 0) {
	const r = issueManualConnection(db, 'u', 'h1', 'muse', now);
	if (!r) throw new Error('not issued');
	return r;
}
function oauth(now = 0, householdId = 'h1') {
	const r = createOAuthConnection(db, 'u', householdId, CLIENT, 'muse', now);
	if (!r) throw new Error('not issued');
	return r;
}

describe('normalizeAgentName', () => {
	it('前後の空白を落とし、空と51文字以上は拒否する', () => {
		expect(normalizeAgentName(' muse ')).toBe('muse');
		expect(normalizeAgentName('  ')).toBeNull();
		expect(normalizeAgentName('a'.repeat(51))).toBeNull();
		expect(normalizeAgentName(1)).toBeNull();
	});
});

describe('手動発行', () => {
	it('接頭辞付きのトークンで世帯とその時点のロールが分かる', () => {
		const { token } = manual();
		expect(token.startsWith('stk_')).toBe(true);
		expect(authenticateAgent(db, token, 1)).toMatchObject({ userId: 'u', householdId: 'h1', role: 'owner' });
		db.update(memberships).set({ role: 'member' }).where(eq(memberships.id, 'u-h1')).run();
		expect(authenticateAgent(db, token, 2)?.role).toBe('member');
	});

	it('所属していない世帯には発行できない', () => {
		expect(issueManualConnection(db, 'other', 'h2', 'x')).toBeNull();
	});

	it('期限はなく、90日使われないと失効して消える', () => {
		const { token } = manual();
		expect(authenticateAgent(db, token, AGENT_IDLE_TTL_MS)).not.toBeNull();
		// 使うたびに最終使用日時が延びる。
		expect(authenticateAgent(db, token, AGENT_IDLE_TTL_MS * 2)).not.toBeNull();
		expect(authenticateAgent(db, token, AGENT_IDLE_TTL_MS * 3 + 1)).toBeNull();
		expect(count()).toBe(0);
	});

	it('不明なトークンは null', () => {
		manual();
		expect(authenticateAgent(db, 'stk_nope')).toBeNull();
	});

	it('強制パスワード変更中は使えないが、接続は残る', () => {
		const { token } = manual();
		db.update(users).set({ mustChangePassword: true }).where(eq(users.id, 'u')).run();
		expect(authenticateAgent(db, token, 1)).toBeNull();
		expect(count()).toBe(1);
	});
});

describe('OAuth', () => {
	it('アクセストークンは1時間で切れる', () => {
		const t = oauth(0);
		expect(t.expiresIn).toBe(3600);
		expect(authenticateAgent(db, t.accessToken, ACCESS_TOKEN_TTL_MS - 1)).not.toBeNull();
		expect(authenticateAgent(db, t.accessToken, ACCESS_TOKEN_TTL_MS)).toBeNull();
	});

	it('リフレッシュで両方入れ替わり、古いアクセストークンは使えない', () => {
		const t1 = oauth(0);
		const t2 = refreshConnection(db, t1.refreshToken, CLIENT, 10);
		expect(t2).not.toBeNull();
		expect(authenticateAgent(db, t1.accessToken, 11)).toBeNull();
		expect(authenticateAgent(db, t2!.accessToken, 11)).not.toBeNull();
	});

	it('使用済みのリフレッシュトークンが再び使われたら接続ごと消す', () => {
		const t1 = oauth(0);
		const t2 = refreshConnection(db, t1.refreshToken, CLIENT, 10)!;
		expect(refreshConnection(db, t1.refreshToken, CLIENT, 20)).toBeNull();
		expect(count()).toBe(0);
		expect(refreshConnection(db, t2.refreshToken, CLIENT, 30)).toBeNull();
	});

	it('別のクライアントのリフレッシュトークンは受け付けない', () => {
		const t = oauth(0);
		expect(refreshConnection(db, t.refreshToken, 'https://evil.example/c.json', 1)).toBeNull();
		expect(count()).toBe(1);
	});

	it('90日使われなかった接続はリフレッシュできない', () => {
		const t = oauth(0);
		expect(refreshConnection(db, t.refreshToken, CLIENT, AGENT_IDLE_TTL_MS + 1)).toBeNull();
		expect(count()).toBe(0);
	});

	it('同じクライアント・同じ世帯で繋ぎ直すと置き換わる。別の世帯は別の接続', () => {
		const t1 = oauth(0);
		oauth(1);
		expect(authenticateAgent(db, t1.accessToken, 2)).toBeNull();
		oauth(2, 'h2');
		expect(count()).toBe(2);
	});

	it('revokeByToken は同じクライアントのトークンだけ接続ごと消す', () => {
		const t = oauth(0);
		revokeByToken(db, t.accessToken, 'https://evil.example/c.json');
		expect(count()).toBe(1);
		revokeByToken(db, t.refreshToken, CLIENT);
		expect(count()).toBe(0);
	});
});

describe('一覧と取り消し', () => {
	it('自分の接続だけを新しい順に返し、失効したものは消す', () => {
		manual(0);
		oauth(AGENT_IDLE_TTL_MS, 'h2');
		issueManualConnection(db, 'other', 'h1', 'dots', 0);
		const list = listAgentConnections(db, 'u', AGENT_IDLE_TTL_MS + 1);
		expect(list.map((c) => c.householdName)).toEqual(['別の家']);
		expect(list[0].clientId).toBe(CLIENT);
		expect(count()).toBe(2);
	});

	it('他人の接続は取り消せない', () => {
		const { id } = manual();
		expect(revokeAgentConnection(db, 'other', id)).toBe(false);
		expect(revokeAgentConnection(db, 'u', id)).toBe(true);
		expect(count()).toBe(0);
	});
});

describe('消えるとき', () => {
	it('世帯から外れるとその世帯の接続だけ消える', () => {
		manual();
		oauth(0, 'h2');
		db.delete(memberships).where(eq(memberships.id, 'u-h1')).run();
		expect(listAgentConnections(db, 'u', 0).map((c) => c.householdId)).toEqual(['h2']);
	});

	it('ユーザー削除ですべて消える', () => {
		manual();
		db.delete(users).where(eq(users.id, 'u')).run();
		expect(count()).toBe(0);
	});

	it('管理者の一時パスワード発行ですべて消える', () => {
		manual();
		oauth(0, 'h2');
		expect(resetPassword('u', 'tmp', db)).toBe(true);
		expect(count()).toBe(0);
	});

	it('リセットリンクは発行では消えず、使った時点で消える', () => {
		manual();
		const link = issueResetLink(db, 'other', 'u', 0)!;
		expect(count()).toBe(1);
		consumeResetLink(db, link.token, { passwordHash: 'new' }, 1);
		expect(count()).toBe(0);
	});

	it('deleteUserAgentConnections は他人の接続を残す', () => {
		manual();
		issueManualConnection(db, 'other', 'h1', 'dots');
		deleteUserAgentConnections(db, 'u');
		expect(count()).toBe(1);
	});
});
