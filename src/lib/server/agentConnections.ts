import { and, eq, inArray, or } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db } from './db';
import { agentConnections, households, memberships, oauthClients, users } from './db/schema';
import type { HouseholdRole } from '#lib/rbac.js';

/**
 * エージェント接続(ADR 0012)。1件の接続は所属(会員×世帯)1つに結びつく。
 * 権限は接続ではなく所属のその時点のロールで決める。
 */

/** この期間使われなかった接続は失効する。 */
export const AGENT_IDLE_TTL_MS = 1000 * 60 * 60 * 24 * 90;
/** OAuth のアクセストークンの寿命。 */
export const ACCESS_TOKEN_TTL_MS = 1000 * 60 * 60;

export const AGENT_NAME_MAX = 50;

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** 漏えい時にシークレットスキャンで見つけやすいよう接頭辞を付ける。 */
function newToken(prefix: 'stk_' | 'stkr_'): string {
	return prefix + randomBytes(32).toString('base64url');
}

/** 名前を整える。空・長すぎは null。 */
export function normalizeAgentName(name: unknown): string | null {
	if (typeof name !== 'string') return null;
	const trimmed = name.trim();
	return trimmed.length > 0 && trimmed.length <= AGENT_NAME_MAX ? trimmed : null;
}

function findMembershipId(db: Db, userId: string, householdId: string): string | null {
	return (
		db
			.select({ id: memberships.id })
			.from(memberships)
			.where(and(eq(memberships.userId, userId), eq(memberships.householdId, householdId)))
			.get()?.id ?? null
	);
}

/** 手動発行。トークンは戻り値でしか分からない。所属していなければ null。 */
export function issueManualConnection(
	db: Db,
	userId: string,
	householdId: string,
	name: string,
	now = Date.now()
): { id: string; token: string } | null {
	const membershipId = findMembershipId(db, userId, householdId);
	if (!membershipId) return null;
	const id = randomUUID();
	const token = newToken('stk_');
	db.insert(agentConnections)
		.values({ id, membershipId, name, clientId: null, accessHash: hashToken(token), accessExpiresAt: null, createdAt: now, lastUsedAt: now })
		.run();
	return { id, token };
}

export interface OAuthTokens {
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
}

function newOAuthTokens(now: number) {
	const accessToken = newToken('stk_');
	const refreshToken = newToken('stkr_');
	return {
		tokens: { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_MS / 1000 },
		columns: { accessHash: hashToken(accessToken), accessExpiresAt: now + ACCESS_TOKEN_TTL_MS, refreshHash: hashToken(refreshToken) }
	};
}

/**
 * OAuth の同意から接続を作る。同じクライアント・同じ所属の既存の接続は置き換える
 * (繋ぎ直すたびに一覧へ溜まらないように)。所属していなければ null。
 */
export function createOAuthConnection(
	db: Db,
	userId: string,
	householdId: string,
	clientId: string,
	name: string,
	now = Date.now()
): OAuthTokens | null {
	const membershipId = findMembershipId(db, userId, householdId);
	if (!membershipId) return null;
	const { tokens, columns } = newOAuthTokens(now);
	db.transaction((tx) => {
		tx.delete(agentConnections)
			.where(and(eq(agentConnections.membershipId, membershipId), eq(agentConnections.clientId, clientId)))
			.run();
		tx.insert(agentConnections)
			.values({ id: randomUUID(), membershipId, name, clientId, ...columns, previousRefreshHash: null, createdAt: now, lastUsedAt: now })
			.run();
	});
	return tokens;
}

const isIdle = (lastUsedAt: number, now: number) => now - lastUsedAt > AGENT_IDLE_TTL_MS;

/**
 * リフレッシュトークンでトークンを入れ替える。1つ前のトークンが再び使われたら
 * 漏えいとみなして接続を消す。無効なら null。
 */
export function refreshConnection(db: Db, refreshToken: string, clientId: string, now = Date.now()): OAuthTokens | null {
	const hash = hashToken(refreshToken);
	return db.transaction((tx) => {
		const row = tx
			.select()
			.from(agentConnections)
			.where(or(eq(agentConnections.refreshHash, hash), eq(agentConnections.previousRefreshHash, hash)))
			.get();
		if (!row || row.clientId !== clientId) return null;
		if (row.refreshHash !== hash || isIdle(row.lastUsedAt, now)) {
			tx.delete(agentConnections).where(eq(agentConnections.id, row.id)).run();
			return null;
		}
		const { tokens, columns } = newOAuthTokens(now);
		tx.update(agentConnections)
			.set({ ...columns, previousRefreshHash: hash, lastUsedAt: now })
			.where(eq(agentConnections.id, row.id))
			.run();
		return tokens;
	});
}

export interface AgentContext {
	connectionId: string;
	userId: string;
	householdId: string;
	role: HouseholdRole;
}

