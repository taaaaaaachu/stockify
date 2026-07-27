import type { StockItem } from '$lib/types';
import type { AppSettings, ItemBundle } from '$lib/repo/types';
import { estimate, estimateInputFromItem, MS_PER_DAY, type Estimate } from './estimate';

/** ダッシュボード上の品目の状態。 */
export type StockStatus =
	/** レートが出せず推定不能。 */
	| 'unknown'
	/** 十分な残量がある。 */
	| 'ok'
	/** 購入推奨日に達した(そろそろ買う)。 */
	| 'restock'
	/** 推定残量が尽きた。 */
	| 'depleted';

/** ダッシュボード 1 行分。 */
export interface DashboardRow {
	item: StockItem;
	estimate: Estimate;
	/** 有効(一時停止でない)な定期便があるか。 */
	hasActiveSubscription: boolean;
	status: StockStatus;
	/** 枯渇までの残り日数(切り捨てない実数)。推定不能や算出不可なら null。 */
	daysUntilDepletion: number | null;
	/** 残量バーの満量基準(購入内容量の最大値)。購入が無ければ null。 */
	capacity: number | null;
	/** 残量の割合(0〜1)。capacity か残量が無ければ null。 */
	remainingFraction: number | null;
}

function hasActiveSubscription(bundle: ItemBundle): boolean {
	return bundle.subscriptions.some((s) => !s.paused);
}

function statusOf(estimate: Estimate, now: number): StockStatus {
	// レートが出せず枯渇予測できない品目は unknown(残量だけ分かっても状態は判断しない)。
	if (estimate.depletionAt === null) return 'unknown';
	if (estimate.remaining !== null && estimate.remaining <= 0) return 'depleted';
	if (estimate.recommendedPurchaseAt !== null && estimate.recommendedPurchaseAt <= now) {
		return 'restock';
	}
	return 'ok';
}

/** 1 品目のバンドルから推定・状態を組み立てる。 */
export function buildRow(bundle: ItemBundle, settings: AppSettings, now: number): DashboardRow {
	const active = hasActiveSubscription(bundle);
	const input = estimateInputFromItem(bundle.item, {
		defaultLeadTimeDays: settings.defaultLeadTimeDays,
		hasActiveSubscription: active,
		purchases: bundle.purchases,
		ranOutEvents: bundle.ranOutEvents,
		adjustments: bundle.adjustments
	});
	const est = estimate(input, now);
	const daysUntilDepletion =
		est.depletionAt !== null ? (est.depletionAt - now) / MS_PER_DAY : null;

	const capacity =
		bundle.purchases.length > 0
			? Math.max(...bundle.purchases.map((p) => p.volume))
			: null;
	const remainingFraction =
		capacity !== null && capacity > 0 && est.remainingClamped !== null
			? Math.min(1, est.remainingClamped / capacity)
			: null;

	return {
		item: bundle.item,
		estimate: est,
		hasActiveSubscription: active,
		status: statusOf(est, now),
		daysUntilDepletion,
		capacity,
		remainingFraction
	};
}

/**
 * 全品目のダッシュボード行を組み立て、緊急な順(枯渇が近い順)に並べる。
 *  - 枯渇予想日が早いものほど上。
 *  - 推定不能(枯渇予想日なし)の品目は末尾へ。
 *  - 同着は品目名で安定的に並べる。
 */
export function buildDashboard(
	bundles: ItemBundle[],
	settings: AppSettings,
	now: number
): DashboardRow[] {
	const rows = bundles.map((b) => buildRow(b, settings, now));
	return rows.sort((a, b) => {
		const aKey = a.estimate.depletionAt;
		const bKey = b.estimate.depletionAt;
		if (aKey === null && bKey === null) return a.item.name.localeCompare(b.item.name, 'ja');
		if (aKey === null) return 1;
		if (bKey === null) return -1;
		if (aKey === bKey) return a.item.name.localeCompare(b.item.name, 'ja');
		return aKey - bKey;
	});
}

/**
 * 買い物リスト: そろそろ買う/尽きた品目のうち、定期便で自動補充されないもの。
 * ダッシュボード行から派生する(緊急な順のまま)。
 */
export function shoppingList(rows: DashboardRow[]): DashboardRow[] {
	return rows.filter(
		(r) => !r.hasActiveSubscription && (r.status === 'restock' || r.status === 'depleted')
	);
}
