<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { invalidateAll, goto } from '$app/navigation';
	import { store } from '$lib/app/store.svelte';

	let { data, children } = $props();

	// サーバーの認証・世帯コンテキストをストアへ反映(変化でリポジトリを選び直す)。
	$effect(() => {
		store.configure({
			user: data.user,
			households: data.households,
			activeHousehold: data.activeHousehold
		});
	});

	const nav = [
		{ href: '/', label: '在庫' },
		{ href: '/shopping', label: '買い物リスト' },
		{ href: '/settings', label: '設定' }
	];

	async function switchHousehold(e: Event) {
		const id = (e.currentTarget as HTMLSelectElement).value;
		await fetch('/api/session/household', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ householdId: id })
		});
		await invalidateAll();
	}
</script>

<header
	style="border-bottom:1px solid var(--border); background:var(--card);
	       position:sticky; top:0; z-index:10;"
>
	<div
		style="max-width:48rem; margin:0 auto; padding:0.75rem 1rem;
		       display:flex; align-items:center; gap:1rem; flex-wrap:wrap;"
	>
		<a href="/" style="font-weight:700; color:var(--accent); text-decoration:none;">Stockify</a>
		<nav style="display:flex; gap:0.75rem; font-size:0.9rem;">
			{#each nav as n (n.href)}
				<a
					href={n.href}
					style="text-decoration:none; color:{page.url.pathname === n.href
						? 'var(--accent)'
						: 'var(--muted)'};"
				>
					{n.label}
				</a>
			{/each}
		</nav>

		<div style="margin-left:auto; display:flex; align-items:center; gap:0.6rem; font-size:0.85rem;">
			{#if data.user}
				{#if data.households.length > 0}
					<select
						onchange={switchHousehold}
						value={data.activeHousehold?.id}
						style="padding:0.2rem 0.4rem; border:1px solid var(--border); border-radius:0.4rem;"
					>
						{#each data.households as h (h.id)}
							<option value={h.id}>{h.name}</option>
						{/each}
					</select>
				{/if}
				<a href="/account" style="color:var(--muted); text-decoration:none;">{data.user.username}</a>
				<form method="POST" action="/logout">
					<button
						type="submit"
						style="border:none; background:none; color:var(--muted); cursor:pointer; font-size:0.85rem;"
						>ログアウト</button
					>
				</form>
			{:else}
				<a href="/login" style="color:var(--accent); text-decoration:none;">ログイン</a>
				<span style="color:var(--muted);">(ゲスト)</span>
			{/if}
		</div>
	</div>
</header>

<main style="max-width:48rem; margin:0 auto; padding:1rem;">
	{@render children()}
</main>
