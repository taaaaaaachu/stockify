<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';

	let { children } = $props();

	const nav = [
		{ href: '/', label: '在庫' },
		{ href: '/shopping', label: '買い物リスト' },
		{ href: '/settings', label: '設定' }
	];
</script>

<header
	style="border-bottom:1px solid var(--border); background:var(--card);
	       position:sticky; top:0; z-index:10;"
>
	<div
		style="max-width:48rem; margin:0 auto; padding:0.75rem 1rem;
		       display:flex; align-items:center; gap:1rem;"
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
	</div>
</header>

<main style="max-width:48rem; margin:0 auto; padding:1rem;">
	{@render children()}
</main>
