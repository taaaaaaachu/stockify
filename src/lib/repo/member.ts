import type { ProductLink, Purchase, Subscription } from '#lib/types.js';
import { fetchSnapshot, sendOp, serverRefresh, SyncError } from './api';
import { IndexedDbRepository } from './indexeddb';
import type {
	AdjustmentInput,
	AppSettings,
	OutboxOp,
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

/** 同期の状態。offline=サーバーに届かない、auth=ログインし直しが必要。 */
export type SyncState = 'synced' | 'offline' | 'auth';

/**
 * 会員モード用リポジトリ(ADR 0009)。
 * 読み書きは世帯ごとのローカル IndexedDB に対して行い、書き込みは同時に outbox へ積む。
 * 同期は「サーバーで定期便を遅延生成 → outbox を順に送信 → 全件 pull で置き換え」。
 * outbox が残っている間はローカルを置き換えない。
 */
export class MemberRepository implements Repository {
	readonly #local: IndexedDbRepository;
	readonly #householdId: string;
	#syncing: Promise<void> | null = null;

	syncState: SyncState = 'synced';
	/** 未送信の操作数。 */
	pending = 0;
	/** サーバーに拒否されて破棄した操作の説明。 */
	rejected: string[] = [];
	/** 同期が終わるたびに呼ぶ(画面の再読み込み用)。 */
	onSynced?: () => void;

	constructor(userId: string, householdId: string) {
		this.#local = new IndexedDbRepository(memberDbName(userId, householdId));
		this.#householdId = householdId;
	}

	/**
	 * 起動時: 端末側で定期便を遅延生成してから同期する。端末で作る購入は決定的 ID なので、
	 * サーバーが同じ回を生成しても重複しない(オフラインでも配送分が反映される)。
	 * ローカルにデータがあればすぐ表示できるよう同期は待たない(終われば onSynced)。
	 */
	async refresh(): Promise<void> {
		await this.#local.refresh();
		const sync = this.sync();
		if ((await this.#local.listItems()).length === 0) await sync;
	}

	/** 同期する。実行中なら同じ処理を待つ。 */
	sync(): Promise<void> {
		this.#syncing ??= this.#runSync().finally(() => {
			this.#syncing = null;
		});
		return this.#syncing;
	}

	async #runSync(): Promise<void> {
		try {
			await serverRefresh(this.#householdId);
			// 送信中に積まれた操作も続けて送る。
			for (let ops = await this.#local.listOutbox(); ops.length > 0; ops = await this.#local.listOutbox()) {
				for (const op of ops) {
					const outcome = await sendOp(this.#householdId, op);
					if (outcome.kind === 'retry' || outcome.kind === 'auth') throw new SyncError(outcome.kind, 0);
					if (outcome.kind === 'rejected') this.rejected.push(`${op.label}: ${outcome.message}`);
					await this.#local.removeOutbox(op.seq);
				}
			}
			await this.#local.replaceAll(await fetchSnapshot(this.#householdId));
			this.syncState = 'synced';
		} catch (e) {
			this.syncState = e instanceof SyncError && e.kind === 'auth' ? 'auth' : 'offline';
			if (!(e instanceof SyncError) && !(e instanceof TypeError)) console.error('同期に失敗しました', e);
		}
		this.pending = await this.#local.countOutbox();
		this.onSynced?.();
	}

	/** ローカルへ反映済みの操作を outbox に積み、裏で同期を始める。 */
	async #enqueue(label: string, method: OutboxOp['method'], path: string, body?: unknown): Promise<void> {
		await this.#local.enqueue({ method, path, body, at: Date.now(), label });
		this.pending++;
		void this.sync();
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

	// --- 書き込み(ローカル + outbox) ---
	async updateSettings(patch: Partial<AppSettings>) {
		const settings = await this.#local.updateSettings(patch);
		await this.#enqueue('設定の変更', 'PATCH', '/api/settings', patch);
		return settings;
	}

	async createItem(input: StockItemInput) {
		const item = await this.#local.createItem(input);
		await this.#enqueue(`品目「${input.name}」の追加`, 'POST', '/api/items', { ...input, id: item.id });
		return item;
	}
	async updateItem(id: string, patch: Partial<StockItemInput>) {
		const item = await this.#local.updateItem(id, patch);
		await this.#enqueue(`品目「${item.name}」の変更`, 'PATCH', `/api/items/${id}`, patch);
		return item;
	}
	async deleteItem(id: string) {
		await this.#local.deleteItem(id);
		await this.#enqueue('品目の削除', 'DELETE', `/api/items/${id}`);
	}

	async createProductLink(input: ProductLinkInput) {
		const link = await this.#local.createProductLink(input);
		await this.#enqueue('商品リンクの追加', 'POST', '/api/product-links', { ...input, id: link.id });
		return link;
	}
	async updateProductLink(id: string, patch: Partial<Pick<ProductLink, 'label' | 'url'>>) {
		const link = await this.#local.updateProductLink(id, patch);
		await this.#enqueue('商品リンクの変更', 'PATCH', `/api/product-links/${id}`, patch);
		return link;
	}
	async deleteProductLink(id: string) {
		await this.#local.deleteProductLink(id);
		await this.#enqueue('商品リンクの削除', 'DELETE', `/api/product-links/${id}`);
	}
	async moveProductLink(id: string, direction: 'up' | 'down') {
		const link = await this.#local.getProductLink(id);
		if (!link) return;
		await this.#local.moveProductLink(id, direction);
		await this.#enqueue('商品リンクの並べ替え', 'POST', `/api/product-links/${id}/move`, {
			direction,
			fromPosition: link.position
		});
	}

	async createPurchase(input: PurchaseInput) {
		const purchase = await this.#local.createPurchase(input);
		await this.#enqueue('購入の追加', 'POST', '/api/purchases', { ...input, id: purchase.id });
		return purchase;
	}
	async updatePurchase(id: string, patch: Partial<Omit<Purchase, 'id' | 'itemId'>>) {
		const purchase = await this.#local.updatePurchase(id, patch);
		await this.#enqueue('購入の変更', 'PATCH', `/api/purchases/${id}`, patch);
		return purchase;
	}
	async deletePurchase(id: string) {
		await this.#local.deletePurchase(id);
		await this.#enqueue('購入の削除', 'DELETE', `/api/purchases/${id}`);
	}

	async createRanOutEvent(input: RanOutInput) {
		const event = await this.#local.createRanOutEvent(input);
		await this.#enqueue('使い切りの記録', 'POST', '/api/ranouts', { ...input, id: event.id });
		return event;
	}
	async deleteRanOutEvent(id: string) {
		await this.#local.deleteRanOutEvent(id);
		await this.#enqueue('使い切りの削除', 'DELETE', `/api/ranouts/${id}`);
	}

	async createAdjustment(input: AdjustmentInput) {
		const adjustment = await this.#local.createAdjustment(input);
		await this.#enqueue('残量補正の記録', 'POST', '/api/adjustments', { ...input, id: adjustment.id });
		return adjustment;
	}
	async deleteAdjustment(id: string) {
		await this.#local.deleteAdjustment(id);
		await this.#enqueue('残量補正の削除', 'DELETE', `/api/adjustments/${id}`);
	}

	async createSubscription(input: SubscriptionInput) {
		const subscription = await this.#local.createSubscription(input);
		await this.#enqueue('定期便の追加', 'POST', '/api/subscriptions', { ...input, id: subscription.id });
		return subscription;
	}
	async updateSubscription(id: string, patch: Partial<Omit<Subscription, 'id' | 'itemId'>>) {
		const subscription = await this.#local.updateSubscription(id, patch);
		await this.#enqueue('定期便の変更', 'PATCH', `/api/subscriptions/${id}`, patch);
		return subscription;
	}
	async deleteSubscription(id: string) {
		await this.#local.deleteSubscription(id);
		await this.#enqueue('定期便の削除', 'DELETE', `/api/subscriptions/${id}`);
	}
}
