import type { Purchase, RanOutEvent, RemainingAdjustment, StockItem } from '#lib/types.js';

/** 1 日のミリ秒数。 */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 履歴からレートを逆算するのに必要な最小の観測期間(日)。
 * これ未満しか離れていない購入/使い切りは、消費レートの情報を持たないとみなし
 * (作成直後のまとめ買い等)、仮の値へフォールバックする。
 */
export const MIN_SPAN_DAYS = 1;

/** 推定に必要な、ある品目のスナップショット。 */
export interface EstimateInput {
	/** 仮の値(初回内容量を約 N 日で使い切る)。null なら未設定。 */
	provisionalDaysToDeplete: number | null;
	/** 品目固有のリードタイム(日)。null なら既定値を使う。 */
	leadTimeDays: number | null;
	/** 全体既定のリードタイム(日)。 */
	defaultLeadTimeDays: number;
	/**
	 * アクティブな定期便のうち最も早い次回配送日(epoch ミリ秒)。定期便が無ければ null。
	 * この配送が枯渇予想日までに届くなら、自動補充される前提で購入推奨を出さない(ADR 0002 改訂)。
	 */
	nextSubscriptionDeliveryAt: number | null;
	purchases: Purchase[];
	ranOutEvents: RanOutEvent[];
	adjustments: RemainingAdjustment[];
}

/** 推定結果。データ不足で決まらない項目は null。 */
export interface Estimate {
	/** 1 日あたりの消費量(volume/day)。推定不能なら null。 */
	ratePerDay: number | null;
	/** 現在の推定残量(単位量、0 以上)。null は推定不能。 */
	remaining: number | null;
	/** 表示用の残量。ウォーク方式で残量は 0 未満にならないため remaining と同値(互換のため残す)。 */
	remainingClamped: number | null;
	/** 枯渇予想日時(epoch ミリ秒)。既に枯渇なら残量が 0 になった時刻(now 以下)。null は推定不能。 */
	depletionAt: number | null;
	/** 購入推奨日時(epoch ミリ秒)= 枯渇予想 − リードタイム。定期便有効時や推定不能時は null。 */
	recommendedPurchaseAt: number | null;
}

function byTimeAsc<T extends { purchasedAt?: number; at?: number }>(getTime: (x: T) => number) {
	return (a: T, b: T) => getTime(a) - getTime(b);
}

function sumVolume(purchases: Purchase[], predicate: (p: Purchase) => boolean): number {
	let total = 0;
	for (const p of purchases) {
		if (predicate(p)) total += p.volume;
	}
	return total;
}

/**
 * 消費レート推定の recency 減衰の半減期(サイクル数)。
 * 「H サイクル前の観測は重みが半分」。∞ にすると等重み(=素朴な長期平均)に一致する。
 * 3 は、生活の変化への追従とノイズ耐性のバランスが最も良い点(ADR 0001 のプロトタイプで確認)。
 */
export const RATE_HALFLIFE_CYCLES = 3;

/**
 * 購入区間の品質重み(使い切り区間 = 1 に対する相対値)。
 * 使い切り(空→空)は消費の確定サンプルなので重み 1、購入間隔は「買った分が次までに使い切られた」
 * という定常近似にすぎないため 0.5(=半分の信頼度)。統合プールで両者を混ぜるときに効く(ADR 0001 改訂)。
 */
export const PURCHASE_QUALITY = 0.5;

/**
 * 購入区間がフル信頼になる長さ(日)。これ未満は日数に比例して線形に割り引く(lengthTrust)。
 * 在庫が十分あるうちの買い足し(安売り・配達都合・記録日のズレ)でも購入区間は短くなり、
 * 「速く消費した」という誤った観測になるため。1 週間あれば生活のリズム 1 周分として信頼する。
 */
export const TRUST_FULL_DAYS = 7;

/** 購入区間の長さによる信頼度(0〜1)。TRUST_FULL_DAYS 以上で 1。 */
export function lengthTrust(days: number): number {
	return Math.min(1, days / TRUST_FULL_DAYS);
}

/** 1 区間(前の基準から次の基準まで)の観測: その間に消費した量・経過日数・信頼度。 */
export interface RateInterval {
	days: number;
	volume: number;
	/** 信頼度(省略時 1)。使い切り区間 = 1、購入区間 = PURCHASE_QUALITY。 */
	quality?: number;
}

