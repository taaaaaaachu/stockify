import { encode } from 'uqr';

/** 招待コードを埋め込んだ招待リンク。 */
export function inviteLinkUrl(origin: string, code: string): string {
	return `${origin}/invite/${encodeURIComponent(code)}`;
}

/** QR コードを SVG の 1 本の path として描くためのデータ(周囲に 2 マスの余白を含む)。 */
export function qrPath(text: string): { size: number; d: string } {
	const { size, data } = encode(text, { border: 2 });
	let d = '';
	data.forEach((row, y) =>
		row.forEach((dark, x) => {
			if (dark) d += `M${x} ${y}h1v1h-1z`;
		})
	);
	return { size, d };
}
