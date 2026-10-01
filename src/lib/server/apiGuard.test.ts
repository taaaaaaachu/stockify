import { describe, it, expect } from 'vitest';
import { MAX_OPERATION_DELAY_MS, operationTime } from './apiGuard';

const NOW = Date.UTC(2026, 9, 2);
const reqWith = (opAt?: string) =>
	new Request('http://localhost/api/subscriptions', {
		headers: opAt === undefined ? {} : { 'x-stockify-op-at': opAt }
	});

describe('operationTime', () => {
	it('ヘッダーが無ければ今', () => {
		expect(operationTime(reqWith(), NOW)).toBe(NOW);
		expect(operationTime(reqWith('abc'), NOW)).toBe(NOW);
	});

	it('オフライン中の操作日時を基準にする', () => {
		expect(operationTime(reqWith(String(NOW - 2 * 86400000)), NOW)).toBe(NOW - 2 * 86400000);
	});

	it('未来は今に、上限より昔は上限に丸める', () => {
		expect(operationTime(reqWith(String(NOW + 1000)), NOW)).toBe(NOW);
		expect(operationTime(reqWith('1'), NOW)).toBe(NOW - MAX_OPERATION_DELAY_MS);
	});
});
