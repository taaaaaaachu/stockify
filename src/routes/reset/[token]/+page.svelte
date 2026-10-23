<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { isPasskeyCancel, resetWithPasskey } from '$lib/app/passkey';

	let { data, form } = $props();

	let passkeyName = $state('');
	let passkeyError = $state('');
	let busy = $state(false);

	async function registerPasskey(e: SubmitEvent) {
		e.preventDefault();
		passkeyError = '';
		busy = true;
		try {
			await resetWithPasskey(page.params.token!, passkeyName);
			await goto(resolve('/'), { invalidateAll: true });
		} catch (err) {
			if (!isPasskeyCancel(err)) passkeyError = err instanceof Error ? err.message : 'パスキーを登録できませんでした。';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>ログイン方法の再設定 — Stockify</title></svelte:head>

<div style="max-width:28rem; margin:2rem auto; background:var(--card); border:1px solid var(--border); border-radius:0.6rem; padding:1.2rem;">
	<h1 style="font-size:1.3rem; margin:0 0 0.6rem;">ログイン方法の再設定</h1>

	{#if data.username === null}
		<p style="color:var(--danger);">このリンクは使えません(期限切れ・使用済み・取り消し済み)。管理者に再発行を依頼してください。</p>
	{:else}
		<p style="font-size:0.85rem; color:var(--muted); margin:0 0 0.8rem;">
			<b>{data.username}</b> の新しいパスワードを設定するか、パスキーを登録してください。登録済みのパスキーはすべて削除され、ほかの端末のログインもすべてログアウトされます。
		</p>

		<h2 style="font-size:1rem; margin:0 0 0.4rem;">新しいパスワードを設定</h2>
		<form method="POST" use:enhance style="display:flex; flex-direction:column; gap:0.6rem;">
			<input type="text" name="username" autocomplete="username" value={data.username} hidden readonly />
			<label>
				<span style="display:block; margin-bottom:0.2rem;">新しいパスワード(8〜256文字)</span>
				<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="256" required style="width:100%; box-sizing:border-box;" />
			</label>
			<label>
				<span style="display:block; margin-bottom:0.2rem;">新しいパスワード(確認)</span>
				<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="256" required style="width:100%; box-sizing:border-box;" />
			</label>
			{#if form?.error}<p style="color:var(--danger); margin:0;">{form.error}</p>{/if}
			<button type="submit" style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.5rem 0.8rem; cursor:pointer;">パスワードを設定してログイン</button>
		</form>

		<h2 style="font-size:1rem; margin:1.2rem 0 0.4rem;">またはパスキーを登録</h2>
		<form onsubmit={registerPasskey} style="display:flex; gap:0.5rem;">
			<input bind:value={passkeyName} placeholder="名前(例: iPhone)" maxlength="50" style="flex:1; min-width:0;" />
			<button type="submit" disabled={busy}>パスキーを登録</button>
		</form>
		{#if passkeyError}<p style="color:var(--danger); margin:0.6rem 0 0;">{passkeyError}</p>{/if}
	{/if}
</div>
