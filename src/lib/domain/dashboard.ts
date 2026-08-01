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

/**
 * アクティブ(一時停止でない)な定期便のうち、最も早い次回配送日。
 * 補充が枯渇前に届くかの判定に使う(ADR 0002 改訂)。アクティブな定期便が無ければ null。
 */
function earliestActiveDeliveryAt(bundle: ItemBundle): number | null {
	let earliest: number | null = null;
	for (const s of bundle.subscriptions) {
		if (s.paused) continue;
		if (earliest === null || s.nextDeliveryAt < earliest) earliest = s.nextDeliveryAt;
	}
	return earliest;
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
		nextSubscriptionDeliveryAt: earliestActiveDeliveryAt(bundle),
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
 * 買い物リスト: そろそろ買う/尽きた品目を集める。ダッシュボード行から派生する(緊急な順のまま)。
 *
 * 定期便による除外はもう status に織り込まれている(ADR 0002 改訂): 次回配送が枯渇前に届く品目は
 * 購入推奨日が出ず 'ok' になるため、ここでは status だけで判定すれば足りる。スキップ等で補充が
 * 間に合わなくなった定期便品目は 'restock'/'depleted' となり、自動的にリストへ復帰する。
 */
export function shoppingList(rows: DashboardRow[]): DashboardRow[] {
	return rows.filter((r) => r.status === 'restock' || r.status === 'depleted');
}
