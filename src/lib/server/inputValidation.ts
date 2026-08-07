import type { Snapshot } from '$lib/repo/types';
import { normalizeProductLinkInput } from '$lib/productLinks';

const MAX_IMPORT_ITEMS = 10_000;
const MAX_IMPORT_CHILDREN = 100_000;

export function parseNonNegativeNumber(value: unknown): number | null {
	if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
	if (typeof value === 'boolean') return null;
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : null;
}

export function parsePositiveNumber(value: unknown): number | null {
	if (typeof value === 'boolean') return null;
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : null;
}

export function parseFiniteNumber(value: unknown): number | null {
	if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
	if (typeof value === 'boolean') return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

export function parseInteger(value: unknown): number | null {
	const number = parseFiniteNumber(value);
	return number !== null && Number.isInteger(number) ? number : null;
}

export function isValidSnapshot(value: unknown): value is Snapshot {
	if (!value || typeof value !== 'object') return false;
	const snapshot = value as Record<string, unknown>;
	if (!Array.isArray(snapshot.items) || snapshot.items.length > MAX_IMPORT_ITEMS) return false;
	const childArrays = ['purchases', 'ranOutEvents', 'adjustments', 'subscriptions'] as const;
	if (
		childArrays.some(
			(key) => !Array.isArray(snapshot[key]) || (snapshot[key] as unknown[]).length > MAX_IMPORT_CHILDREN
		)
	)
		return false;
	if (snapshot.productLinks !== undefined && (!Array.isArray(snapshot.productLinks) || snapshot.productLinks.length > MAX_IMPORT_CHILDREN)) return false;

	if (
		snapshot.items.some((value) => {
			if (!value || typeof value !== 'object') return true;
			const item = value as Record<string, unknown>;
			return (
				typeof item.id !== 'string' ||
				typeof item.name !== 'string' ||
				item.name.trim() === '' ||
				typeof item.unit !== 'string' ||
				item.unit.trim() === '' ||
				(item.leadTimeDays !== null &&
					item.leadTimeDays !== undefined &&
					parseNonNegativeNumber(item.leadTimeDays) === null) ||
				(item.provisionalDaysToDeplete !== null &&
					item.provisionalDaysToDeplete !== undefined &&
					parseNonNegativeNumber(item.provisionalDaysToDeplete) === null)
			);
		})
	)
		return false;

	const itemIds = new Set(snapshot.items.map((item) => (item as { id: string }).id));
	if (itemIds.size !== snapshot.items.length) return false;
	if (
		(snapshot.purchases as unknown[]).some((value) => {
			if (!value || typeof value !== 'object') return true;
			const purchase = value as Record<string, unknown>;
			return (
				typeof purchase.id !== 'string' ||
				typeof purchase.itemId !== 'string' ||
				!itemIds.has(purchase.itemId) ||
				parsePositiveNumber(purchase.volume) === null ||
				(purchase.price !== null &&
					purchase.price !== undefined &&
					(purchase.price === '' || parseNonNegativeNumber(purchase.price) === null)) ||
				parseFiniteNumber(purchase.purchasedAt) === null ||
				(purchase.source !== 'manual' && purchase.source !== 'subscription')
			);
		}) ||
		(snapshot.ranOutEvents as unknown[]).some((value) => {
			if (!value || typeof value !== 'object') return true;
			const event = value as Record<string, unknown>;
			return (
				typeof event.id !== 'string' ||
				typeof event.itemId !== 'string' ||
				!itemIds.has(event.itemId) ||
				parseFiniteNumber(event.at) === null
			);
		}) ||
		(snapshot.adjustments as unknown[]).some((value) => {
			if (!value || typeof value !== 'object') return true;
			const adjustment = value as Record<string, unknown>;
			return (
				typeof adjustment.id !== 'string' ||
				typeof adjustment.itemId !== 'string' ||
				!itemIds.has(adjustment.itemId) ||
				parseFiniteNumber(adjustment.at) === null ||
				parseNonNegativeNumber(adjustment.remaining) === null
			);
		}) ||
		(snapshot.subscriptions as unknown[]).some((value) => {
			if (!value || typeof value !== 'object') return true;
			const subscription = value as Record<string, unknown>;
			return (
				typeof subscription.id !== 'string' ||
				typeof subscription.itemId !== 'string' ||
				!itemIds.has(subscription.itemId) ||
				parsePositiveNumber(subscription.intervalDays) === null ||
				parseFiniteNumber(subscription.nextDeliveryAt) === null ||
				parsePositiveNumber(subscription.volumePerDelivery) === null ||
				parsePositiveNumber(subscription.quantityPerDelivery) === null ||
				typeof subscription.paused !== 'boolean'
			);
		}) ||
		(snapshot.productLinks ?? []).some((value, index, links) => {
			if (!value || typeof value !== 'object') return true;
			const link = value as Record<string, unknown>;
			const duplicate = (links as unknown[]).some((other, otherIndex) => {
				if (otherIndex === index || !other || typeof other !== 'object') return false;
				const otherLink = other as Record<string, unknown>;
				return otherLink.itemId === link.itemId && otherLink.url === link.url;
			});
			return (
				typeof link.id !== 'string' ||
				typeof link.itemId !== 'string' ||
				!itemIds.has(link.itemId) ||
				typeof link.position !== 'number' ||
				!Number.isInteger(link.position) ||
				duplicate ||
				normalizeProductLinkInput({ label: link.label, url: link.url }) === null
			);
		})
	)
		return false;

	return true;
}
