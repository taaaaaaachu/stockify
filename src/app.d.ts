// See https://svelte.dev/docs/kit/types#app.d.ts
import type { InstanceRole, HouseholdRole } from '$lib/rbac';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: {
				id: string;
				username: string;
				instanceRole: InstanceRole;
				notifyMinuteOfDay: number;
				mustChangePassword: boolean;
			} | null;
			/** ログイン中ユーザーが所属する世帯の一覧。 */
			households: { id: string; name: string; role: HouseholdRole; defaultLeadTimeDays: number }[];
			/** 現在選択中の世帯。未ログインや世帯無しなら null。 */
			activeHousehold: { id: string; name: string; role: HouseholdRole } | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
