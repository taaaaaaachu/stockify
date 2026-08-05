import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from './db';
import {
	households,
	stockItems,
	purchases,
	ranouts,
	adjustments,
	subscriptions,
	type StockItemRow,
	type PurchaseRow,
	type RanoutRow,
	type AdjustmentRow,
	type SubscriptionRow
} from './db/schema';
import type {
	Purchase,
	RanOutEvent,
	RemainingAdjustment,
	StockItem,
	Subscription
} from '$lib/types';
import type {
	AdjustmentInput,
	AppSettings,
	ItemBundle,
	PurchaseInput,
	RanOutInput,
	Snapshot,
	StockItemInput,
	SubscriptionInput
} from '$lib/repo/types';
import { generateDueDeliveries } from '$lib/domain/subscription';

// --- 行 → ドメイン型 ---

function toItem(r: StockItemRow): StockItem {
	return {
		id: r.id,
		name: r.name,
		unit: r.unit,
		category: r.category,
		leadTimeDays: r.leadTimeDays,
		provisionalDaysToDeplete: r.provisionalDaysToDeplete
	};
}
const toPurchase = (r: PurchaseRow): Purchase => ({
	id: r.id,
	itemId: r.itemId,
	volume: r.volume,
	price: r.price,
	purchasedAt: r.purchasedAt,
	source: r.source
});
const toRanout = (r: RanoutRow): RanOutEvent => ({ id: r.id, itemId: r.itemId, at: r.at });
const toAdjustment = (r: AdjustmentRow): RemainingAdjustment => ({
	id: r.id,
	itemId: r.itemId,
	at: r.at,
	remaining: r.remaining
});
const toSubscription = (r: SubscriptionRow): Subscription => ({
	id: r.id,
	itemId: r.itemId,
	intervalDays: r.intervalDays,
	nextDeliveryAt: r.nextDeliveryAt,
	volumePerDelivery: r.volumePerDelivery,
	quantityPerDelivery: r.quantityPerDelivery,
	paused: r.paused
});

// --- 所有チェック ---

/** その品目が指定世帯のものなら true。 */
export function itemInHousehold(db: Db, householdId: string, itemId: string): boolean {
	return !!db
		.select({ id: stockItems.id })
		.from(stockItems)
		.where(and(eq(stockItems.id, itemId), eq(stockItems.householdId, householdId)))
		.get();
}

/** 子レコード(購入など)が世帯所有の品目に属するなら、その itemId を返す。 */
function childItemId(
	db: Db,
	householdId: string,
	table: typeof purchases | typeof ranouts | typeof adjustments | typeof subscriptions,
	id: string
): string | null {
	const row = db
		.select({ itemId: table.itemId, householdId: stockItems.householdId })
		.from(table)
		.innerJoin(stockItems, eq(table.itemId, stockItems.id))
		.where(eq(table.id, id))
		.get();
	if (!row || row.householdId !== householdId) return null;
	return row.itemId;
}

// --- 設定 ---

export function getSettings(db: Db, householdId: string): AppSettings {
	const row = db
		.select({ defaultLeadTimeDays: households.defaultLeadTimeDays })
		.from(households)
		.where(eq(households.id, householdId))
		.get();
	return { defaultLeadTimeDays: row?.defaultLeadTimeDays ?? 7 };
}

export function updateSettings(db: Db, householdId: string, patch: Partial<AppSettings>): AppSettings {
	if (patch.defaultLeadTimeDays !== undefined) {
		db.update(households)
			.set({ defaultLeadTimeDays: patch.defaultLeadTimeDays })
			.where(eq(households.id, householdId))
			.run();
	}
	return getSettings(db, householdId);
}

// --- 品目 ---

export function listItems(db: Db, householdId: string): StockItem[] {
	return db
		.select()
		.from(stockItems)
		.where(eq(stockItems.householdId, householdId))
		.all()
		.map(toItem);
}

export function getItem(db: Db, householdId: string, id: string): StockItem | null {
	const row = db
		.select()
		.from(stockItems)
		.where(and(eq(stockItems.id, id), eq(stockItems.householdId, householdId)))
		.get();
	return row ? toItem(row) : null;
}

export function createItem(db: Db, householdId: string, input: StockItemInput): StockItem {
	const row: StockItemRow = { id: randomUUID(), householdId, ...input };
	db.insert(stockItems).values(row).run();
	return toItem(row);
}

export function updateItem(
	db: Db,
	householdId: string,
	id: string,
	patch: Partial<StockItemInput>
): StockItem | null {
	const existing = db
		.select()
		.from(stockItems)
		.where(and(eq(stockItems.id, id), eq(stockItems.householdId, householdId)))
		.get();
	if (!existing) return null;
	const updated = { ...existing, ...patch };
	db.update(stockItems).set(updated).where(eq(stockItems.id, id)).run();
	return toItem(updated);
}

