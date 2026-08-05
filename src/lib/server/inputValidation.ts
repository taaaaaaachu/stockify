import type { Snapshot } from '$lib/repo/types';

const MAX_IMPORT_ITEMS = 10_000;
const MAX_IMPORT_CHILDREN = 100_000;

export function parseNonNegativeNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value === 'boolean') return null;
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : null;
}

export function parsePositiveNumber(value: unknown): number | null {
	if (typeof value === 'boolean') return null;
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : null;
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
				!Number.isFinite(Number(purchase.purchasedAt)) ||
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
				!Number.isFinite(Number(event.at))
			);
		}) ||
		(snapshot.adjustments as unknown[]).some((value) => {
			if (!value || typeof value !== 'object') return true;
			const adjustment = value as Record<string, unknown>;
			return (
				typeof adjustment.id !== 'string' ||
				typeof adjustment.itemId !== 'string' ||
				!itemIds.has(adjustment.itemId) ||
				!Number.isFinite(Number(adjustment.at)) ||
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
				!Number.isFinite(Number(subscription.nextDeliveryAt)) ||
				parsePositiveNumber(subscription.volumePerDelivery) === null ||
				parsePositiveNumber(subscription.quantityPerDelivery) === null ||
				typeof subscription.paused !== 'boolean'
			);
		})
	)
		return false;

	return true;
}
