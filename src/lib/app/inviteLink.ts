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
const FINDER = 7;

/**
 * データのマスは角の丸い四角(`d`)、角の 3 つの位置検出パターンは左上座標(`finders`)で返す。
 * 位置検出パターンは読み取りの手がかりなので、マスとしてではなく角丸の枠として別に描く。
 * 真円のドット(半径 0.5 未満)は jsQR で読めなくなるコードがあったため、マスいっぱいの角丸にしている。
 */
export function qrPath(text: string): { size: number; d: string; finders: { x: number; y: number }[] } {
	const { size, data } = encode(text, QR_OPTIONS);
	const b = QR_OPTIONS.border;
	const far = size - b - FINDER;
	const finders = [
		{ x: b, y: b },
		{ x: far, y: b },
		{ x: b, y: far }
	];
	const inFinder = (x: number, y: number) =>
		finders.some((f) => x >= f.x && x < f.x + FINDER && y >= f.y && y < f.y + FINDER);
	const r = 0.35;
	const e = 1 - 2 * r;
	const corner = (dx: number, dy: number) => `a${r} ${r} 0 0 1 ${dx} ${dy}`;
	let d = '';
	data.forEach((row, y) =>
		row.forEach((dark, x) => {
			if (dark && !inFinder(x, y))
				d += `M${x + r} ${y}h${e}${corner(r, r)}v${e}${corner(-r, r)}h${-e}${corner(-r, -r)}v${-e}${corner(r, -r)}z`;
		})
	);
	return { size, d, finders };
}
