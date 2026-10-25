<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import { formatDate } from '#lib/format.js';
	import {
		ApiError,
		REAUTH_REQUIRED,
		addPasskey,
		deletePasskey,
		isPasskeyCancel,
		reauthenticate,
		removeOwnPassword,
		renamePasskey,
		reauthErrorMessage
	} from '#lib/app/passkey.js';

	interface Credentials {
		hasPassword: boolean;
		passkeys: { id: string; name: string; createdAt: number; lastUsedAt: number | null }[];
	}
	let { credentials: creds }: { credentials: Credentials } = $props();

	/** パスワードなしで最後の1つなら、そのパスキーは消せない。 */
	const lastPasskeyLocked = $derived(!creds.hasPassword && creds.passkeys.length <= 1);

	let errorMessage = $state('');
	let notice = $state('');
	let busy = $state(false);
	let newPasskeyName = $state('');

	/** 本人確認が要ると言われた操作。確認できたら再実行する。 */
	let pending = $state<{ action: () => Promise<unknown>; done: string } | null>(null);
	let reauthPassword = $state('');

	/** 操作を実行して画面を更新する。428 なら本人確認を挟んでから再実行する。 */
	async function run(action: () => Promise<unknown>, done: string): Promise<boolean> {
		errorMessage = '';
		notice = '';
		busy = true;
		try {
			await action();
			await refreshAll();
			notice = done;
			return true;
		} catch (err) {
			if (err instanceof ApiError && err.status === REAUTH_REQUIRED) pending = { action, done };
			else if (!isPasskeyCancel(err)) errorMessage = err instanceof Error ? err.message : '操作に失敗しました。';
			return false;
		} finally {
			busy = false;
		}
	}

	async function confirmIdentity(password?: string) {
		if (!pending) return;
		const { action, done } = pending;
		errorMessage = '';
		busy = true;
		try {
			await reauthenticate(password);
		} catch (err) {
			errorMessage = reauthErrorMessage(err) ?? errorMessage;
			return;
		} finally {
			busy = false;
		}
		pending = null;
		reauthPassword = '';
		await run(action, done);
	}

	async function onAddPasskey(e: SubmitEvent) {
		e.preventDefault();
		const name = newPasskeyName;
		if (await run(() => addPasskey(name), 'パスキーを追加しました。')) newPasskeyName = '';
	}

	function onRename(id: string, current: string) {
		const name = window.prompt('パスキーの名前', current);
		if (name === null || name.trim() === current) return;
		run(() => renamePasskey(id, name), 'パスキーの名前を変更しました。');
	}

	function onDeletePasskey(id: string, name: string) {
		if (!window.confirm(`パスキー「${name}」を削除しますか?\nこの端末以外のログインはすべてログアウトされます。`)) return;
		run(() => deletePasskey(id), 'パスキーを削除しました。');
	}

	function onRemovePassword() {
		if (!window.confirm('パスワードを削除して、パスキーでしかログインできないようにしますか?\nこの端末以外のログインはすべてログアウトされます。')) return;
		run(removeOwnPassword, 'パスワードを削除しました。今後はパスキーでログインしてください。');
	}

	const section =
		'background:var(--card); border:1px solid var(--border); border-radius:0.6rem; padding:0.9rem; margin-bottom:1rem;';
	const smallButton =
		'border:1px solid var(--border); background:var(--card); color:var(--text); border-radius:0.4rem; padding:0.3rem 0.6rem; cursor:pointer;';
</script>

