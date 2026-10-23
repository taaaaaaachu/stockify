import { db } from '#lib/server/db/index.js';
import { listUserHouseholds } from '#lib/server/households.js';
import type { PageServerLoad } from './$types';

/** 会員は世帯ごとの通知ON/OFF状態を渡す。ゲストは空配列。 */
export const load: PageServerLoad = ({ locals }) => {
	const notifyHouseholds = locals.user
		? listUserHouseholds(db, locals.user.id).map((h) => ({
				id: h.id,
				name: h.name,
				notifyEnabled: h.notifyEnabled
			}))
		: [];
	return { notifyHouseholds };
};
