<script lang="ts">
	import { resolve } from '$app/paths';
	let { data, form } = $props();

	const unusable: Record<string, string> = {
		used: 'この招待コードは既に使われています。',
		expired: 'この招待コードは有効期限が切れています。',
		revoked: 'この招待コードは無効化されています。'
	};
	const primary =
		'background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.6rem; cursor:pointer;';
	const secondary =
		'background:var(--card); color:var(--accent); border:1px solid var(--accent); border-radius:0.5rem; padding:0.6rem; cursor:pointer;';
</script>

<svelte:head><title>世帯への招待 — Stockify</title></svelte:head>

<div style="max-width:28rem; margin:2rem auto; background:var(--card); border:1px solid var(--border); border-radius:0.6rem; padding:1.2rem; display:flex; flex-direction:column; gap:0.8rem;">
	<h1 style="font-size:1.3rem; margin:0;">世帯「{data.invite.householdName}」への招待</h1>
	{#if data.invite.issuer}
		<p style="margin:0; color:var(--muted); font-size:0.9rem;">{data.invite.issuer} さんからの招待です。</p>
	{/if}

	{#if data.invite.alreadyMember}
		<p style="margin:0;">この世帯には既に参加しています。</p>
		<form method="POST" style="display:flex; flex-direction:column;">
			<button type="submit" style={primary}>この世帯を開く</button>
		</form>
	{:else if data.invite.state !== 'active'}
		<p style="margin:0; color:var(--danger);">{unusable[data.invite.state]}招待した人に再発行を依頼してください。</p>
	{:else if data.loggedIn}
		<!-- 参加後は世帯のデータを読み直すため、enhance を使わずページごと遷移する。 -->
		<form method="POST" style="display:flex; flex-direction:column;">
			<button type="submit" style={primary}>参加する</button>
		</form>
	{:else}
		<p style="margin:0; font-size:0.9rem;">参加するには、ログインするかアカウントを登録してください。</p>
		<!-- クエリ付きの移動先なので GET フォームで送る(ログイン後は確認画面へ戻る)。 -->
		<form method="GET" action={resolve('/register')} style="display:flex; flex-direction:column;">
			<input type="hidden" name="invite" value={data.code} />
			<button type="submit" style={primary}>アカウントを登録して参加</button>
		</form>
		<form method="GET" action={resolve('/login')} style="display:flex; flex-direction:column;">
			<input type="hidden" name="next" value={`/invite/${data.code}`} />
			<button type="submit" style={secondary}>ログインして参加</button>
		</form>
	{/if}

	{#if form?.error}<p style="color:var(--danger); margin:0;">{form.error}</p>{/if}
</div>
