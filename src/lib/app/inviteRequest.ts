export function buildInviteRequestBody(
	inviteExpiry: string | number | null | undefined
): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	const expiry = String(inviteExpiry ?? '').trim();
	if (expiry !== '') body.expiresInDays = Number(expiry);
	return body;
}
