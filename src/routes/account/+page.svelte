<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { store } from '$lib/app/store.svelte';
	import { IndexedDbRepository } from '$lib/repo/indexeddb';
	import { formatDate } from '$lib/format';
	import { buildInviteRequestBody } from '$lib/app/inviteRequest';
	import PasswordChangeForm from '$lib/components/PasswordChangeForm.svelte';

	let { data } = $props();

	let inviteCode = $state('');
	let joinError = $state('');
	let inviteExpiry = $state('');
	let lastCode = $state<string | null>(null);
	let copiedCode = $state<string | null>(null);
	let busy = $state(false);
	type AdminUser = { id: string; username: string };
	type HouseholdSummary = { id: string; name: string; memberCount: number; ownerCount: number; itemCount: number; createdAt: number; activeInviteCount: number };
	type HouseholdMember = { userId: string; username: string; role: 'owner' | 'manager' | 'member' };
	let adminUsers = $state<AdminUser[]>([]);
	let householdMembers = $derived(data.members ?? []);
	let resetResult = $state<{ username: string; password: string } | null>(null);
	let adminError = $state('');
	let deleteUsername = $state('');
	let deletePassword = $state('');
	let deleteError = $state('');
	let showDeleteAccount = $state(false);
	let memberError = $state('');
	let adminHouseholds = $state<HouseholdSummary[]>([]);
	let adminHouseholdName = $state('');
	let adminHouseholdError = $state('');
	let adminInviteCodes = $state<Record<string, string>>({});

	async function copyInviteCode(code: string) {
		try {
			await navigator.clipboard.writeText(code);
			copiedCode = code;
			setTimeout(() => {
				if (copiedCode === code) copiedCode = null;
			}, 2000);
		} catch {
			// クリップボードが使えない環境でも、画面上のコードは利用できる。
		}
	}

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
			adminHouseholds = data.adminHouseholds ?? [];
		}
	});

	async function joinHousehold(e: SubmitEvent) {
		e.preventDefault();
		joinError = '';
		const res = await fetch('/api/households/join', {
			method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: inviteCode })
		});
		if (!res.ok) { joinError = (await res.json().catch(() => ({}))).message ?? '世帯への参加に失敗しました。'; return; }
		inviteCode = '';
		await invalidateAll();
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

	async function deleteAdminUser(user: AdminUser) {
		const username = window.prompt(`削除するユーザー名「${user.username}」を入力してください。`);
		if (username === null) return;
		const password = window.prompt('操作するsuper_adminの現在のパスワードを入力してください。');
		if (password === null) return;
		const res = await fetch(`/api/admin/users/${user.id}`, {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ username, password })
		});
		const result = await res.json().catch(() => ({}));
		if (!res.ok) { adminError = result.message ?? 'ユーザーの削除に失敗しました。'; return; }
		adminUsers = adminUsers.filter((candidate) => candidate.id !== user.id);
	}

	async function deleteAccount(e: SubmitEvent) {
		e.preventDefault();
		deleteError = '';
		const res = await fetch('/api/account/delete', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ username: deleteUsername, password: deletePassword })
		});
		const result = await res.json().catch(() => ({}));
		if (!res.ok) { deleteError = result.message ?? 'アカウントの削除に失敗しました。'; return; }
		window.location.href = '/login?deleted=1';
	}

	async function promoteMember(member: HouseholdMember) {
		memberError = '';
		busy = true;
		try {
			const res = await fetch(`/api/households/members/${member.userId}/promote`, { method: 'POST' });
			const result = await res.json().catch(() => ({}));
			if (!res.ok) {
			memberError = result.message ?? 'managerの任命に失敗しました。';
				return;
			}
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	async function demoteManager(member: HouseholdMember) {
		memberError = '';
		busy = true;
		try {
			const res = await fetch(`/api/households/members/${member.userId}/demote`, { method: 'POST' });
			const result = await res.json().catch(() => ({}));
			if (!res.ok) {
				memberError = result.message ?? 'managerの解任に失敗しました。';
				return;
			}
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	async function removeMember(member: HouseholdMember) {
		memberError = '';
		busy = true;
		try {
			const res = await fetch(`/api/households/members/${member.userId}/remove`, { method: 'DELETE' });
			const result = await res.json().catch(() => ({}));
			if (!res.ok) {
				memberError = result.message ?? 'メンバーの除名に失敗しました。';
				return;
			}
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	async function requestTransfer(member: HouseholdMember) {
		const res = await fetch('/api/households/transfers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateUserId: member.userId }) });
		if (!res.ok) memberError = (await res.json().catch(() => ({}))).message ?? 'owner交代の申請に失敗しました。';
		else memberError = `${member.username}さんへowner交代の申請を送りました。`;
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
			if (lastCode) await copyInviteCode(lastCode);
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

	async function acceptTransfer(id: string, accept: boolean) {
		await fetch(`/api/households/transfers/${id}/${accept ? 'accept' : 'reject'}`, { method: 'POST' });
		await invalidateAll();
	}

	async function createAdminHousehold(e: SubmitEvent) {
		e.preventDefault();
		adminHouseholdError = '';
		const res = await fetch('/api/admin/households', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: adminHouseholdName }) });
		if (!res.ok) { adminHouseholdError = (await res.json().catch(() => ({}))).message ?? '世帯の作成に失敗しました。'; return; }
		adminHouseholdName = '';
		const list = await fetch('/api/admin/households');
		if (list.ok) adminHouseholds = await list.json();
	}

	async function deleteAdminHousehold(household: HouseholdSummary) {
		const expectedName = window.prompt(`削除する世帯名「${household.name}」を入力してください。`);
		if (expectedName === null) return;
		const res = await fetch(`/api/admin/households/${household.id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedName }) });
		if (!res.ok) { adminHouseholdError = (await res.json().catch(() => ({}))).message ?? '世帯の削除に失敗しました。'; return; }
		adminHouseholds = adminHouseholds.filter((h) => h.id !== household.id);
	}

	async function createAdminInvite(household: HouseholdSummary) {
		const res = await fetch(`/api/admin/households/${household.id}/invites`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
		const result = await res.json().catch(() => ({}));
		if (!res.ok) { adminHouseholdError = result.message ?? '招待コードの発行に失敗しました。'; return; }
		adminInviteCodes = { ...adminInviteCodes, [household.id]: result.code };
		if (result.code) await copyInviteCode(result.code);
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
			if (!res.ok) throw new Error(json.message ?? 'ゲストデータの取り込みに失敗しました。');
			await guest.clearAll();
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

<PasswordChangeForm />

<div style={section}>
	<h2 style="margin:0 0 0.5rem; font-size:1rem;">所属している世帯</h2>
	<ul style="list-style:none; padding:0; margin:0 0 0.7rem;">
		{#each store.households as h (h.id)}
			<li style="display:flex; gap:0.5rem; align-items:center; font-size:0.9rem;">
				<span>{h.name}</span>
				<span style="color:var(--muted);">({h.role === 'owner' ? 'owner' : h.role === 'manager' ? 'manager' : 'メンバー'})</span>
				{#if store.activeHousehold?.id === h.id}
					<span style="color:var(--accent); font-size:0.75rem;">選択中</span>
				{/if}
			</li>
		{/each}
	</ul>
	<form onsubmit={joinHousehold} style="display:flex; gap:0.5rem; margin-top:0.7rem;">
		<input bind:value={inviteCode} placeholder="招待コードで別の世帯に参加" style="flex:1;" />
		<button type="submit" disabled={busy} style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.4rem 0.8rem; cursor:pointer;">世帯に参加</button>
	</form>
	{#if joinError}<p style="color:var(--danger);">{joinError}</p>{/if}
</div>

{#if guestItemCount > 0 && store.activeHousehold}
	<div style={section}>
		<h2 style="margin:0 0 0.5rem; font-size:1rem;">ゲストデータの取り込み</h2>
		<p style="font-size:0.9rem; color:var(--muted); margin:0 0 0.5rem;">
			この端末のゲスト(ローカル)に {guestItemCount} 件の品目があります。現在の世帯「{store
				.activeHousehold.name}」へ取り込めます。
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

{#if data.canManageInvites}
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
			<p style="font-size:0.9rem; display:flex; gap:0.5rem; align-items:center;">
				<span>発行しました: <code style="font-weight:700; user-select:all;">{lastCode}</code></span>
				<button type="button" onclick={() => copyInviteCode(lastCode!)} style="border:1px solid var(--border); background:var(--card); border-radius:0.4rem; padding:0.25rem 0.5rem; cursor:pointer;">{copiedCode === lastCode ? 'コピーしました' : 'コピー'}</button>
			</p>
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

{#if data.canManageMembers}
	<div style={section}>
		<h2 style="margin:0 0 0.5rem; font-size:1rem;">世帯メンバー</h2>
		<ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.4rem;">
			{#each householdMembers as member (member.userId)}
				<li style="display:flex; gap:0.5rem; align-items:center;">
					<span>{member.username}</span>
					<span style="color:var(--muted);">({member.role === 'owner' ? 'owner' : member.role === 'manager' ? 'manager' : 'メンバー'})</span>
					{#if member.role === 'member'}
						<button onclick={() => promoteMember(member)} disabled={busy} style="margin-left:auto; border:1px solid var(--accent); background:var(--card); color:var(--accent); border-radius:0.4rem; padding:0.3rem 0.6rem; cursor:pointer;">managerに任命</button>
					{/if}
					{#if member.role === 'manager'}
						<button onclick={() => demoteManager(member)} disabled={busy} style="margin-left:auto; border:1px solid var(--warn); background:var(--card); color:var(--warn); border-radius:0.4rem; padding:0.3rem 0.6rem; cursor:pointer;">managerを解任</button>
					{/if}
					{#if member.role !== 'owner'}
						<button onclick={() => removeMember(member)} disabled={busy} style="border:1px solid var(--danger); background:var(--card); color:var(--danger); border-radius:0.4rem; padding:0.3rem 0.6rem; cursor:pointer;">除名</button>
					{/if}
					{#if member.role !== 'owner'}
						<button onclick={() => requestTransfer(member)} disabled={busy} style="border:1px solid var(--warn); background:var(--card); color:var(--warn); border-radius:0.4rem; padding:0.3rem 0.6rem; cursor:pointer;">owner候補に指名</button>
					{/if}
				</li>
			{/each}
		</ul>
		{#if memberError}<p style="color:var(--danger);">{memberError}</p>{/if}
	</div>
{/if}

{#if data.pendingTransfers.length > 0}
	<div style={section}>
		<h2 style="margin:0 0 0.5rem; font-size:1rem;">owner交代の申請</h2>
		{#each data.pendingTransfers as transfer (transfer.id)}
			<div style="display:flex; gap:0.5rem; align-items:center;">
				<span>世帯「{transfer.householdName}」のownerになる申請です。</span>
				<button onclick={() => acceptTransfer(transfer.id, true)} disabled={busy}>承認</button>
				<button onclick={() => acceptTransfer(transfer.id, false)} disabled={busy}>拒否</button>
			</div>
		{/each}
	</div>
{/if}

{#if data.user?.instanceRole === 'super_admin'}
	<div style={section}>
		<h2 style="margin:0 0 0.5rem; font-size:1rem;">世帯管理</h2>
		<form onsubmit={createAdminHousehold} style="display:flex; gap:0.5rem; margin-bottom:0.7rem;">
			<input bind:value={adminHouseholdName} placeholder="世帯名" style="flex:1;" />
			<button type="submit" disabled={busy} style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.4rem 0.8rem; cursor:pointer;">世帯を作成</button>
		</form>
		{#each adminHouseholds as household (household.id)}
			<div style="display:flex; gap:0.5rem; align-items:center; font-size:0.85rem; border-top:1px solid var(--border); padding:0.4rem 0;">
				<span>{household.name}</span><span style="color:var(--muted);">所属{household.memberCount}人 / owner{household.ownerCount}人 / 品目{household.itemCount}件 / 招待{household.activeInviteCount}件</span>
				<button onclick={() => createAdminInvite(household)} style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.3rem 0.6rem; cursor:pointer;">招待コード発行</button>
				{#if adminInviteCodes[household.id]}
					<code style="user-select:all;">{adminInviteCodes[household.id]}</code>
					<button type="button" onclick={() => copyInviteCode(adminInviteCodes[household.id])} style="border:1px solid var(--border); background:var(--card); color:var(--text); border-radius:0.4rem; padding:0.25rem 0.5rem; cursor:pointer;">{copiedCode === adminInviteCodes[household.id] ? 'コピーしました' : 'コピー'}</button>
				{/if}
				<button onclick={() => deleteAdminHousehold(household)} style="margin-left:auto; border:1px solid var(--danger); background:var(--card); color:var(--danger); border-radius:0.4rem; padding:0.3rem 0.6rem; cursor:pointer;">削除</button>
			</div>
		{/each}
		{#if adminHouseholdError}<p style="color:var(--danger);">{adminHouseholdError}</p>{/if}
	</div>
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
						<button onclick={() => deleteAdminUser(user)} disabled={busy} style="border:1px solid var(--danger); background:var(--card); color:var(--danger); border-radius:0.4rem; padding:0.3rem 0.6rem; cursor:pointer;">削除</button>
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

<div style={`${section} margin-top:2rem;`}>
	<button type="button" onclick={() => { showDeleteAccount = true; deleteError = ''; }} style="border:1px solid var(--danger); background:var(--card); color:var(--danger); border-radius:0.4rem; padding:0.4rem 0.8rem; cursor:pointer;">アカウントを削除</button>
</div>

{#if showDeleteAccount}
	<div role="presentation" onclick={(event) => { if (event.target === event.currentTarget) showDeleteAccount = false; }} style="position:fixed; inset:0; z-index:10; display:flex; align-items:center; justify-content:center; padding:1rem; background:rgba(0,0,0,0.45);">
		<div role="dialog" aria-modal="true" aria-labelledby="delete-account-title" style="width:min(100%, 28rem); background:var(--card); border:1px solid var(--border); border-radius:0.6rem; padding:1rem; box-shadow:0 0.75rem 2rem rgba(0,0,0,0.2);">
			<h2 id="delete-account-title" style="margin:0 0 0.5rem; font-size:1rem;">アカウントの削除</h2>
			<p style="font-size:0.85rem; color:var(--muted);">この操作は取り消せません。ownerになっている世帯がある場合は、先にownerを委任してください。</p>
			<form onsubmit={deleteAccount} style="display:flex; flex-direction:column; gap:0.5rem;">
				<input bind:value={deleteUsername} placeholder="ユーザー名" autocomplete="username" required />
				<input bind:value={deletePassword} type="password" placeholder="現在のパスワード" autocomplete="current-password" required />
				<div style="display:flex; justify-content:flex-end; gap:0.5rem;">
					<button type="button" onclick={() => { showDeleteAccount = false; deleteError = ''; }}>キャンセル</button>
					<button type="submit" disabled={busy} style="border:1px solid var(--danger); background:var(--card); color:var(--danger); border-radius:0.4rem; padding:0.4rem 0.8rem; cursor:pointer;">削除する</button>
				</div>
			</form>
			{#if deleteError}<p style="color:var(--danger);">{deleteError}</p>{/if}
		</div>
	</div>
{/if}