<div style={section}>
	<h2 style="margin:0 0 0.5rem; font-size:1rem;">パスキー</h2>
	<p style="font-size:0.85rem; color:var(--muted); margin:0 0 0.6rem;">指紋・顔認証などで、パスワードを入力せずにログインできます。</p>

	{#if pending}
		<div style="border:1px solid var(--warn); border-radius:0.5rem; padding:0.7rem; margin-bottom:0.7rem; display:flex; flex-direction:column; gap:0.5rem;">
			<b style="font-size:0.9rem;">本人確認</b>
			<span style="font-size:0.85rem; color:var(--muted);">ログイン方法を変更するため、本人確認をしてください。</span>
			{#if creds.passkeys.length > 0}
				<button type="button" disabled={busy} onclick={() => confirmIdentity()} style="align-self:flex-start; background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.4rem 0.8rem; cursor:pointer;">パスキーで確認</button>
			{/if}
			{#if creds.hasPassword}
				<form onsubmit={(e) => (e.preventDefault(), confirmIdentity(reauthPassword))} style="display:flex; gap:0.5rem;">
					<input type="password" bind:value={reauthPassword} placeholder="現在のパスワード" autocomplete="current-password" required style="flex:1; min-width:0;" />
					<button type="submit" disabled={busy} style={smallButton}>パスワードで確認</button>
				</form>
			{/if}
			<button type="button" onclick={() => (pending = null)} style="align-self:flex-start; border:none; background:none; color:var(--muted); text-decoration:underline; padding:0; cursor:pointer;">やめる</button>
		</div>
	{/if}

	{#if creds.passkeys.length > 0}
		<ul style="list-style:none; padding:0; margin:0 0 0.7rem; display:flex; flex-direction:column; gap:0.4rem;">
			{#each creds.passkeys as pk (pk.id)}
				<li style="display:flex; flex-wrap:wrap; gap:0.5rem; align-items:center;">
					<span style="display:flex; flex-direction:column;">
						<span>{pk.name}</span>
						<span style="font-size:0.75rem; color:var(--muted);">登録 {formatDate(pk.createdAt)} ・ 最終使用 {pk.lastUsedAt ? formatDate(pk.lastUsedAt) : '未使用'}</span>
					</span>
					<span style="margin-left:auto; display:flex; gap:0.4rem;">
						<button type="button" disabled={busy} onclick={() => onRename(pk.id, pk.name)} style={smallButton}>名前変更</button>
						<button
							type="button"
							disabled={busy || lastPasskeyLocked}
							title={lastPasskeyLocked ? 'パスワードがないため、最後のパスキーは削除できません' : undefined}
							onclick={() => onDeletePasskey(pk.id, pk.name)}
							style="border:1px solid var(--danger); background:var(--card); color:var(--danger); border-radius:0.4rem; padding:0.3rem 0.6rem; cursor:pointer;"
							>削除</button
						>
					</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p style="font-size:0.85rem; color:var(--muted);">まだ登録されていません。</p>
	{/if}
	<form onsubmit={onAddPasskey} style="display:flex; gap:0.5rem;">
		<input bind:value={newPasskeyName} placeholder="名前(例: iPhone)" maxlength="50" style="flex:1; min-width:0;" />
		<button type="submit" disabled={busy} style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.4rem 0.8rem; cursor:pointer;">パスキーを追加</button>
	</form>

	{#if creds.hasPassword}
		<h3 style="margin:1rem 0 0.4rem; font-size:0.95rem;">パスワードの削除</h3>
		{#if creds.passkeys.length > 0}
			<p style="font-size:0.85rem; color:var(--muted); margin:0 0 0.5rem;">パスワードを削除すると、パスキーでしかログインできなくなります。</p>
			<button type="button" disabled={busy} onclick={onRemovePassword} style="border:1px solid var(--danger); background:var(--card); color:var(--danger); border-radius:0.4rem; padding:0.4rem 0.8rem; cursor:pointer;">パスワードを削除</button>
		{:else}
			<p style="font-size:0.85rem; color:var(--muted); margin:0;">パスワードを削除するには、先にパスキーを登録してください。</p>
		{/if}
	{/if}

	{#if errorMessage}<p style="color:var(--danger); margin:0.6rem 0 0;">{errorMessage}</p>{/if}
	{#if notice}<p style="color:var(--ok); margin:0.6rem 0 0;">{notice}</p>{/if}
</div>
