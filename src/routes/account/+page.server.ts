import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { listHouseholdInvites } from '$lib/server/households';
import { canManageHousehold } from '$lib/rbac';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	const active = locals.activeHousehold;
	const canManage = active ? canManageHousehold(active.role, locals.user.instanceRole) : false;
	return {
		canManage,
		invites: canManage && active ? listHouseholdInvites(db, active.id) : []
	};
};
