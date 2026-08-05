<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let { forced = false } = $props<{ forced?: boolean }>();
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let busy = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		errorMessage = '';
		successMessage = '';
		busy = true;
		try {
			const res = await fetch('/api/account/password', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) {
				errorMessage = result.message ?? 'パスワードの変更に失敗しました。';
				return;
			}
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
			successMessage = 'パスワードを変更しました。';
			await invalidateAll();
		} finally {
			busy = false;
		}
	}
</script>

<div
	style="max-width:28rem; margin:3rem auto; background:var(--card); border:1px solid var(--border); border-radius:0.6rem; padding:1.2rem;"
>
	<h1 style="font-size:1.3rem; margin:0 0 0.6rem;">パスワードの変更</h1>
	{#if forced}
		<p style="color:var(--warn); margin:0 0 0.8rem;">
			管理者が発行した一時パスワードです。続けるには新しいパスワードへ変更してください。
		</p>
	{/if}
	<form onsubmit={submit} style="display:flex; flex-direction:column; gap:0.6rem;">
		{#if !forced}
			<label>
				<span style="display:block; margin-bottom:0.2rem;">現在のパスワード</span>
				<input bind:value={currentPassword} type="password" autocomplete="current-password" required />
			</label>
		{/if}
		<label>
			<span style="display:block; margin-bottom:0.2rem;">新しいパスワード(8〜256文字)</span>
			<input bind:value={newPassword} type="password" autocomplete="new-password" minlength="8" maxlength="256" required />
		</label>
		<label>
			<span style="display:block; margin-bottom:0.2rem;">新しいパスワード(確認)</span>
			<input bind:value={confirmPassword} type="password" autocomplete="new-password" minlength="8" maxlength="256" required />
		</label>
		<button type="submit" disabled={busy} style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.5rem 0.8rem; cursor:pointer;">パスワードを変更</button>
	</form>
	{#if errorMessage}<p style="color:var(--danger); margin:0.6rem 0 0;">{errorMessage}</p>{/if}
	{#if successMessage}<p style="color:var(--ok); margin:0.6rem 0 0;">{successMessage}</p>{/if}
	<form method="POST" action="/logout" style="margin-top:0.8rem; text-align:center;">
		<button type="submit" style="border:none; background:none; color:var(--muted); cursor:pointer;">ログアウト</button>
	</form>
</div>