export function deleteItem(db: Db, householdId: string, id: string): boolean {
	// 子レコードは FK の onDelete cascade で消える。
	const res = db
		.delete(stockItems)
		.where(and(eq(stockItems.id, id), eq(stockItems.householdId, householdId)))
		.run();
	return res.changes > 0;
}

// --- 購入 ---

export function listPurchases(db: Db, householdId: string, itemId: string): Purchase[] | null {
	if (!itemInHousehold(db, householdId, itemId)) return null;
	return db.select().from(purchases).where(eq(purchases.itemId, itemId)).all().map(toPurchase);
}

export function createPurchase(db: Db, householdId: string, input: PurchaseInput): Purchase | null {
	if (!itemInHousehold(db, householdId, input.itemId)) return null;
	const row: PurchaseRow = { id: randomUUID(), ...input };
	db.insert(purchases).values(row).run();
	return toPurchase(row);
}

export function updatePurchase(
	db: Db,
	householdId: string,
	id: string,
	patch: Partial<Omit<Purchase, 'id' | 'itemId'>>
): Purchase | null {
	if (!childItemId(db, householdId, purchases, id)) return null;
	const existing = db.select().from(purchases).where(eq(purchases.id, id)).get();
	if (!existing) return null;
	const updated = { ...existing, ...patch };
	db.update(purchases).set(updated).where(eq(purchases.id, id)).run();
	return toPurchase(updated);
}

export function deletePurchase(db: Db, householdId: string, id: string): boolean {
	if (!childItemId(db, householdId, purchases, id)) return false;
	db.delete(purchases).where(eq(purchases.id, id)).run();
	return true;
}

// --- 使い切り ---

export function createRanOutEvent(db: Db, householdId: string, input: RanOutInput): RanOutEvent | null {
	if (!itemInHousehold(db, householdId, input.itemId)) return null;
	const row: RanoutRow = { id: randomUUID(), ...input };
	db.insert(ranouts).values(row).run();
	return toRanout(row);
}

export function deleteRanOutEvent(db: Db, householdId: string, id: string): boolean {
	if (!childItemId(db, householdId, ranouts, id)) return false;
	db.delete(ranouts).where(eq(ranouts.id, id)).run();
	return true;
}

// --- 残量補正 ---

export function createAdjustment(
	db: Db,
	householdId: string,
	input: AdjustmentInput
): RemainingAdjustment | null {
	if (!itemInHousehold(db, householdId, input.itemId)) return null;
	const row: AdjustmentRow = { id: randomUUID(), ...input };
	db.insert(adjustments).values(row).run();
	return toAdjustment(row);
}

export function deleteAdjustment(db: Db, householdId: string, id: string): boolean {
	if (!childItemId(db, householdId, adjustments, id)) return false;
	db.delete(adjustments).where(eq(adjustments.id, id)).run();
	return true;
}

// --- 定期便 ---

export function createSubscription(
	db: Db,
	householdId: string,
	input: SubscriptionInput
): Subscription | null {
	if (!itemInHousehold(db, householdId, input.itemId)) return null;
	const row: SubscriptionRow = { id: randomUUID(), ...input };
	db.insert(subscriptions).values(row).run();
	return toSubscription(row);
}

export function updateSubscription(
	db: Db,
	householdId: string,
	id: string,
	patch: Partial<Omit<Subscription, 'id' | 'itemId'>>
): Subscription | null {
	if (!childItemId(db, householdId, subscriptions, id)) return null;
	const existing = db.select().from(subscriptions).where(eq(subscriptions.id, id)).get();
	if (!existing) return null;
	const updated = { ...existing, ...patch };
	db.update(subscriptions).set(updated).where(eq(subscriptions.id, id)).run();
	return toSubscription(updated);
}

export function deleteSubscription(db: Db, householdId: string, id: string): boolean {
	if (!childItemId(db, householdId, subscriptions, id)) return false;
	db.delete(subscriptions).where(eq(subscriptions.id, id)).run();
	return true;
}

// --- バンドル / スナップショット ---

export function listBundles(db: Db, householdId: string): ItemBundle[] {
	const items = db.select().from(stockItems).where(eq(stockItems.householdId, householdId)).all();
	const ids = items.map((i) => i.id);
	if (ids.length === 0) return [];
	const [ps, rs, as, ss] = [
		db.select().from(purchases).where(inArray(purchases.itemId, ids)).all(),
		db.select().from(ranouts).where(inArray(ranouts.itemId, ids)).all(),
		db.select().from(adjustments).where(inArray(adjustments.itemId, ids)).all(),
		db.select().from(subscriptions).where(inArray(subscriptions.itemId, ids)).all()
	];
	return items.map((item) => ({
		item: toItem(item),
		purchases: ps.filter((p) => p.itemId === item.id).map(toPurchase),
		ranOutEvents: rs.filter((r) => r.itemId === item.id).map(toRanout),
		adjustments: as.filter((a) => a.itemId === item.id).map(toAdjustment),
		subscriptions: ss.filter((s) => s.itemId === item.id).map(toSubscription)
	}));
}

