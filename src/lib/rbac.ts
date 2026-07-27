// クライアント・サーバー両方から使う純粋な権限判定。副作用・DB依存なし(ADR 0003)。

/** インスタンス全体のロール。運営者は super_admin、通常会員は user。 */
export type InstanceRole = 'super_admin' | 'user';

/** ある世帯におけるロール。owner は世帯の管理、member は在庫の閲覧・編集のみ。 */
export type HouseholdRole = 'owner' | 'member';

/** インスタンス管理者(サーバー全体の運営者)か。 */
export function isInstanceAdmin(role: InstanceRole): boolean {
	return role === 'super_admin';
}

/**
 * 世帯そのものを管理できるか(招待発行・メンバー除名・世帯削除・世帯設定変更)。
 * その世帯の owner、またはインスタンス管理者なら可。
 * householdRole は非所属なら null。
 */
export function canManageHousehold(
	householdRole: HouseholdRole | null,
	instanceRole: InstanceRole
): boolean {
	return householdRole === 'owner' || isInstanceAdmin(instanceRole);
}

/**
 * 世帯の在庫(品目・購入・定期便など)を閲覧・編集できるか。
 * その世帯に所属(owner/member どちらでも)していれば可。
 * householdRole は非所属なら null。
 */
export function canEditStock(householdRole: HouseholdRole | null): boolean {
	return householdRole === 'owner' || householdRole === 'member';
}
