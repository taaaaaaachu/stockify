<script lang="ts">
	import { store } from '$lib/app/store.svelte';
	import { buildDashboard } from '$lib/domain/dashboard';
	import { formatDepletion, formatQuantity } from '$lib/format';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import RemainingBar from '$lib/components/RemainingBar.svelte';

	const rows = $derived(buildDashboard(store.bundles, store.settings, store.now));
</script>

<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem;">
	<h1 style="margin:0; font-size:1.4rem;">在庫</h1>
	<a
		href="/items/new"
		style="background:var(--accent); color:#fff; text-decoration:none;
		       padding:0.4rem 0.8rem; border-radius:0.5rem; font-size:0.9rem;"
	>
		＋ 品目を追加
	</a>
</div>

{#if !store.loaded}
	<p style="color:var(--muted);">読み込み中…</p>
{:else if rows.length === 0}
	<p style="color:var(--muted);">
		まだ品目がありません。「＋ 品目を追加」から最初の詰替え・消耗品を登録してください。
	</p>
{:else}
	<ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.6rem;">
		{#each rows as row (row.item.id)}
			<li>
				<a
					href="/items/{row.item.id}"
					style="display:block; text-decoration:none; color:inherit; background:var(--card);
					       border:1px solid var(--border); border-radius:0.6rem; padding:0.8rem;"
				>
					<div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.4rem;">
						<span style="font-weight:600;">{row.item.name}</span>
						{#if row.item.category}
							<span style="font-size:0.75rem; color:var(--muted);">{row.item.category}</span>
						{/if}
						{#if row.hasActiveSubscription}
							<span
								style="font-size:0.7rem; color:var(--accent); border:1px solid var(--accent);
								       border-radius:999px; padding:0 0.4rem;">定期便</span
							>
						{/if}
						<span style="margin-left:auto;"><StatusBadge status={row.status} /></span>
					</div>
					<RemainingBar fraction={row.remainingFraction} status={row.status} />
					<div
						style="display:flex; justify-content:space-between; margin-top:0.4rem;
						       font-size:0.85rem; color:var(--muted);"
					>
						<span>残量 {formatQuantity(row.estimate.remainingClamped, row.item.unit)}</span>
						<span>枯渇 {formatDepletion(row.estimate.depletionAt, store.now)}</span>
					</div>
				</a>
			</li>
		{/each}
	</ul>
{/if}
