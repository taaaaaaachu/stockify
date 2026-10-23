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
	/** 現在の推定残量(単位量)。負値は「予想を超えて使い切った(枯渇済み)」を表す。null は推定不能。 */
	remaining: number | null;
	/** 表示用にゼロ下限でクランプした残量。null は推定不能。 */
	remainingClamped: number | null;
	/** 枯渇予想日時(epoch ミリ秒)。既に枯渇なら now 以下。null は推定不能。 */
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
		intervals.push({ days: (events[i + 1].at - events[i].at) / MS_PER_DAY, volume: events[i].volume, quality });
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

interface Anchor {
	/** 基準時刻(epoch ミリ秒)。 */
	at: number;
	/** 基準時刻での既知残量。 */
	remaining: number;
	/** 基準時刻ちょうどの購入を加算に含めるか(初回購入基準のときだけ true)。 */
	includesPurchaseAtAnchor: boolean;
}

/**
 * 残量計算の基準点(アンカー)を選ぶ。
 * 「残量が既知の最も新しい時点」を採る:
 *  - 初回購入の直前は残量 0(初回購入自体を加算として数える)
 *  - 各使い切りイベントは残量 0
 *  - 各残量補正はその実測値
 * これらのうち最も新しい時刻のものを基準にする。
 */
function pickAnchor(input: EstimateInput, purchasesAsc: Purchase[]): Anchor | null {
	let anchor: Anchor | null = null;

	if (purchasesAsc.length >= 1) {
		anchor = { at: purchasesAsc[0].purchasedAt, remaining: 0, includesPurchaseAtAnchor: true };
	}

	for (const e of input.ranOutEvents) {
		if (anchor === null || e.at >= anchor.at) {
			anchor = { at: e.at, remaining: 0, includesPurchaseAtAnchor: false };
		}
	}

	for (const adj of input.adjustments) {
		if (anchor === null || adj.at >= anchor.at) {
			anchor = { at: adj.at, remaining: adj.remaining, includesPurchaseAtAnchor: false };
		}
	}

	return anchor;
}

/**
 * ある品目の残量・枯渇予想日・購入推奨日を推定する。
 *
 * 残量 = 基準残量 + (基準時刻より後の購入で入った量) − 消費レート × 経過日数。
 * 枯渇予想日 = 残量がゼロを切る時点(現在の残量とレートから外挿。将来の定期便配送は織り込まない)。
 * 購入推奨日 = 枯渇予想日 − リードタイム(品目固有 > 全体既定)。
 *   ただし定期便の次回配送が枯渇予想日までに届くなら、自動補充される前提で null(ADR 0002 改訂)。
 */
export function estimate(input: EstimateInput, now: number): Estimate {
	const purchasesAsc = [...input.purchases].sort(byTimeAsc((p) => p.purchasedAt));
	const ratePerDay = consumptionRatePerDay(input);
	const anchor = pickAnchor(input, purchasesAsc);

	if (anchor === null) {
		return {
			ratePerDay,
			remaining: null,
			remainingClamped: null,
			depletionAt: null,
			recommendedPurchaseAt: null
		};
	}

	const additions = sumVolume(
		purchasesAsc,
		(p) =>
			p.purchasedAt <= now &&
			(anchor.includesPurchaseAtAnchor ? p.purchasedAt >= anchor.at : p.purchasedAt > anchor.at)
	);
	const elapsedDays = Math.max(0, (now - anchor.at) / MS_PER_DAY);
	const consumed = ratePerDay !== null ? ratePerDay * elapsedDays : 0;
	const remaining = anchor.remaining + additions - consumed;
	const remainingClamped = Math.max(0, remaining);

	let depletionAt: number | null = null;
	if (ratePerDay !== null && ratePerDay > 0) {
		// remaining が 0 を切る時点。既に負なら過去(枯渇済み)として now 以前になる。
		const daysUntilEmpty = remaining / ratePerDay;
		depletionAt = now + daysUntilEmpty * MS_PER_DAY;
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

	return { ratePerDay, remaining, remainingClamped, depletionAt, recommendedPurchaseAt };
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
