<script lang="ts">
	import { resolve } from '$app/paths';
	import { store } from '$lib/app/store.svelte';
	import { buildDashboard, shoppingList } from '$lib/domain/dashboard';
	import { formatDepletion, formatQuantity } from '$lib/format';
	import StatusBadge from '$lib/components/StatusBadge.svelte';

	const rows = $derived(shoppingList(buildDashboard(store.bundles, store.settings, store.now)));

	let busy = $state<string | null>(null);

	// 「買った」= 直近購入と同じ内容量で今日付けの購入を登録する。
	async function boughtNow(itemId: string) {
		const bundle = store.bundle(itemId);
		if (!bundle) return;
		const latest = [...bundle.purchases].sort((a, b) => b.purchasedAt - a.purchasedAt)[0];
		const volume = latest ? latest.volume : 0;
		if (volume <= 0) return;
		busy = itemId;
		try {
			await store.addPurchase({
				itemId,
				volume,
				price: null,
				purchasedAt: Date.now(),
				source: 'manual'
			});
		} finally {
			busy = null;
		}
	}
</script>

<h1 style="font-size:1.3rem;">買い物リスト</h1>
<p style="color:var(--muted); font-size:0.9rem;">
	購入推奨日に達した品目です(定期便で自動補充される品目は除く)。
</p>

{#if !store.loaded}
	<p style="color:var(--muted);">読み込み中…</p>
{:else if rows.length === 0}
	<p style="color:var(--muted);">いま買うべき品目はありません。</p>
{:else}
	<ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.6rem;">
		{#each rows as row (row.item.id)}
			<li
				style="background:var(--card); border:1px solid var(--border); border-radius:0.6rem;
				       padding:0.8rem; display:flex; align-items:center; gap:0.6rem;"
			>
				<div style="flex:1;">
					<div style="display:flex; align-items:center; gap:0.5rem;">
						<a href={resolve('/items/[id]', { id: row.item.id })} style="font-weight:600; color:inherit;"
							>{row.item.name}</a
						>
						<StatusBadge status={row.status} />
					</div>
					<div style="font-size:0.85rem; color:var(--muted); margin-top:0.2rem;">
						残量 {formatQuantity(row.estimate.remainingClamped, row.item.unit)} ・ 枯渇 {formatDepletion(
							row.estimate.depletionAt,
							store.now
						)}
					</div>
				</div>
				<button
					onclick={() => boughtNow(row.item.id)}
					disabled={busy === row.item.id}
					style="background:var(--ok); color:#fff; border:none; border-radius:0.5rem;
					       padding:0.5rem 0.8rem; cursor:pointer; white-space:nowrap;"
				>
					買った
				</button>
			</li>
		{/each}
	</ul>
{/if}