/**
 * Bearer トークン(手動発行・OAuth のアクセストークン)を確かめる。
 * 期限切れ・90日未使用・強制パスワード変更中は null。使えたら最終使用日時を更新する。
 */
export function authenticateAgent(db: Db, token: string, now = Date.now()): AgentContext | null {
	const row = db
		.select({
			id: agentConnections.id,
			accessExpiresAt: agentConnections.accessExpiresAt,
			lastUsedAt: agentConnections.lastUsedAt,
			userId: memberships.userId,
			householdId: memberships.householdId,
			role: memberships.role,
			mustChangePassword: users.mustChangePassword
		})
		.from(agentConnections)
		.innerJoin(memberships, eq(agentConnections.membershipId, memberships.id))
		.innerJoin(users, eq(memberships.userId, users.id))
		.where(eq(agentConnections.accessHash, hashToken(token)))
		.get();
	if (!row) return null;
	if (isIdle(row.lastUsedAt, now)) {
		db.delete(agentConnections).where(eq(agentConnections.id, row.id)).run();
		return null;
	}
	if ((row.accessExpiresAt !== null && row.accessExpiresAt <= now) || row.mustChangePassword) return null;
	db.update(agentConnections).set({ lastUsedAt: now }).where(eq(agentConnections.id, row.id)).run();
	return { connectionId: row.id, userId: row.userId, householdId: row.householdId, role: row.role };
}

export interface AgentConnectionSummary {
	id: string;
	name: string;
	householdId: string;
	householdName: string;
	clientId: string | null;
	/** 一覧での見分け方。手動発行・CIMD のドメイン・DCR の戻り先のドメイン。 */
	origin: string;
	createdAt: number;
	lastUsedAt: number;
}

function originOf(clientId: string | null, dcrRedirectUris: string | null): string {
	if (!clientId) return '手動発行';
	const url = dcrRedirectUris ? (JSON.parse(dcrRedirectUris) as string[])[0] : clientId;
	return URL.canParse(url) ? new URL(url).host + (dcrRedirectUris ? '(自己登録)' : '') : clientId;
}

/** 会員の接続一覧(新しい順)。失効したものは消してから返す。 */
export function listAgentConnections(db: Db, userId: string, now = Date.now()): AgentConnectionSummary[] {
	const rows = db
		.select({
			id: agentConnections.id,
			name: agentConnections.name,
			householdId: households.id,
			householdName: households.name,
			clientId: agentConnections.clientId,
			dcrRedirectUris: oauthClients.redirectUris,
			createdAt: agentConnections.createdAt,
			lastUsedAt: agentConnections.lastUsedAt
		})
		.from(agentConnections)
		.innerJoin(memberships, eq(agentConnections.membershipId, memberships.id))
		.innerJoin(households, eq(memberships.householdId, households.id))
		.leftJoin(oauthClients, eq(agentConnections.clientId, oauthClients.id))
		.where(eq(memberships.userId, userId))
		.all();
	const idle = rows.filter((r) => isIdle(r.lastUsedAt, now)).map((r) => r.id);
	if (idle.length > 0) db.delete(agentConnections).where(inArray(agentConnections.id, idle)).run();
	return rows
		.filter((r) => !idle.includes(r.id))
		.sort((a, b) => b.createdAt - a.createdAt)
		.map(({ dcrRedirectUris, ...r }) => ({ ...r, origin: originOf(r.clientId, dcrRedirectUris) }));
}

/** 自分の接続を取り消す。見つからなければ false。 */
export function revokeAgentConnection(db: Db, userId: string, id: string): boolean {
	const own = db
		.select({ id: agentConnections.id })
		.from(agentConnections)
		.innerJoin(memberships, eq(agentConnections.membershipId, memberships.id))
		.where(and(eq(agentConnections.id, id), eq(memberships.userId, userId)))
		.get();
	if (!own) return false;
	return db.delete(agentConnections).where(eq(agentConnections.id, id)).run().changes > 0;
}

/**
 * OAuth のトークン取り消し(RFC 7009)。アクセス・リフレッシュどちらでも接続ごと消す。
 * 別のクライアントのトークンや不明なトークンは何もしない(結果は常に成功扱い)。
 */
export function revokeByToken(db: Db, token: string, clientId: string): void {
	const hash = hashToken(token);
	db.delete(agentConnections)
		.where(
			and(
				eq(agentConnections.clientId, clientId),
				or(eq(agentConnections.accessHash, hash), eq(agentConnections.refreshHash, hash))
			)
		)
		.run();
}

/** 会員のすべての接続を消す(管理者によるパスワードリセット)。 */
export function deleteUserAgentConnections(db: Db, userId: string): void {
	const ids = db.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, userId));
	db.delete(agentConnections).where(inArray(agentConnections.membershipId, ids)).run();
}
