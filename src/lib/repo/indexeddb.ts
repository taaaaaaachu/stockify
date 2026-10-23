import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
	Purchase,
	ProductLink,
	RanOutEvent,
	RemainingAdjustment,
	StockItem,
	Subscription
} from '#lib/types.js';
import type {
	AdjustmentInput,
	AppSettings,
	ItemBundle,
	PurchaseInput,
	RanOutInput,
	Repository,
	Snapshot,
	StockItemInput,
	ProductLinkInput,
	SubscriptionInput,
	OutboxOp
} from './types';

const DB_NAME = 'stockify';
const DB_VERSION = 3;
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
	productLinks: { key: string; value: ProductLink; indexes: { by_item: string } };
	/** 会員のサーバー未送信の操作(ADR 0009)。ゲストでは使わない。 */
	outbox: { key: number; value: OutboxOp };
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

	/** @param name DB 名。ゲストは既定、会員は世帯ごとに別名(ADR 0009)。 */
	constructor(name = DB_NAME) {
		this.#dbPromise = openDB<StockifyDB>(name, DB_VERSION, {
			// ログアウト時の DB 削除を妨げないよう、要求されたら接続を閉じる。
			blocking(_current, _blocked, event) {
				(event.target as IDBDatabase).close();
			},
			upgrade(db) {
				if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
				if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
				if (!db.objectStoreNames.contains('purchases')) db.createObjectStore('purchases', { keyPath: 'id' }).createIndex('by_item', 'itemId');
				if (!db.objectStoreNames.contains('ranouts')) db.createObjectStore('ranouts', { keyPath: 'id' }).createIndex('by_item', 'itemId');
				if (!db.objectStoreNames.contains('adjustments')) db.createObjectStore('adjustments', { keyPath: 'id' }).createIndex('by_item', 'itemId');
				if (!db.objectStoreNames.contains('subscriptions')) db.createObjectStore('subscriptions', { keyPath: 'id' }).createIndex('by_item', 'itemId');
				if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
				if (!db.objectStoreNames.contains('productLinks')) db.createObjectStore('productLinks', { keyPath: 'id' }).createIndex('by_item', 'itemId');
			}
		});
	}

	async refresh(): Promise<void> {
		// ゲストはクライアントで定期便を遅延生成する。
		const { materializeDueSubscriptions } = await import('#lib/app/subscriptions.js');
		await materializeDueSubscriptions(this, Date.now());
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
			['items', 'purchases', 'ranouts', 'adjustments', 'subscriptions', 'productLinks'],
			'readwrite'
		);
		await tx.objectStore('items').delete(id);
		for (const store of ['purchases', 'ranouts', 'adjustments', 'subscriptions', 'productLinks'] as const) {
			const keys = await tx.objectStore(store).index('by_item').getAllKeys(id);
			for (const key of keys) await tx.objectStore(store).delete(key);
		}
		await tx.done;
	}

	async getProductLink(id: string): Promise<ProductLink | null> {
		const db = await this.#dbPromise;
		return (await db.get('productLinks', id)) ?? null;
	}

	async listProductLinks(itemId: string): Promise<ProductLink[]> {
		const db = await this.#dbPromise;
		return (await db.getAllFromIndex('productLinks', 'by_item', itemId)).sort((a, b) => a.position - b.position);
	}

	async createProductLink(input: ProductLinkInput): Promise<ProductLink> {
		const db = await this.#dbPromise;
		const links = await this.listProductLinks(input.itemId);
		if (links.some((link) => link.url === input.url)) throw new Error('同じURLの商品リンクは登録できません。');
		const link: ProductLink = { id: newId(), ...input, position: links.length };
		await db.put('productLinks', link);
		return link;
	}

	async updateProductLink(id: string, patch: Partial<Pick<ProductLink, 'label' | 'url'>>): Promise<ProductLink> {
		const db = await this.#dbPromise;
		const existing = await db.get('productLinks', id);
		if (!existing) throw new Error(`商品リンクが見つかりません: ${id}`);
		if (patch.url && (await this.listProductLinks(existing.itemId)).some((link) => link.id !== id && link.url === patch.url))
			throw new Error('同じURLの商品リンクは登録できません。');
		const updated = { ...existing, ...patch };
		await db.put('productLinks', updated);
		return updated;
	}

	async deleteProductLink(id: string): Promise<void> {
		const db = await this.#dbPromise;
		const existing = await db.get('productLinks', id);
		if (!existing) return;
		const links = await this.listProductLinks(existing.itemId);
		await db.delete('productLinks', id);
		for (const [position, link] of links.filter((link) => link.id !== id).entries()) {
			if (link.position !== position) await db.put('productLinks', { ...link, position });
		}
	}

	async moveProductLink(id: string, direction: 'up' | 'down'): Promise<void> {
		const db = await this.#dbPromise;
		const link = await db.get('productLinks', id);
		if (!link) return;
		const links = await this.listProductLinks(link.itemId);
		const index = links.findIndex((entry) => entry.id === id);
		const otherIndex = direction === 'up' ? index - 1 : index + 1;
		if (index < 0 || otherIndex < 0 || otherIndex >= links.length) return;
		const other = links[otherIndex];
		await db.put('productLinks', { ...link, position: other.position });
		await db.put('productLinks', { ...other, position: link.position });
	}

	async listPurchases(itemId: string): Promise<Purchase[]> {
		const db = await this.#dbPromise;
		return db.getAllFromIndex('purchases', 'by_item', itemId);
	}

	async createPurchase(input: PurchaseInput): Promise<Purchase> {
		const db = await this.#dbPromise;
		// 定期便の遅延生成は決定的 ID を渡す(同じ回の再生成は上書きになる)。
		const purchase: Purchase = { ...input, id: input.id ?? newId() };
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
		const [productLinks, purchases, ranOutEvents, adjustments, subscriptions] = await Promise.all([
			db.getAllFromIndex('productLinks', 'by_item', itemId),
			db.getAllFromIndex('purchases', 'by_item', itemId),
			db.getAllFromIndex('ranouts', 'by_item', itemId),
			db.getAllFromIndex('adjustments', 'by_item', itemId),
			db.getAllFromIndex('subscriptions', 'by_item', itemId)
		]);
		return { item, productLinks: productLinks.sort((a, b) => a.position - b.position), purchases, ranOutEvents, adjustments, subscriptions };
	}

	async listBundles(): Promise<ItemBundle[]> {
		const db = await this.#dbPromise;
		const [items, productLinks, purchases, ranOutEvents, adjustments, subscriptions] = await Promise.all([
			db.getAll('items'),
			db.getAll('productLinks'),
			db.getAll('purchases'),
			db.getAll('ranouts'),
			db.getAll('adjustments'),
			db.getAll('subscriptions')
		]);
		return items.map((item) => ({
			item,
			productLinks: productLinks.filter((link) => link.itemId === item.id).sort((a, b) => a.position - b.position),
			purchases: purchases.filter((p) => p.itemId === item.id),
			ranOutEvents: ranOutEvents.filter((e) => e.itemId === item.id),
			adjustments: adjustments.filter((a) => a.itemId === item.id),
			subscriptions: subscriptions.filter((s) => s.itemId === item.id)
		}));
	}

	async exportAll(): Promise<Snapshot> {
		const db = await this.#dbPromise;
		const [settings, items, productLinks, purchases, ranOutEvents, adjustments, subscriptions] =
			await Promise.all([
				this.getSettings(),
				db.getAll('items'),
				db.getAll('productLinks'),
				db.getAll('purchases'),
				db.getAll('ranouts'),
				db.getAll('adjustments'),
				db.getAll('subscriptions')
			]);
		return { settings, items, productLinks, purchases, ranOutEvents, adjustments, subscriptions };
	}

	/**
	 * 全データをスナップショットで置き換える(会員のサーバー → ローカル取り込み)。
	 * 未送信の操作が残っていれば、ローカルの変更を消さないよう何もせず false を返す。
	 */
	async replaceAll(snapshot: Snapshot): Promise<boolean> {
		const db = await this.#dbPromise;
		const stores = ['settings', 'items', 'purchases', 'ranouts', 'adjustments', 'subscriptions', 'productLinks'] as const;
		const tx = db.transaction([...stores, 'outbox'], 'readwrite');
		if ((await tx.objectStore('outbox').count()) > 0) {
			tx.abort();
			await tx.done.catch(() => undefined);
			return false;
		}
		for (const store of stores) await tx.objectStore(store).clear();
		await tx.objectStore('settings').put(snapshot.settings, SETTINGS_KEY);
		const rows = [
			['items', snapshot.items],
			['purchases', snapshot.purchases],
			['ranouts', snapshot.ranOutEvents],
			['adjustments', snapshot.adjustments],
			['subscriptions', snapshot.subscriptions],
			['productLinks', snapshot.productLinks ?? []]
		] as const;
		for (const [store, values] of rows) {
			for (const value of values) await tx.objectStore(store).put(value as never);
		}
		await tx.done;
		return true;
	}

	// --- outbox(会員の未送信操作) ---
	async enqueue(op: Omit<OutboxOp, 'seq'>): Promise<void> {
		const db = await this.#dbPromise;
		await db.add('outbox', op as OutboxOp);
	}
	async listOutbox(): Promise<OutboxOp[]> {
		const db = await this.#dbPromise;
		return db.getAll('outbox');
	}
	async removeOutbox(seq: number): Promise<void> {
		const db = await this.#dbPromise;
		await db.delete('outbox', seq);
	}
	async countOutbox(): Promise<number> {
		const db = await this.#dbPromise;
		return db.count('outbox');
	}

	/** ゲストデータを全消去する(会員データへ取り込んだ後などに使う)。 */
	async clearAll(): Promise<void> {
		const db = await this.#dbPromise;
		const tx = db.transaction(
			['settings', 'items', 'purchases', 'ranouts', 'adjustments', 'subscriptions', 'productLinks'],
			'readwrite'
		);
		for (const store of [
			'settings',
			'items',
			'purchases',
			'ranouts',
			'adjustments',
			'subscriptions'
			, 'productLinks'
		] as const) {
			await tx.objectStore(store).clear();
		}
		await tx.done;
	}
}
