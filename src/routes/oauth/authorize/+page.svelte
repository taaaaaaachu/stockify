<script lang="ts">
	import { page } from '$app/state';
	import { isPasskeyCancel, reauthenticate } from '#lib/app/passkey.js';
	import ReauthPrompt from '#lib/components/ReauthPrompt.svelte';

	let { data, form } = $props();

	let householdId = $state('');
	let name = $state('');
	let busy = $state(false);
	let reauthError = $state('');
	let reauthed = $state(false);
	const needsReauth = $derived(!reauthed && (data.needsReauth || form?.reauth === true));

	$effect(() => {
		if (!householdId && data.households?.length) householdId = data.households[0].id;
	});

	async function confirmIdentity(password?: string) {
		reauthError = '';
		busy = true;
		try {
			await reauthenticate(password);
			reauthed = true;
		} catch (err) {
			if (!isPasskeyCancel(err)) reauthError = err instanceof Error ? err.message : '本人確認できませんでした。';
		} finally {
			busy = false;
		}
	}

	// 名前付きアクションは元の認可リクエストのクエリを残したまま送る。
	const action = (name: 'allow' | 'deny') => `${page.url.search}&/${name}`;
</script>

<div style="max-width:28rem; margin:2rem auto; background:var(--card); border:1px solid var(--border); border-radius:0.6rem; padding:1.2rem;">
	{#if data.error}
		<h1 style="font-size:1.2rem; margin:0 0 0.6rem;">接続できません</h1>
		<p style="color:var(--danger); margin:0;">{data.error}</p>
	{:else if data.client}
		<h1 style="font-size:1.2rem; margin:0 0 0.6rem;">エージェント接続の許可</h1>
		<p style="margin:0 0 0.3rem; font-size:1.3rem;"><b>{data.client.host}</b></p>
		{#if data.client.kind === 'dcr'}<p style="margin:0 0 0.3rem; font-size:0.8rem; color:var(--muted);">(許可後の戻り先のドメイン。このクライアントは自己登録のため、ドメインで身元を確かめられません)</p>{/if}
		{#if data.client.name}<p style="margin:0 0 0.6rem; color:var(--muted);">「{data.client.name}」と名乗っています</p>{/if}
		<p style="font-size:0.9rem; margin:0 0 0.8rem;">
			このエージェントに、選んだ世帯の在庫(品目・購入・使い切り・残量補正・定期便・商品リンク)の閲覧と変更を許可します。
			世帯の owner なら、リードタイムの既定値も変更できます。世帯のメンバーや招待、アカウントには触れられません。
		</p>
		<p style="font-size:0.85rem; color:var(--warn); margin:0 0 0.8rem;">
			心当たりのないドメイン({data.client.host})なら許可しないでください。{#if data.client.kind === 'cimd'}許可後の戻り先は {data.client.redirectHost} です。{/if}
		</p>

		{#if data.households.length === 0}
			<p style="color:var(--danger);">所属している世帯がありません。</p>
		{:else}
			{#if needsReauth}
				<ReauthPrompt
					hasPassword={data.hasPassword}
					hasPasskey={data.hasPasskey}
					{busy}
					message="エージェント接続を作るため、本人確認をしてください。"
					onconfirm={confirmIdentity}
				/>
				{#if reauthError}<p style="color:var(--danger); margin:0 0 0.6rem;">{reauthError}</p>{/if}
			{/if}
			<form method="POST" action={action('allow')} style="display:flex; flex-direction:column; gap:0.7rem;">
				<label style="display:flex; flex-direction:column; gap:0.25rem;">
					<span>操作させる世帯</span>
					<select name="householdId" bind:value={householdId}>
						{#each data.households as h (h.id)}<option value={h.id}>{h.name}</option>{/each}
					</select>
				</label>
				<label style="display:flex; flex-direction:column; gap:0.25rem;">
					<span>接続の名前(一覧での表示用)</span>
					<input name="name" bind:value={name} maxlength="50" placeholder={data.client.name ?? data.client.host} />
				</label>
				<button type="submit" disabled={needsReauth} style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.6rem; cursor:pointer;">許可する</button>
			</form>
		{/if}
		<form method="POST" action={action('deny')} style="margin-top:0.6rem; text-align:center;">
			<button type="submit" style="border:none; background:none; color:var(--muted); cursor:pointer; text-decoration:underline;">許可しない</button>
		</form>
		{#if form?.error}<p style="color:var(--danger); margin:0.6rem 0 0;">{form.error}</p>{/if}
	{/if}
</div>
