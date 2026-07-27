import type { Purchase, RanOutEvent, RemainingAdjustment, StockItem } from '$lib/types';

/** 1 日のミリ秒数。 */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 推定に必要な、ある品目のスナップショット。 */
export interface EstimateInput {
	/** 仮の値(初回内容量を約 N 日で使い切る)。null なら未設定。 */
	provisionalDaysToDeplete: number | null;
	/** 品目固有のリードタイム(日)。null なら既定値を使う。 */
	leadTimeDays: number | null;
	/** 全体既定のリードタイム(日)。 */
	defaultLeadTimeDays: number;
	/** 有効な定期便があるか(あれば購入推奨の対象外)。 */
	hasActiveSubscription: boolean;
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
 * 消費レート(volume/day)を推定する。
 *
 * 優先順位(ADR 0001):
 *  1. 使い切りイベントが 2 件以上 → 空〜空の間に購入した総量 ÷ その期間。
 *     残量が確実に 0 になった 2 点で挟むため、最も正確な消費サンプル。
 *  2. 購入が 2 件以上 → 長期平均方式: (累計購入量 − 直近購入量) ÷ (初回〜直近の期間)。
 *     直近購入分はまだ消費されていないため除く。早買い/まとめ買いのブレは
 *     期間全体で平均化され、購入を重ねるほど正確になる。
 *  3. 仮の値 → 初回内容量 ÷ 想定日数。
 *
 * いずれも消費量が正で期間が正のときだけ採用し、満たさなければ次の手段へ落ちる。
 * どれも使えなければ null。
 */
export function consumptionRatePerDay(input: EstimateInput): number | null {
	const purchases = [...input.purchases].sort(byTimeAsc((p) => p.purchasedAt));
	const ranOuts = [...input.ranOutEvents].sort(byTimeAsc((e) => e.at));

	// 1. 使い切りイベント基準(最優先)
	if (ranOuts.length >= 2) {
		const first = ranOuts[0].at;
		const last = ranOuts[ranOuts.length - 1].at;
		const days = (last - first) / MS_PER_DAY;
		if (days > 0) {
			const consumed = sumVolume(purchases, (p) => p.purchasedAt > first && p.purchasedAt <= last);
			if (consumed > 0) return consumed / days;
		}
	}

	// 2. 購入間隔の長期平均
	if (purchases.length >= 2) {
		const first = purchases[0].purchasedAt;
		const last = purchases[purchases.length - 1].purchasedAt;
		const days = (last - first) / MS_PER_DAY;
		if (days > 0) {
			const total = sumVolume(purchases, () => true);
			const lastVolume = purchases[purchases.length - 1].volume;
			const consumed = total - lastVolume;
			if (consumed > 0) return consumed / days;
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
 * 購入推奨日 = 枯渇予想日 − リードタイム(品目固有 > 全体既定)。定期便が有効なら null。
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
	if (depletionAt !== null && !input.hasActiveSubscription) {
		const leadDays = input.leadTimeDays ?? input.defaultLeadTimeDays;
		recommendedPurchaseAt = depletionAt - leadDays * MS_PER_DAY;
	}

	return { ratePerDay, remaining, remainingClamped, depletionAt, recommendedPurchaseAt };
}

/** StockItem から EstimateInput の品目固有フィールドを埋めるヘルパ。 */
export function estimateInputFromItem(
	item: Pick<StockItem, 'leadTimeDays' | 'provisionalDaysToDeplete'>,
	data: {
		defaultLeadTimeDays: number;
		hasActiveSubscription: boolean;
		purchases: Purchase[];
		ranOutEvents: RanOutEvent[];
		adjustments: RemainingAdjustment[];
	}
): EstimateInput {
	return {
		provisionalDaysToDeplete: item.provisionalDaysToDeplete,
		leadTimeDays: item.leadTimeDays,
		defaultLeadTimeDays: data.defaultLeadTimeDays,
		hasActiveSubscription: data.hasActiveSubscription,
		purchases: data.purchases,
		ranOutEvents: data.ranOutEvents,
		adjustments: data.adjustments
	};
}
