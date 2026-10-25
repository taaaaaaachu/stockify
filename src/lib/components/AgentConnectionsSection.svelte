<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import { formatDate } from '#lib/format.js';
	import { ApiError, REAUTH_REQUIRED, api, isPasskeyCancel, reauthenticate } from '#lib/app/passkey.js';
	import ReauthPrompt from './ReauthPrompt.svelte';

	interface Connection {
		id: string;
		name: string;
		householdName: string;
		origin: string;
		createdAt: number;
		lastUsedAt: number;
	}
	let {
		connections,
		households,
		mcpUrl,
		credentials
	}: {
		connections: Connection[];
		households: { id: string; name: string }[];
		mcpUrl: string;
		credentials: { hasPassword: boolean; passkeys: unknown[] };
	} = $props();

	let name = $state('');
	let householdId = $state('');
	let busy = $state(false);
	let errorMessage = $state('');
	let needsReauth = $state(false);
	/** 発行直後に一度だけ見せるトークン。 */
	let issued = $state<{ name: string; token: string } | null>(null);

	$effect(() => {
		if (!householdId && households.length > 0) householdId = households[0].id;
	});

	async function issue() {
		errorMessage = '';
		busy = true;
		try {
			const r = await api<{ token: string }>('/api/agent-connections', { method: 'POST', body: JSON.stringify({ name, householdId }) });
			issued = { name, token: r.token };
			name = '';
			await refreshAll();
		} catch (err) {
			if (err instanceof ApiError && err.status === REAUTH_REQUIRED) needsReauth = true;
			else errorMessage = err instanceof Error ? err.message : '発行に失敗しました。';
		} finally {
			busy = false;
		}
	}

	async function confirmIdentity(password?: string) {
		errorMessage = '';
		busy = true;
		try {
			await reauthenticate(password);
		} catch (err) {
			if (!isPasskeyCancel(err)) errorMessage = err instanceof Error ? err.message : '本人確認できませんでした。';
			return;
		} finally {
			busy = false;
		}
		needsReauth = false;
		await issue();
	}

	async function revoke(c: Connection) {
		if (!window.confirm(`エージェント接続「${c.name}」(${c.householdName})を取り消しますか?`)) return;
		errorMessage = '';
		try {
			await api(`/api/agent-connections/${c.id}`, { method: 'DELETE' });
			await refreshAll();
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : '取り消しに失敗しました。';
		}
	}

	const section =
		'background:var(--card); border:1px solid var(--border); border-radius:0.6rem; padding:0.9rem; margin-bottom:1rem;';
</script>

<div style={section}>
	<h2 style="margin:0 0 0.5rem; font-size:1rem;">エージェント接続</h2>
	<p style="font-size:0.85rem; color:var(--muted); margin:0 0 0.6rem;">
		AI エージェントに、選んだ世帯の在庫を操作させます。MCP の URL は <code>{mcpUrl}</code> です。OAuth に対応したエージェントはこの URL だけで繋がります。対応していないエージェントには、ここでトークンを発行して渡してください。90日使われない接続は自動で消えます。
	</p>

	{#if connections.length > 0}
		<ul style="list-style:none; padding:0; margin:0 0 0.7rem; display:flex; flex-direction:column; gap:0.4rem;">
			{#each connections as c (c.id)}
				<li style="display:flex; flex-wrap:wrap; gap:0.5rem; align-items:center;">
					<span style="display:flex; flex-direction:column;">
						<span>{c.name} <span style="color:var(--muted); font-size:0.85rem;">→ {c.householdName}</span></span>
						<span style="font-size:0.75rem; color:var(--muted);">{c.origin} ・ 作成 {formatDate(c.createdAt)} ・ 最終使用 {formatDate(c.lastUsedAt)}</span>
					</span>
					<button
						type="button"
						onclick={() => revoke(c)}
						style="margin-left:auto; border:1px solid var(--danger); background:var(--card); color:var(--danger); border-radius:0.4rem; padding:0.3rem 0.6rem; cursor:pointer;"
						>取り消す</button
					>
				</li>
			{/each}
		</ul>
	{:else}
		<p style="font-size:0.85rem; color:var(--muted);">まだありません。</p>
	{/if}

	{#if issued}
		<div style="border:1px solid var(--ok); border-radius:0.5rem; padding:0.7rem; margin-bottom:0.7rem; display:flex; flex-direction:column; gap:0.4rem;">
			<b style="font-size:0.9rem;">「{issued.name}」のトークン</b>
			<span style="font-size:0.85rem; color:var(--muted);">この画面を離れると二度と表示できません。エージェントの設定で <code>Authorization: Bearer &lt;トークン&gt;</code> として使います。</span>
			<input readonly value={issued.token} onfocus={(e) => e.currentTarget.select()} style="font-family:monospace; width:100%; box-sizing:border-box;" />
			<button type="button" onclick={() => (issued = null)} style="align-self:flex-start; border:none; background:none; color:var(--muted); text-decoration:underline; padding:0; cursor:pointer;">閉じる</button>
		</div>
	{/if}

	{#if needsReauth}
		<ReauthPrompt
			hasPassword={credentials.hasPassword}
			hasPasskey={credentials.passkeys.length > 0}
			{busy}
			message="エージェント接続を作るため、本人確認をしてください。"
			onconfirm={confirmIdentity}
			oncancel={() => (needsReauth = false)}
		/>
	{/if}

	{#if households.length > 0}
		<form onsubmit={(e) => (e.preventDefault(), issue())} style="display:flex; flex-wrap:wrap; gap:0.5rem;">
			<input bind:value={name} placeholder="名前(例: muse)" maxlength="50" required style="flex:1; min-width:8rem;" />
			<select bind:value={householdId} aria-label="世帯">
				{#each households as h (h.id)}<option value={h.id}>{h.name}</option>{/each}
			</select>
			<button type="submit" disabled={busy} style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.4rem 0.8rem; cursor:pointer;">トークンを発行</button>
		</form>
	{/if}

	{#if errorMessage}<p style="color:var(--danger); margin:0.6rem 0 0;">{errorMessage}</p>{/if}
</div>
