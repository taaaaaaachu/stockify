export function buildInviteRequestBody(
	inviteExpiry: string | number | null | undefined
): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	const expiry = String(inviteExpiry ?? '').trim();
	if (expiry !== '') {
		const days = Number(expiry);
		body.expiresInDays = Number.isFinite(days) ? days : expiry;
	}
	return body;
}
