import { consumptionRatePerDay, MS_PER_DAY, type EstimateInput } from './estimate';

/** 残量推移の 1 点。 */
export interface TrajectoryPoint {
	t: number;
	remaining: number;
}

type Event =
	| { t: number; kind: 'add'; amount: number }
	| { t: number; kind: 'set'; value: number };

/**
 * 残量の推移(履歴グラフ用)を、イベントを時系列にたどって組み立てる。
 *
 * - 購入は残量を積み増し(add)、使い切りは 0 に、残量補正は実測値にリセット(set)。
 * - イベント間は推定レートで線形に消費し、0 未満にはしない(物理的な下限)。
 * - 同時刻は set を後に適用する。
 * - 最後のイベントから now まで消費を延長した点を末尾に加える。
 *
 * ダッシュボードの残量(超過を負値で表す)とは異なり、履歴は 0 下限でクランプする。
 */
export function remainingTrajectory(input: EstimateInput, now: number): TrajectoryPoint[] {
	const ratePerDay = consumptionRatePerDay(input) ?? 0;

	const events: Event[] = [
		...input.purchases.map((p) => ({ t: p.purchasedAt, kind: 'add' as const, amount: p.volume })),
		...input.ranOutEvents.map((e) => ({ t: e.at, kind: 'set' as const, value: 0 })),
		...input.adjustments.map((a) => ({ t: a.at, kind: 'set' as const, value: a.remaining }))
	];
	if (events.length === 0) return [];

	// 時刻昇順。同時刻は add → set の順にする(set が原点を上書きするため後勝ち)。
	events.sort((a, b) => {
		if (a.t !== b.t) return a.t - b.t;
		const rank = (e: Event) => (e.kind === 'add' ? 0 : 1);
		return rank(a) - rank(b);
	});

	const points: TrajectoryPoint[] = [];
	let remaining = 0;
	let lastT = events[0].t;

	for (const ev of events) {
		const dtDays = (ev.t - lastT) / MS_PER_DAY;
		remaining = Math.max(0, remaining - ratePerDay * dtDays);
		points.push({ t: ev.t, remaining }); // イベント直前
		if (ev.kind === 'add') remaining += ev.amount;
		else remaining = Math.max(0, ev.value);
		points.push({ t: ev.t, remaining }); // イベント直後
		lastT = ev.t;
	}

	if (now > lastT) {
		const dtDays = (now - lastT) / MS_PER_DAY;
		remaining = Math.max(0, remaining - ratePerDay * dtDays);
		points.push({ t: now, remaining });
	}

	return points;
}
