<script lang="ts">
	/** 本人確認(パスキーかパスワード)を求める欄。確認そのものは呼び出し側が行う。 */
	let {
		hasPassword,
		hasPasskey,
		busy = false,
		message,
		onconfirm,
		oncancel
	}: {
		hasPassword: boolean;
		hasPasskey: boolean;
		busy?: boolean;
		message: string;
		onconfirm: (password?: string) => void;
		oncancel?: () => void;
	} = $props();

	let password = $state('');
</script>

<div style="border:1px solid var(--warn); border-radius:0.5rem; padding:0.7rem; margin-bottom:0.7rem; display:flex; flex-direction:column; gap:0.5rem;">
	<b style="font-size:0.9rem;">本人確認</b>
	<span style="font-size:0.85rem; color:var(--muted);">{message}</span>
	{#if hasPasskey}
		<button type="button" disabled={busy} onclick={() => onconfirm()} style="align-self:flex-start; background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.4rem 0.8rem; cursor:pointer;">パスキーで確認</button>
	{/if}
	{#if hasPassword}
		<form onsubmit={(e) => (e.preventDefault(), onconfirm(password))} style="display:flex; gap:0.5rem;">
			<input type="password" bind:value={password} placeholder="現在のパスワード" autocomplete="current-password" required style="flex:1; min-width:0;" />
			<button type="submit" disabled={busy} style="border:1px solid var(--border); background:var(--card); color:var(--text); border-radius:0.4rem; padding:0.3rem 0.6rem; cursor:pointer;">パスワードで確認</button>
		</form>
	{/if}
	{#if oncancel}
		<button type="button" onclick={oncancel} style="align-self:flex-start; border:none; background:none; color:var(--muted); text-decoration:underline; padding:0; cursor:pointer;">やめる</button>
	{/if}
</div>
