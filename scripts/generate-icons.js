// PWA用のPNGアイコンをSVGから生成するスクリプト。
// icon.svg / icon-maskable.svg を変更したら `node scripts/generate-icons.js` で再生成する。
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const staticDir = join(__dirname, '..', 'static');

// 生成対象: [元SVG, 出力PNG, サイズ]
const targets = [
	['icon.svg', 'icon-192.png', 192],
	['icon.svg', 'icon-512.png', 512],
	// apple-touch-icon はiOSが独自に角丸マスクを付けるため、角丸なし全面塗りのmaskable版を使う
	['icon-maskable.svg', 'apple-touch-icon.png', 180],
	['icon-maskable.svg', 'icon-192-maskable.png', 192],
	['icon-maskable.svg', 'icon-512-maskable.png', 512]
];

for (const [srcName, outName, size] of targets) {
	const svg = await readFile(join(staticDir, srcName));
	const png = await sharp(svg, { density: 512 })
		.resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toBuffer();
	await writeFile(join(staticDir, outName), png);
	console.log(`generated static/${outName} (${size}x${size}) from ${srcName}`);
}
