import { describe, expect, it } from 'vitest';
import { buildInviteRequestBody } from './inviteRequest';

describe('buildInviteRequestBody', () => {
	it('number input from a number input is converted to an expiration value', () => {
		expect(buildInviteRequestBody(7)).toEqual({ expiresInDays: 7 });
	});

	it('empty input creates an unlimited invite request', () => {
		expect(buildInviteRequestBody('')).toEqual({});
	});

	it('nullish input creates an unlimited invite request', () => {
		expect(buildInviteRequestBody(undefined)).toEqual({});
		expect(buildInviteRequestBody(null)).toEqual({});
	});
});
