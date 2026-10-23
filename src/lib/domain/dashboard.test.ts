import { describe, it, expect } from 'vitest';
import { buildDashboard, buildRow, shoppingList } from './dashboard';
import { MS_PER_DAY } from './estimate';
import type { AppSettings, ItemBundle } from '#lib/repo/types.js';
import type { Purchase, StockItem, Subscription } from '#lib/types.js';

const T0 = Date.UTC(2026, 0, 1);
const day = (n: number) => T0 + n * MS_PER_DAY;

const settings: AppSettings = { defaultLeadTimeDays: 7 };

const item = (over: Partial<StockItem> = {}): StockItem => ({
	id: 'i',
	name: '品目',
	unit: 'ml',
	category: null,
	leadTimeDays: null,
	provisionalDaysToDeplete: null,
	...over
});

const purchase = (dayN: number, volume: number, itemId = 'i'): Purchase => ({
	id: `p${dayN}`,
	itemId,
	volume,
	price: null,
	purchasedAt: day(dayN),
	source: 'manual'
});

const bundle = (over: Partial<ItemBundle> = {}): ItemBundle => ({
	item: item(),
	purchases: [],
	ranOutEvents: [],
	adjustments: [],
	subscriptions: [],
	...over
});

describe('buildRow: 状態判定', () => {
	it('レートが出せなければ unknown', () => {
		const row = buildRow(bundle({ purchases: [purchase(0, 300)] }), settings, day(10));
		expect(row.status).toBe('unknown');
		expect(row.estimate.ratePerDay).toBeNull();
	});

	it('残量が十分なら ok', () => {
		const b = bundle({
			item: item({ provisionalDaysToDeplete: 30 }),
			purchases: [purchase(0, 300)] // 10ml/day、枯渇30日目、推奨23日目
		});
		const row = buildRow(b, settings, day(10));
		expect(row.status).toBe('ok');
	});

	it('購入推奨日を過ぎたら restock', () => {
		const b = bundle({
			item: item({ provisionalDaysToDeplete: 30 }),
			purchases: [purchase(0, 300)] // 推奨23日目
		});
		const row = buildRow(b, settings, day(25));
		expect(row.status).toBe('restock');
	});

	it('残量が尽きたら depleted', () => {
		const b = bundle({
			item: item({ provisionalDaysToDeplete: 30 }),
			purchases: [purchase(0, 300)] // 枯渇30日目
		});
		const row = buildRow(b, settings, day(35));
		expect(row.status).toBe('depleted');
	});

	const sub = (over: Partial<Subscription> = {}): Subscription => ({
		id: 's',
		itemId: 'i',
		intervalDays: 30,
		nextDeliveryAt: day(28),
		volumePerDelivery: 300,
		quantityPerDelivery: 1,
		paused: false,
		...over
	});

	it('次回配送が枯渇前に届く定期便品目は購入推奨対象外で ok 扱い', () => {
		const b = bundle({
			item: item({ provisionalDaysToDeplete: 30 }), // 枯渇30日目
			purchases: [purchase(0, 300)],
			subscriptions: [sub({ nextDeliveryAt: day(28) })] // 枯渇前に届く
		});
		const row = buildRow(b, settings, day(25));
		expect(row.hasActiveSubscription).toBe(true);
		expect(row.estimate.recommendedPurchaseAt).toBeNull();
		expect(row.status).toBe('ok');
	});

	it('定期便があっても次回配送が枯渇に間に合わなければ restock(スキップ等)', () => {
		const b = bundle({
			item: item({ provisionalDaysToDeplete: 30 }), // 枯渇30日目
			purchases: [purchase(0, 300)],
			subscriptions: [sub({ nextDeliveryAt: day(45) })] // スキップで枯渇の先へ
		});
		const row = buildRow(b, settings, day(25));
		expect(row.hasActiveSubscription).toBe(true);
		expect(row.estimate.recommendedPurchaseAt).not.toBeNull();
		expect(row.status).toBe('restock');
	});

	it('一時停止中の定期便は補充とみなさない(購入推奨が出る)', () => {
		const b = bundle({
			item: item({ provisionalDaysToDeplete: 30 }),
			purchases: [purchase(0, 300)],
			subscriptions: [sub({ nextDeliveryAt: day(28), paused: true })]
		});
		const row = buildRow(b, settings, day(25));
		expect(row.hasActiveSubscription).toBe(false);
		expect(row.status).toBe('restock');
	});
});

describe('buildDashboard: 並び順', () => {
	it('枯渇が近い順に並び、推定不能は末尾', () => {
		const soon = bundle({
			item: item({ id: 'soon', name: 'soon', provisionalDaysToDeplete: 10 }),
			purchases: [{ ...purchase(0, 100, 'soon'), id: 'ps' }] // 10ml/day、枯渇10日目
		});
		const later = bundle({
			item: item({ id: 'later', name: 'later', provisionalDaysToDeplete: 100 }),
			purchases: [{ ...purchase(0, 100, 'later'), id: 'pl' }] // 1ml/day、枯渇100日目
		});
		const unknown = bundle({
			item: item({ id: 'unknown', name: 'unknown' }),
			purchases: [{ ...purchase(0, 100, 'unknown'), id: 'pu' }] // レート不能
		});

		const rows = buildDashboard([later, unknown, soon], settings, day(0));
		expect(rows.map((r) => r.item.id)).toEqual(['soon', 'later', 'unknown']);
	});
});

describe('shoppingList', () => {
	it('restock/depleted かつ定期便なしの品目だけ集める', () => {
		const restock = bundle({
			item: item({ id: 'restock', name: 'restock', provisionalDaysToDeplete: 30 }),
			purchases: [{ ...purchase(0, 300, 'restock'), id: 'pr' }]
		});
		const ok = bundle({
			item: item({ id: 'ok', name: 'ok', provisionalDaysToDeplete: 100 }),
			purchases: [{ ...purchase(0, 300, 'ok'), id: 'po' }]
		});
		const rows = buildDashboard([restock, ok], settings, day(25));
		const list = shoppingList(rows);
		expect(list.map((r) => r.item.id)).toEqual(['restock']);
	});

	it('次回配送が間に合う定期便品目は除外、間に合わない品目は載る', () => {
		const covered = bundle({
			item: item({ id: 'covered', name: 'covered', provisionalDaysToDeplete: 30 }),
			purchases: [{ ...purchase(0, 300, 'covered'), id: 'pc' }],
			subscriptions: [
				{
					id: 'sc',
					itemId: 'covered',
					intervalDays: 30,
					nextDeliveryAt: day(28), // 枯渇30日前に届く
					volumePerDelivery: 300,
					quantityPerDelivery: 1,
					paused: false
				}
			]
		});
		const uncovered = bundle({
			item: item({ id: 'uncovered', name: 'uncovered', provisionalDaysToDeplete: 30 }),
			purchases: [{ ...purchase(0, 300, 'uncovered'), id: 'pu' }],
			subscriptions: [
				{
					id: 'su',
					itemId: 'uncovered',
					intervalDays: 30,
					nextDeliveryAt: day(45), // 枯渇に間に合わない(スキップ相当)
					volumePerDelivery: 300,
					quantityPerDelivery: 1,
					paused: false
				}
			]
		});
		const list = shoppingList(buildDashboard([covered, uncovered], settings, day(25)));
		expect(list.map((r) => r.item.id)).toEqual(['uncovered']);
	});
});
