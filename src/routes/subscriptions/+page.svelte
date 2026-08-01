<script lang="ts">
	import { resolve } from '$app/paths';
	import { store } from '$lib/app/store.svelte';
	import {
		dateInputToTimestamp,
		formatDate,
		formatDaysUntil,
		formatQuantity,
		localDateInput
	} from '$lib/format';
	import { MS_PER_DAY } from '$lib/domain/estimate';

	type SubscriptionRow = {
		item: (typeof store.bundles)[number]['item'];
		subscription: (typeof store.bundles)[number]['subscriptions'][number];
	};

	const subscriptionRows = $derived(
		store.bundles
			.flatMap((bundle) =>
				bundle.subscriptions.map((subscription) => ({ item: bundle.item, subscription }))
			)
			.sort((a, b) => {
				if (a.subscription.paused !== b.subscription.paused) {
					return Number(a.subscription.paused) - Number(b.subscription.paused);
				}
				if (a.subscription.nextDeliveryAt !== b.subscription.nextDeliveryAt) {
					return a.subscription.nextDeliveryAt - b.subscription.nextDeliveryAt;
				}
				return a.item.name.localeCompare(b.item.name, 'ja');
			}) satisfies SubscriptionRow[]
	);

	const activeRows = $derived(subscriptionRows.filter((row) => !row.subscription.paused));
	const pausedRows = $derived(subscriptionRows.filter((row) => row.subscription.paused));
	const dueSoonRows = $derived(
		subscriptionRows.filter(
			(row) => !row.subscription.paused && row.subscription.nextDeliveryAt <= store.now + 7 * MS_PER_DAY
		)
	);

	let busy = $state<string | null>(null);
	let editingNextId = $state<string | null>(null);
	let nextDate = $state('');

	function startEditNext(row: SubscriptionRow) {
		editingNextId = row.subscription.id;
		nextDate = localDateInput(new Date(row.subscription.nextDeliveryAt));
	}

	async function saveNextDate(row: SubscriptionRow, e: SubmitEvent) {
		e.preventDefault();
		busy = row.subscription.id;
		try {
			await store.setSubscriptionNextDelivery(row.subscription.id, dateInputToTimestamp(nextDate));
			editingNextId = null;
		} finally {
			busy = null;
		}
	}

	async function togglePaused(row: SubscriptionRow) {
		busy = row.subscription.id;
		try {
			await store.editSubscription(row.subscription.id, { paused: !row.subscription.paused });
		} finally {
			busy = null;
		}
	}

	async function skip(row: SubscriptionRow) {
		busy = row.subscription.id;
		try {
			await store.skipSubscription(row.subscription);
		} finally {
			busy = null;
		}
	}

	async function remove(row: SubscriptionRow) {
		if (!confirm(`「${row.item.name}」の定期便を解約します。よろしいですか?`)) return;
		busy = row.subscription.id;
		try {
			await store.removeSubscription(row.subscription.id);
		} finally {
			busy = null;
		}
	}
</script>

<div
	style="display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; flex-wrap:wrap; margin-bottom:1rem;"
>
	<div>
		<h1 style="margin:0; font-size:1.35rem;">定期便一覧</h1>
		<p style="margin:0.35rem 0 0; color:var(--muted); font-size:0.9rem;">
			定期購入の予定、停止中のもの、次回配送日の変更をまとめて管理します。
		</p>
	</div>
	<a
		href={resolve('/')}
		style="background:var(--card); color:var(--accent); text-decoration:none; border:1px solid var(--border);
		       padding:0.45rem 0.8rem; border-radius:0.5rem; font-size:0.9rem;"
	>
		在庫へ戻る
	</a>
</div>

