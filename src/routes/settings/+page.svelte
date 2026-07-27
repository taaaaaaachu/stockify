<script lang="ts">
	import { onMount } from 'svelte';
	import { store } from '$lib/app/store.svelte';

	onMount(() => {
		if (!store.loaded) store.load();
	});

	let leadTime = $state('');
	let saved = $state(false);

	// ストア読込後に初期値を反映する。
	$effect(() => {
		if (store.loaded && leadTime === '') {
			leadTime = String(store.settings.defaultLeadTimeDays);
		}
	});

	async function save(e: SubmitEvent) {
		e.preventDefault();
		const n = Number(leadTime);
		if (!Number.isFinite(n) || n < 0) return;
		await store.setDefaultLeadTime(n);
		saved = true;
		setTimeout(() => (saved = false), 1500);
	}
</script>

<h1 style="font-size:1.3rem;">設定</h1>

{#if !store.loaded}
	<p style="color:var(--muted);">読み込み中…</p>
{:else}
	<form onsubmit={save} style="display:flex; flex-direction:column; gap:0.9rem; max-width:20rem;">
		<label style="display:flex; flex-direction:column; gap:0.25rem;">
			<span>リードタイム既定値(日)</span>
			<input bind:value={leadTime} type="number" step="any" min="0" />
			<small style="color:var(--muted);"
				>購入推奨日 = 枯渇予想日 − この日数。品目ごとに上書きできます。</small
			>
		</label>
		<button
			type="submit"
			style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem;
			       padding:0.5rem; cursor:pointer;"
		>
			保存
		</button>
		{#if saved}<span style="color:var(--ok);">保存しました</span>{/if}
	</form>
{/if}
