<script lang="ts">
	import type { StockStatus } from '$lib/domain/dashboard';

	let { status }: { status: StockStatus } = $props();

	const label: Record<StockStatus, string> = {
		unknown: '推定中',
		ok: '十分',
		restock: 'そろそろ購入',
		depleted: '在庫切れ'
	};
	const color: Record<StockStatus, string> = {
		unknown: 'var(--muted)',
		ok: 'var(--ok)',
		restock: 'var(--warn)',
		depleted: 'var(--danger)'
	};
</script>

<span
	style="display:inline-block; padding:0.1rem 0.5rem; border-radius:999px; font-size:0.75rem;
	       color:#fff; background:{color[status]};"
>
	{label[status]}
</span>
