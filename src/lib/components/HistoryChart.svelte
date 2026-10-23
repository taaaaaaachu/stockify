<script lang="ts">
	import type { TrajectoryPoint } from '#lib/domain/trajectory.js';
	import { formatDate } from '#lib/format.js';

	let { points, unit }: { points: TrajectoryPoint[]; unit: string } = $props();

	const W = 640;
	const H = 180;
	const PAD = 28;

	const view = $derived.by(() => {
		if (points.length < 2) return null;
		const ts = points.map((p) => p.t);
		const vs = points.map((p) => p.remaining);
		const tMin = Math.min(...ts);
		const tMax = Math.max(...ts);
		const vMax = Math.max(...vs, 1);
		const tSpan = tMax - tMin || 1;

		const x = (t: number) => PAD + ((t - tMin) / tSpan) * (W - 2 * PAD);
		const y = (v: number) => H - PAD - (v / vMax) * (H - 2 * PAD);

		const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t)},${y(p.remaining)}`).join(' ');
		return { x, y, tMin, tMax, vMax, path };
	});
</script>

{#if view === null}
	<p style="color:var(--muted); font-size:0.9rem;">履歴を描くにはもう少しデータが必要です。</p>
{:else}
	<svg viewBox="0 0 {W} {H}" style="width:100%; height:auto;" role="img" aria-label="残量推移">
		<!-- 軸 -->
		<line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--border)" />
		<line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--border)" />
		<!-- 残量ライン -->
		<path d={view.path} fill="none" stroke="var(--accent)" stroke-width="2" />
		<!-- ラベル -->
		<text x={PAD} y={PAD - 8} font-size="11" fill="var(--muted)">{Math.round(view.vMax)} {unit}</text>
		<text x={PAD} y={H - 8} font-size="11" fill="var(--muted)">{formatDate(view.tMin)}</text>
		<text x={W - PAD} y={H - 8} font-size="11" fill="var(--muted)" text-anchor="end"
			>{formatDate(view.tMax)}</text
		>
	</svg>
{/if}