/**
 * 区間列(古い順)から、直近ほど重い指数減衰 × 区間の信頼度で加重した消費レート(volume/日)を求める。
 *   rate = Σ qᵢ·wᵢ·volumeᵢ / Σ qᵢ·wᵢ·daysᵢ,  wᵢ = 0.5^(何区間前か / halfLifeCycles), qᵢ = quality
 * 最新区間を age 0 とする。halfLifeCycles = Infinity かつ quality 一律なら素朴な長期平均に一致。
 * 加重期間・加重消費量がともに正のときだけ値を返し、そうでなければ null。
 */
export function weightedRatePerDay(intervals: RateInterval[], halfLifeCycles: number): number | null {
	const newest = intervals.length - 1;
	let weightedVolume = 0;
	let weightedDays = 0;
	for (let i = 0; i <= newest; i++) {
		const age = newest - i;
		const decay = halfLifeCycles === Infinity ? 1 : Math.pow(0.5, age / halfLifeCycles);
		const w = decay * (intervals[i].quality ?? 1);
		weightedVolume += w * intervals[i].volume;
		weightedDays += w * intervals[i].days;
	}
	if (weightedDays <= 0 || weightedVolume <= 0) return null;
	return weightedVolume / weightedDays;
}

/** 同一時刻の購入をまとめる(購入間隔の分解でゼロ幅区間を作らないため)。 */
function coalescePurchasesByTime(purchasesAsc: Purchase[]): { at: number; volume: number }[] {
	const byTime = new Map<number, number>();
	for (const p of purchasesAsc) {
		byTime.set(p.purchasedAt, (byTime.get(p.purchasedAt) ?? 0) + p.volume);
	}
	return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([at, volume]) => ({ at, volume }));
}

/**
 * 時刻順の購入イベント列から購入区間の観測を作る。
 * 区間 i の消費 ≈ その区間の始点で買った量(最新購入分は未消費なので区間の元にしない)。
 */
function purchaseIntervals(
	events: { at: number; volume: number }[],
	quality: number
): RateInterval[] {
	const intervals: RateInterval[] = [];
	for (let i = 0; i < events.length - 1; i++) {
		const days = (events[i + 1].at - events[i].at) / MS_PER_DAY;
		if (days <= 0) continue; // 同時刻は coalesce 済みだが念のため
		// 短い区間ほど買い足しの可能性が高いので信頼度を下げる(使い切り区間には掛けない)。
		intervals.push({ days, volume: events[i].volume, quality: quality * lengthTrust(days) });
	}
	return intervals;
}

/**
 * 消費レート(volume/day)を推定する。
 *
 * 優先順位(ADR 0001):
 *  1. 使い切りイベントが 2 件以上 → 空〜空の各区間(信頼度 1)に、
 *     「最後の使い切り以降の購入区間」(信頼度 PURCHASE_QUALITY)を足した統合プールを加重平均。
 *     使い切りが確定サンプルとして支配しつつ、使い切りが古くなると最近の購入ペースが効いてくる。
 *  2. 使い切りが 1 件以下 → 購入間隔だけで加重平均。
 *  3. 仮の値 → 初回内容量 ÷ 想定日数。
 *
 * 1・2 とも複数の区間観測を、直近ほど重い指数減衰 × 区間の信頼度で加重平均する
 * (halfLifeCycles = ∞ かつ信頼度一律なら素朴な長期平均に一致)。これにより、購入を重ねるほど
 * 精度が上がりつつ、生活の変化には数サイクルで追従し、大昔のパターンは自然に薄れる。
 * どの手段も使えなければ null。
 */
