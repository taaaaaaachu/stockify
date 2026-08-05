import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { listHouseholdInvites, listHouseholdMembers, listPendingOwnershipTransfers, listHouseholdSummaries } from '$lib/server/households';
import { canManageInvites, canManageMembers } from '$lib/rbac';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	const active = locals.activeHousehold;
	const canManageInvitesForActive = active ? canManageInvites(active.role) : false;
	const canManageMembersForActive = active ? canManageMembers(active.role) : false;
	return {
		canManageInvites: canManageInvitesForActive,
		canManageMembers: canManageMembersForActive,
		invites: canManageInvitesForActive && active ? listHouseholdInvites(db, active.id) : [],
		members: canManageInvitesForActive && active ? listHouseholdMembers(db, active.id) : [],
		pendingTransfers: listPendingOwnershipTransfers(db, locals.user.id),
		adminHouseholds: locals.user.instanceRole === 'super_admin' ? listHouseholdSummaries(db) : []
	};
};
