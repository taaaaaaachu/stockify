/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

// 型のためのキャスト(Service Worker のグローバル)。
const sw = self as unknown as ServiceWorkerGlobalScope;

interface PushPayload {
	title?: string;
	body?: string;
	url?: string;
}

// サーバーからの Web Push を受けて通知を表示する。
sw.addEventListener('push', (event: PushEvent) => {
	let payload: PushPayload = {};
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
