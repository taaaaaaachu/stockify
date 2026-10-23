<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { version } from '$app/environment';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { store } from '$lib/app/store.svelte';
	import PasswordChangeForm from '$lib/components/PasswordChangeForm.svelte';

	let { data, children } = $props();

	onMount(() => {
		if (!('serviceWorker' in navigator)) return;

		// ビルドごとにURLを変え、CDNに残った旧service-worker.jsを再利用させない。
		navigator.serviceWorker
			.register(`/service-worker.js?v=${encodeURIComponent(version)}`)
			.catch((error: unknown) => console.error('Service Workerの登録に失敗しました', error));
	});

	// 通信の回復時・アプリに戻ったときに、会員の未送信操作を送ってサーバーと揃える(ADR 0009)。
	onMount(() => {
		const sync = () => {
			if (document.visibilityState === 'visible') void store.sync();
		};
		window.addEventListener('online', sync);
		document.addEventListener('visibilitychange', sync);
		return () => {
			window.removeEventListener('online', sync);
			document.removeEventListener('visibilitychange', sync);
		};
	});

	function confirmLogout(e: SubmitEvent) {
		const message = `サーバーへ未送信の変更が ${store.pending} 件あります。ログアウトすると失われます。ログアウトしますか?`;
		if (store.pending > 0 && !confirm(message)) e.preventDefault();
	}

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
		{ href: '/subscriptions', label: '定期便' },
		{ href: '/settings', label: '設定' }
	] as const;

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

{#if !data.user?.mustChangePassword}
	<header
	style="border-bottom:1px solid var(--border); background:var(--card);
	       position:sticky; top:0; z-index:10;"
>
	<div
		style="max-width:48rem; margin:0 auto; padding:0.75rem 1rem;
		       display:flex; align-items:center; gap:1rem; flex-wrap:wrap;"
	>
		<a href={resolve('/')} style="font-weight:700; color:var(--accent); text-decoration:none;">Stockify</a>
		<nav style="display:flex; gap:0.75rem; font-size:0.9rem;">
			{#each nav as n (n.href)}
				<a
					href={resolve(n.href)}
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
				<a href={resolve('/account')} style="color:var(--muted); text-decoration:none;">{data.user.username}</a>
				<form method="POST" action="/logout" onsubmit={confirmLogout}>
					<button
						type="submit"
						style="border:none; background:none; color:var(--muted); cursor:pointer; font-size:0.85rem;"
						>ログアウト</button
					>
				</form>
			{:else}
				<a href={resolve('/login')} style="color:var(--accent); text-decoration:none;">ログイン</a>
				<span style="color:var(--muted);">(ゲスト)</span>
			{/if}
		</div>
	</div>
	</header>
{/if}

<main style="max-width:48rem; margin:0 auto; padding:1rem;">
	{#if store.syncState !== 'synced' || store.pending > 0}
		<p role="status" style="margin:0 0 1rem; padding:0.5rem 0.75rem; border-radius:0.5rem; border:1px solid var(--warn); color:var(--warn); background:var(--card); font-size:0.85rem;">
			{#if store.syncState === 'auth'}
				ログインの有効期限が切れたため同期できません。<a href={resolve('/login')}>ログインし直してください</a>。
			{:else if store.syncState === 'offline'}
				オフラインです。この端末に保存したデータを表示しています。
			{/if}
			{#if store.pending > 0}
				未送信の変更が {store.pending} 件あります(通信できるようになると自動で送信します)。
			{/if}
		</p>
	{/if}
	{#if store.rejected.length > 0}
		<div role="alert" style="margin:0 0 1rem; padding:0.5rem 0.75rem; border-radius:0.5rem; border:1px solid var(--warn); color:var(--warn); background:var(--card); font-size:0.85rem;">
			<p style="margin:0;">次の変更はサーバーに反映できなかったため取り消しました。</p>
			<ul style="margin:0.25rem 0; padding-left:1.25rem;">
				{#each store.rejected as message, i (i)}
					<li>{message}</li>
				{/each}
			</ul>
			<button type="button" onclick={() => store.dismissRejected()}>閉じる</button>
		</div>
	{/if}
	<!-- リセットリンクは同じブラウザで別の人が開くことがあるので、強制変更中でも見せる(ADR 0011)。 -->
	{#if data.user?.mustChangePassword && !page.url.pathname.startsWith('/reset/')}
		<PasswordChangeForm forced={true} />
	{:else}
		{@render children()}
	{/if}
</main>