export function consumptionRatePerDay(input: EstimateInput): number | null {
	const purchases = [...input.purchases].sort(byTimeAsc((p) => p.purchasedAt));
	const ranOuts = [...input.ranOutEvents].sort(byTimeAsc((e) => e.at));
	const events = coalescePurchasesByTime(purchases);

	// 1. 使い切り区間 + 最後の使い切り以降の購入区間(tail)を1プールに統合して加重平均。
	const ranOutTimes = [...new Set(ranOuts.map((e) => e.at))].sort((a, b) => a - b);
	if (ranOutTimes.length >= 2) {
		const span = (ranOutTimes[ranOutTimes.length - 1] - ranOutTimes[0]) / MS_PER_DAY;
		if (span >= MIN_SPAN_DAYS) {
			// 使い切り区間(空→空、信頼度 1)。
			const pool: RateInterval[] = [];
			for (let i = 1; i < ranOutTimes.length; i++) {
				const lo = ranOutTimes[i - 1];
				const hi = ranOutTimes[i];
				const volume = sumVolume(purchases, (p) => p.purchasedAt > lo && p.purchasedAt <= hi);
				pool.push({ days: (hi - lo) / MS_PER_DAY, volume, quality: 1 });
			}
			// tail: 最後の使い切りより後の購入区間(信頼度 PURCHASE_QUALITY)を時系列で後ろに足す。
			// 使い切りをマメに記録している間は tail が生じず、従来どおり使い切り区間だけになる。
			const lastRanOut = ranOutTimes[ranOutTimes.length - 1];
			const tail = events.filter((e) => e.at > lastRanOut);
			pool.push(...purchaseIntervals(tail, PURCHASE_QUALITY));

			const rate = weightedRatePerDay(pool, RATE_HALFLIFE_CYCLES);
			if (rate !== null) return rate;
		}
	}

	// 2. 購入間隔の(recency 加重)長期平均。
	if (events.length >= 2) {
		const span = (events[events.length - 1].at - events[0].at) / MS_PER_DAY;
		// 期間が短すぎる(=作成直後にまとめて買い足した等)と極小の時間で割って
		// レートが爆発するため、最低期間を満たすまでは採用せず仮の値へ落とす。
		if (span >= MIN_SPAN_DAYS) {
			const rate = weightedRatePerDay(purchaseIntervals(events, 1), RATE_HALFLIFE_CYCLES);
			if (rate !== null) return rate;
		}
	}

	// 3. 仮の値
	if (
		input.provisionalDaysToDeplete !== null &&
		input.provisionalDaysToDeplete > 0 &&
		purchases.length >= 1
	) {
		const firstVolume = purchases[0].volume;
		if (firstVolume > 0) return firstVolume / input.provisionalDaysToDeplete;
	}

	return null;
}

/** 残量推移の 1 点。 */
export interface TrajectoryPoint {
	t: number;
	remaining: number;
}

/** 残量ウォークの結果。 */
export interface RemainingWalk {
	/** グラフ用の推移(各イベントの直前・直後、0 到達点、now)。 */
	points: TrajectoryPoint[];
	/** now 時点の残量(0 以上)。 */
	remaining: number;
	/** 残量が 0 になった時刻。現在 0 でなければ null。 */
	emptyAt: number | null;
}

type WalkEvent =
	| { t: number; kind: 'add'; amount: number }
	| { t: number; kind: 'set'; value: number };

/**
 * イベント(購入・使い切り・残量補正)を時系列にたどって残量を求める(ADR 0001 再々改訂)。
 *
 * - 区間 [tᵢ, tᵢ₊₁] は「tᵢ 時点で確定していた購入・使い切りだけから推定したレート」で消費する。
 *   後から入ったイベントが、終わった区間の消費を書き換えない(遡及適用しない)。
 *   例外として、始点でレートが出せない区間(仮の値なしの初回区間など)は最初に推定できたレートで埋める。
 *   消費 0 にすると、補正するまで初回購入分が丸ごと残り続けるため。
 * - 購入は加算、使い切りは 0、残量補正は実測値に置き換える。同時刻は add → set の順。
 * - 区間の途中で 0 に達したらそこで消費を止め、その時刻を emptyAt に記録する。
 * - now より後のイベントは無視し、最後のイベントから now までも同じルールで消費する。
 */
