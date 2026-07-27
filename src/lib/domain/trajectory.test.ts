import { describe, it, expect } from 'vitest';
import { remainingTrajectory } from './trajectory';
import { MS_PER_DAY, type EstimateInput } from './estimate';
import type { Purchase } from '$lib/types';

const T0 = Date.UTC(2026, 0, 1);
const day = (n: number) => T0 + n * MS_PER_DAY;

const purchase = (dayN: number, volume: number): Purchase => ({
	id: `p${dayN}`,
	itemId: 'i',
	volume,
	price: null,
	purchasedAt: day(dayN),
	source: 'manual'
});

const input = (over: Partial<EstimateInput> = {}): EstimateInput => ({
	provisionalDaysToDeplete: null,
	leadTimeDays: null,
	defaultLeadTimeDays: 7,
	hasActiveSubscription: false,
	purchases: [],
	ranOutEvents: [],
	adjustments: [],
	...over
});

describe('remainingTrajectory', () => {
	it('イベントが無ければ空', () => {
		expect(remainingTrajectory(input(), day(10))).toEqual([]);
	});

	it('購入で積み増し、レートで線形に減る', () => {
		// 0日400, 40日400 → rate = (800-400)/40 = 10ml/day
		const pts = remainingTrajectory(
			input({ purchases: [purchase(0, 400), purchase(40, 400)] }),
			day(40)
		);
		// 0日: 直前0 → 直後400
		expect(pts[0]).toEqual({ t: day(0), remaining: 0 });
		expect(pts[1]).toEqual({ t: day(0), remaining: 400 });
		// 40日直前: 400 - 10*40 = 0、直後: +400 = 400
		expect(pts[2].remaining).toBeCloseTo(0, 6);
		expect(pts[3].remaining).toBeCloseTo(400, 6);
	});

	it('使い切りイベントで 0 にリセットされる', () => {
		const pts = remainingTrajectory(
			input({
				purchases: [purchase(0, 300), purchase(20, 300)],
				ranOutEvents: [{ id: 'r', itemId: 'i', at: day(15) }]
			}),
			day(20)
		);
		// 15日の set(0) 直後に remaining=0 の点があるはず
		const atRanOut = pts.filter((p) => p.t === day(15));
		expect(atRanOut.at(-1)?.remaining).toBe(0);
	});

	it('残量は 0 未満にならない', () => {
		const pts = remainingTrajectory(
			input({ purchases: [purchase(0, 100)], provisionalDaysToDeplete: 10 }), // 10ml/day
			day(30) // 100を10日で使い切り、以降は0のまま
		);
		expect(Math.min(...pts.map((p) => p.remaining))).toBeGreaterThanOrEqual(0);
		expect(pts.at(-1)?.remaining).toBe(0);
	});
});
