import { describe, expect, it } from 'vitest';
import { isValidSnapshot, parseClientId, parseFiniteNumber, parseNonNegativeNumber, parsePositiveNumber } from './inputValidation';

const item = {
	id: 'item-1',
	name: '洗剤',
	unit: 'ml',
	category: null,
	leadTimeDays: null,
	provisionalDaysToDeplete: 30
};

describe('入力検証', () => {
	it('非負数と正数を区別する', () => {
		expect(parseNonNegativeNumber(0)).toBe(0);
		expect(parseNonNegativeNumber(-1)).toBeNull();
		expect(parsePositiveNumber(0)).toBeNull();
		expect(parsePositiveNumber(1)).toBe(1);
		expect(parseNonNegativeNumber(false)).toBeNull();
		expect(parsePositiveNumber(true)).toBeNull();
		expect(parseFiniteNumber(false)).toBeNull();
		expect(parseFiniteNumber(null)).toBeNull();
		expect(parseFiniteNumber('')).toBeNull();
		expect(parseNonNegativeNumber('   ')).toBeNull();
		expect(parseFiniteNumber('\t')).toBeNull();
		expect(parseFiniteNumber('123')).toBe(123);
	});

	it('不正な品目を含むスナップショットを拒否する', () => {
		expect(isValidSnapshot({ items: [{ ...item, name: '' }], purchases: [], ranOutEvents: [], adjustments: [], subscriptions: [] })).toBe(false);
	});

	it('重複した品目IDを含むスナップショットを拒否する', () => {
		expect(
			isValidSnapshot({
				items: [item, { ...item, name: '別の洗剤' }],
				purchases: [],
				ranOutEvents: [],
				adjustments: [],
				subscriptions: []
			})
		).toBe(false);
	});

	it('子レコードの参照先と値を検証する', () => {
		const valid = {
			settings: { defaultLeadTimeDays: 7 },
			items: [item],
			purchases: [
				{ id: 'purchase-1', itemId: 'item-1', volume: 1, price: null, purchasedAt: 1, source: 'manual' }
			],
			ranOutEvents: [],
			adjustments: [],
			subscriptions: []
		};
		expect(isValidSnapshot(valid)).toBe(true);
		expect(isValidSnapshot({ ...valid, purchases: [{ ...valid.purchases[0], itemId: 'missing' }] })).toBe(false);
		expect(isValidSnapshot({ ...valid, purchases: [{ ...valid.purchases[0], purchasedAt: false }] })).toBe(false);
		expect(
			isValidSnapshot({
				...valid,
				subscriptions: [{
					id: 'sub-1', itemId: 'item-1', intervalDays: 0, nextDeliveryAt: 1,
					volumePerDelivery: 1, quantityPerDelivery: 1, paused: false
				}]
			})
		).toBe(false);
	});
});

describe('parseClientId', () => {
	it('未指定は undefined、UUID と定期便の決定的 ID は受け付ける', () => {
		expect(parseClientId(undefined)).toBeUndefined();
		expect(parseClientId(null)).toBeUndefined();
		expect(parseClientId('0b6f5d0e-1c2a-4f7e-9d3b-2a1c4e5f6a7b')).toBe('0b6f5d0e-1c2a-4f7e-9d3b-2a1c4e5f6a7b');
		expect(parseClientId('sub-abc-1790000000000')).toBe('sub-abc-1790000000000');
	});

	it('文字列以外・空・記号入り・長すぎるものは不正', () => {
		for (const v of [1, '', 'a/b', 'a b', 'x'.repeat(101)]) expect(parseClientId(v)).toBeNull();
	});
});