{#if !store.loaded}
	<p style="color:var(--muted);">読み込み中…</p>
{:else if subscriptionRows.length === 0}
	<div style="background:var(--card); border:1px solid var(--border); border-radius:0.75rem; padding:1rem;">
		<p style="margin-top:0;">まだ定期便がありません。</p>
		<p style="margin-bottom:0; color:var(--muted);">
			品目の詳細画面から定期便を登録すると、この一覧でまとめて確認できます。
		</p>
	</div>
{:else}
	<div style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:0.75rem; margin-bottom:1rem;">
		<div style="background:var(--card); border:1px solid var(--border); border-radius:0.75rem; padding:0.9rem;">
			<div style="font-size:0.78rem; color:var(--muted);">登録数</div>
			<div style="font-size:1.4rem; font-weight:700; margin-top:0.2rem;">{subscriptionRows.length}件</div>
		</div>
		<div style="background:var(--card); border:1px solid var(--border); border-radius:0.75rem; padding:0.9rem;">
			<div style="font-size:0.78rem; color:var(--muted);">稼働中</div>
			<div style="font-size:1.4rem; font-weight:700; margin-top:0.2rem;">{activeRows.length}件</div>
		</div>
		<div style="background:var(--card); border:1px solid var(--border); border-radius:0.75rem; padding:0.9rem;">
			<div style="font-size:0.78rem; color:var(--muted);">一時停止中</div>
			<div style="font-size:1.4rem; font-weight:700; margin-top:0.2rem;">{pausedRows.length}件</div>
		</div>
		<div style="background:var(--card); border:1px solid var(--border); border-radius:0.75rem; padding:0.9rem;">
			<div style="font-size:0.78rem; color:var(--muted);">7日以内の予定</div>
			<div style="font-size:1.4rem; font-weight:700; margin-top:0.2rem;">{dueSoonRows.length}件</div>
		</div>
	</div>

	<section style="margin-bottom:1.25rem;">
		<h2 style="margin:0 0 0.5rem; font-size:1rem;">稼働中</h2>
		{#if activeRows.length === 0}
			<p style="color:var(--muted);">いま稼働中の定期便はありません。</p>
		{:else}
			<div style="display:flex; flex-direction:column; gap:0.7rem;">
				{#each activeRows as row (row.subscription.id)}
					<div
						style="background:var(--card); border:1px solid var(--border); border-radius:0.75rem; padding:0.9rem;"
					>
						<div
							style="display:flex; gap:0.75rem; align-items:flex-start; justify-content:space-between; flex-wrap:wrap;"
						>
							<div>
								<div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
									<a
										href={resolve('/items/[id]', { id: row.item.id })}
										style="font-weight:700; color:inherit; text-decoration:none;"
										>{row.item.name}</a
									>
									{#if row.item.category}
										<span style="font-size:0.75rem; color:var(--muted);">{row.item.category}</span>
									{/if}
									<span
										style="font-size:0.72rem; color:var(--accent); border:1px solid var(--accent);
										       border-radius:999px; padding:0 0.4rem;"
										>稼働中</span
									>
								</div>
								<div style="margin-top:0.35rem; font-size:0.9rem; color:var(--muted);">
									{row.subscription.intervalDays}日ごとに {formatQuantity(
										row.subscription.volumePerDelivery * row.subscription.quantityPerDelivery,
										row.item.unit
									)} ・ 次回 {formatDate(row.subscription.nextDeliveryAt)} ({formatDaysUntil(
										(row.subscription.nextDeliveryAt - store.now) / MS_PER_DAY
									)})
								</div>
							</div>
							<div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
								{#if !row.subscription.paused}
									<button
										onclick={() => skip(row)}
										disabled={busy === row.subscription.id}
										style="border:1px solid var(--border); background:var(--card); border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer;"
									>
										スキップ
									</button>
								{/if}
								<button
									onclick={() => startEditNext(row)}
									style="border:1px solid var(--border); background:var(--card); border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer;"
								>
									次回日変更
								</button>
								<button
									onclick={() => togglePaused(row)}
									disabled={busy === row.subscription.id}
									style="border:1px solid var(--border); background:var(--card); border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer;"
								>
									一時停止
								</button>
								<button
									onclick={() => remove(row)}
									disabled={busy === row.subscription.id}
									style="border:1px solid var(--danger); color:var(--danger); background:var(--card); border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer;"
								>
									解約
								</button>
							</div>
						</div>

						{#if editingNextId === row.subscription.id}
							<form
								onsubmit={(e) => saveNextDate(row, e)}
								style="display:flex; gap:0.5rem; align-items:center; margin-top:0.8rem; flex-wrap:wrap;"
							>
								<input bind:value={nextDate} type="date" required />
								<button
									type="submit"
									style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer;"
								>
									保存
								</button>
								<button
									type="button"
									onclick={() => (editingNextId = null)}
									style="border:1px solid var(--border); background:var(--card); border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer;"
								>
									やめる
								</button>
							</form>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section>
		<h2 style="margin:0 0 0.5rem; font-size:1rem;">一時停止中</h2>
		{#if pausedRows.length === 0}
			<p style="color:var(--muted);">一時停止中の定期便はありません。</p>
		{:else}
			<div style="display:flex; flex-direction:column; gap:0.7rem;">
				{#each pausedRows as row (row.subscription.id)}
					<div
						style="background:var(--card); border:1px solid var(--border); border-radius:0.75rem; padding:0.9rem; opacity:0.9;"
					>
						<div
							style="display:flex; gap:0.75rem; align-items:flex-start; justify-content:space-between; flex-wrap:wrap;"
						>
							<div>
								<div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
									<a
										href={resolve('/items/[id]', { id: row.item.id })}
										style="font-weight:700; color:inherit; text-decoration:none;"
										>{row.item.name}</a
									>
									{#if row.item.category}
										<span style="font-size:0.75rem; color:var(--muted);">{row.item.category}</span>
									{/if}
									<span
										style="font-size:0.72rem; color:var(--muted); border:1px solid var(--border);
										       border-radius:999px; padding:0 0.4rem;"
										>一時停止中</span
									>
								</div>
								<div style="margin-top:0.35rem; font-size:0.9rem; color:var(--muted);">
									{row.subscription.intervalDays}日ごとに {formatQuantity(
										row.subscription.volumePerDelivery * row.subscription.quantityPerDelivery,
										row.item.unit
									)} ・ 次回 {formatDate(row.subscription.nextDeliveryAt)}
								</div>
							</div>
							<div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
								<button
									onclick={() => togglePaused(row)}
									disabled={busy === row.subscription.id}
									style="border:1px solid var(--border); background:var(--card); border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer;"
								>
									再開
								</button>
								<button
									onclick={() => startEditNext(row)}
									style="border:1px solid var(--border); background:var(--card); border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer;"
								>
									次回日変更
								</button>
								<button
									onclick={() => remove(row)}
									disabled={busy === row.subscription.id}
									style="border:1px solid var(--danger); color:var(--danger); background:var(--card); border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer;"
								>
									解約
								</button>
							</div>
						</div>

						{#if editingNextId === row.subscription.id}
							<form
								onsubmit={(e) => saveNextDate(row, e)}
								style="display:flex; gap:0.5rem; align-items:center; margin-top:0.8rem; flex-wrap:wrap;"
							>
								<input bind:value={nextDate} type="date" required />
								<button
									type="submit"
									style="background:var(--accent); color:#fff; border:none; border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer;"
								>
									保存
								</button>
								<button
									type="button"
									onclick={() => (editingNextId = null)}
									style="border:1px solid var(--border); background:var(--card); border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer;"
								>
									やめる
								</button>
							</form>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>
{/if}
