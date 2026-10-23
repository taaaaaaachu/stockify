<script lang="ts">
	import type { StockStatus } from '#lib/domain/dashboard.js';

	let {
		fraction,
		status
	}: { fraction: number | null; status: StockStatus } = $props();

	const color: Record<StockStatus, string> = {
		unknown: 'var(--muted)',
		ok: 'var(--ok)',
		restock: 'var(--warn)',
		depleted: 'var(--danger)'
	};

	const pct = $derived(fraction === null ? 0 : Math.round(fraction * 100));
</script>

<div
	style="height:0.6rem; border-radius:999px; background:var(--border); overflow:hidden;"
	title={fraction === null ? '推定中' : `${pct}%`}
>
	{#if fraction !== null}
		<div style="height:100%; width:{pct}%; background:{color[status]};"></div>
	{/if}
</div>
