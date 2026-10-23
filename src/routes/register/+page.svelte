<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { signupWithPasskey, isPasskeyCancel } from '#lib/app/passkey.js';
	let { data, form } = $props();

	let method = $state<'passkey' | 'password'>('passkey');
	let passkeyError = $state('');
	let busy = $state(false);

	/** パスキーで登録する場合はフォームアクションを送らず API で登録する(世帯の扱いは同じ)。 */
	const submit: SubmitFunction = ({ cancel, formData }) => {
		if (method !== 'passkey') return;
		cancel();
		signup(formData);
	};

	async function signup(fd: FormData) {
		passkeyError = '';
		busy = true;
		try {
			await signupWithPasskey({
				username: String(fd.get('username') ?? ''),
				invite: String(fd.get('invite') ?? ''),
				household: String(fd.get('household') ?? '')
			});
			await goto(resolve('/'), { refreshAll: true });
		} catch (err) {
			if (!isPasskeyCancel(err)) passkeyError = err instanceof Error ? err.message : '登録に失敗しました。';
		} finally {
			busy = false;
		}
	}
</script>

<h1 style="font-size:1.3rem;">アカウント登録</h1>
{#if !data.requireInvite}
	<p style="color:var(--muted); font-size:0.9rem;">
		最初のユーザーです。あなたがインスタンス管理者になり、最初の世帯が作られます。
	</p>
{/if}

<form
	method="POST"
	use:enhance={submit}
	style="display:flex; flex-direction:column; gap:0.8rem; max-width:22rem;"
>
	<label style="display:flex; flex-direction:column; gap:0.25rem;">
		<span>ユーザー名</span>
		<input name="username" value={form?.username ?? ''} required autocomplete="username" />
	</label>
	<fieldset style="display:flex; flex-direction:column; gap:0.3rem; border:none; padding:0; margin:0;">
		<legend style="margin-bottom:0.25rem;">ログイン方法</legend>
		<label><input type="radio" bind:group={method} value="passkey" /> パスキー(指紋・顔認証など)</label>
		<label><input type="radio" bind:group={method} value="password" /> パスワード</label>
	</fieldset>
	{#if method === 'password'}
		<label style="display:flex; flex-direction:column; gap:0.25rem;">
			<span>パスワード</span>
			<input name="password" type="password" required autocomplete="new-password" />
		</label>
	{:else}
		<small style="color:var(--muted);">登録後、アカウント画面からパスワードやほかの端末のパスキーも追加できます。</small>
	{/if}
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

	{#if form?.error}
		<p style="color:var(--danger); margin:0;">{form.error}</p>
	{/if}

	{#if passkeyError}
		<p style="color:var(--danger); margin:0;">{passkeyError}</p>
	{/if}

	<button
		type="submit"
		disabled={busy}
		style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.6rem; cursor:pointer;"
	>{busy ? '確認中…' : '登録する'}</button>

	<a
		href={resolve('login')}
		style="color:var(--muted); font-size:0.9rem;"
	>ログインはこちら</a>
</form>
