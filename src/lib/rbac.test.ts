import { describe, it, expect } from 'vitest';
import { isInstanceAdmin, canManageHousehold, canEditStock } from './rbac';

describe('isInstanceAdmin', () => {
	it('super_admin のみ true', () => {
		expect(isInstanceAdmin('super_admin')).toBe(true);
		expect(isInstanceAdmin('user')).toBe(false);
	});
});

describe('canManageHousehold', () => {
	it('世帯 owner は管理できる', () => {
		expect(canManageHousehold('owner', 'user')).toBe(true);
	});
	it('世帯 member は管理できない', () => {
		expect(canManageHousehold('member', 'user')).toBe(false);
	});
	it('非所属でもインスタンス管理者なら管理できる', () => {
		expect(canManageHousehold(null, 'super_admin')).toBe(true);
	});
	it('非所属の一般ユーザーは管理できない', () => {
		expect(canManageHousehold(null, 'user')).toBe(false);
	});
});

describe('canEditStock', () => {
	it('owner/member は在庫を編集できる', () => {
		expect(canEditStock('owner')).toBe(true);
		expect(canEditStock('member')).toBe(true);
	});
	it('非所属は編集できない', () => {
		expect(canEditStock(null)).toBe(false);
	});
});
