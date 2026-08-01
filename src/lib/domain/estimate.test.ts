import { describe, it, expect } from 'vitest';
import {
	consumptionRatePerDay,
	estimate,
	weightedRatePerDay,
	MS_PER_DAY,
	type EstimateInput,
	type RateInterval
} from './estimate';
import type { Purchase, RanOutEvent, RemainingAdjustment } from '$lib/types';

// テスト用の基準日時(2026-01-01T00:00:00Z)。
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

const ranOut = (dayN: number, id = `r${dayN}`): RanOutEvent => ({
	id,
	itemId: 'item',
	at: day(dayN)
});

const adjust = (dayN: number, remaining: number, id = `a${dayN}`): RemainingAdjustment => ({
	id,
	itemId: 'item',
	at: day(dayN),
	remaining
});

const baseInput = (over: Partial<EstimateInput> = {}): EstimateInput => ({
	provisionalDaysToDeplete: null,
	leadTimeDays: null,
	defaultLeadTimeDays: 7,
	nextSubscriptionDeliveryAt: null,
	purchases: [],
	ranOutEvents: [],
	adjustments: [],
	...over
});

describe('consumptionRatePerDay', () => {
	it('データが無ければ null', () => {
		expect(consumptionRatePerDay(baseInput())).toBeNull();
	});

	it('購入 1 件のみで仮の値が無ければ null', () => {
		expect(consumptionRatePerDay(baseInput({ purchases: [purchase(0, 300)] }))).toBeNull();
	});

	it('仮の値: 初回内容量 ÷ 想定日数', () => {
		const input = baseInput({
			purchases: [purchase(0, 300)],
			provisionalDaysToDeplete: 30
		});
		// 300ml を 30 日 → 10ml/day
		expect(consumptionRatePerDay(input)).toBeCloseTo(10, 10);
	});

	it('長期平均: (累計 − 直近) ÷ (初回〜直近)', () => {
		// 0日:400, 40日:400, 80日:400 を購入。累計1200 − 直近400 = 800 を 80 日で消費 → 10ml/day
		const input = baseInput({
			purchases: [purchase(0, 400), purchase(40, 400), purchase(80, 400)]
		});
		expect(consumptionRatePerDay(input)).toBeCloseTo(10, 10);
	});

	it('長期平均は購入間隔のブレを平均化する(早買いでも過大評価しない)', () => {
		// 実際の消費は 10ml/day。40日ごとに 400ml 使い切るが、毎回 10 日早く買い足す。
		// 購入: 0, 30, 60, 120(最後だけ長め)… ではなく等間隔でも一貫することを確認。
		const input = baseInput({
			purchases: [purchase(0, 400), purchase(40, 400), purchase(80, 400), purchase(120, 400)]
		});
		// (1600 − 400) / 120 = 10
		expect(consumptionRatePerDay(input)).toBeCloseTo(10, 10);
	});

	it('仮の値より購入履歴(長期平均)が優先される', () => {
		const input = baseInput({
			purchases: [purchase(0, 400), purchase(40, 400), purchase(80, 400)],
			provisionalDaysToDeplete: 5 // 仮の値なら 80ml/day になるが無視される
		});
		expect(consumptionRatePerDay(input)).toBeCloseTo(10, 10);
	});

	it('使い切りイベント 2 件が最優先(空〜空の総購入量 ÷ 期間)', () => {
		// 10日で空 → 20日で再度空。その間(10<t<=20)に 500ml 購入 → 500/10 = 50ml/day
		const input = baseInput({
			purchases: [purchase(0, 500), purchase(12, 500)],
			ranOutEvents: [ranOut(10), ranOut(20)]
		});
		expect(consumptionRatePerDay(input)).toBeCloseTo(50, 10);
	});

	it('ごく短時間の2購入(期間 < 1日)ではレートが爆発せず仮の値へ落ちる', () => {
		// 同日にほぼ同時刻の2購入。長期平均だと極小時間で割って爆発する。
		const input = baseInput({
			purchases: [purchase(0, 500), { ...purchase(0, 500, 'p2'), purchasedAt: day(0) + 60_000 }],
			provisionalDaysToDeplete: 20
		});
		// 仮の値 500/20 = 25 を採用(爆発した巨大値にならない)。
		expect(consumptionRatePerDay(input)).toBeCloseTo(25, 6);
	});

	it('1日以上離れた2購入なら長期平均を採用する', () => {
		const input = baseInput({
			purchases: [purchase(0, 500), purchase(2, 500)],
			provisionalDaysToDeplete: 20
		});
		// (1000 − 500) / 2日 = 250/日
		expect(consumptionRatePerDay(input)).toBeCloseTo(250, 6);
	});

	it('内容量 0 の初回では仮の値を採らず null', () => {
		const input = baseInput({
			purchases: [purchase(0, 0)],
			provisionalDaysToDeplete: 30
		});
		expect(consumptionRatePerDay(input)).toBeNull();
	});

	it('直近の消費増(倍増)に、素朴な平均より速く追従する(recency 減衰)', () => {
		// 前半 3 サイクル=30日/300ml(10ml/day)、後半 3 サイクル=15日/300ml(20ml/day)。
		const ranOutEvents = [0, 30, 60, 90, 105, 120, 135].map((d) => ranOut(d));
		const purchases = [30, 60, 90, 105, 120, 135].map((d) => purchase(d, 300));
		const rate = consumptionRatePerDay(baseInput({ purchases, ranOutEvents }));
		// 素朴な等重み平均は 1800/135 = 13.33。減衰(H=3)は直近の 20 側へ寄って ≈15。
		expect(rate).not.toBeNull();
		expect(rate!).toBeGreaterThan(13.34); // 等重み平均より必ず上(直近を重く見る)
		expect(rate!).toBeLessThan(20); // ただし急には飛びつかない
		expect(rate!).toBeCloseTo(15.0, 1);
	});
});

