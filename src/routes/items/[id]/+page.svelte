<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { store } from '#lib/app/store.svelte.js';
	import { buildRow } from '#lib/domain/dashboard.js';
	import { estimateInputFromItem } from '#lib/domain/estimate.js';
	import { remainingTrajectory } from '#lib/domain/trajectory.js';
	import {
		formatDate,
		formatDepletion,
		formatNumber,
		formatQuantity,
		localDateInput,
		dateInputToTimestamp
	} from '#lib/format.js';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import RemainingBar from '#lib/components/RemainingBar.svelte';
	import HistoryChart from '#lib/components/HistoryChart.svelte';
	import ProductLinksEditor from '#lib/components/ProductLinksEditor.svelte';

	const id = $derived(page.params.id ?? '');

	const bundle = $derived(store.bundle(id));
	const row = $derived(bundle ? buildRow(bundle, store.settings, store.now) : null);
	const trajectory = $derived(
		bundle
			? remainingTrajectory(
					estimateInputFromItem(bundle.item, {
						defaultLeadTimeDays: store.settings.defaultLeadTimeDays,
						// 残量推移(グラフ)はレートと履歴だけで決まり、この値は使わないため null で足りる。
						nextSubscriptionDeliveryAt: null,
						purchases: bundle.purchases,
						ranOutEvents: bundle.ranOutEvents,
						adjustments: bundle.adjustments
					}),
					store.now
				)
			: []
	);
	const purchasesDesc = $derived(
		bundle ? [...bundle.purchases].sort((a, b) => b.purchasedAt - a.purchasedAt) : []
	);
	// 使い切り・補正の履歴も新しい順に。リアクティブ状態を直接 sort すると
	// 描画中に状態を書き換えることになり(state_unsafe_mutation)、詳細画面が
	// 開けなくなるため、必ずコピーしてから並べ替える。
	const ranOutsDesc = $derived(bundle ? [...bundle.ranOutEvents].sort((a, b) => b.at - a.at) : []);
	const adjustmentsDesc = $derived(bundle ? [...bundle.adjustments].sort((a, b) => b.at - a.at) : []);
	const activeSub = $derived(bundle?.subscriptions.find((s) => !s.paused) ?? bundle?.subscriptions[0]);

	// type="number" の bind:value は数値化されるため、数値・文字列どちらも受ける。
	function numOrNull(v: unknown): number | null {
		if (typeof v === 'number') return Number.isFinite(v) ? v : null;
		if (typeof v === 'string') {
			const t = v.trim();
			if (t === '') return null;
			const n = Number(t);
			return Number.isFinite(n) ? n : null;
		}
		return null;
	}

	// --- 購入追加 ---
	// 直近の購入(空欄で追加したときの既定値・プレースホルダーに使う)。
	const lastPurchase = $derived(purchasesDesc[0]);
	let pVolume = $state('');
	let pDate = $state(localDateInput());
	let pPrice = $state('');
	async function addPurchase(e: SubmitEvent) {
		e.preventDefault();
		// 内容量が空なら前回の購入と同じ量にする。
		let v = numOrNull(pVolume);
		if (v === null) v = lastPurchase?.volume ?? null;
		if (v === null || v <= 0) return;
		// 価格が空なら前回の価格を引き継ぐ。
		let price = numOrNull(pPrice);
		if (price === null) price = lastPurchase?.price ?? null;
		await store.addPurchase({
			itemId: id,
			volume: v,
			price,
			// 当日なら現在時刻。使い切り直後の購入が即・使い切り扱いにならないように。
			purchasedAt: dateInputToTimestamp(pDate),
			source: 'manual'
		});
		pVolume = '';
		pPrice = '';
	}

	// --- 購入編集 ---
	let editingPurchaseId = $state<string | null>(null);
	let ePurchaseVolume = $state('');
	let ePurchaseDate = $state('');
	let ePurchasePrice = $state('');
	function startEditPurchase(p: (typeof purchasesDesc)[number]) {
		editingPurchaseId = p.id;
		ePurchaseVolume = String(p.volume);
		ePurchaseDate = localDateInput(new Date(p.purchasedAt));
		ePurchasePrice = p.price === null ? '' : String(p.price);
	}
	async function savePurchaseEdit(e: SubmitEvent) {
		e.preventDefault();
		if (!editingPurchaseId) return;
		const volume = numOrNull(ePurchaseVolume);
		const price = numOrNull(ePurchasePrice);
		if (volume === null || volume <= 0 || !ePurchaseDate) return;
		await store.editPurchase(editingPurchaseId, {
			volume,
			price,
			purchasedAt: dateInputToTimestamp(ePurchaseDate)
		});
		editingPurchaseId = null;
	}

	// --- 残量補正 ---
	let adjRemaining = $state('');
	async function addAdjustment(e: SubmitEvent) {
		e.preventDefault();
		const v = numOrNull(adjRemaining);
		if (v === null || v < 0) return;
		await store.addAdjustment({ itemId: id, at: Date.now(), remaining: v });
		adjRemaining = '';
	}

	async function markRanOut() {
		await store.markRanOut(id, Date.now());
	}

	// --- 定期便 ---
	let subInterval = $state('60');
	let subNext = $state(new Date().toISOString().slice(0, 10));
	let subVolume = $state('');
	let subQty = $state('1');
	async function addSubscription(e: SubmitEvent) {
		e.preventDefault();
		const interval = numOrNull(subInterval);
		const vol = numOrNull(subVolume);
		const qty = numOrNull(subQty);
		if (interval === null || interval <= 0 || vol === null || vol <= 0 || qty === null || qty <= 0)
			return;
		await store.addSubscription({
			itemId: id,
			intervalDays: interval,
			nextDeliveryAt: new Date(subNext).getTime(),
			volumePerDelivery: vol,
			quantityPerDelivery: qty,
			paused: false
		});
		subVolume = '';
	}

	// 次回配送を 1 回スキップ(次回予定日を 1 間隔ぶん先送り、購入は生成しない)。
	async function skipSubscription() {
		if (!activeSub) return;
		await store.skipSubscription(activeSub);
	}

	// 次回日変更(その場で type=date、今日以降のみ)。
	const todayInput = localDateInput();
	let editingNext = $state(false);
	let nextDate = $state('');
	function startEditNext() {
		if (!activeSub) return;
		nextDate = localDateInput(new Date(activeSub.nextDeliveryAt));
		editingNext = true;
	}
	async function saveNextDate(e: SubmitEvent) {
		e.preventDefault();
		if (!activeSub) return;
		await store.setSubscriptionNextDelivery(activeSub.id, dateInputToTimestamp(nextDate));
		editingNext = false;
	}

	// --- 品目編集 ---
	let editing = $state(false);
	let eName = $state('');
	let eUnit = $state('');
	let eCategory = $state('');
	let eLead = $state('');
	let eProv = $state('');
	function startEdit() {
		if (!bundle) return;
		eName = bundle.item.name;
		eUnit = bundle.item.unit;
		eCategory = bundle.item.category ?? '';
		eLead = bundle.item.leadTimeDays === null ? '' : String(bundle.item.leadTimeDays);
		eProv =
			bundle.item.provisionalDaysToDeplete === null
				? ''
				: String(bundle.item.provisionalDaysToDeplete);
		editing = true;
	}
	async function saveEdit(e: SubmitEvent) {
		e.preventDefault();
		if (eName.trim() === '' || eUnit.trim() === '') return;
		await store.editItem(id, {
			name: eName.trim(),
			unit: eUnit.trim(),
			category: eCategory.trim() === '' ? null : eCategory.trim(),
			leadTimeDays: numOrNull(eLead),
			provisionalDaysToDeplete: numOrNull(eProv)
		});
		editing = false;
	}

	async function removeItem() {
		if (!confirm('この品目と配下のすべての記録を削除します。よろしいですか?')) return;
		await store.removeItem(id);
		await goto(resolve('/'));
	}

	const sectionStyle =
		'background:var(--card); border:1px solid var(--border); border-radius:0.6rem; padding:0.9rem; margin-bottom:1rem;';
	// flex-basis を持たせて、狭い画面では縦積みに折り返す。min-width:0 で
	// input の既定幅(size属性由来)がパネル幅を押し広げるのを防ぐ。
	const inputRow = 'display:flex; flex-direction:column; gap:0.2rem; flex:1 1 7rem; min-width:0;';
