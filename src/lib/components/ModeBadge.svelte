<script lang="ts">
	import type { TrackingMode } from '#lib/types.js';

	// 手動管理モード(ADR 0013)の品目だけに付ける。推定モードは既定なので表示しない。
	let { mode }: { mode: TrackingMode } = $props();
</script>

{#if mode === 'manual'}
	<span
		title="推定せず、使用・購入・補正の実数で残量を管理しています"
		style="font-size:0.7rem; color:var(--muted); border:1px solid var(--muted);
		       border-radius:999px; padding:0 0.4rem;">手動</span
	>
{/if}
