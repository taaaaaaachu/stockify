import { encode } from 'uqr';

/** 招待コードを埋め込んだ招待リンク。 */
export function inviteLinkUrl(origin: string, code: string): string {
	return `${origin}/invite/${encodeURIComponent(code)}`;
}

/**
 * QR コードを SVG の 1 本の path として描くためのデータ(周囲に 2 マスの余白を含む)。
 * 中央にアイコンを重ねても読めるよう、誤り訂正は最高の H(約 30% の欠けまで復元)にする。
 */
export const QR_OPTIONS = { border: 2, ecc: 'H' } as const;
export function qrPath(text: string): { size: number; d: string } {
	const { size, data } = encode(text, QR_OPTIONS);
	let d = '';
	data.forEach((row, y) =>
		row.forEach((dark, x) => {
			if (dark) d += `M${x} ${y}h1v1h-1z`;
		})
	);
	return { size, d };
}
