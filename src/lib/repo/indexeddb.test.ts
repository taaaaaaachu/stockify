import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbRepository } from './indexeddb';
import type { StockItemInput } from './types';

const itemInput = (over: Partial<StockItemInput> = {}): StockItemInput => ({
	name: '食器用洗剤',
	unit: 'ml',
	category: 'キッチン',
	leadTimeDays: null,
	provisionalDaysToDeplete: 30,
	...over
});

describe('IndexedDbRepository', () => {
	beforeEach(() => {
		// 各テストで IndexedDB を作り直して分離する。
		indexedDB = new IDBFactory();
	});

	it('設定は既定値を返し、更新できる', async () => {
		const repo = new IndexedDbRepository();
		expect((await repo.getSettings()).defaultLeadTimeDays).toBe(7);
		await repo.updateSettings({ defaultLeadTimeDays: 10 });
		expect((await repo.getSettings()).defaultLeadTimeDays).toBe(10);
	});

	it('品目を作成・取得・更新・一覧できる', async () => {
		const repo = new IndexedDbRepository();
		const created = await repo.createItem(itemInput());
		expect(created.id).toBeTruthy();
		expect(await repo.getItem(created.id)).toEqual(created);

		const updated = await repo.updateItem(created.id, { name: '柔軟剤' });
		expect(updated.name).toBe('柔軟剤');
		expect((await repo.listItems()).length).toBe(1);
	});

	it('購入を品目ごとに保存し取り出せる', async () => {
		const repo = new IndexedDbRepository();
		const item = await repo.createItem(itemInput());
		await repo.createPurchase({
			itemId: item.id,
			volume: 300,
			price: 250,
			purchasedAt: Date.UTC(2026, 0, 1),
			source: 'manual'
		});
		const purchases = await repo.listPurchases(item.id);
		expect(purchases.length).toBe(1);
		expect(purchases[0].volume).toBe(300);
	});

	it('品目削除で配下の購入・使い切り・補正・定期便もカスケード削除される', async () => {
		const repo = new IndexedDbRepository();
		const item = await repo.createItem(itemInput());
		const other = await repo.createItem(itemInput({ name: '別品目' }));
		await repo.createPurchase({
			itemId: item.id,
			volume: 300,
			price: null,
			purchasedAt: 1,
			source: 'manual'
		});
		await repo.createRanOutEvent({ itemId: item.id, at: 2 });
		await repo.createAdjustment({ itemId: item.id, at: 3, remaining: 100 });
		await repo.createSubscription({
			itemId: item.id,
			intervalDays: 60,
			nextDeliveryAt: 4,
			volumePerDelivery: 300,
			quantityPerDelivery: 1,
			paused: false
		});
		// 別品目にもデータを置き、巻き添え削除されないことを確認する。
		await repo.createPurchase({
			itemId: other.id,
			volume: 500,
			price: null,
			purchasedAt: 5,
			source: 'manual'
		});

		await repo.deleteItem(item.id);

		expect(await repo.getItem(item.id)).toBeNull();
		expect(await repo.listPurchases(item.id)).toEqual([]);
		expect(await repo.listRanOutEvents(item.id)).toEqual([]);
		expect(await repo.listAdjustments(item.id)).toEqual([]);
		expect(await repo.listSubscriptions(item.id)).toEqual([]);
		expect((await repo.listPurchases(other.id)).length).toBe(1);
	});

	it('listBundles は品目ごとに配下データをまとめる', async () => {
		const repo = new IndexedDbRepository();
		const a = await repo.createItem(itemInput({ name: 'A' }));
		const b = await repo.createItem(itemInput({ name: 'B' }));
		await repo.createPurchase({
			itemId: a.id,
			volume: 300,
			price: null,
			purchasedAt: 1,
			source: 'manual'
		});
		await repo.createPurchase({
			itemId: a.id,
			volume: 300,
			price: null,
			purchasedAt: 2,
			source: 'subscription'
		});
		await repo.createPurchase({
			itemId: b.id,
			volume: 500,
			price: null,
			purchasedAt: 3,
			source: 'manual'
		});

		const bundles = await repo.listBundles();
		const bundleA = bundles.find((x) => x.item.id === a.id)!;
		const bundleB = bundles.find((x) => x.item.id === b.id)!;
		expect(bundleA.purchases.length).toBe(2);
		expect(bundleB.purchases.length).toBe(1);
	});

	it('exportAll は全データのスナップショットを返す', async () => {
		const repo = new IndexedDbRepository();
		const item = await repo.createItem(itemInput());
		await repo.createPurchase({
			itemId: item.id,
			volume: 300,
			price: null,
			purchasedAt: 1,
			source: 'manual'
		});
		const snap = await repo.exportAll();
		expect(snap.items.length).toBe(1);
		expect(snap.purchases.length).toBe(1);
		expect(snap.settings.defaultLeadTimeDays).toBe(7);
	});
});
