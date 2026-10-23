import { vapidPublicKey } from '#lib/server/push.js';
import type { RequestHandler } from './$types';

/** クライアントが購読に使う VAPID 公開鍵。未設定なら null。 */
export const GET: RequestHandler = () => {
	return Response.json({ publicKey: vapidPublicKey() });
};
