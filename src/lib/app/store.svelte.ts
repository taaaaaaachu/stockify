import { IndexedDbRepository } from '$lib/repo/indexeddb';
import { materializeDueSubscriptions } from './subscriptions';
import type {
	AdjustmentInput,
	AppSettings,
	ItemBundle,
	PurchaseInput,
	StockItemInput,
	SubscriptionInput
} from '$lib/repo/types';

let repo: IndexedDbRepository | null = null;
function getRepo(): IndexedDbRepository {
	if (!repo) repo = new IndexedDbRepository();
	return repo;
}

/**
 * ゲストモードのアプリ状態。ブラウザの IndexedDB を唯一の保存先とする。
 * 起動時に定期便の遅延生成を適用してから在庫を読み込む。
 */
class Store {
	bundles = $state<ItemBundle[]>([]);
	settings = $state<AppSettings>({ defaultLeadTimeDays: 7 });
	now = $state(Date.now());
	loaded = $state(false);

	/** 起動時ロード: 定期便を遅延生成してから在庫と設定を読み込む。 */
	async load(): Promise<void> {
		this.now = Date.now();
		await materializeDueSubscriptions(getRepo(), this.now);
		await this.reload();
		this.loaded = true;
	}

	/** DB から最新の在庫・設定を読み直す。 */
	async reload(): Promise<void> {
		const r = getRepo();
		const [bundles, settings] = await Promise.all([r.listBundles(), r.getSettings()]);
		this.bundles = bundles;
		this.settings = settings;
	}

	bundle(itemId: string): ItemBundle | undefined {
		return this.bundles.find((b) => b.item.id === itemId);
	}

	// --- 品目 ---
	async addItem(input: StockItemInput): Promise<string> {
		const item = await getRepo().createItem(input);
		await this.reload();
		return item.id;
	}
	async editItem(id: string, patch: Partial<StockItemInput>): Promise<void> {
		await getRepo().updateItem(id, patch);
		await this.reload();
	}
	async removeItem(id: string): Promise<void> {
		await getRepo().deleteItem(id);
		await this.reload();
	}

	// --- 購入 ---
	async addPurchase(input: PurchaseInput): Promise<void> {
		await getRepo().createPurchase(input);
		await this.reload();
	}
	async removePurchase(id: string): Promise<void> {
		await getRepo().deletePurchase(id);
		await this.reload();
	}

	// --- 使い切り ---
	async markRanOut(itemId: string, at: number): Promise<void> {
		await getRepo().createRanOutEvent({ itemId, at });
		await this.reload();
	}
	async removeRanOut(id: string): Promise<void> {
		await getRepo().deleteRanOutEvent(id);
		await this.reload();
	}

	// --- 残量補正 ---
	async addAdjustment(input: AdjustmentInput): Promise<void> {
		await getRepo().createAdjustment(input);
		await this.reload();
	}
	async removeAdjustment(id: string): Promise<void> {
		await getRepo().deleteAdjustment(id);
		await this.reload();
	}

	// --- 定期便 ---
	async addSubscription(input: SubscriptionInput): Promise<void> {
		await getRepo().createSubscription(input);
		// 追加直後に過去分があれば生成しておく。
		await materializeDueSubscriptions(getRepo(), Date.now());
		await this.reload();
	}
	async editSubscription(
		id: string,
		patch: Partial<Omit<SubscriptionInput, 'itemId'>>
	): Promise<void> {
		await getRepo().updateSubscription(id, patch);
		await this.reload();
	}
	async removeSubscription(id: string): Promise<void> {
		await getRepo().deleteSubscription(id);
		await this.reload();
	}

	// --- 設定 ---
	async setDefaultLeadTime(days: number): Promise<void> {
		await getRepo().updateSettings({ defaultLeadTimeDays: days });
		await this.reload();
	}
}

export const store = new Store();
