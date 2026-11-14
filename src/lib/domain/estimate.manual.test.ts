import { describe, it, expect } from 'vitest';
import {
	estimate,
	switchNeedsCurrentRemaining,
	walkRemaining,
	MS_PER_DAY,
	type EstimateInput
} from './estimate';
import type { Purchase, RanOutEvent, RemainingAdjustment, UsageEvent } from '#lib/types.js';

// 手動管理モード(ADR 0013)と使用イベントのテスト。推定モードの既存テストは estimate.test.ts。

const T0 = Date.UTC(2026, 0, 1);
const day = (n: number) => T0 + n * MS_PER_DAY;

const purchase = (dayN: number, volume: number, id = `p${dayN}`): Purchase => ({
	id,
	itemId: 'item',
	volume,
	price: null,
	purchasedAt: day(dayN),
	source: 'manual'
});
const ranOut = (dayN: number): RanOutEvent => ({ id: `r${dayN}`, itemId: 'item', at: day(dayN) });
const adjust = (dayN: number, remaining: number): RemainingAdjustment => ({
	id: `a${dayN}`,
	itemId: 'item',
	at: day(dayN),
	remaining
});
const usage = (dayN: number, volume: number, id = `u${dayN}`): UsageEvent => ({
	id,
	itemId: 'item',
	at: day(dayN),
	volume
});

const manualInput = (over: Partial<EstimateInput> = {}): EstimateInput => ({
	provisionalDaysToDeplete: null,
	leadTimeDays: null,
	defaultLeadTimeDays: 7,
	nextSubscriptionDeliveryAt: null,
	purchases: [],
	ranOutEvents: [],
	adjustments: [],
	usageEvents: [],
	trackingMode: 'manual',
	...over
});

describe('手動モードの残量', () => {
	it('購入 10 は 365 日後もちょうど 10(時間減衰なし)', () => {
		const e = estimate(manualInput({ purchases: [purchase(0, 10)] }), day(365));
		expect(e.remaining).toBe(10);
		expect(e.remainingClamped).toBe(10);
	});

	it('使用 3 で 7、さらに使用 20 でも 0 で止まる', () => {
		const purchases = [purchase(0, 10)];
		expect(estimate(manualInput({ purchases, usageEvents: [usage(5, 3)] }), day(10)).remaining).toBe(7);
		const e = estimate(manualInput({ purchases, usageEvents: [usage(5, 3), usage(6, 20)] }), day(10));
		expect(e.remaining).toBe(0);
	});

	it('0 で止まった後の購入はそこから足す(マイナスを持ち越さない)', () => {
		const e = estimate(
			manualInput({ purchases: [purchase(0, 10), purchase(8, 4)], usageEvents: [usage(5, 20)] }),
			day(10)
		);
		expect(e.remaining).toBe(4);
	});

	it('残量補正で 5 にした後に購入 2 で 7', () => {
		const e = estimate(
			manualInput({ purchases: [purchase(0, 10), purchase(20, 2)], adjustments: [adjust(10, 5)] }),
			day(30)
		);
		expect(e.remaining).toBe(7);
	});

	it('使い切りは残量 0 への set として扱う', () => {
		const e = estimate(
			manualInput({ purchases: [purchase(0, 10), purchase(20, 3)], ranOutEvents: [ranOut(10)] }),
			day(30)
		);
		expect(e.remaining).toBe(3);
	});

	it('同時刻は add → sub → set の順(補正が最後に勝つ)', () => {
		const e = estimate(
			manualInput({ purchases: [purchase(5, 10)], usageEvents: [usage(5, 4)], adjustments: [adjust(5, 2)] }),
			day(6)
		);
		expect(e.remaining).toBe(2);
		// 補正なしなら 購入 → 使用 の順で 6。
		const e2 = estimate(manualInput({ purchases: [purchase(5, 10)], usageEvents: [usage(5, 4)] }), day(6));
		expect(e2.remaining).toBe(6);
	});

	it('now より後のイベントは無視する', () => {
		const e = estimate(manualInput({ purchases: [purchase(0, 10)], usageEvents: [usage(20, 3)] }), day(10));
		expect(e.remaining).toBe(10);
	});

	it('イベントが無ければ残量は null', () => {
		expect(estimate(manualInput(), day(10)).remaining).toBeNull();
	});

	it('使用で 0 になったらその時刻を emptyAt にする', () => {
		const walk = walkRemaining(manualInput({ purchases: [purchase(0, 3)], usageEvents: [usage(4, 3)] }), day(10));
		expect(walk?.remaining).toBe(0);
		expect(walk?.emptyAt).toBe(day(4));
	});
});

describe('手動モードは推定値を出さない', () => {
	it('どんな履歴でも ratePerDay / depletionAt / recommendedPurchaseAt が null', () => {
		const histories: Partial<EstimateInput>[] = [
			{},
			{ purchases: [purchase(0, 10)] },
			{ purchases: [purchase(0, 10)], provisionalDaysToDeplete: 30 },
			{ purchases: [purchase(0, 10), purchase(30, 10), purchase(60, 10)] },
			{ purchases: [purchase(0, 10), purchase(30, 10)], ranOutEvents: [ranOut(20), ranOut(50)] },
			{ purchases: [purchase(0, 10)], usageEvents: [usage(1, 20)], adjustments: [adjust(2, 1)] }
		];
		for (const h of histories) {
			const e = estimate(manualInput(h), day(100));
			expect(e.ratePerDay).toBeNull();
			expect(e.depletionAt).toBeNull();
			expect(e.recommendedPurchaseAt).toBeNull();
		}
	});
});

describe('推定モードは使用イベントを無視する', () => {
	it('usageEvents があっても無い場合と同じ推定になる', () => {
		const base = manualInput({
			trackingMode: 'estimated',
			provisionalDaysToDeplete: 30,
			purchases: [purchase(0, 300)]
		});
		const withUsage = { ...base, usageEvents: [usage(5, 100)] };
		expect(estimate(withUsage, day(10))).toEqual(estimate({ ...base, usageEvents: [] }, day(10)));
		// trackingMode 省略も推定モード。
		expect(estimate({ ...base, trackingMode: undefined }, day(10))).toEqual(estimate(base, day(10)));
	});
});

describe('switchNeedsCurrentRemaining', () => {
	it('推定 → 手動のときだけ実残量が要る', () => {
		expect(switchNeedsCurrentRemaining('estimated', 'manual')).toBe(true);
		expect(switchNeedsCurrentRemaining('manual', 'estimated')).toBe(false);
		expect(switchNeedsCurrentRemaining('manual', 'manual')).toBe(false);
		expect(switchNeedsCurrentRemaining('estimated', undefined)).toBe(false);
	});
});
