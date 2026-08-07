<script lang="ts">
	import { productLinkLabel, normalizeProductLinkInput } from '$lib/productLinks';
	import type { ProductLink } from '$lib/types';
	import { store } from '$lib/app/store.svelte';

	let { itemId, links }: { itemId: string; links: ProductLink[] } = $props();
	let label = $state('');
	let url = $state('');
	let error = $state('');
	let editingId = $state<string | null>(null);
	let editLabel = $state('');
	let editUrl = $state('');

	function validate(input: { label: string; url: string }): { label: string; url: string } | null {
		const normalized = normalizeProductLinkInput(input);
		if (!normalized) {
			error = '商品リンクは http/https のURLで、表示名100文字・URL2048文字以内にしてください。';
			return null;
		}
		return normalized;
	}

	async function add(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		const input = validate({ label, url });
		if (!input) return;
		try {
			await store.addProductLink({ itemId, ...input });
			label = '';
			url = '';
		} catch (e) {
			error = e instanceof Error ? e.message : '商品リンクを追加できませんでした。';
		}
	}

	function startEdit(link: ProductLink) {
		editingId = link.id;
		editLabel = link.label;
		editUrl = link.url;
		error = '';
	}

	async function saveEdit(e: SubmitEvent) {
		e.preventDefault();
		if (!editingId) return;
		error = '';
		const input = validate({ label: editLabel, url: editUrl });
		if (!input) return;
		try {
			await store.editProductLink(editingId, input);
			editingId = null;
		} catch (e) {
			error = e instanceof Error ? e.message : '商品リンクを保存できませんでした。';
		}
	}

	async function remove(id: string) {
		try {
			await store.removeProductLink(id);
		} catch (e) {
			error = e instanceof Error ? e.message : '商品リンクを削除できませんでした。';
		}
	}
</script>

<div style="display:flex; flex-direction:column; gap:0.6rem; margin-top:0.6rem;">
	{#if links.length > 0}
		<ol style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.4rem;">
			{#each links as link, index (link.id)}
				<li style="border:1px solid var(--border); border-radius:0.4rem; padding:0.5rem;">
					{#if editingId === link.id}
						<form onsubmit={saveEdit} style="display:flex; gap:0.4rem; flex-wrap:wrap; align-items:end;">
							<label style="flex:1; min-width:8rem;"><span style="font-size:0.75rem;">表示名</span><input bind:value={editLabel} maxlength="100" /></label>
							<label style="flex:2; min-width:12rem;"><span style="font-size:0.75rem;">URL</span><input bind:value={editUrl} maxlength="2048" type="url" required /></label>
							<button type="submit">保存</button>
							<button type="button" onclick={() => (editingId = null)}>やめる</button>
						</form>
					{:else}
						<div style="display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap;">
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
							<a href={link.url} target="_blank" rel="noopener noreferrer" style="color:var(--accent);">{productLinkLabel(link)}</a>
							<span style="font-size:0.75rem; color:var(--muted);">{index === 0 ? '既定' : ''}</span>
							<span style="margin-left:auto; display:flex; gap:0.25rem;">
								<button type="button" onclick={() => store.moveProductLink(link.id, 'up')} disabled={index === 0} aria-label="上へ">↑</button>
								<button type="button" onclick={() => store.moveProductLink(link.id, 'down')} disabled={index === links.length - 1} aria-label="下へ">↓</button>
								<button type="button" onclick={() => startEdit(link)}>編集</button>
								<button type="button" onclick={() => remove(link.id)} style="color:var(--danger);">削除</button>
							</span>
						</div>
					{/if}
				</li>
			{/each}
		</ol>
	{:else}
		<p style="color:var(--muted); font-size:0.85rem; margin:0;">商品リンクはまだありません。</p>
	{/if}

	<form onsubmit={add} style="display:flex; gap:0.4rem; flex-wrap:wrap; align-items:end;">
		<label style="flex:1; min-width:8rem;"><span style="font-size:0.75rem;">表示名(任意)</span><input bind:value={label} maxlength="100" placeholder="Amazon" /></label>
		<label style="flex:2; min-width:12rem;"><span style="font-size:0.75rem;">URL</span><input bind:value={url} maxlength="2048" type="url" placeholder="https://..." required /></label>
		<button type="submit">追加</button>
	</form>
	{#if error}<p style="color:var(--danger); font-size:0.85rem; margin:0;">{error}</p>{/if}
</div>
