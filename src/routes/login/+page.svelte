<script lang="ts">
	import { enhance } from '$app/forms';
	let { form } = $props();
</script>

<h1 style="font-size:1.3rem;">ログイン</h1>

<form
	method="POST"
	use:enhance
	style="display:flex; flex-direction:column; gap:0.8rem; max-width:22rem;"
>
	<label style="display:flex; flex-direction:column; gap:0.25rem;">
		<span>ユーザー名</span>
		<input name="username" value={form?.username ?? ''} required autocomplete="username" />
	</label>
	<label style="display:flex; flex-direction:column; gap:0.25rem;">
		<span>パスワード</span>
		<input name="password" type="password" required autocomplete="current-password" />
	</label>

	{#if form?.error}<p style="color:var(--danger); margin:0;">{form.error}</p>{/if}

	<button
		type="submit"
		style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.6rem; cursor:pointer;"
		>ログイン</button
	>
	<a href="/register" style="color:var(--muted); font-size:0.9rem;">アカウント登録はこちら</a>
</form>