describe('weightedRatePerDay: recency 加重', () => {
	const twoRates: RateInterval[] = [
		{ days: 30, volume: 300 }, // 古い区間: 10ml/day
		{ days: 15, volume: 300 } // 新しい区間: 20ml/day
	];

	it('単一区間はそのままレートを返す', () => {
		expect(weightedRatePerDay([{ days: 20, volume: 500 }], 3)).toBeCloseTo(25, 10);
	});

	it('半減期 ∞ は素朴な長期平均(Σvolume/Σdays)に一致する', () => {
		// (300+300)/(30+15) = 13.333…
		expect(weightedRatePerDay(twoRates, Infinity)).toBeCloseTo(600 / 45, 10);
	});

	it('半減期が短いほど最新区間のレート(20)へ寄る(単調)', () => {
		const inf = weightedRatePerDay(twoRates, Infinity)!;
		const h3 = weightedRatePerDay(twoRates, 3)!;
		const h1 = weightedRatePerDay(twoRates, 1)!;
		expect(h3).toBeGreaterThan(inf);
		expect(h1).toBeGreaterThan(h3);
		expect(h1).toBeLessThan(20); // 最新区間の値は超えない
	});

	it('全区間が同じレートなら半減期に依らず一定', () => {
		const same: RateInterval[] = [
			{ days: 30, volume: 300 },
			{ days: 60, volume: 600 }
		]; // どちらも 10ml/day
		expect(weightedRatePerDay(same, 2)).toBeCloseTo(10, 10);
		expect(weightedRatePerDay(same, Infinity)).toBeCloseTo(10, 10);
	});

	it('加重消費量が 0(全区間 volume 0)なら null', () => {
		expect(weightedRatePerDay([{ days: 30, volume: 0 }], 3)).toBeNull();
	});
});

