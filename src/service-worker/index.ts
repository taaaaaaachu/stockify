import { self as sw } from '$app/service-worker';
import { version } from '$app/env';
import { immutable, assets } from '$app/manifest';
import { asset } from '$app/paths';
import { strategyFor } from '#lib/sw/strategy.js';
import { MEMBER_DB_PREFIX } from '#lib/repo/member.js';

// 版ごとにキャッシュを分ける。古い HTML が消えた旧アセットを参照しないよう、ページも版ごと(ADR 0009)。
const ASSET_CACHE = `stockify-assets-${version}`;
const PAGE_CACHE = `stockify-pages-${version}`;
const OFFLINE_URL = '/offline.html';
// マニフェストのパスはベースパス相対なので、url.pathname と同じ形(先頭 / 付き)にそろえる。
// ビルド成果物は SW 自身(ベースパス直下)からの相対で解決する。
const PRECACHED = new Set([
	...immutable.map((f) => new URL(f.path, sw.location.href).pathname),
	...assets.map((f) => asset(f.path))
]);

interface PushPayload {
	title?: string;
	body?: string;
	url?: string;
}

// アプリ本体(ビルド成果物・静的ファイル)をプリキャッシュし、オフラインでも起動できるようにする。
sw.addEventListener('install', (event: ExtendableEvent) => {
	event.waitUntil(
		Promise.all([
			caches.open(ASSET_CACHE).then((cache) => cache.addAll([...PRECACHED])),
			sw.skipWaiting()
		])
	);
});

sw.addEventListener('activate', (event: ExtendableEvent) => {
	event.waitUntil(
		Promise.all([
			caches
				.keys()
				.then((names) =>
					Promise.all(
						names
							.filter(
								(name) =>
									name.startsWith('stockify-') && name !== ASSET_CACHE && name !== PAGE_CACHE
							)
							.map((name) => caches.delete(name))
					)
				),
			sw.clients.claim()
		])
	);
});

async function cacheFirst(request: Request): Promise<Response> {
	return (await caches.match(request, { cacheName: ASSET_CACHE })) ?? fetch(request);
}

// 画面遷移は network-first。成功した HTML を保存し、通信できなければ保存済みを返す。
async function networkFirstPage(request: Request): Promise<Response> {
	try {
		const response = await fetch(request);
		if (response.ok && !response.redirected && response.type === 'basic') {
			const cache = await caches.open(PAGE_CACHE);
			await cache.put(request, response.clone());
		}
		return response;
	} catch {
		const cached =
			(await caches.match(request, { cacheName: PAGE_CACHE })) ??
			(await caches.match(OFFLINE_URL, { cacheName: ASSET_CACHE }));
		return (
			cached ??
			new Response('オフラインです。通信状態を確認してから、もう一度お試しください。', {
				status: 503,
				headers: { 'Content-Type': 'text/plain; charset=utf-8' }
			})
		);
	}
}

sw.addEventListener('fetch', (event: FetchEvent) => {
	switch (strategyFor(event.request, sw.location.origin, PRECACHED)) {
		case 'precache':
			event.respondWith(cacheFirst(event.request));
			return;
		case 'page':
			event.respondWith(networkFirstPage(event.request));
			return;
		case 'clear-pages':
			// ページ HTML にはユーザー名等が埋め込まれるため、認証状態が変わるときに消す。
			event.waitUntil(caches.delete(PAGE_CACHE));
			return;
		case 'clear-user-data':
			event.waitUntil(Promise.all([caches.delete(PAGE_CACHE), deleteMemberDatabases()]));
			return;
	}
});

// 共有端末に在庫データを残さないよう、ログアウト時に会員のローカル DB を消す(ADR 0009)。
async function deleteMemberDatabases(): Promise<void> {
	const dbs = await indexedDB.databases();
	await Promise.all(
		dbs
			.filter((db) => db.name?.startsWith(MEMBER_DB_PREFIX))
			.map(
				(db) =>
					new Promise<void>((resolve) => {
						const request = indexedDB.deleteDatabase(db.name!);
						request.onsuccess = request.onerror = () => resolve();
					})
			)
	);
}

// サーバーからの Web Push を受けて通知を表示する。
sw.addEventListener('push', (event: PushEvent) => {
	let payload: PushPayload;
	try {
		payload = event.data?.json() ?? {};
	} catch {
		payload = { body: event.data?.text() };
	}
	const title = payload.title ?? 'Stockify';
	event.waitUntil(
		sw.registration.showNotification(title, {
			body: payload.body ?? '',
			icon: '/icon.svg',
			badge: '/icon.svg',
			data: { url: payload.url ?? '/' }
		})
	);
});

// 通知タップで該当ページを開く(既に開いていればそれをフォーカス)。
sw.addEventListener('notificationclick', (event: NotificationEvent) => {
	event.notification.close();
	const url = (event.notification.data as { url?: string })?.url ?? '/';
	event.waitUntil(
		(async () => {
			const clientList = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const client of clientList) {
				if ('focus' in client) {
					await client.focus();
					if ('navigate' in client) await client.navigate(url).catch(() => undefined);
					return;
				}
			}
			await sw.clients.openWindow(url);
		})()
	);
});
