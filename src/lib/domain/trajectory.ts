import { walkRemaining, type EstimateInput, type TrajectoryPoint } from './estimate';

export type { TrajectoryPoint };

/**
 * 残量の推移(履歴グラフ用)。推定残量と同じウォーク(walkRemaining)の経路をそのまま返すため、
 * グラフの末尾はダッシュボードの推定残量と一致する。イベントが無ければ空。
 */
export function remainingTrajectory(input: EstimateInput, now: number): TrajectoryPoint[] {
	return walkRemaining(input, now)?.points ?? [];
}