export function walkRemaining(input: EstimateInput, now: number): RemainingWalk | null {
	const events: WalkEvent[] = [
		...input.purchases.map((p) => ({ t: p.purchasedAt, kind: 'add' as const, amount: p.volume })),
		...input.ranOutEvents.map((e) => ({ t: e.at, kind: 'set' as const, value: 0 })),
		...input.adjustments.map((a) => ({ t: a.at, kind: 'set' as const, value: a.remaining }))
	].filter((e) => e.t <= now);
	if (events.length === 0) return null;

	events.sort((a, b) => a.t - b.t || (a.kind === 'add' ? 0 : 1) - (b.kind === 'add' ? 0 : 1));

	// 各イベント直後に始まる区間のレート(その時点までに確定している購入・使い切りだけから推定)。
	const rates = events.map((ev) =>
		consumptionRatePerDay({
			...input,
			purchases: input.purchases.filter((p) => p.purchasedAt <= ev.t),
			ranOutEvents: input.ranOutEvents.filter((e) => e.at <= ev.t)
		})
	);
	const firstKnownRate = rates.find((r) => r !== null) ?? 0;

	const points: TrajectoryPoint[] = [];
	let remaining = 0;
	let emptyAt: number | null = null;
	let rate = 0;
	let lastT = events[0].t;

	const consumeUntil = (t: number) => {
		if (remaining > 0 && rate > 0) {
			const emptyT = lastT + (remaining / rate) * MS_PER_DAY;
			if (emptyT <= t) {
				remaining = 0;
				emptyAt = emptyT;
				if (emptyT < t) points.push({ t: emptyT, remaining: 0 });
			} else {
				remaining -= (rate * (t - lastT)) / MS_PER_DAY;
			}
		}
		lastT = t;
	};

	for (const [i, ev] of events.entries()) {
		consumeUntil(ev.t);
		points.push({ t: ev.t, remaining }); // イベント直前
		if (ev.kind === 'add') remaining += ev.amount;
		else remaining = Math.max(0, ev.value);
		if (remaining > 0) emptyAt = null;
		else if (ev.kind === 'set') emptyAt = ev.t;
		points.push({ t: ev.t, remaining }); // イベント直後
		rate = rates[i] ?? firstKnownRate;
	}

	if (now > lastT) {
		consumeUntil(now);
		points.push({ t: now, remaining });
	}

	return { points, remaining, emptyAt };
}

/**
 * ある品目の残量・枯渇予想日・購入推奨日を推定する。
 *
 * 残量 = walkRemaining による時系列ウォーク(区間ごとにその時点のレートで消費、0 下限)。
 * 枯渇予想日 = 残量 0 ならその到達時刻、正なら now + 残量 ÷ 最新レート(将来の定期便配送は織り込まない)。
 * 購入推奨日 = 枯渇予想日 − リードタイム(品目固有 > 全体既定)。
 *   ただし定期便の次回配送が枯渇予想日までに届くなら、自動補充される前提で null(ADR 0002 改訂)。
 */
export function estimate(input: EstimateInput, now: number): Estimate {
	const ratePerDay = consumptionRatePerDay(input);
	const walk = walkRemaining(input, now);

	if (walk === null) {
		return {
			ratePerDay,
			remaining: null,
			remainingClamped: null,
			depletionAt: null,
			recommendedPurchaseAt: null
		};
	}

	const { remaining } = walk;
	let depletionAt: number | null = null;
	if (ratePerDay !== null && ratePerDay > 0) {
		depletionAt = remaining > 0 ? now + (remaining / ratePerDay) * MS_PER_DAY : (walk.emptyAt ?? now);
	}

	let recommendedPurchaseAt: number | null = null;
	if (depletionAt !== null) {
		// 定期便の次回配送が枯渇予想日までに届くなら、補充で足りるとみなし推奨を出さない。
		const coveredBySubscription =
			input.nextSubscriptionDeliveryAt !== null &&
			input.nextSubscriptionDeliveryAt <= depletionAt;
		if (!coveredBySubscription) {
			const leadDays = input.leadTimeDays ?? input.defaultLeadTimeDays;
			recommendedPurchaseAt = depletionAt - leadDays * MS_PER_DAY;
		}
	}

	return { ratePerDay, remaining, remainingClamped: remaining, depletionAt, recommendedPurchaseAt };
}

/** StockItem から EstimateInput の品目固有フィールドを埋めるヘルパ。 */
export function estimateInputFromItem(
	item: Pick<StockItem, 'leadTimeDays' | 'provisionalDaysToDeplete'>,
	data: {
		defaultLeadTimeDays: number;
		nextSubscriptionDeliveryAt: number | null;
		purchases: Purchase[];
		ranOutEvents: RanOutEvent[];
		adjustments: RemainingAdjustment[];
	}
): EstimateInput {
	return {
		provisionalDaysToDeplete: item.provisionalDaysToDeplete,
		leadTimeDays: item.leadTimeDays,
		defaultLeadTimeDays: data.defaultLeadTimeDays,
		nextSubscriptionDeliveryAt: data.nextSubscriptionDeliveryAt,
		purchases: data.purchases,
		ranOutEvents: data.ranOutEvents,
		adjustments: data.adjustments
	};
}
