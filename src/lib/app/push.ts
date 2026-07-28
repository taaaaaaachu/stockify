// クライアント側の Web Push 購読ヘルパ(会員モードで使う)。

/** VAPID 公開鍵(base64url)を Uint8Array へ変換する。 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(base64);
	const output = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
	return output;
}

/** ブラウザが Web Push に対応しているか。 */
export function pushSupported(): boolean {
	return (
		typeof window !== 'undefined' &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window
	);
}

/** サーバーの VAPID 公開鍵を取得する。プッシュ未設定なら null。 */
async function fetchPublicKey(): Promise<string | null> {
	const res = await fetch('/api/push/key');
	if (!res.ok) return null;
	const json = await res.json();
	return typeof json.publicKey === 'string' ? json.publicKey : null;
}

/** サーバーでプッシュが有効か(VAPID 設定済みか)。 */
export async function pushConfigured(): Promise<boolean> {
	return (await fetchPublicKey()) !== null;
}

/** 現在この端末が購読中か。 */
export async function isSubscribed(): Promise<boolean> {
	if (!pushSupported()) return false;
	const reg = await navigator.serviceWorker.ready;
	return (await reg.pushManager.getSubscription()) !== null;
}

/** 通知を有効化する。成功したら true。権限拒否や未設定なら例外/false。 */
export async function enablePush(): Promise<boolean> {
	if (!pushSupported()) throw new Error('この端末は通知に対応していません。');
	const publicKey = await fetchPublicKey();
	if (!publicKey) throw new Error('サーバーで通知が設定されていません。');

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') return false;

	const reg = await navigator.serviceWorker.ready;
	const sub = await reg.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource
	});
	const res = await fetch('/api/push/subscribe', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(sub.toJSON())
	});
	return res.ok;
}

/** 通知を無効化する。 */
export async function disablePush(): Promise<void> {
	if (!pushSupported()) return;
	const reg = await navigator.serviceWorker.ready;
	const sub = await reg.pushManager.getSubscription();
	if (!sub) return;
	await fetch('/api/push/unsubscribe', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ endpoint: sub.endpoint })
	});
	await sub.unsubscribe();
}
