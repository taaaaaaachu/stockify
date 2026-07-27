import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
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
	Repository,
	Snapshot,
	StockItemInput,
	SubscriptionInput
} from './types';

const DB_NAME = 'stockify';
const DB_VERSION = 1;
const SETTINGS_KEY = 'app';

const DEFAULT_SETTINGS: AppSettings = {
	defaultLeadTimeDays: 7
};

interface StockifyDB extends DBSchema {
	settings: { key: string; value: AppSettings };
	items: { key: string; value: StockItem };
	purchases: { key: string; value: Purchase; indexes: { by_item: string } };
	ranouts: { key: string; value: RanOutEvent; indexes: { by_item: string } };
	adjustments: { key: string; value: RemainingAdjustment; indexes: { by_item: string } };
	subscriptions: { key: string; value: Subscription; indexes: { by_item: string } };
}

function newId(): string {
	return crypto.randomUUID();
}

/**
 * ゲストモード用リポジトリ。データはブラウザの IndexedDB にのみ保存し、
 * サーバーとは一切通信しない(完全クライアント完結)。
 */
export class IndexedDbRepository implements Repository {
	#dbPromise: Promise<IDBPDatabase<StockifyDB>>;

	constructor() {
		this.#dbPromise = openDB<StockifyDB>(DB_NAME, DB_VERSION, {
			upgrade(db) {
				db.createObjectStore('settings');
				db.createObjectStore('items', { keyPath: 'id' });
				db.createObjectStore('purchases', { keyPath: 'id' }).createIndex('by_item', 'itemId');
				db.createObjectStore('ranouts', { keyPath: 'id' }).createIndex('by_item', 'itemId');
				db.createObjectStore('adjustments', { keyPath: 'id' }).createIndex('by_item', 'itemId');
				db
					.createObjectStore('subscriptions', { keyPath: 'id' })
					.createIndex('by_item', 'itemId');
			}
		});
	}

	async getSettings(): Promise<AppSettings> {
		const db = await this.#dbPromise;
		const stored = await db.get('settings', SETTINGS_KEY);
		return { ...DEFAULT_SETTINGS, ...stored };
	}

	async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
		const db = await this.#dbPromise;
		const next = { ...(await this.getSettings()), ...patch };
		await db.put('settings', next, SETTINGS_KEY);
		return next;
	}

	async listItems(): Promise<StockItem[]> {
		const db = await this.#dbPromise;
		return db.getAll('items');
	}

	async getItem(id: string): Promise<StockItem | null> {
		const db = await this.#dbPromise;
		return (await db.get('items', id)) ?? null;
	}

	async createItem(input: StockItemInput): Promise<StockItem> {
		const db = await this.#dbPromise;
		const item: StockItem = { id: newId(), ...input };
		await db.put('items', item);
		return item;
	}

	async updateItem(id: string, patch: Partial<StockItemInput>): Promise<StockItem> {
		const db = await this.#dbPromise;
		const existing = await db.get('items', id);
		if (!existing) throw new Error(`品目が見つかりません: ${id}`);
		const updated: StockItem = { ...existing, ...patch };
		await db.put('items', updated);
		return updated;
	}

	async deleteItem(id: string): Promise<void> {
		const db = await this.#dbPromise;
		const tx = db.transaction(
			['items', 'purchases', 'ranouts', 'adjustments', 'subscriptions'],
			'readwrite'
		);
		await tx.objectStore('items').delete(id);
		for (const store of ['purchases', 'ranouts', 'adjustments', 'subscriptions'] as const) {
			const keys = await tx.objectStore(store).index('by_item').getAllKeys(id);
			for (const key of keys) await tx.objectStore(store).delete(key);
		}
		await tx.done;
	}

	async listPurchases(itemId: string): Promise<Purchase[]> {
		const db = await this.#dbPromise;
		return db.getAllFromIndex('purchases', 'by_item', itemId);
	}

	async createPurchase(input: PurchaseInput): Promise<Purchase> {
		const db = await this.#dbPromise;
		const purchase: Purchase = { id: newId(), ...input };
		await db.put('purchases', purchase);
		return purchase;
	}

	async updatePurchase(
		id: string,
		patch: Partial<Omit<Purchase, 'id' | 'itemId'>>
	): Promise<Purchase> {
		const db = await this.#dbPromise;
		const existing = await db.get('purchases', id);
		if (!existing) throw new Error(`購入が見つかりません: ${id}`);
		const updated: Purchase = { ...existing, ...patch };
		await db.put('purchases', updated);
		return updated;
	}

	async deletePurchase(id: string): Promise<void> {
		const db = await this.#dbPromise;
		await db.delete('purchases', id);
	}

	async listRanOutEvents(itemId: string): Promise<RanOutEvent[]> {
		const db = await this.#dbPromise;
		return db.getAllFromIndex('ranouts', 'by_item', itemId);
	}

	async createRanOutEvent(input: RanOutInput): Promise<RanOutEvent> {
		const db = await this.#dbPromise;
		const event: RanOutEvent = { id: newId(), ...input };
		await db.put('ranouts', event);
		return event;
	}

	async deleteRanOutEvent(id: string): Promise<void> {
		const db = await this.#dbPromise;
		await db.delete('ranouts', id);
	}

	async listAdjustments(itemId: string): Promise<RemainingAdjustment[]> {
		const db = await this.#dbPromise;
		return db.getAllFromIndex('adjustments', 'by_item', itemId);
	}

	async createAdjustment(input: AdjustmentInput): Promise<RemainingAdjustment> {
		const db = await this.#dbPromise;
		const adjustment: RemainingAdjustment = { id: newId(), ...input };
		await db.put('adjustments', adjustment);
		return adjustment;
	}

	async deleteAdjustment(id: string): Promise<void> {
		const db = await this.#dbPromise;
		await db.delete('adjustments', id);
	}

	async listSubscriptions(itemId: string): Promise<Subscription[]> {
		const db = await this.#dbPromise;
		return db.getAllFromIndex('subscriptions', 'by_item', itemId);
	}

	async createSubscription(input: SubscriptionInput): Promise<Subscription> {
		const db = await this.#dbPromise;
		const subscription: Subscription = { id: newId(), ...input };
		await db.put('subscriptions', subscription);
		return subscription;
	}

	async updateSubscription(
		id: string,
		patch: Partial<Omit<Subscription, 'id' | 'itemId'>>
	): Promise<Subscription> {
		const db = await this.#dbPromise;
		const existing = await db.get('subscriptions', id);
		if (!existing) throw new Error(`定期便が見つかりません: ${id}`);
		const updated: Subscription = { ...existing, ...patch };
		await db.put('subscriptions', updated);
		return updated;
	}

	async deleteSubscription(id: string): Promise<void> {
		const db = await this.#dbPromise;
		await db.delete('subscriptions', id);
	}

	async getBundle(itemId: string): Promise<ItemBundle | null> {
		const db = await this.#dbPromise;
		const item = await db.get('items', itemId);
		if (!item) return null;
		const [purchases, ranOutEvents, adjustments, subscriptions] = await Promise.all([
			db.getAllFromIndex('purchases', 'by_item', itemId),
			db.getAllFromIndex('ranouts', 'by_item', itemId),
			db.getAllFromIndex('adjustments', 'by_item', itemId),
			db.getAllFromIndex('subscriptions', 'by_item', itemId)
		]);
		return { item, purchases, ranOutEvents, adjustments, subscriptions };
	}

	async listBundles(): Promise<ItemBundle[]> {
		const db = await this.#dbPromise;
		const [items, purchases, ranOutEvents, adjustments, subscriptions] = await Promise.all([
			db.getAll('items'),
			db.getAll('purchases'),
			db.getAll('ranouts'),
			db.getAll('adjustments'),
			db.getAll('subscriptions')
		]);
		return items.map((item) => ({
			item,
			purchases: purchases.filter((p) => p.itemId === item.id),
			ranOutEvents: ranOutEvents.filter((e) => e.itemId === item.id),
			adjustments: adjustments.filter((a) => a.itemId === item.id),
			subscriptions: subscriptions.filter((s) => s.itemId === item.id)
		}));
	}

	async exportAll(): Promise<Snapshot> {
		const db = await this.#dbPromise;
		const [settings, items, purchases, ranOutEvents, adjustments, subscriptions] =
			await Promise.all([
				this.getSettings(),
				db.getAll('items'),
				db.getAll('purchases'),
				db.getAll('ranouts'),
				db.getAll('adjustments'),
				db.getAll('subscriptions')
			]);
		return { settings, items, purchases, ranOutEvents, adjustments, subscriptions };
	}

	/** ゲストデータを全消去する(会員データへ取り込んだ後などに使う)。 */
	async clearAll(): Promise<void> {
		const db = await this.#dbPromise;
		const tx = db.transaction(
			['settings', 'items', 'purchases', 'ranouts', 'adjustments', 'subscriptions'],
			'readwrite'
		);
		for (const store of [
			'settings',
			'items',
			'purchases',
			'ranouts',
			'adjustments',
			'subscriptions'
		] as const) {
			await tx.objectStore(store).clear();
		}
		await tx.done;
	}
}
