/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

// 型のためのキャスト(Service Worker のグローバル)。
const sw = self as unknown as ServiceWorkerGlobalScope;
const OFFLINE_CACHE = 'stockify-offline-v1';
const OFFLINE_URL = '/offline.html';

interface PushPayload {
	title?: string;
	body?: string;
	url?: string;
}

// Android Chrome が WebAPK として扱えるよう、ナビゲーションをオフラインでも応答可能にする。
// 認証済み画面や API レスポンスは保存せず、固定のオフラインページだけをキャッシュする。
sw.addEventListener('install', (event: ExtendableEvent) => {
	event.waitUntil(
		Promise.all([
			caches.open(OFFLINE_CACHE).then((cache) => cache.add(OFFLINE_URL)),
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
							.filter((name) => name.startsWith('stockify-offline-') && name !== OFFLINE_CACHE)
							.map((name) => caches.delete(name))
					)
				),
			sw.clients.claim()
		])
	);
});

sw.addEventListener('fetch', (event: FetchEvent) => {
	if (event.request.mode !== 'navigate') return;

	event.respondWith(
		fetch(event.request).catch(async () => {
			const offlinePage = await caches.match(OFFLINE_URL);
			return (
				offlinePage ??
				new Response('オフラインです。通信状態を確認してから、もう一度お試しください。', {
					status: 503,
					headers: { 'Content-Type': 'text/plain; charset=utf-8' }
				})
			);
		})
	);
});

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
