import { json } from '@sveltejs/kit';
import { vapidPublicKey } from '$lib/server/push';
import type { RequestHandler } from './$types';

/** クライアントが購読に使う VAPID 公開鍵。未設定なら null。 */
export const GET: RequestHandler = () => {
	return json({ publicKey: vapidPublicKey() });
};
