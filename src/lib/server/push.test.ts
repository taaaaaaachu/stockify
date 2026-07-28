import { describe, it, expect, beforeEach, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb, type Db } from './db';
import { registerUser } from './households';
import * as stock from './stock';
import {
	saveSubscription,
	deleteSubscription,
	dueItemNamesForUser,
	notifyDueRestocks,
	type SendResult
} from './push';
import { pushSubscriptions } from './db/schema';
import { MS_PER_DAY } from '$lib/domain/estimate';

let db: Db;
let userId: string;
let hh: string;

const T0 = Date.UTC(2026, 0, 1);
const day = (n: number) => T0 + n * MS_PER_DAY;

const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } });

beforeEach(() => {
	db = createDb(':memory:');
	migrate(db, { migrationsFolder: './drizzle' });
	const r = registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false });
	if (!r.ok) throw new Error('setup failed');
	userId = r.user.id;
	hh = r.householdId;
});

describe('購読の保存・解除', () => {
	it('保存し、同一 endpoint は重複しない', () => {
		saveSubscription(db, userId, sub('https://push/1'));
		saveSubscription(db, userId, sub('https://push/1'));
		expect(db.select().from(pushSubscriptions).all()).toHaveLength(1);
	});
	it('解除できる', () => {
		saveSubscription(db, userId, sub('https://push/1'));
		deleteSubscription(db, userId, 'https://push/1');
		expect(db.select().from(pushSubscriptions).all()).toHaveLength(0);
	});
});

describe('dueItemNamesForUser', () => {
	it('購入推奨に達した品目名を集める', () => {
		const item = stock.createItem(db, hh, {
			name: '洗剤',
			unit: 'ml',
			category: null,
			leadTimeDays: null,
			provisionalDaysToDeplete: 30
		});
		stock.createPurchase(db, hh, { itemId: item.id, volume: 300, price: null, purchasedAt: day(0), source: 'manual' });
		// 推奨は 23日目。25日時点では due。
		expect(dueItemNamesForUser(db, userId, day(25))).toEqual(['洗剤']);
		// 10日時点ではまだ十分。
		expect(dueItemNamesForUser(db, userId, day(10))).toEqual([]);
	});
});

describe('notifyDueRestocks', () => {
	function seedDueItem() {
		const item = stock.createItem(db, hh, {
			name: '洗剤',
			unit: 'ml',
			category: null,
			leadTimeDays: null,
			provisionalDaysToDeplete: 30
		});
		stock.createPurchase(db, hh, { itemId: item.id, volume: 300, price: null, purchasedAt: day(0), source: 'manual' });
	}

	it('due な品目があれば送信し lastNotifiedAt を記録する', async () => {
		seedDueItem();
		saveSubscription(db, userId, sub('https://push/1'));
		const send = vi.fn(async (): Promise<SendResult> => 'ok');
		const res = await notifyDueRestocks(db, day(25), { send, cooldownMs: 1000 });
		expect(res.notified).toBe(1);
		expect(send).toHaveBeenCalledOnce();
		const row = db.select().from(pushSubscriptions).all()[0];
		expect(row.lastNotifiedAt).toBe(day(25));
	});

	it('クールダウン内は再送しない', async () => {
		seedDueItem();
		saveSubscription(db, userId, sub('https://push/1'));
		const send = vi.fn(async (): Promise<SendResult> => 'ok');
		await notifyDueRestocks(db, day(25), { send, cooldownMs: MS_PER_DAY });
		const res2 = await notifyDueRestocks(db, day(25) + 1000, { send, cooldownMs: MS_PER_DAY });
		expect(res2.notified).toBe(0);
		expect(send).toHaveBeenCalledOnce();
	});

	it('due が無ければ送信しない', async () => {
		seedDueItem();
		saveSubscription(db, userId, sub('https://push/1'));
		const send = vi.fn(async (): Promise<SendResult> => 'ok');
		const res = await notifyDueRestocks(db, day(10), { send, cooldownMs: 1000 });
		expect(res.notified).toBe(0);
		expect(send).not.toHaveBeenCalled();
	});

	it('失効した購読(gone)は削除する', async () => {
		seedDueItem();
		saveSubscription(db, userId, sub('https://push/1'));
		const send = vi.fn(async (): Promise<SendResult> => 'gone');
		const res = await notifyDueRestocks(db, day(25), { send, cooldownMs: 1000 });
		expect(res.removed).toBe(1);
		expect(db.select().from(pushSubscriptions).all()).toHaveLength(0);
	});
});
