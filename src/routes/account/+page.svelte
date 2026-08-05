<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { store } from '$lib/app/store.svelte';
	import { IndexedDbRepository } from '$lib/repo/indexeddb';
	import { formatDate } from '$lib/format';
	import { buildInviteRequestBody } from '$lib/app/inviteRequest';

	let { data } = $props();

	let newHousehold = $state('');
	let inviteExpiry = $state('');
	let lastCode = $state<string | null>(null);
	let busy = $state(false);
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordError = $state('');
	let passwordMessage = $state('');
	type AdminUser = { id: string; username: string };
	let adminUsers = $state<AdminUser[]>([]);
	let resetResult = $state<{ username: string; password: string } | null>(null);
	let adminError = $state('');

	// ゲスト(IndexedDB)に残っているローカルデータの件数(取り込み導線用)。
	let guestItemCount = $state(0);
	let importMsg = $state('');

	onMount(async () => {
		try {
			const guest = new IndexedDbRepository();
			const snap = await guest.exportAll();
			guestItemCount = snap.items.length;
		} catch {
			guestItemCount = 0;
		}
		if (data.user?.instanceRole === 'super_admin') {
			const res = await fetch('/api/admin/users');
			if (res.ok) adminUsers = await res.json();
		}
	});

	async function changeOwnPassword(e: SubmitEvent) {
		e.preventDefault();
		passwordError = '';
		passwordMessage = '';
		busy = true;
		try {
			const res = await fetch('/api/account/password', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) {
				passwordError = result.message ?? 'パスワードの変更に失敗しました。';
				return;
			}
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
			passwordMessage = 'パスワードを変更しました。';
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	async function resetUser(user: AdminUser) {
		adminError = '';
		resetResult = null;
		busy = true;
		try {
			const res = await fetch(`/api/admin/users/${user.id}/reset`, { method: 'POST' });
			const result = await res.json().catch(() => ({}));
			if (!res.ok) {
				adminError = result.message ?? 'パスワードのリセットに失敗しました。';
				return;
			}
			resetResult = { username: user.username, password: result.temporaryPassword };
		} finally {
			busy = false;
		}
	}

	async function createHousehold(e: SubmitEvent) {
		e.preventDefault();
		if (newHousehold.trim() === '') return;
		busy = true;
		try {
			await fetch('/api/households', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: newHousehold.trim() })
			});
			newHousehold = '';
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	async function createInvite(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const res = await fetch('/api/invites', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(buildInviteRequestBody(inviteExpiry))
			});
			const json = await res.json();
			lastCode = json.code ?? null;
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	async function revoke(id: string) {
		await fetch(`/api/invites/${id}/revoke`, { method: 'POST' });
		await invalidateAll();
	}
	async function remove(id: string) {
		await fetch(`/api/invites/${id}`, { method: 'DELETE' });
		await invalidateAll();
	}

	async function importGuest() {
		busy = true;
		importMsg = '';
		try {
			const guest = new IndexedDbRepository();
			const snap = await guest.exportAll();
			const res = await fetch('/api/import', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(snap)
			});
			const json = await res.json();
			importMsg = `${json.items} 件の品目を取り込みました。`;
			guestItemCount = 0;
			await store.load();
		} finally {
			busy = false;
		}
	}

	const stateLabel: Record<string, string> = {
		active: '有効',
		used: '使用済み',
		expired: '期限切れ',
		revoked: '無効化'
	};

	const section =
		'background:var(--card); border:1px solid var(--border); border-radius:0.6rem; padding:0.9rem; margin-bottom:1rem;';
</script>

<h1 style="font-size:1.3rem;">アカウント</h1>

