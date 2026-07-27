import { describe, it, expect, beforeEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb, type Db } from './db';
import { registerUser, createHousehold } from './households';
import * as stock from './stock';
import { MS_PER_DAY } from '$lib/domain/estimate';

let db: Db;
let hhA: string;
let hhB: string;
let userId: string;

const T0 = Date.UTC(2026, 0, 1);
const day = (n: number) => T0 + n * MS_PER_DAY;

const itemInput = (name = '洗剤') => ({
	name,
	unit: 'ml',
	category: null,
	leadTimeDays: null,
	provisionalDaysToDeplete: 30
});

beforeEach(() => {
	db = createDb(':memory:');
	migrate(db, { migrationsFolder: './drizzle' });
	const r = registerUser(db, { username: 'alice', passwordHash: 'x', requireInvite: false, householdName: '自宅' });
	if (!r.ok) throw new Error('setup failed');
	userId = r.user.id;
	hhA = r.householdId;
	hhB = createHousehold(db, '実家', userId).id;
});

describe('品目 CRUD と世帯スコープ', () => {
	it('作成・取得・更新・削除できる', () => {
		const item = stock.createItem(db, hhA, itemInput());
		expect(stock.getItem(db, hhA, item.id)?.name).toBe('洗剤');
		const updated = stock.updateItem(db, hhA, item.id, { name: '柔軟剤' });
		expect(updated?.name).toBe('柔軟剤');
		expect(stock.deleteItem(db, hhA, item.id)).toBe(true);
		expect(stock.getItem(db, hhA, item.id)).toBeNull();
	});

	it('別世帯の品目は見えない・触れない', () => {
		const item = stock.createItem(db, hhA, itemInput());
		expect(stock.listItems(db, hhB)).toHaveLength(0);
		expect(stock.getItem(db, hhB, item.id)).toBeNull();
		expect(stock.updateItem(db, hhB, item.id, { name: 'x' })).toBeNull();
		expect(stock.deleteItem(db, hhB, item.id)).toBe(false);
	});
});

describe('購入と所有チェック', () => {
	it('自世帯の品目にのみ購入を追加できる', () => {
		const item = stock.createItem(db, hhA, itemInput());
		const p = stock.createPurchase(db, hhA, {
			itemId: item.id,
			volume: 300,
			price: 250,
			purchasedAt: day(0),
			source: 'manual'
		});
		expect(p).not.toBeNull();
		// 別世帯からは同じ品目に追加できない
		expect(
			stock.createPurchase(db, hhB, { itemId: item.id, volume: 1, price: null, purchasedAt: 0, source: 'manual' })
		).toBeNull();
	});

	it('別世帯からは購入を削除できない', () => {
		const item = stock.createItem(db, hhA, itemInput());
		const p = stock.createPurchase(db, hhA, { itemId: item.id, volume: 300, price: null, purchasedAt: 0, source: 'manual' })!;
		expect(stock.deletePurchase(db, hhB, p.id)).toBe(false);
		expect(stock.deletePurchase(db, hhA, p.id)).toBe(true);
	});
});

describe('品目削除のカスケード', () => {
	it('品目を消すと配下の購入・定期便も消える', () => {
		const item = stock.createItem(db, hhA, itemInput());
		stock.createPurchase(db, hhA, { itemId: item.id, volume: 300, price: null, purchasedAt: 0, source: 'manual' });
		stock.createSubscription(db, hhA, {
			itemId: item.id,
			intervalDays: 60,
			nextDeliveryAt: day(0),
			volumePerDelivery: 300,
			quantityPerDelivery: 1,
			paused: false
		});
		stock.deleteItem(db, hhA, item.id);
		expect(stock.listBundles(db, hhA)).toHaveLength(0);
	});
});

describe('listBundles', () => {
	it('世帯ごとに品目と配下データをまとめる', () => {
		const a = stock.createItem(db, hhA, itemInput('A'));
		stock.createPurchase(db, hhA, { itemId: a.id, volume: 300, price: null, purchasedAt: 0, source: 'manual' });
		stock.createItem(db, hhB, itemInput('B'));
		const bundlesA = stock.listBundles(db, hhA);
		expect(bundlesA).toHaveLength(1);
		expect(bundlesA[0].purchases).toHaveLength(1);
		expect(stock.listBundles(db, hhB)).toHaveLength(1);
	});
});

describe('materializeDueSubscriptions(サーバー)', () => {
	it('予定日超過分を生成し、次回予定日を進める。冪等', () => {
		const item = stock.createItem(db, hhA, itemInput());
		stock.createSubscription(db, hhA, {
			itemId: item.id,
			intervalDays: 30,
			nextDeliveryAt: day(0),
			volumePerDelivery: 300,
			quantityPerDelivery: 1,
			paused: false
		});
		const r1 = stock.materializeDueSubscriptions(db, hhA, day(65));
		expect(r1.generatedPurchases).toBe(3);
		const r2 = stock.materializeDueSubscriptions(db, hhA, day(65));
		expect(r2.generatedPurchases).toBe(0);
		expect(stock.listPurchases(db, hhA, item.id)).toHaveLength(3);
	});

	it('別世帯の定期便は生成対象にしない', () => {
		const item = stock.createItem(db, hhA, itemInput());
		stock.createSubscription(db, hhA, {
			itemId: item.id,
			intervalDays: 30,
			nextDeliveryAt: day(0),
			volumePerDelivery: 300,
			quantityPerDelivery: 1,
			paused: false
		});
		expect(stock.materializeDueSubscriptions(db, hhB, day(65)).generatedPurchases).toBe(0);
	});
});

describe('importSnapshot', () => {
	it('スナップショットを世帯へ追記し、id を採番し直して親子を維持する', () => {
		const snapshot = {
			settings: { defaultLeadTimeDays: 99 },
			items: [
				{ id: 'old-1', name: '洗剤', unit: 'ml', category: 'キッチン', leadTimeDays: null, provisionalDaysToDeplete: 30 }
			],
			purchases: [{ id: 'p1', itemId: 'old-1', volume: 300, price: 250, purchasedAt: day(0), source: 'manual' as const }],
			ranOutEvents: [{ id: 'r1', itemId: 'old-1', at: day(5) }],
			adjustments: [],
			subscriptions: []
		};
		const res = stock.importSnapshot(db, hhA, snapshot);
		expect(res.items).toBe(1);
		const bundles = stock.listBundles(db, hhA);
		expect(bundles).toHaveLength(1);
		expect(bundles[0].item.id).not.toBe('old-1'); // 採番し直し
		expect(bundles[0].purchases).toHaveLength(1);
		expect(bundles[0].ranOutEvents).toHaveLength(1);
		// 設定は取り込まない(世帯の既定を維持)
		expect(stock.getSettings(db, hhA).defaultLeadTimeDays).toBe(7);
	});
});

describe('settings', () => {
	it('世帯ごとに既定リードタイムを持ち更新できる', () => {
		expect(stock.getSettings(db, hhA).defaultLeadTimeDays).toBe(7);
		stock.updateSettings(db, hhA, { defaultLeadTimeDays: 10 });
		expect(stock.getSettings(db, hhA).defaultLeadTimeDays).toBe(10);
		expect(stock.getSettings(db, hhB).defaultLeadTimeDays).toBe(7); // 別世帯は不変
	});
});
