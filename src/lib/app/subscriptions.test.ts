import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbRepository } from '$lib/repo/indexeddb';
import { materializeDueSubscriptions } from './subscriptions';
import { MS_PER_DAY } from '$lib/domain/estimate';

const T0 = Date.UTC(2026, 0, 1);
const day = (n: number) => T0 + n * MS_PER_DAY;

describe('materializeDueSubscriptions', () => {
	beforeEach(() => {
		indexedDB = new IDBFactory();
	});

	it('予定日超過分の購入を生成し、次回予定日を更新する', async () => {
		const repo = new IndexedDbRepository();
		const item = await repo.createItem({
			name: '洗剤',
			unit: 'ml',
			category: null,
			leadTimeDays: null,
			provisionalDaysToDeplete: null
		});
		await repo.createSubscription({
			itemId: item.id,
			intervalDays: 30,
			nextDeliveryAt: day(0),
			volumePerDelivery: 300,
			quantityPerDelivery: 1,
			paused: false
		});

		// 65日時点 → 0/30/60 の 3 回生成、次回は 90日。
		const result = await materializeDueSubscriptions(repo, day(65));
		expect(result.generatedPurchases).toBe(3);
		expect(result.updatedSubscriptions).toBe(1);

		const purchases = await repo.listPurchases(item.id);
		expect(purchases.length).toBe(3);
		expect(purchases.every((p) => p.source === 'subscription')).toBe(true);

		const [sub] = await repo.listSubscriptions(item.id);
		expect(sub.nextDeliveryAt).toBe(day(90));
	});

	it('冪等: 生成後に再実行しても重複生成しない', async () => {
		const repo = new IndexedDbRepository();
		const item = await repo.createItem({
			name: '洗剤',
			unit: 'ml',
			category: null,
			leadTimeDays: null,
			provisionalDaysToDeplete: null
		});
		await repo.createSubscription({
			itemId: item.id,
			intervalDays: 30,
			nextDeliveryAt: day(0),
			volumePerDelivery: 300,
			quantityPerDelivery: 1,
			paused: false
		});

		await materializeDueSubscriptions(repo, day(65));
		const again = await materializeDueSubscriptions(repo, day(65));
		expect(again.generatedPurchases).toBe(0);
		expect((await repo.listPurchases(item.id)).length).toBe(3);
	});

	it('一時停止中の定期便は生成しない', async () => {
		const repo = new IndexedDbRepository();
		const item = await repo.createItem({
			name: '洗剤',
			unit: 'ml',
			category: null,
			leadTimeDays: null,
			provisionalDaysToDeplete: null
		});
		await repo.createSubscription({
			itemId: item.id,
			intervalDays: 30,
			nextDeliveryAt: day(0),
			volumePerDelivery: 300,
			quantityPerDelivery: 1,
			paused: true
		});
		const result = await materializeDueSubscriptions(repo, day(100));
		expect(result.generatedPurchases).toBe(0);
	});
});
