import type { ProductLink, Purchase, Subscription } from '$lib/types';
import { ApiRepository } from './api';
import { IndexedDbRepository } from './indexeddb';
import type {
	AdjustmentInput,
	AppSettings,
	ProductLinkInput,
	PurchaseInput,
	RanOutInput,
	Repository,
	StockItemInput,
	SubscriptionInput
} from './types';

/** 会員のローカル DB 名。ユーザー × 世帯ごとに分ける。 */
export const MEMBER_DB_PREFIX = 'stockify-m-';
export const memberDbName = (userId: string, householdId: string) =>
	`${MEMBER_DB_PREFIX}${userId}-${householdId}`;

/**
 * 会員モード用リポジトリ(ADR 0009 Phase 2)。
 * 読み取りは世帯ごとのローカル IndexedDB から行い、サーバーの全件スナップショットで置き換えて同期する。
 * 書き込みはサーバー API に送り、成功後に同期する(オフライン書き込みは Phase 3)。
 * サーバーに届かないときはローカルの最終同期データで動き、offline を立てる。
 */
export class MemberRepository implements Repository {
	readonly #api = new ApiRepository();
	readonly #local: IndexedDbRepository;
	/** 直近の同期に失敗し、ローカルの最終同期データを表示している。 */
	offline = false;

	constructor(userId: string, householdId: string) {
		this.#local = new IndexedDbRepository(memberDbName(userId, householdId));
	}

	/** サーバーで定期便を遅延生成し、全件を取り込む。届かなければローカルで続行する。 */
	async refresh(): Promise<void> {
		try {
			await this.#api.refresh();
			await this.#pull();
		} catch (e) {
			this.offline = true;
			console.warn('サーバーと同期できないため、ローカルのデータを表示します', e);
		}
	}

	async #pull(): Promise<void> {
		await this.#local.replaceAll(await this.#api.exportAll());
		this.offline = false;
	}

	/** サーバーへ書き込み、成功したら同期する。 */
	async #write<T>(send: () => Promise<T>): Promise<T> {
		let result: T;
		try {
			result = await send();
		} catch (e) {
			// fetch 自体の失敗(TypeError)は通信不可。サーバーのエラーはそのまま伝える。
			if (e instanceof TypeError)
				throw new Error('オフラインのため保存できません。通信できる状態で再度お試しください。', {
					cause: e
				});
			throw e;
		}
		try {
			await this.#pull();
		} catch {
			this.offline = true;
		}
		return result;
	}

	// --- 読み取り(ローカル) ---
	getSettings = () => this.#local.getSettings();
	listItems = () => this.#local.listItems();
	getItem = (id: string) => this.#local.getItem(id);
	listProductLinks = (itemId: string) => this.#local.listProductLinks(itemId);
	listPurchases = (itemId: string) => this.#local.listPurchases(itemId);
	listRanOutEvents = (itemId: string) => this.#local.listRanOutEvents(itemId);
	listAdjustments = (itemId: string) => this.#local.listAdjustments(itemId);
	listSubscriptions = (itemId: string) => this.#local.listSubscriptions(itemId);
	listBundles = () => this.#local.listBundles();
	getBundle = (itemId: string) => this.#local.getBundle(itemId);
	exportAll = () => this.#local.exportAll();

	// --- 書き込み(サーバー) ---
	updateSettings = (patch: Partial<AppSettings>) => this.#write(() => this.#api.updateSettings(patch));
	createItem = (input: StockItemInput) => this.#write(() => this.#api.createItem(input));
	updateItem = (id: string, patch: Partial<StockItemInput>) =>
		this.#write(() => this.#api.updateItem(id, patch));
	deleteItem = (id: string) => this.#write(() => this.#api.deleteItem(id));
	createProductLink = (input: ProductLinkInput) => this.#write(() => this.#api.createProductLink(input));
	updateProductLink = (id: string, patch: Partial<Pick<ProductLink, 'label' | 'url'>>) =>
		this.#write(() => this.#api.updateProductLink(id, patch));
	deleteProductLink = (id: string) => this.#write(() => this.#api.deleteProductLink(id));
	moveProductLink = (id: string, direction: 'up' | 'down') =>
		this.#write(() => this.#api.moveProductLink(id, direction));
	createPurchase = (input: PurchaseInput) => this.#write(() => this.#api.createPurchase(input));
	updatePurchase = (id: string, patch: Partial<Omit<Purchase, 'id' | 'itemId'>>) =>
		this.#write(() => this.#api.updatePurchase(id, patch));
	deletePurchase = (id: string) => this.#write(() => this.#api.deletePurchase(id));
	createRanOutEvent = (input: RanOutInput) => this.#write(() => this.#api.createRanOutEvent(input));
	deleteRanOutEvent = (id: string) => this.#write(() => this.#api.deleteRanOutEvent(id));
	createAdjustment = (input: AdjustmentInput) => this.#write(() => this.#api.createAdjustment(input));
	deleteAdjustment = (id: string) => this.#write(() => this.#api.deleteAdjustment(id));
	createSubscription = (input: SubscriptionInput) => this.#write(() => this.#api.createSubscription(input));
	updateSubscription = (id: string, patch: Partial<Omit<Subscription, 'id' | 'itemId'>>) =>
		this.#write(() => this.#api.updateSubscription(id, patch));
	deleteSubscription = (id: string) => this.#write(() => this.#api.deleteSubscription(id));
}
