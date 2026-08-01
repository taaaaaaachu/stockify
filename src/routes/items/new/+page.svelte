<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { store } from '$lib/app/store.svelte';
	import { localDateInput, dateInputToTimestamp } from '$lib/format';

	let name = $state('');
	let unit = $state('ml');
	let category = $state('');
	let leadTime = $state('');
	// 初回購入(内容量+日時)と仮の値をまとめて登録できるようにする。
	let firstVolume = $state('');
	let firstDate = $state(localDateInput());
	let firstPrice = $state('');
	let provisionalDays = $state('30');
	let saving = $state(false);
	let error = $state('');

	// type="number" の bind:value は数値化されるため、数値・文字列どちらも受ける。
	function parseNumberOrNull(v: unknown): number | null {
		if (typeof v === 'number') return Number.isFinite(v) ? v : null;
		if (typeof v === 'string') {
			const t = v.trim();
			if (t === '') return null;
			const n = Number(t);
			return Number.isFinite(n) ? n : null;
		}
		return null;
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		if (name.trim() === '') {
			error = '品目名を入力してください。';
			return;
		}
		if (unit.trim() === '') {
			error = '単位を入力してください。';
			return;
		}
		const vol = parseNumberOrNull(firstVolume);
		if (vol === null || vol <= 0) {
			error = '初回の内容量を正の数で入力してください。';
			return;
		}
		const prov = parseNumberOrNull(provisionalDays);
		if (prov === null || prov <= 0) {
			error = '「約何日で使い切るか」を正の数で入力してください。';
			return;
		}

		saving = true;
		try {
			const id = await store.addItem({
				name: name.trim(),
				unit: unit.trim(),
				category: category.trim() === '' ? null : category.trim(),
				leadTimeDays: parseNumberOrNull(leadTime),
				provisionalDaysToDeplete: prov
			});
			await store.addPurchase({
				itemId: id,
				volume: vol,
				price: parseNumberOrNull(firstPrice),
				purchasedAt: dateInputToTimestamp(firstDate),
				source: 'manual'
			});
			await goto(resolve('/items/[id]', { id }));
		} finally {
			saving = false;
		}
	}
</script>

<a href={resolve('/')} style="color:var(--muted); text-decoration:none; font-size:0.9rem;">← 在庫へ戻る</a>
<h1 style="font-size:1.3rem;">品目を追加</h1>

<form onsubmit={submit} style="display:flex; flex-direction:column; gap:0.9rem;">
	<label style="display:flex; flex-direction:column; gap:0.25rem;">
		<span>品目名</span>
		<input bind:value={name} placeholder="食器用洗剤" required />
	</label>

	<div style="display:flex; gap:0.9rem;">
		<label style="display:flex; flex-direction:column; gap:0.25rem; flex:1;">
			<span>単位</span>
			<input bind:value={unit} placeholder="ml / g / m / 個" required />
		</label>
		<label style="display:flex; flex-direction:column; gap:0.25rem; flex:1;">
			<span>カテゴリ / 保管場所(任意)</span>
			<input bind:value={category} placeholder="キッチン" list="category-options" />
			<datalist id="category-options">
				{#each store.categories as c (c)}
					<option value={c}></option>
				{/each}
			</datalist>
		</label>
	</div>

	<fieldset style="border:1px solid var(--border); border-radius:0.5rem; padding:0.8rem;">
		<legend style="padding:0 0.4rem; color:var(--muted);">初回購入</legend>
		<div style="display:flex; gap:0.9rem; flex-wrap:wrap;">
			<label style="display:flex; flex-direction:column; gap:0.25rem; flex:1;">
				<span>内容量</span>
				<input bind:value={firstVolume} type="number" step="any" min="0" placeholder="300" required />
			</label>
			<label style="display:flex; flex-direction:column; gap:0.25rem; flex:1;">
				<span>購入日</span>
				<input bind:value={firstDate} type="date" required />
			</label>
			<label style="display:flex; flex-direction:column; gap:0.25rem; flex:1;">
				<span>価格(任意・円)</span>
				<input bind:value={firstPrice} type="number" step="any" min="0" placeholder="250" />
			</label>
		</div>
	</fieldset>

	<label style="display:flex; flex-direction:column; gap:0.25rem;">
		<span>仮の見積り: この内容量を約何日で使い切る?</span>
		<input bind:value={provisionalDays} type="number" step="any" min="0" />
		<small style="color:var(--muted);"
			>購入を重ねると自動計算(長期平均)に切り替わり、精度が上がります。</small
		>
	</label>

	<label style="display:flex; flex-direction:column; gap:0.25rem;">
		<span>リードタイム(任意・日)</span>
		<input bind:value={leadTime} type="number" step="any" min="0" placeholder="未入力なら全体既定" />
		<small style="color:var(--muted);">購入推奨日を枯渇予想日の何日前にするか。空欄なら設定の既定値。</small>
	</label>

	{#if error}
		<p style="color:var(--danger); margin:0;">{error}</p>
	{/if}

	<button
		type="submit"
		disabled={saving}
		style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem;
		       padding:0.6rem; font-size:1rem; cursor:pointer;"
	>
		{saving ? '保存中…' : '登録する'}
	</button>
</form>