<div style={section}>
	<div>ユーザー名: <b>{store.user?.username ?? '—'}</b></div>
	{#if store.user?.instanceRole === 'super_admin'}
		<div style="font-size:0.85rem; color:var(--accent);">インスタンス管理者</div>
	{/if}
</div>

<div style={section}>
	<h2 style="margin:0 0 0.5rem; font-size:1rem;">パスワード変更</h2>
	{#if store.user?.mustChangePassword}
		<p style="color:var(--warn); margin:0 0 0.6rem;">管理者が発行した一時パスワードです。続けるには新しいパスワードへ変更してください。</p>
	{/if}
	<form onsubmit={changeOwnPassword} style="display:flex; flex-direction:column; gap:0.5rem; max-width:28rem;">
		<input bind:value={currentPassword} type="password" placeholder="現在のパスワード" autocomplete="current-password" required />
		<input bind:value={newPassword} type="password" placeholder="新しいパスワード(8〜256文字)" autocomplete="new-password" minlength="8" maxlength="256" required />
		<input bind:value={confirmPassword} type="password" placeholder="新しいパスワード(確認)" autocomplete="new-password" minlength="8" maxlength="256" required />
		<button type="submit" disabled={busy} style="align-self:flex-start; background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.4rem 0.8rem; cursor:pointer;">パスワードを変更</button>
	</form>
	{#if passwordError}<p style="color:var(--danger); margin:0.5rem 0 0;">{passwordError}</p>{/if}
	{#if passwordMessage}<p style="color:var(--ok); margin:0.5rem 0 0;">{passwordMessage}</p>{/if}
</div>

<div style={section}>
	<h2 style="margin:0 0 0.5rem; font-size:1rem;">所属している世帯</h2>
	<ul style="list-style:none; padding:0; margin:0 0 0.7rem;">
		{#each store.households as h (h.id)}
			<li style="display:flex; gap:0.5rem; align-items:center; font-size:0.9rem;">
				<span>{h.name}</span>
				<span style="color:var(--muted);">({h.role === 'owner' ? 'オーナー' : 'メンバー'})</span>
				{#if store.activeHousehold?.id === h.id}
					<span style="color:var(--accent); font-size:0.75rem;">選択中</span>
				{/if}
			</li>
		{/each}
	</ul>
	<form onsubmit={createHousehold} style="display:flex; gap:0.5rem;">
		<input bind:value={newHousehold} placeholder="新しい世帯名(例: 実家)" style="flex:1;" />
		<button
			type="submit"
			disabled={busy}
			style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.4rem 0.8rem; cursor:pointer;"
			>世帯を作成</button
		>
	</form>
</div>

{#if guestItemCount > 0 && store.activeHousehold}
	<div style={section}>
		<h2 style="margin:0 0 0.5rem; font-size:1rem;">ゲストデータの取り込み</h2>
		<p style="font-size:0.9rem; color:var(--muted); margin:0 0 0.5rem;">
			この端末のゲスト(ローカル)に {guestItemCount} 件の品目があります。現在の世帯「{store
				.activeHousehold.name}」へ取り込めます(追記)。
		</p>
		<button
			onclick={importGuest}
			disabled={busy}
			style="background:var(--ok); color:#fff; border:none; border-radius:0.5rem; padding:0.4rem 0.8rem; cursor:pointer;"
			>取り込む</button
		>
		{#if importMsg}<span style="color:var(--ok); margin-left:0.5rem;">{importMsg}</span>{/if}
	</div>
{/if}

{#if data.canManage}
	<div style={section}>
		<h2 style="margin:0 0 0.5rem; font-size:1rem;">
			招待(世帯「{store.activeHousehold?.name}」へ招く)
		</h2>
		<form onsubmit={createInvite} style="display:flex; gap:0.5rem; align-items:center; margin-bottom:0.7rem;">
			<input
				bind:value={inviteExpiry}
				type="number"
				min="1"
				placeholder="有効日数(空欄=無期限)"
				style="flex:1;"
			/>
			<button
				type="submit"
				disabled={busy}
				style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.4rem 0.8rem; cursor:pointer;"
				>招待コードを発行</button
			>
		</form>
		{#if lastCode}
			<p style="font-size:0.9rem;">発行しました: <code style="font-weight:700;">{lastCode}</code></p>
		{/if}
		{#if data.invites.length > 0}
			<ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.3rem;">
				{#each data.invites as inv (inv.id)}
					<li style="display:flex; gap:0.5rem; align-items:center; font-size:0.85rem;">
						<code>{inv.code}</code>
						<span style="color:var(--muted);">{stateLabel[inv.state]}</span>
						{#if inv.invitee}<span style="color:var(--muted);">→ {inv.invitee}</span>{/if}
						{#if inv.expiresAt}<span style="color:var(--muted);">〜{formatDate(inv.expiresAt)}</span>{/if}
						<span style="margin-left:auto; display:flex; gap:0.4rem;">
							{#if inv.state === 'active'}
								<button onclick={() => revoke(inv.id)} style="border:none; background:none; color:var(--warn); cursor:pointer;">無効化</button>
							{/if}
							<button onclick={() => remove(inv.id)} style="border:none; background:none; color:var(--danger); cursor:pointer;">削除</button>
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

{#if data.user?.instanceRole === 'super_admin'}
	<div style={section}>
		<h2 style="margin:0 0 0.5rem; font-size:1rem;">ユーザーパスワードのリセット</h2>
		<p style="font-size:0.85rem; color:var(--muted);">リセットすると対象ユーザーの全セッションが無効になり、次回ログイン時に変更が必要になります。</p>
		{#if adminUsers.length === 0}
			<p style="color:var(--muted);">自分以外のユーザーはいません。</p>
		{:else}
			<ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.4rem;">
				{#each adminUsers as user (user.id)}
					<li style="display:flex; gap:0.5rem; align-items:center;">
						<span>{user.username}</span>
						<button onclick={() => resetUser(user)} disabled={busy} style="margin-left:auto; border:1px solid var(--warn); background:var(--card); color:var(--warn); border-radius:0.4rem; padding:0.3rem 0.6rem; cursor:pointer;">一時パスワードを発行</button>
					</li>
				{/each}
			</ul>
		{/if}
		{#if adminError}<p style="color:var(--danger);">{adminError}</p>{/if}
		{#if resetResult}
			<p style="color:var(--warn);">ユーザー <b>{resetResult.username}</b> の一時パスワード（この画面でのみ表示）:</p>
			<code style="display:block; user-select:all; padding:0.5rem; background:var(--bg);">{resetResult.password}</code>
		{/if}
	</div>
{/if}