describe('estimate: 残量', () => {
	it('データが無ければ残量 null', () => {
		const e = estimate(baseInput(), day(10));
		expect(e.remaining).toBeNull();
		expect(e.remainingClamped).toBeNull();
		expect(e.depletionAt).toBeNull();
	});

	it('仮の値ベース: 初回購入からの経過で目減りする', () => {
		const input = baseInput({
			purchases: [purchase(0, 300)],
			provisionalDaysToDeplete: 30 // 10ml/day
		});
		// 10 日後 → 300 − 10*10 = 200
		const e = estimate(input, day(10));
		expect(e.remaining).toBeCloseTo(200, 10);
		expect(e.remainingClamped).toBeCloseTo(200, 10);
	});

	it('複数購入は入った総量から消費を引く(タンクモデル)', () => {
		const input = baseInput({
			purchases: [purchase(0, 400), purchase(40, 400), purchase(80, 400)] // rate 10ml/day
		});
		// 80 日時点: 総投入 1200 − 10*80 = 400
		const e = estimate(input, day(80));
		expect(e.remaining).toBeCloseTo(400, 10);
	});

	it('残量が予想を超えて減ると負値になり、クランプ版は 0', () => {
		const input = baseInput({
			purchases: [purchase(0, 300)],
			provisionalDaysToDeplete: 30 // 10ml/day
		});
		// 40 日後 → 300 − 400 = −100
		const e = estimate(input, day(40));
		expect(e.remaining).toBeCloseTo(-100, 10);
		expect(e.remainingClamped).toBe(0);
	});

	it('使い切りイベントを基準に残量がリセットされる', () => {
		// 購入: 0/30/60日 各300(等間隔=レート10ml/day、減衰の有無に依らず一定)。使い切り1件。
		const input = baseInput({
			purchases: [purchase(0, 300), purchase(30, 300), purchase(60, 300)],
			ranOutEvents: [ranOut(20)]
		});
		// 基準 = 20日で残量0。以降(20<t<=70)の購入: 30日(300)+60日(300)=600 投入。
		// 70日時点: 0 + 600 − 10*(70−20) = 600 − 500 = 100
		const e = estimate(input, day(70));
		expect(e.remaining).toBeCloseTo(100, 10);
	});

	it('残量補正が最新なら実測値を原点にする', () => {
		const input = baseInput({
			purchases: [purchase(0, 400), purchase(40, 400)], // rate 10ml/day
			adjustments: [adjust(50, 250)]
		});
		// 基準 = 50日で残量250。以降購入なし。60日 → 250 − 10*10 = 150
		const e = estimate(input, day(60));
		expect(e.remaining).toBeCloseTo(150, 10);
	});

	it('補正と使い切りは新しい方を基準にする', () => {
		const input = baseInput({
			purchases: [purchase(0, 400), purchase(40, 400)],
			adjustments: [adjust(45, 999)], // 古い
			ranOutEvents: [ranOut(55)] // こちらが新しい → 残量0基準
		});
		// 60日 → 0 − 10*5 = −50(枯渇済み)
		const e = estimate(input, day(60));
		expect(e.remaining).toBeCloseTo(-50, 10);
		expect(e.remainingClamped).toBe(0);
	});
});

describe('estimate: 枯渇予想日・購入推奨日', () => {
	it('枯渇予想日 = now + 残量/レート', () => {
		const input = baseInput({
			purchases: [purchase(0, 300)],
			provisionalDaysToDeplete: 30 // 10ml/day
		});
		// 10日時点で残量200 → あと20日で枯渇 = 30日目
		const e = estimate(input, day(10));
		expect(e.depletionAt).toBeCloseTo(day(30), -1);
	});

	it('購入推奨日 = 枯渇予想日 − 既定リードタイム', () => {
		const input = baseInput({
			purchases: [purchase(0, 300)],
			provisionalDaysToDeplete: 30, // 10ml/day
			defaultLeadTimeDays: 7
		});
		// 枯渇30日目 − 7日 = 23日目
		const e = estimate(input, day(10));
		expect(e.recommendedPurchaseAt).toBeCloseTo(day(23), -1);
	});

	it('品目固有リードタイムが既定を上書きする', () => {
		const input = baseInput({
			purchases: [purchase(0, 300)],
			provisionalDaysToDeplete: 30,
			defaultLeadTimeDays: 7,
			leadTimeDays: 3
		});
		// 枯渇30日目 − 3日 = 27日目
		const e = estimate(input, day(10));
		expect(e.recommendedPurchaseAt).toBeCloseTo(day(27), -1);
	});

	it('次回配送が枯渇予想日までに届くなら購入推奨日を出さない', () => {
		const input = baseInput({
			purchases: [purchase(0, 300)],
			provisionalDaysToDeplete: 30, // 枯渇30日目
			nextSubscriptionDeliveryAt: day(25) // 枯渇前に届く
		});
		const e = estimate(input, day(10));
		expect(e.depletionAt).not.toBeNull();
		expect(e.recommendedPurchaseAt).toBeNull();
	});

	it('次回配送が枯渇予想日より後なら購入推奨日を出す(スキップ等で補充が間に合わない)', () => {
		const input = baseInput({
			purchases: [purchase(0, 300)],
			provisionalDaysToDeplete: 30, // 枯渇30日目
			defaultLeadTimeDays: 7,
			nextSubscriptionDeliveryAt: day(45) // 枯渇に間に合わない
		});
		const e = estimate(input, day(10));
		// 定期便があっても間に合わないので通常どおり 23日目
		expect(e.recommendedPurchaseAt).toBeCloseTo(day(23), -1);
	});

	it('レートが出せなければ枯渇・推奨日とも null', () => {
		const input = baseInput({ purchases: [purchase(0, 300)] });
		const e = estimate(input, day(10));
		expect(e.depletionAt).toBeNull();
		expect(e.recommendedPurchaseAt).toBeNull();
	});
});