export function getBundle(db: Db, householdId: string, itemId: string): ItemBundle | null {
	if (!itemInHousehold(db, householdId, itemId)) return null;
	const item = db.select().from(stockItems).where(eq(stockItems.id, itemId)).get();
	if (!item) return null;
	return {
		item: toItem(item),
		purchases: db.select().from(purchases).where(eq(purchases.itemId, itemId)).all().map(toPurchase),
		ranOutEvents: db.select().from(ranouts).where(eq(ranouts.itemId, itemId)).all().map(toRanout),
		adjustments: db
			.select()
			.from(adjustments)
			.where(eq(adjustments.itemId, itemId))
			.all()
			.map(toAdjustment),
		subscriptions: db
			.select()
			.from(subscriptions)
			.where(eq(subscriptions.itemId, itemId))
			.all()
			.map(toSubscription)
	};
}

export function exportAll(db: Db, householdId: string): Snapshot {
	const bundles = listBundles(db, householdId);
	return {
		settings: getSettings(db, householdId),
		items: bundles.map((b) => b.item),
		purchases: bundles.flatMap((b) => b.purchases),
		ranOutEvents: bundles.flatMap((b) => b.ranOutEvents),
		adjustments: bundles.flatMap((b) => b.adjustments),
		subscriptions: bundles.flatMap((b) => b.subscriptions)
	};
}

/**
 * スナップショットを世帯へ取り込む(単純追記)。id は全て新規採番し、
 * 品目→子レコードの対応を維持する。設定は取り込まない(世帯の既定値を尊重)。
 */
export function importSnapshot(
	db: Db,
	householdId: string,
	snapshot: Snapshot
): { items: number } {
	const idMap = new Map<string, string>();
	let itemCount = 0;
	db.transaction((tx) => {
		for (const item of snapshot.items) {
			const newId = randomUUID();
			idMap.set(item.id, newId);
			tx.insert(stockItems)
				.values({
					id: newId,
					householdId,
					name: item.name,
					unit: item.unit,
					category: item.category ?? null,
					leadTimeDays: item.leadTimeDays ?? null,
					provisionalDaysToDeplete: item.provisionalDaysToDeplete ?? null
				})
				.run();
			itemCount++;
		}
		for (const p of snapshot.purchases) {
			const itemId = idMap.get(p.itemId);
			if (!itemId) continue;
			tx.insert(purchases)
				.values({ id: randomUUID(), itemId, volume: p.volume, price: p.price ?? null, purchasedAt: p.purchasedAt, source: p.source })
				.run();
		}
		for (const r of snapshot.ranOutEvents) {
			const itemId = idMap.get(r.itemId);
			if (!itemId) continue;
			tx.insert(ranouts).values({ id: randomUUID(), itemId, at: r.at }).run();
		}
		for (const a of snapshot.adjustments) {
			const itemId = idMap.get(a.itemId);
			if (!itemId) continue;
			tx.insert(adjustments).values({ id: randomUUID(), itemId, at: a.at, remaining: a.remaining }).run();
		}
		for (const s of snapshot.subscriptions) {
			const itemId = idMap.get(s.itemId);
			if (!itemId) continue;
			tx.insert(subscriptions)
				.values({
					id: randomUUID(),
					itemId,
					intervalDays: s.intervalDays,
					nextDeliveryAt: s.nextDeliveryAt,
					volumePerDelivery: s.volumePerDelivery,
					quantityPerDelivery: s.quantityPerDelivery,
					paused: s.paused
				})
				.run();
		}
	});
	return { items: itemCount };
}

/**
 * 世帯内の全定期便について予定日超過分の購入を生成し、次回予定日を更新する
 * (ADR 0002 の遅延生成。会員モードではサーバー側で行う)。
 */
export function materializeDueSubscriptions(
	db: Db,
	householdId: string,
	now: number
): { generatedPurchases: number } {
	const rows = db
		.select({ sub: subscriptions })
		.from(subscriptions)
		.innerJoin(stockItems, eq(subscriptions.itemId, stockItems.id))
		.where(eq(stockItems.householdId, householdId))
		.all()
		.map((r) => r.sub);

	let generated = 0;
	db.transaction((tx) => {
		for (const sub of rows) {
			const { deliveries, nextDeliveryAt } = generateDueDeliveries(sub, now);
			if (deliveries.length === 0) continue;
			for (const d of deliveries) {
				tx.insert(purchases)
					.values({
						id: randomUUID(),
						itemId: sub.itemId,
						volume: d.volume,
						price: null,
						purchasedAt: d.deliveredAt,
						source: 'subscription'
					})
					.run();
				generated++;
			}
			tx.update(subscriptions).set({ nextDeliveryAt }).where(eq(subscriptions.id, sub.id)).run();
		}
	});
	return { generatedPurchases: generated };
}
