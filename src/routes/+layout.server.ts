import type { LayoutServerLoad } from './$types';

/** 認証状態と世帯コンテキストを全ページへ渡す。 */
export const load: LayoutServerLoad = ({ locals }) => {
	return {
		user: locals.user,
		households: locals.households.map((h) => ({ id: h.id, name: h.name, role: h.role })),
		activeHousehold: locals.activeHousehold
	};
};
