import { IndexedDbRepository } from '$lib/repo/indexeddb';
import { ApiRepository } from '$lib/repo/api';
import type { Repository } from '$lib/repo/types';
import type {
	AdjustmentInput,
	AppSettings,
	ItemBundle,
	PurchaseInput,
	StockItemInput,
	SubscriptionInput
} from '$lib/repo/types';
import type { InstanceRole, HouseholdRole } from '$lib/rbac';

export interface AuthUser {
	id: string;
	username: string;
	instanceRole: InstanceRole;
	notifyMinuteOfDay: number;
}
export interface HouseholdSummary {
	id: string;
	name: string;
	role: HouseholdRole;
}

/** レイアウトから渡すサーバー側コンテキスト。 */
export interface AppContext {
	user: AuthUser | null;
	households: HouseholdSummary[];
	activeHousehold: HouseholdSummary | null;
}

/**
 * アプリ状態。ゲストは IndexedDB、会員は /api(現在の世帯)を保存先にする。
 * レイアウトが configure() でコンテキストを与え、その変化でリポジトリを選び直す。
 */
class Store {
	mode = $state<'guest' | 'member'>('guest');
	user = $state<AuthUser | null>(null);
	households = $state<HouseholdSummary[]>([]);
	activeHousehold = $state<HouseholdSummary | null>(null);

	bundles = $state<ItemBundle[]>([]);
	settings = $state<AppSettings>({ defaultLeadTimeDays: 7 });
	now = $state(Date.now());
	loaded = $state(false);

	#repo: Repository | null = null;
	#contextKey = '';
	#loading = false;

	get repo(): Repository {
		if (!this.#repo) this.#repo = new IndexedDbRepository();
		return this.#repo;
	}

	/** レイアウトのサーバーデータを反映する。コンテキストが変わればリポジトリを選び直す。 */
	configure(ctx: AppContext): void {
		const key = `${ctx.user?.id ?? 'guest'}::${ctx.activeHousehold?.id ?? '-'}`;
		this.user = ctx.user;
		this.households = ctx.households;
		this.activeHousehold = ctx.activeHousehold;
		if (key === this.#contextKey) return;
		this.#contextKey = key;
		this.mode = ctx.user && ctx.activeHousehold ? 'member' : 'guest';
		this.#repo = this.mode === 'member' ? new ApiRepository() : new IndexedDbRepository();
		this.loaded = false;
		void this.load();
	}

	/** 起動時ロード: 定期便を遅延生成してから在庫と設定を読み込む。 */
	async load(): Promise<void> {
		if (this.#loading) return;
		this.#loading = true;
		try {
			this.now = Date.now();
			await this.repo.refresh();
			await this.reload();
			this.loaded = true;
		} finally {
			this.#loading = false;
		}
	}

	async reload(): Promise<void> {
		// 「今」を毎回更新する。直前に Date.now() で登録した購入が now より後に
		// なって推定から除外される(=即・在庫切れ表示)のを防ぐ。
		this.now = Date.now();
		const [bundles, settings] = await Promise.all([
			this.repo.listBundles(),
			this.repo.getSettings()
		]);
		this.bundles = bundles;
		this.settings = settings;
	}

	bundle(itemId: string): ItemBundle | undefined {
		return this.bundles.find((b) => b.item.id === itemId);
	}

	/** 既存の品目に付いているカテゴリ/保管場所の一覧(重複なし・五十音順)。入力候補に使う。 */
	get categories(): string[] {
		// ローカルの重複排除用。リアクティブ状態ではないので通常の Set でよい。
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const set = new Set<string>();
		for (const b of this.bundles) {
			if (b.item.category) set.add(b.item.category);
		}
		return [...set].sort((a, b) => a.localeCompare(b, 'ja'));
	}

	// --- 品目 ---
	async addItem(input: StockItemInput): Promise<string> {
		const item = await this.repo.createItem(input);
		await this.reload();
		return item.id;
	}
	async editItem(id: string, patch: Partial<StockItemInput>): Promise<void> {
		await this.repo.updateItem(id, patch);
		await this.reload();
	}
	async removeItem(id: string): Promise<void> {
		await this.repo.deleteItem(id);
		await this.reload();
	}

	// --- 購入 ---
	async addPurchase(input: PurchaseInput): Promise<void> {
		await this.repo.createPurchase(input);
		await this.reload();
	}
	async removePurchase(id: string): Promise<void> {
		await this.repo.deletePurchase(id);
		await this.reload();
	}

	// --- 使い切り ---
	async markRanOut(itemId: string, at: number): Promise<void> {
		await this.repo.createRanOutEvent({ itemId, at });
		await this.reload();
	}
	async removeRanOut(id: string): Promise<void> {
		await this.repo.deleteRanOutEvent(id);
		await this.reload();
	}

	// --- 残量補正 ---
	async addAdjustment(input: AdjustmentInput): Promise<void> {
		await this.repo.createAdjustment(input);
		await this.reload();
	}
	async removeAdjustment(id: string): Promise<void> {
		await this.repo.deleteAdjustment(id);
		await this.reload();
	}

	// --- 定期便 ---
	async addSubscription(input: SubscriptionInput): Promise<void> {
		await this.repo.createSubscription(input);
		// 過去分の遅延生成を反映(ゲストはクライアント、会員はサーバー側で既に実施)。
		await this.repo.refresh();
		await this.reload();
	}
	async editSubscription(
		id: string,
		patch: Partial<Omit<SubscriptionInput, 'itemId'>>
	): Promise<void> {
		await this.repo.updateSubscription(id, patch);
		await this.reload();
	}
	async removeSubscription(id: string): Promise<void> {
		await this.repo.deleteSubscription(id);
		await this.reload();
	}

	// --- 設定 ---
	async setDefaultLeadTime(days: number): Promise<void> {
		await this.repo.updateSettings({ defaultLeadTimeDays: days });
		await this.reload();
	}
}

export const store = new Store();
