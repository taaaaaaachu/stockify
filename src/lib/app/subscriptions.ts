import { generateDueDeliveries } from '$lib/domain/subscription';
import type { Repository } from '$lib/repo/types';

/** 遅延生成の適用結果(サマリ)。 */
export interface MaterializeResult {
	/** 生成した購入の総数。 */
	generatedPurchases: number;
	/** 更新した定期便の数。 */
	updatedSubscriptions: number;
}

/**
 * 全定期便について予定日超過分の購入を生成・永続化し、次回予定日を更新する
 * (ADR 0002 の遅延生成)。アプリ起動時に一度呼ぶ想定。
 *
 * ドメインの純粋関数 generateDueDeliveries に生成判断を委ね、ここは永続化のみ担う。
 */
export async function materializeDueSubscriptions(
	repo: Repository,
	now: number
): Promise<MaterializeResult> {
	const items = await repo.listItems();
	let generatedPurchases = 0;
	let updatedSubscriptions = 0;

	for (const item of items) {
		const subscriptions = await repo.listSubscriptions(item.id);
		for (const sub of subscriptions) {
			const { deliveries, nextDeliveryAt } = generateDueDeliveries(sub, now);
			if (deliveries.length === 0) continue;

			for (const delivery of deliveries) {
				await repo.createPurchase({
					itemId: item.id,
					volume: delivery.volume,
					price: null,
					purchasedAt: delivery.deliveredAt,
					source: 'subscription'
				});
				generatedPurchases++;
			}
			await repo.updateSubscription(sub.id, { nextDeliveryAt });
			updatedSubscriptions++;
		}
	}

	return { generatedPurchases, updatedSubscriptions };
}
