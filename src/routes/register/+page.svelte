<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
</script>

<h1 style="font-size:1.3rem;">アカウント登録</h1>
{#if !data.requireInvite}
	<p style="color:var(--muted); font-size:0.9rem;">
		最初のユーザーです。あなたがインスタンス管理者になり、最初の世帯が作られます。
	</p>
{/if}

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
		<input name="password" type="password" required autocomplete="new-password" />
	</label>
	{#if data.requireInvite}
		<label style="display:flex; flex-direction:column; gap:0.25rem;">
			<span>招待コード</span>
			<input name="invite" required />
			<small style="color:var(--muted);">招かれた世帯にメンバーとして参加します。</small>
		</label>
	{:else}
		<label style="display:flex; flex-direction:column; gap:0.25rem;">
			<span>最初の世帯名</span>
			<input name="household" placeholder="自宅" />
		</label>
	{/if}

	{#if form?.error}<p style="color:var(--danger); margin:0;">{form.error}</p>{/if}

	<button
		type="submit"
		style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.6rem; cursor:pointer;"
		>登録する</button
	>
	<a href="/login" style="color:var(--muted); font-size:0.9rem;">ログインはこちら</a>
</form>
