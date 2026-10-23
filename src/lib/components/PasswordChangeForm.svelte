<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import {
		ApiError,
		REAUTH_REQUIRED,
		addPasskey,
		api,
		isPasskeyCancel,
		reauthenticate,
		withPasskeyReauth
	} from '$lib/app/passkey';

	/** hasPassword=false はパスキーのみの会員。現在のパスワードの代わりにパスキーで本人確認して設定する。 */
	let { forced = false, hasPassword = true } = $props<{ forced?: boolean; hasPassword?: boolean }>();
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let passkeyName = $state('');
	let busy = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');
	/** 強制変更でログインから時間が経っていたとき、一時パスワードで本人確認してから再実行する操作(ADR 0011)。 */
	let pending = $state<{ action: () => Promise<unknown>; success: string } | null>(null);
	let temporaryPassword = $state('');

	async function run(action: () => Promise<unknown>, success: string) {
		errorMessage = '';
		successMessage = '';
		busy = true;
		try {
			await action();
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
			passkeyName = '';
			successMessage = success;
			await invalidateAll();
		} catch (err) {
			if (forced && err instanceof ApiError && err.status === REAUTH_REQUIRED) pending = { action, success };
			else if (!isPasskeyCancel(err)) errorMessage = err instanceof Error ? err.message : 'パスワードの変更に失敗しました。';
		} finally {
			busy = false;
		}
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const body = JSON.stringify({ currentPassword, newPassword, confirmPassword });
		const call = () => api('/api/account/password', { method: 'POST', body });
		// 強制変更中はパスキーを持たないので、本人確認は一時パスワードで行う。
		void run(forced ? call : () => withPasskeyReauth(call), hasPassword ? 'パスワードを変更しました。' : 'パスワードを設定しました。');
	}

	function registerPasskey(e: SubmitEvent) {
		e.preventDefault();
		const name = passkeyName;
		void run(() => addPasskey(name), 'パスキーを登録しました。');
	}

	async function confirmIdentity(e: SubmitEvent) {
		e.preventDefault();
		if (!pending) return;
		const retry = pending;
		errorMessage = '';
		try {
			await reauthenticate(temporaryPassword);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : '本人確認できませんでした。';
			return;
		}
		pending = null;
		temporaryPassword = '';
		await run(retry.action, retry.success);
	}
</script>

<div
	style={forced
		? 'max-width:28rem; margin:3rem auto; background:var(--card); border:1px solid var(--border); border-radius:0.6rem; padding:1.2rem;'
		: 'background:var(--card); border:1px solid var(--border); border-radius:0.6rem; padding:0.9rem; margin-bottom:1rem;'}
>
	<h2 style={forced ? 'font-size:1.3rem; margin:0 0 0.6rem;' : 'margin:0 0 0.5rem; font-size:1rem;'}>{hasPassword ? 'パスワードの変更' : 'パスワードの設定'}</h2>
	{#if forced}
		<p style="color:var(--warn); margin:0 0 0.8rem;">
			管理者が発行した一時パスワードです。続けるには新しいパスワードへ変更するか、パスキーを登録してください。
		</p>
		{#if pending}
			<form onsubmit={confirmIdentity} style="display:flex; flex-direction:column; gap:0.6rem; margin:0 0 0.8rem; padding:0.8rem; border:1px solid var(--border); border-radius:0.5rem;">
				<span style="font-size:0.85rem; color:var(--muted);">ログインから時間が経ったため、一時パスワードで本人確認してください。</span>
				<input bind:value={temporaryPassword} type="password" autocomplete="current-password" placeholder="一時パスワード" required style="width:100%; box-sizing:border-box;" />
				<button type="submit" disabled={busy}>確認して続ける</button>
			</form>
		{/if}
	{:else if !hasPassword}
		<p style="font-size:0.85rem; color:var(--muted); margin:0 0 0.6rem;">
			いまはパスキーでのみログインできます。パスワードを設定すると、パスワードでもログインできるようになります。
		</p>
	{/if}
	<form onsubmit={submit} style="display:flex; flex-direction:column; gap:0.6rem; max-width:{forced ? '28rem' : '100%'};">
		{#if !forced && hasPassword}
			<label>
				<span style="display:block; margin-bottom:0.2rem;">現在のパスワード</span>
				<input bind:value={currentPassword} type="password" autocomplete="current-password" required style="width:100%; box-sizing:border-box;" />
			</label>
		{/if}
		<label>
			<span style="display:block; margin-bottom:0.2rem;">新しいパスワード(8〜256文字)</span>
			<input bind:value={newPassword} type="password" autocomplete="new-password" minlength="8" maxlength="256" required style="width:100%; box-sizing:border-box;" />
		</label>
		<label>
			<span style="display:block; margin-bottom:0.2rem;">新しいパスワード(確認)</span>
			<input bind:value={confirmPassword} type="password" autocomplete="new-password" minlength="8" maxlength="256" required style="width:100%; box-sizing:border-box;" />
		</label>
		<button type="submit" disabled={busy} style="align-self:{forced ? 'stretch' : 'flex-start'}; background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.5rem 0.8rem; cursor:pointer;">{hasPassword ? 'パスワードを変更' : 'パスワードを設定'}</button>
	</form>
	{#if forced}
		<h3 style="font-size:1rem; margin:1.2rem 0 0.4rem;">またはパスキーを登録</h3>
		<p style="font-size:0.85rem; color:var(--muted); margin:0 0 0.6rem;">パスキーを登録すると一時パスワードは削除され、パスキーでログインするようになります。</p>
		<form onsubmit={registerPasskey} style="display:flex; gap:0.5rem;">
			<input bind:value={passkeyName} placeholder="名前(例: iPhone)" maxlength="50" style="flex:1; min-width:0;" />
			<button type="submit" disabled={busy}>パスキーを登録</button>
		</form>
	{/if}
	{#if errorMessage}<p style="color:var(--danger); margin:0.6rem 0 0;">{errorMessage}</p>{/if}
	{#if successMessage}<p style="color:var(--ok); margin:0.6rem 0 0;">{successMessage}</p>{/if}
	{#if forced}
		<form method="POST" action="/logout" style="margin-top:0.8rem; text-align:center;">
			<button type="submit" style="border:none; background:none; color:var(--muted); cursor:pointer;">ログアウト</button>
		</form>
	{/if}
</div>
