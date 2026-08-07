import type { ProductLink } from '$lib/types';

export const PRODUCT_LINK_LABEL_MAX_LENGTH = 100;
export const PRODUCT_LINK_URL_MAX_LENGTH = 2048;

export function normalizeProductLinkInput(input: { label?: unknown; url?: unknown }): {
	label: string;
	url: string;
} | null {
	const label = typeof input.label === 'string' ? input.label.trim() : '';
	const url = typeof input.url === 'string' ? input.url.trim() : '';
	if (!url || label.length > PRODUCT_LINK_LABEL_MAX_LENGTH || url.length > PRODUCT_LINK_URL_MAX_LENGTH)
		return null;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
	} catch {
		return null;
	}
	return { label, url };
}

export function productLinkLabel(link: Pick<ProductLink, 'label' | 'url'>): string {
	if (link.label) return link.label;
	try {
		return new URL(link.url).hostname;
	} catch {
		return link.url;
	}
}
