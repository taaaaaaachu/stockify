import { describe, it, expect } from 'vitest';
import { MAX_OPERATION_DELAY_MS, operationTime, requireRecentAuth } from './apiGuard';

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

describe('requireRecentAuth', () => {
	const user = { id: 'u', username: 'u', instanceRole: 'user' as const, notifyMinuteOfDay: 540, mustChangePassword: false };
	const locals = (session: App.Locals['session'], u: App.Locals['user'] = user): App.Locals => ({
		user: u,
		session,
		households: [],
		activeHousehold: null
	});

	it('直近に本人確認していれば、ユーザーとセッション id を返す', () => {
		expect(requireRecentAuth(locals({ id: 's', verifiedAt: Date.now() }))).toEqual({ ...user, sessionId: 's' });
	});

	it('本人確認が古い・未確認なら 428、未ログインなら 401', () => {
		const stale = locals({ id: 's', verifiedAt: Date.now() - 60 * 60 * 1000 });
		expect(() => requireRecentAuth(stale)).toThrow(expect.objectContaining({ status: 428 }));
		expect(() => requireRecentAuth(locals({ id: 's', verifiedAt: null }))).toThrow(
			expect.objectContaining({ status: 428 })
		);
		expect(() => requireRecentAuth(locals(null, null))).toThrow(expect.objectContaining({ status: 401 }));
	});
});
