<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { normalizeNotifyMinute } from '$lib/notify-time';
	import { store } from '$lib/app/store.svelte';
	import {
		pushSupported,
		pushConfigured,
		isSubscribed,
		enablePush,
		disablePush
	} from '$lib/app/push';

	let leadTime = $state('');
	let saved = $state(false);

	// ストア読込後に初期値を反映する。
	$effect(() => {
		if (store.loaded && leadTime === '') {
			leadTime = String(store.settings.defaultLeadTimeDays);
		}
	});

	async function save(e: SubmitEvent) {
		e.preventDefault();
		const value = leadTime.trim();
		if (value === '') return;
		const n = Number(value);
		if (!Number.isFinite(n) || n < 0) return;
		await store.setDefaultLeadTime(n);
		saved = true;
		setTimeout(() => (saved = false), 1500);
	}

	// --- 通知 ---
	type PushState = 'loading' | 'unsupported' | 'unconfigured' | 'on' | 'off';
	let pushState = $state<PushState>('loading');
	let pushBusy = $state(false);
	let pushError = $state('');

	async function refreshPushState() {
		if (!pushSupported()) {
			pushState = 'unsupported';
			return;
		}
		if (!(await pushConfigured())) {
			pushState = 'unconfigured';
			return;
		}
		pushState = (await isSubscribed()) ? 'on' : 'off';
	}

	onMount(refreshPushState);

	async function togglePush() {
		pushBusy = true;
		pushError = '';
		try {
			if (pushState === 'on') {
				await disablePush();
			} else {
				const ok = await enablePush();
				if (!ok) pushError = '通知の許可が得られませんでした。';
			}
			await refreshPushState();
		} catch (e) {
			pushError = e instanceof Error ? e.message : '通知の設定に失敗しました。';
		} finally {
			pushBusy = false;
		}
	}

	// --- 通知時刻(15分刻み) ---
	function minuteToTime(m: number): string {
		const h = String(Math.floor(m / 60)).padStart(2, '0');
		const min = String(m % 60).padStart(2, '0');
		return `${h}:${min}`;
	}
	// input[type=time] の "HH:MM" 現在値(ユーザー設定)。
	const notifyTime = $derived(
		minuteToTime(normalizeNotifyMinute(store.user?.notifyMinuteOfDay ?? 540))
	);
	let notifyTimeSaved = $state(false);

	async function changeNotifyTime(e: Event) {
		const [h, m] = (e.currentTarget as HTMLInputElement).value.split(':').map(Number);
		if (Number.isNaN(h) || Number.isNaN(m)) return;
		const minuteOfDay = normalizeNotifyMinute(h * 60 + m);
		const response = await fetch('/api/notify-time', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ minuteOfDay })
		});
		if (!response.ok) return;
		await invalidateAll();
		notifyTimeSaved = true;
		setTimeout(() => (notifyTimeSaved = false), 1500);
	}
</script>

<h1 style="font-size:1.3rem;">設定</h1>

{#if !store.loaded}
	<p style="color:var(--muted);">読み込み中…</p>
{:else}
	<form onsubmit={save} style="display:flex; flex-direction:column; gap:0.9rem; max-width:20rem;">
		<label style="display:flex; flex-direction:column; gap:0.25rem;">
			<span>リードタイム既定値(日)</span>
			<input bind:value={leadTime} type="number" step="any" min="0" />
			<small style="color:var(--muted);"
				>購入推奨日 = 枯渇予想日 − この日数。品目ごとに上書きできます。</small
			>
		</label>
		<button
			type="submit"
			style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem;
			       padding:0.5rem; cursor:pointer;"
		>
			保存
		</button>
		{#if saved}<span style="color:var(--ok);">保存しました</span>{/if}
	</form>

	<section style="margin-top:1.5rem; max-width:26rem;">
		<h2 style="font-size:1.05rem;">購入リマインド通知</h2>
		{#if !store.user}
			<p style="color:var(--muted); font-size:0.9rem;">
				通知は会員モードで使えます。<a href={resolve('/login')}>ログイン</a>してください。
			</p>
		{:else if pushState === 'loading'}
			<p style="color:var(--muted);">確認中…</p>
		{:else if pushState === 'unsupported'}
			<p style="color:var(--muted); font-size:0.9rem;">この端末/ブラウザは通知に対応していません。</p>
		{:else if pushState === 'unconfigured'}
			<p style="color:var(--muted); font-size:0.9rem;">
				サーバーで通知が設定されていません(VAPID 未設定)。
			</p>
		{:else}
			<p style="color:var(--muted); font-size:0.9rem;">
				購入推奨日に達した品目を、アプリを開いていなくても通知します。
			</p>
			<button
				onclick={togglePush}
				disabled={pushBusy}
				style="border:none; border-radius:0.5rem; padding:0.5rem 0.9rem; cursor:pointer; color:#fff;
				       background:{pushState === 'on' ? 'var(--danger)' : 'var(--accent)'};"
			>
				{pushState === 'on' ? '通知をオフにする' : '通知をオンにする'}
			</button>
			<span style="margin-left:0.5rem; color:var(--muted); font-size:0.85rem;">
				現在: {pushState === 'on' ? 'オン' : 'オフ'}
			</span>

			<div style="margin-top:1rem;">
				<label style="display:flex; flex-direction:column; gap:0.25rem; max-width:12rem;">
					<span>通知する時刻</span>
					<input type="time" step="900" value={notifyTime} onchange={changeNotifyTime} />
					<small style="color:var(--muted);"
						>15分刻み。この時刻ごろに、買うべき品目があれば通知します。</small
					>
				</label>
				{#if notifyTimeSaved}<span style="color:var(--ok); font-size:0.85rem;">保存しました</span>{/if}
			</div>
		{/if}
		{#if pushError}<p style="color:var(--danger); margin:0.5rem 0 0;">{pushError}</p>{/if}
	</section>
{/if}
