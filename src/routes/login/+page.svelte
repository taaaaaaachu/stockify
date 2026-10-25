<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { browserSupportsWebAuthnAutofill } from '@simplewebauthn/browser';
	import { loginWithPasskey, isPasskeyCancel } from '#lib/app/passkey.js';
	let { form, data } = $props();

	let passkeyError = $state('');
	let busy = $state(false);

	async function passkeyLogin(useBrowserAutofill: boolean) {
		try {
			await loginWithPasskey(useBrowserAutofill);
			// 戻り先(OAuth の同意画面など)はアプリ内のルートとは限らないので、ページごと読み込む。
			if (data.next === '/') await goto(resolve('/'), { refreshAll: true });
			else location.assign(data.next);
		} catch (err) {
			if (isPasskeyCancel(err)) return;
			passkeyError = err instanceof Error ? err.message : 'パスキーでログインできませんでした。';
		}
	}

	async function onPasskeyButton() {
		passkeyError = '';
		busy = true;
		await passkeyLogin(false);
		busy = false;
	}

	// ユーザー名欄のオートフィルにパスキーを出す(対応ブラウザのみ)。
	onMount(async () => {
		if (await browserSupportsWebAuthnAutofill()) passkeyLogin(true);
	});
</script>

<h1 style="font-size:1.3rem;">ログイン</h1>

{#if data.deleted}<p style="color:var(--ok);">アカウントを削除しました。</p>{/if}

<div style="display:flex; flex-direction:column; gap:0.5rem; max-width:22rem; margin-bottom:1.2rem;">
	<button
		type="button"
		onclick={onPasskeyButton}
		disabled={busy}
		style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.6rem; cursor:pointer;"
		>{busy ? '確認中…' : 'パスキーでログイン'}</button
	>
	{#if passkeyError}<p style="color:var(--danger); margin:0;">{passkeyError}</p>{/if}
	<p style="color:var(--muted); font-size:0.85rem; text-align:center; margin:0.4rem 0 0;">または パスワードでログイン</p>
</div>

<form
	method="POST"
	use:enhance
	style="display:flex; flex-direction:column; gap:0.8rem; max-width:22rem;"
>
	<label style="display:flex; flex-direction:column; gap:0.25rem;">
		<span>ユーザー名</span>
		<input name="username" value={form?.username ?? ''} required autocomplete="username webauthn" />
	</label>
	<label style="display:flex; flex-direction:column; gap:0.25rem;">
		<span>パスワード</span>
		<input name="password" type="password" required autocomplete="current-password" />
	</label>

	{#if form?.error}<p style="color:var(--danger); margin:0;">{form.error}</p>{/if}

	<button
		type="submit"
		style="background:var(--card); color:var(--accent); border:1px solid var(--accent); border-radius:0.5rem; padding:0.6rem; cursor:pointer;"
	>ログイン</button>

	<a
		href={resolve('register')}
		style="color:var(--muted); font-size:0.9rem;"
	>アカウント登録はこちら</a>
</form>
