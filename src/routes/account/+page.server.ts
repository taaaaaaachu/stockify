import { redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { listHouseholdInvites, listHouseholdMembers, listPendingOwnershipTransfers, listHouseholdSummaries } from '#lib/server/households.js';
import { getCredentialSummary } from '#lib/server/credentials.js';
import { listAgentConnections } from '#lib/server/agentConnections.js';
import { canManageInvites, canManageMembers } from '#lib/rbac.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	// 強制パスワード変更中は変更フォームしか出さないので、世帯や管理のデータも返さない(ADR 0011)。
	// activeHousehold は hooks で null になっている。
	const forced = locals.user.mustChangePassword;
	const active = locals.activeHousehold;
	const canManageInvitesForActive = active ? canManageInvites(active.role) : false;
	const canManageMembersForActive = active ? canManageMembers(active.role) : false;
	return {
		credentials: getCredentialSummary(db, locals.user.id),
		agentConnections: forced ? [] : listAgentConnections(db, locals.user.id),
		mcpUrl: `${url.origin}/mcp`,
		canManageInvites: canManageInvitesForActive,
		canManageMembers: canManageMembersForActive,
		invites: canManageInvitesForActive && active ? listHouseholdInvites(db, active.id) : [],
		members: canManageInvitesForActive && active ? listHouseholdMembers(db, active.id) : [],
		pendingTransfers: forced ? [] : listPendingOwnershipTransfers(db, locals.user.id),
		adminHouseholds: !forced && locals.user.instanceRole === 'super_admin' ? listHouseholdSummaries(db) : []
	};
};
