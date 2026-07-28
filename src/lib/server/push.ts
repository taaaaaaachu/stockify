import webpush from 'web-push';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { Db } from './db';
import { pushSubscriptions, users, type PushSubscriptionRow } from './db/schema';
import { listUserHouseholds } from './households';
import { listBundles, getSettings } from './stock';
import { buildDashboard, shoppingList } from '$lib/domain/dashboard';

/** 通知間引きの既定クールダウン(この時間内は同じ端末へ再送しない)。 */
export const NOTIFY_COOLDOWN_MS = 20 * 60 * 60 * 1000; // 20時間

interface Vapid {
	publicKey: string;
	privateKey: string;
	subject: string;
}

/** 環境変数から VAPID 設定を読む。未設定なら null(プッシュ機能は無効)。 */
export function getVapid(): Vapid | null {
	const publicKey = env.VAPID_PUBLIC_KEY;
	const privateKey = env.VAPID_PRIVATE_KEY;
	if (!publicKey || !privateKey) return null;
	return { publicKey, privateKey, subject: env.VAPID_SUBJECT ?? 'mailto:admin@example.com' };
}

/** プッシュ機能が使えるか(VAPID 設定済みか)。 */
export function pushConfigured(): boolean {
	return getVapid() !== null;
}

/** クライアントへ渡す VAPID 公開鍵。未設定なら null。 */
export function vapidPublicKey(): string | null {
	return getVapid()?.publicKey ?? null;
}

export interface SubscriptionInput {
	endpoint: string;
	keys: { p256dh: string; auth: string };
}

/** 購読を保存する(同一 endpoint は上書き)。 */
export function saveSubscription(db: Db, userId: string, sub: SubscriptionInput): void {
	const existing = db
		.select({ id: pushSubscriptions.id })
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.endpoint, sub.endpoint))
		.get();
	if (existing) {
		db.update(pushSubscriptions)
			.set({ userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
			.where(eq(pushSubscriptions.endpoint, sub.endpoint))
			.run();
		return;
	}
	db.insert(pushSubscriptions)
		.values({
			id: randomUUID(),
			userId,
			endpoint: sub.endpoint,
			p256dh: sub.keys.p256dh,
			auth: sub.keys.auth,
			createdAt: Date.now(),
			lastNotifiedAt: null
		})
		.run();
}

/** 購読を解除する(その端末の endpoint)。 */
export function deleteSubscription(db: Db, userId: string, endpoint: string): void {
	db.delete(pushSubscriptions)
		.where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
		.run();
}

export interface NotificationPayload {
	title: string;
	body: string;
	url: string;
}

/** 送信結果。gone は購読が失効(404/410)して削除すべき状態。 */
export type SendResult = 'ok' | 'gone' | 'error';

/** 実際に Web Push を送る。VAPID 未設定なら 'error'。 */
export async function sendWebPush(
	row: Pick<PushSubscriptionRow, 'endpoint' | 'p256dh' | 'auth'>,
	payload: NotificationPayload
): Promise<SendResult> {
	const vapid = getVapid();
	if (!vapid) return 'error';
	webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
	try {
		await webpush.sendNotification(
			{ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
			JSON.stringify(payload)
		);
		return 'ok';
	} catch (e) {
		const status = (e as { statusCode?: number }).statusCode;
		if (status === 404 || status === 410) return 'gone';
		return 'error';
	}
}

/**
 * あるユーザーが「そろそろ買う」品目名を、所属する全世帯から集める。
 * 定期便で自動補充される品目は購入推奨の対象外(shoppingList が除外する)。
 */
export function dueItemNamesForUser(db: Db, userId: string, now: number): string[] {
	const names: string[] = [];
	for (const h of listUserHouseholds(db, userId)) {
		const bundles = listBundles(db, h.id);
		const rows = shoppingList(buildDashboard(bundles, { defaultLeadTimeDays: h.defaultLeadTimeDays }, now));
		names.push(...rows.map((r) => r.item.name));
	}
	return names;
}

/** 通知スロットの長さ(分)。 */
export const NOTIFY_SLOT_MINUTES = 15;

/**
 * ユーザーの設定時刻(userMinute)が、現在の 15 分スロットに該当するか。
 * 現在分をスロット幅で切り捨てた値と一致すれば送信対象。
 */
export function matchesNotifySlot(
	userMinute: number,
	nowMinuteOfDay: number,
	slot = NOTIFY_SLOT_MINUTES
): boolean {
	return Math.floor(nowMinuteOfDay / slot) * slot === userMinute;
}

export interface NotifyDeps {
	send: (
		row: Pick<PushSubscriptionRow, 'endpoint' | 'p256dh' | 'auth'>,
		payload: NotificationPayload
	) => Promise<SendResult>;
	cooldownMs: number;
	/**
	 * 現在時刻の「0:00 からの分」。指定すると、各ユーザーの設定時刻スロットに
	 * 該当するときだけ送る。省略時は時刻ゲートなし(常に評価)。
	 */
	nowMinuteOfDay?: number;
}

/**
 * 全購読を評価し、購入推奨に達した品目があるユーザーへ通知する(通知評価cron)。
 * nowMinuteOfDay 指定時は各ユーザーの設定時刻スロットのみ対象。
 * クールダウン内の端末はスキップ。失効した購読は削除する。
 */
export async function notifyDueRestocks(
	db: Db,
	now: number,
	deps: NotifyDeps = { send: sendWebPush, cooldownMs: NOTIFY_COOLDOWN_MS }
): Promise<{ notified: number; skipped: number; removed: number }> {
	const subs = db
		.select({ sub: pushSubscriptions, notifyMinuteOfDay: users.notifyMinuteOfDay })
		.from(pushSubscriptions)
		.innerJoin(users, eq(pushSubscriptions.userId, users.id))
		.all();
	let notified = 0;
	let skipped = 0;
	let removed = 0;

	for (const { sub, notifyMinuteOfDay } of subs) {
		// 時刻ゲート: 指定時は設定スロットに該当するときだけ。
		if (deps.nowMinuteOfDay !== undefined && !matchesNotifySlot(notifyMinuteOfDay, deps.nowMinuteOfDay)) {
			skipped++;
			continue;
		}
		if (sub.lastNotifiedAt !== null && now - sub.lastNotifiedAt < deps.cooldownMs) {
			skipped++;
			continue;
		}
		const names = dueItemNamesForUser(db, sub.userId, now);
		if (names.length === 0) {
			skipped++;
			continue;
		}
		const body =
			names.length <= 3
				? `${names.join('、')} がそろそろ切れます`
				: `${names.slice(0, 3).join('、')} ほか ${names.length - 3} 件がそろそろ切れます`;
		const result = await deps.send(sub, { title: '買い物リマインド', body, url: '/shopping' });
		if (result === 'ok') {
			db.update(pushSubscriptions)
				.set({ lastNotifiedAt: now })
				.where(eq(pushSubscriptions.id, sub.id))
				.run();
			notified++;
		} else if (result === 'gone') {
			db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run();
			removed++;
		} else {
			skipped++;
		}
	}

	return { notified, skipped, removed };
}
