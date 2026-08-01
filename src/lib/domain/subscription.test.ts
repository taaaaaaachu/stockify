import { describe, it, expect } from 'vitest';
import {
	generateDueDeliveries,
	nextDeliveryAfterSkip,
	isAcceptableNextDelivery,
	MAX_BACKFILL
} from './subscription';
import { MS_PER_DAY } from './estimate';
import type { Subscription } from '$lib/types';

const T0 = Date.UTC(2026, 0, 1);
const day = (n: number) => T0 + n * MS_PER_DAY;

const sub = (over: Partial<Subscription> = {}): Subscription => ({
	id: 's',
	itemId: 'item',
	intervalDays: 30,
	nextDeliveryAt: day(0),
	volumePerDelivery: 300,
	quantityPerDelivery: 1,
	paused: false,
	...over
});

describe('generateDueDeliveries', () => {
	it('次回予定日が未来なら何も生成しない', () => {
		const r = generateDueDeliveries(sub({ nextDeliveryAt: day(10) }), day(5));
		expect(r.deliveries).toEqual([]);
		expect(r.nextDeliveryAt).toBe(day(10));
	});

	it('予定日を過ぎた分を古い順に生成し、次回予定日を進める', () => {
		// 0日開始・30日間隔。65日時点で 0/30/60 の 3 回が期限到来。
		const r = generateDueDeliveries(sub({ nextDeliveryAt: day(0) }), day(65));
		expect(r.deliveries.map((d) => d.deliveredAt)).toEqual([day(0), day(30), day(60)]);
		expect(r.nextDeliveryAt).toBe(day(90));
	});

	it('総量は内容量 × 個数', () => {
		const r = generateDueDeliveries(sub({ volumePerDelivery: 300, quantityPerDelivery: 2 }), day(0));
		expect(r.deliveries[0].volume).toBe(600);
	});

	it('一時停止中は生成しない', () => {
		const r = generateDueDeliveries(sub({ paused: true }), day(100));
		expect(r.deliveries).toEqual([]);
		expect(r.nextDeliveryAt).toBe(day(0));
	});

	it('間隔が 0 以下なら生成しない(暴走防止)', () => {
		const r = generateDueDeliveries(sub({ intervalDays: 0 }), day(100));
		expect(r.deliveries).toEqual([]);
	});

	it('ちょうど予定日(now と一致)も生成対象に含む', () => {
		const r = generateDueDeliveries(sub({ nextDeliveryAt: day(0) }), day(0));
		expect(r.deliveries.map((d) => d.deliveredAt)).toEqual([day(0)]);
		expect(r.nextDeliveryAt).toBe(day(30));
	});

	it('長期間開かなくても MAX_BACKFILL で打ち切り、次回予定日は now 以降に追いつく', () => {
		// 1日間隔で 10000 日後まで開かなかった → 生成は MAX_BACKFILL 件で打ち切り。
		const r = generateDueDeliveries(sub({ intervalDays: 1, nextDeliveryAt: day(0) }), day(10000));
		expect(r.deliveries.length).toBe(MAX_BACKFILL);
		expect(r.nextDeliveryAt).toBeGreaterThan(day(10000));
	});
});

describe('nextDeliveryAfterSkip', () => {
	it('次回予定日を 1 間隔ぶん先送りする', () => {
		expect(nextDeliveryAfterSkip(sub({ nextDeliveryAt: day(10), intervalDays: 30 }))).toBe(day(40));
	});

	it('端数の間隔でも 1 間隔ぶんだけ進む', () => {
		expect(nextDeliveryAfterSkip(sub({ nextDeliveryAt: day(10), intervalDays: 0.5 }))).toBe(
			day(10) + 0.5 * MS_PER_DAY
		);
	});
});

describe('isAcceptableNextDelivery', () => {
	// タイムゾーン非依存にするため、判定基準の「今日 0:00」を同じ流儀で組み立てて比較する。
	const now = Date.now();
	const todayStart = (() => {
		const d = new Date(now);
		d.setHours(0, 0, 0, 0);
		return d.getTime();
	})();

	it('今日 0:00 は受け付ける', () => {
		expect(isAcceptableNextDelivery(todayStart, now)).toBe(true);
	});

	it('未来日は受け付ける', () => {
		expect(isAcceptableNextDelivery(todayStart + 5 * MS_PER_DAY, now)).toBe(true);
	});

	it('昨日以前は受け付けない', () => {
		expect(isAcceptableNextDelivery(todayStart - 1, now)).toBe(false);
		expect(isAcceptableNextDelivery(todayStart - 3 * MS_PER_DAY, now)).toBe(false);
	});
});
