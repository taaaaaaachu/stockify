/** 通知時刻を判定するスロットの長さ(分)。 */
export const NOTIFY_SLOT_MINUTES = 15;

/** 通知時刻を15分スロットの開始時刻へ切り捨てる。 */
export function normalizeNotifyMinute(minuteOfDay: number, slot = NOTIFY_SLOT_MINUTES): number {
	return Math.floor(minuteOfDay / slot) * slot;
}
