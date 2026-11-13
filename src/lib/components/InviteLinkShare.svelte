<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { inviteLinkUrl, qrPath } from '#lib/app/inviteLink.js';

	let { code }: { code: string } = $props();

	const url = $derived(inviteLinkUrl(page.url.origin, code));
	const qr = $derived(qrPath(url));
	let showQr = $state(false);
	let copied = $state(false);
	// 共有シートの有無はブラウザでしかわからない(SSR との食い違いを避けて描画後に判定する)。
	let canShare = $state(false);
	onMount(() => {
		canShare = typeof navigator.share === 'function';
	});

	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// クリップボードが使えない環境でも、画面上のリンクは選択してコピーできる。
		}
	}

	async function share() {
		try {
			await navigator.share({ title: 'Stockify への招待', url });
		} catch {
			// 共有シートを閉じた場合など。
		}
	}

	const button =
		'border:1px solid var(--border); background:var(--card); color:var(--text); border-radius:0.4rem; padding:0.25rem 0.5rem; cursor:pointer;';
</script>

<div style="display:flex; flex-direction:column; gap:0.4rem; font-size:0.85rem;">
	<code style="overflow-wrap:anywhere; user-select:all;">{url}</code>
	<span style="display:flex; gap:0.4rem; flex-wrap:wrap;">
		<button type="button" onclick={copy} style={button}>{copied ? 'コピーしました' : 'リンクをコピー'}</button>
		{#if canShare}<button type="button" onclick={share} style={button}>共有</button>{/if}
		<button type="button" onclick={() => (showQr = !showQr)} style={button}>{showQr ? 'QRを隠す' : 'QRを表示'}</button>
	</span>
	{#if showQr}
		<!-- 読み取りやすいよう、テーマに関係なく白地に黒で描く。 -->
		<svg
			viewBox={`0 0 ${qr.size} ${qr.size}`}
			width="200"
			height="200"
			role="img"
			aria-label="招待リンクのQRコード"
			shape-rendering="crispEdges"
			style="background:#fff;"
		>
			<path d={qr.d} fill="#000" />
		</svg>
	{/if}
</div>
