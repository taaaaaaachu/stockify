import { describe, expect, it } from 'vitest';
import { normalizeProductLinkInput, productLinkLabel } from './productLinks';

describe('product links', () => {
	it('trims and accepts http/https URLs', () => {
		expect(normalizeProductLinkInput({ label: ' Amazon ', url: ' https://amazon.co.jp/item ' })).toEqual({
			label: 'Amazon',
			url: 'https://amazon.co.jp/item'
		});
	});

	it('rejects unsafe schemes and missing URLs', () => {
		expect(normalizeProductLinkInput({ url: 'javascript:alert(1)' })).toBeNull();
		expect(normalizeProductLinkInput({ url: '' })).toBeNull();
	});

	it('falls back to the hostname when label is blank', () => {
		expect(productLinkLabel({ label: '', url: 'https://www.example.com/item/1' })).toBe('www.example.com');
	});
});