</script>

<a href={resolve('/')} style="color:var(--muted); text-decoration:none; font-size:0.9rem;">← 在庫へ戻る</a>

{#if !store.loaded}
	<p style="color:var(--muted);">読み込み中…</p>
{:else if !bundle || !row}
	<p style="color:var(--muted);">品目が見つかりません。</p>
{:else}
	<!-- ヘッダ + 推定サマリ -->
	<div style={sectionStyle}>
		<div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.5rem;">
			<h1 style="margin:0; font-size:1.3rem;">{bundle.item.name}</h1>
			{#if bundle.item.category}
				<span style="font-size:0.8rem; color:var(--muted);">{bundle.item.category}</span>
			{/if}
			<span style="margin-left:auto;"><StatusBadge status={row.status} /></span>
		</div>
		<RemainingBar fraction={row.remainingFraction} status={row.status} />
		<div style="display:grid; grid-template-columns:repeat(2,1fr); gap:0.4rem; margin-top:0.7rem; font-size:0.9rem;">
			<div>推定残量: <b>{formatQuantity(row.estimate.remainingClamped, bundle.item.unit)}</b></div>
			<div>
				消費レート:
				<b>{row.estimate.ratePerDay === null ? '—' : `${formatNumber(row.estimate.ratePerDay)} ${bundle.item.unit}/日`}</b>
			</div>
			<div>枯渇予想: <b>{formatDate(row.estimate.depletionAt)}</b>({formatDepletion(row.estimate.depletionAt, store.now)})</div>
			<div>
				購入推奨:
				<b>
					{#if row.estimate.recommendedPurchaseAt !== null}
						{formatDate(row.estimate.recommendedPurchaseAt)}
					{:else if row.hasActiveSubscription}
						定期便で自動補充
					{:else}
						—
					{/if}
				</b>
			</div>
		</div>
	</div>

	<!-- 履歴グラフ -->
	<div style={sectionStyle}>
		<h2 style="margin:0 0 0.5rem; font-size:1rem;">残量の推移</h2>
		<HistoryChart points={trajectory} unit={bundle.item.unit} />
	</div>

	<!-- クイック操作 -->
	<div style={sectionStyle}>
		<h2 style="margin:0 0 0.5rem; font-size:1rem;">記録する</h2>
		<div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.8rem;">
			<button
				onclick={markRanOut}
				style="background:var(--danger); color:#fff; border:none; border-radius:0.5rem; padding:0.5rem 0.8rem; cursor:pointer;"
				>空になった</button
			>
			<form onsubmit={addAdjustment} style="display:flex; gap:0.4rem; align-items:center;">
				<input
					bind:value={adjRemaining}
					type="number"
					step="any"
					min="0"
					placeholder="今の残量"
					style="width:7rem;"
				/>
				<button
					type="submit"
					style="background:var(--warn); color:#fff; border:none; border-radius:0.5rem; padding:0.5rem 0.8rem; cursor:pointer;"
					>残量を補正</button
				>
			</form>
		</div>

		<form onsubmit={addPurchase} style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:end;">
			<label style={inputRow}><span style="font-size:0.85rem;">内容量</span>
				<input
					bind:value={pVolume}
					type="number"
					step="any"
					min="0"
					placeholder={lastPurchase ? `${lastPurchase.volume}(前回と同じ)` : '300'}
				/></label
			>
			<label style={inputRow}><span style="font-size:0.85rem;">購入日</span>
				<input bind:value={pDate} type="date" required /></label
			>
			<label style={inputRow}><span style="font-size:0.85rem;">価格(任意)</span>
				<input
					bind:value={pPrice}
					type="number"
					step="any"
					min="0"
					placeholder={lastPurchase?.price != null ? `${lastPurchase.price}` : '250'}
				/></label
			>
			<button
				type="submit"
				style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.5rem 0.8rem; cursor:pointer;"
				>購入を追加</button
			>
		</form>
	</div>

	<!-- 定期便 -->
	<div style={sectionStyle}>
		<h2 style="margin:0 0 0.5rem; font-size:1rem;">定期便</h2>
		{#if activeSub}
			<div style="font-size:0.9rem;">
				{activeSub.intervalDays}日ごとに {formatQuantity(
					activeSub.volumePerDelivery * activeSub.quantityPerDelivery,
					bundle.item.unit
				)} ・ 次回 {formatDate(activeSub.nextDeliveryAt)}
				{#if activeSub.paused}<span style="color:var(--muted);">(一時停止中)</span>{/if}
			</div>
			<div style="display:flex; gap:0.5rem; margin-top:0.5rem; flex-wrap:wrap;">
				{#if !activeSub.paused}
					<button
						onclick={skipSubscription}
						style="border:1px solid var(--border); background:var(--card); border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer;"
						>スキップ</button
					>
				{/if}
				<button
					onclick={startEditNext}
					style="border:1px solid var(--border); background:var(--card); border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer;"
					>次回日変更</button
				>
				<button
					onclick={() => store.editSubscription(activeSub.id, { paused: !activeSub.paused })}
					style="border:1px solid var(--border); background:var(--card); border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer;"
					>{activeSub.paused ? '再開' : '一時停止'}</button
				>
				<button
					onclick={() => store.removeSubscription(activeSub.id)}
					style="border:1px solid var(--danger); color:var(--danger); background:var(--card); border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer;"
					>解約</button
				>
			</div>
			{#if editingNext}
				<form onsubmit={saveNextDate} style="display:flex; gap:0.4rem; align-items:center; margin-top:0.5rem; flex-wrap:wrap;">
					<input bind:value={nextDate} type="date" min={todayInput} required />
					<button
						type="submit"
						style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer;"
						>変更</button
					>
					<button
						type="button"
						onclick={() => (editingNext = false)}
						style="border:1px solid var(--border); background:var(--card); border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer;"
						>やめる</button
					>
				</form>
			{/if}
		{:else}
			<form onsubmit={addSubscription} style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:end;">
				<label style={inputRow}><span style="font-size:0.85rem;">間隔(日)</span>
					<input bind:value={subInterval} type="number" step="any" min="1" required /></label
				>
				<label style={inputRow}><span style="font-size:0.85rem;">次回予定日</span>
					<input bind:value={subNext} type="date" required /></label
				>
				<label style={inputRow}><span style="font-size:0.85rem;">1回の内容量</span>
					<input bind:value={subVolume} type="number" step="any" min="0" placeholder="300" required /></label
				>
				<label style={inputRow}><span style="font-size:0.85rem;">個数</span>
					<input bind:value={subQty} type="number" step="any" min="1" /></label
				>
				<button
					type="submit"
					style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.5rem 0.8rem; cursor:pointer;"
					>定期便を登録</button
				>
			</form>
		{/if}
	</div>

	<!-- 購入履歴 -->
	<div style={sectionStyle}>
		<h2 style="margin:0 0 0.5rem; font-size:1rem;">購入履歴</h2>
		{#if purchasesDesc.length === 0}
			<p style="color:var(--muted); font-size:0.9rem;">まだ購入がありません。</p>
		{:else}
			<ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.3rem;">
				{#each purchasesDesc as p (p.id)}
					<li style="display:flex; align-items:center; gap:0.5rem; font-size:0.9rem;">
						<span>{formatDate(p.purchasedAt)}</span>
						<span>{formatQuantity(p.volume, bundle.item.unit)}</span>
						{#if p.price !== null}<span style="color:var(--muted);">¥{p.price}</span>{/if}
						{#if p.source === 'subscription'}
							<span style="font-size:0.7rem; color:var(--accent);">定期便</span>
						{/if}
						<button
							onclick={() => startEditPurchase(p)}
							style="margin-left:auto; border:none; background:none; color:var(--accent); cursor:pointer;"
							aria-label="編集">編集</button
						>
						<button
							onclick={() => store.removePurchase(p.id)}
							style="border:none; background:none; color:var(--danger); cursor:pointer;"
							aria-label="削除">✕</button
						>
					</li>
					{#if editingPurchaseId === p.id}
						<li style="display:flex; font-size:0.9rem;">
							<form onsubmit={savePurchaseEdit} style="display:flex; gap:0.4rem; align-items:end; flex-wrap:wrap; width:100%;">
								<label style={inputRow}><span style="font-size:0.75rem;">購入日</span><input bind:value={ePurchaseDate} type="date" required /></label>
								<label style={inputRow}><span style="font-size:0.75rem;">内容量</span><input bind:value={ePurchaseVolume} type="number" min="0" step="any" required /></label>
								<label style={inputRow}><span style="font-size:0.75rem;">価格</span><input bind:value={ePurchasePrice} type="number" min="0" step="any" /></label>
								<button type="submit" style="background:var(--accent); color:#fff; border:none; border-radius:0.4rem; padding:0.35rem 0.6rem; cursor:pointer;">保存</button>
								<button type="button" onclick={() => (editingPurchaseId = null)} style="border:1px solid var(--border); background:var(--card); border-radius:0.4rem; padding:0.35rem 0.6rem; cursor:pointer;">やめる</button>
							</form>
						</li>
					{/if}
				{/each}
			</ul>
		{/if}
		{#if bundle.ranOutEvents.length > 0 || bundle.adjustments.length > 0}
			<div style="margin-top:0.6rem; font-size:0.85rem; color:var(--muted);">
				{#each ranOutsDesc as e (e.id)}
					<div style="display:flex; gap:0.5rem; align-items:center;">
						<span>{formatDate(e.at)} 空になった</span>
						<button onclick={() => store.removeRanOut(e.id)} style="border:none; background:none; color:var(--danger); cursor:pointer;" aria-label="削除">✕</button>
					</div>
				{/each}
				{#each adjustmentsDesc as a (a.id)}
					<div style="display:flex; gap:0.5rem; align-items:center;">
						<span>{formatDate(a.at)} 残量補正 → {formatQuantity(a.remaining, bundle.item.unit)}</span>
						<button onclick={() => store.removeAdjustment(a.id)} style="border:none; background:none; color:var(--danger); cursor:pointer;" aria-label="削除">✕</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- 品目設定 -->
	<div style={sectionStyle}>
		<div style="display:flex; align-items:center;">
			<h2 style="margin:0; font-size:1rem;">品目の設定</h2>
			{#if !editing}
				<button onclick={startEdit} style="margin-left:auto; border:1px solid var(--border); background:var(--card); border-radius:0.5rem; padding:0.3rem 0.6rem; cursor:pointer;">編集</button>
			{/if}
		</div>
		{#if editing}
			<form onsubmit={saveEdit} style="display:flex; flex-direction:column; gap:0.6rem; margin-top:0.6rem;">
				<div style="display:flex; gap:0.6rem; flex-wrap:wrap;">
					<label style={inputRow}><span style="font-size:0.85rem;">品目名</span><input bind:value={eName} required /></label>
					<label style={inputRow}><span style="font-size:0.85rem;">単位</span><input bind:value={eUnit} required /></label>
				</div>
				<div style="display:flex; gap:0.6rem; flex-wrap:wrap;">
					<label style={inputRow}><span style="font-size:0.85rem;">カテゴリ / 保管場所</span><input bind:value={eCategory} list="category-options" /></label>
					<datalist id="category-options">
						{#each store.categories as c (c)}
							<option value={c}></option>
						{/each}
					</datalist>
					<label style={inputRow}><span style="font-size:0.85rem;">リードタイム(日)</span><input bind:value={eLead} type="number" step="any" min="0" placeholder="既定" /></label>
				</div>
				<label style={inputRow}><span style="font-size:0.85rem;">仮の値: 約何日で使い切る</span><input bind:value={eProv} type="number" step="any" min="0" /></label>
				<div style="display:flex; gap:0.5rem;">
					<button type="submit" style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.5rem 0.9rem; cursor:pointer;">保存</button>
					<button type="button" onclick={() => (editing = false)} style="border:1px solid var(--border); background:var(--card); border-radius:0.5rem; padding:0.5rem 0.9rem; cursor:pointer;">やめる</button>
				</div>
			</form>
		{:else}
		<div style="font-size:0.9rem; color:var(--muted); margin-top:0.4rem;">
				単位 {bundle.item.unit} ・ リードタイム {bundle.item.leadTimeDays === null
					? `既定(${store.settings.defaultLeadTimeDays}日)`
					: `${bundle.item.leadTimeDays}日`}
		</div>
		<h3 style="font-size:0.95rem; margin:0.8rem 0 0;">商品リンク</h3>
		<ProductLinksEditor itemId={id} links={bundle.productLinks ?? []} />
		{/if}
		<button
			onclick={removeItem}
			style="margin-top:0.8rem; border:1px solid var(--danger); color:var(--danger); background:var(--card); border-radius:0.5rem; padding:0.4rem 0.8rem; cursor:pointer;"
			>この品目を削除</button
		>
	</div>
{/if}

<style>
	/* input の既定幅(size属性由来の約20文字ぶん)がフレックス項目を押し広げて
	   パネルからはみ出すのを防ぐ。幅指定を inline style で持つ input は従来どおり。 */
	input {
		width: 100%;
		min-width: 0;
	}
</style>
