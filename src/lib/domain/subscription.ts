import { MS_PER_DAY } from './estimate';
import type { Subscription } from '$lib/types';

/**
 * 一度の遅延生成でさかのぼって作る配送の上限。
 * 長期間アプリを開かなかった場合の暴走を防ぐ安全弁。
 */
export const MAX_BACKFILL = 1000;

/**
 * 遅延生成した購入の ID。定期便と配送日から決定的に作り、複数端末やサーバーで
 * 同じ回を生成しても同一 ID に揃えて重複を防ぐ(ADR 0009)。
 */
export function deliveryPurchaseId(subscriptionId: string, deliveredAt: number): string {
	return `sub-${subscriptionId}-${Math.round(deliveredAt)}`;
}

/**
 * スキップ後の次回予定日。現在の次回予定日を 1 間隔ぶん先送りした時刻を返す
 * (その回の購入は生成しない)。未来は次回予定日 1 点だけなので、スキップは
 * この 1 点を進める定型的な次回日変更にあたる。
 */
export function nextDeliveryAfterSkip(
	subscription: Pick<Subscription, 'intervalDays' | 'nextDeliveryAt'>
): number {
	return subscription.nextDeliveryAt + subscription.intervalDays * MS_PER_DAY;
}

/**
 * 次回日変更で受け付けてよい日付か。今日(now のローカル 0:00)以降なら true。
 * 過去日は遡っての一括遅延生成を招くため受け付けない(過去分の登録は購入の手動追加が担う)。
 */
export function isAcceptableNextDelivery(at: number, now: number): boolean {
	const todayStart = new Date(now);
	todayStart.setHours(0, 0, 0, 0);
	return at >= todayStart.getTime();
}

/** 遅延生成で作るべき 1 回分の配送。 */
export interface DueDelivery {
	/** 配送日時(= その回の予定日、epoch ミリ秒)。購入の purchasedAt になる。 */
	deliveredAt: number;
	/** その回の総量(内容量 × 個数)。 */
	volume: number;
}

/** 遅延生成の結果。 */
export interface GenerationResult {
	/** 生成すべき配送(古い順)。呼び出し側が購入として永続化する。 */
	deliveries: DueDelivery[];
	/** 生成後に更新すべき次回予定日(epoch ミリ秒)。 */
	nextDeliveryAt: number;
}

/**
 * 定期便から、現在(now)までに予定日を過ぎた配送を洗い出す(ADR 0002 の遅延生成)。
 *
 * - `paused` の間、または間隔が 0 以下なら何も生成しない。
 * - 予定日 <= now の分を古い順に列挙し、次回予定日を間隔ずつ進める。
 * - 生成数が MAX_BACKFILL に達したら打ち切り、以降の予定日は now 以降へ間引いて追いつく。
 *
 * この関数は純粋で副作用を持たない。永続化は呼び出し側の責務。
 */
export function generateDueDeliveries(
	subscription: Pick<
		Subscription,
		'intervalDays' | 'nextDeliveryAt' | 'volumePerDelivery' | 'quantityPerDelivery' | 'paused'
	>,
	now: number
): GenerationResult {
	const { intervalDays, volumePerDelivery, quantityPerDelivery, paused } = subscription;

	if (paused || intervalDays <= 0) {
		return { deliveries: [], nextDeliveryAt: subscription.nextDeliveryAt };
	}

	const intervalMs = intervalDays * MS_PER_DAY;
	const volume = volumePerDelivery * quantityPerDelivery;

	const deliveries: DueDelivery[] = [];
	let next = subscription.nextDeliveryAt;

	while (next <= now && deliveries.length < MAX_BACKFILL) {
		deliveries.push({ deliveredAt: next, volume });
		next += intervalMs;
	}

	// 打ち切った場合は、次回予定日を now より後まで間引いて追いつかせる
	// (取りこぼした分の再生成を防ぐ)。
	if (next <= now) {
		const missedIntervals = Math.floor((now - next) / intervalMs) + 1;
		next += missedIntervals * intervalMs;
	}

	return { deliveries, nextDeliveryAt: next };
}
