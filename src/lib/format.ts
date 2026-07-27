import { MS_PER_DAY } from '$lib/domain/estimate';

/** epoch ミリ秒を「YYYY/MM/DD」で表す(ローカルタイム)。null は「—」。 */
export function formatDate(ms: number | null): string {
	if (ms === null || !Number.isFinite(ms)) return '—';
	const d = new Date(ms);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}/${m}/${day}`;
}

/**
 * 数値を表示用に整形する。整数はそのまま、小数は最大 1 桁に丸めて末尾ゼロを落とす。
 * 例: 300 → "300"、12.34 → "12.3"、10.0 → "10"。
 */
export function formatNumber(n: number | null): string {
	if (n === null || !Number.isFinite(n)) return '—';
	const rounded = Math.round(n * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** 残量などを「123 ml」の形にする。 */
export function formatQuantity(n: number | null, unit: string): string {
	if (n === null || !Number.isFinite(n)) return '—';
	return `${formatNumber(n)} ${unit}`;
}

/**
 * 「今から見た日数」を人間語にする。
 * 例: 3 → "あと3日"、0 → "本日"、-2 → "2日超過"。
 * null は「—」。端数は日単位に丸める。
 */
export function formatDaysUntil(days: number | null): string {
	if (days === null || !Number.isFinite(days)) return '—';
	const d = Math.round(days);
	if (d > 0) return `あと${d}日`;
	if (d === 0) return '本日';
	return `${-d}日超過`;
}

/** epoch ミリ秒の枯渇予想日を「今から見た日数」の人間語にする。 */
export function formatDepletion(depletionAt: number | null, now: number): string {
	if (depletionAt === null) return '—';
	return formatDaysUntil((depletionAt - now) / MS_PER_DAY);
}
