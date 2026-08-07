import type {
	Purchase,
	ProductLink,
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
	ProductLinkInput,
	RanOutInput,
	Repository,
	Snapshot,
	StockItemInput,
	SubscriptionInput
} from './types';

async function req<T>(input: string, init?: RequestInit): Promise<T> {
	const res = await fetch(input, {
		...init,
		headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }
	});
	if (!res.ok) {
		let message = `リクエストに失敗しました (${res.status})`;
		try {
			const body = await res.json();
			if (body?.message) message = body.message;
		} catch {
			/* JSON でないレスポンスは既定メッセージ */
		}
		throw new Error(message);
	}
	if (res.status === 204) return undefined as T;
	return res.json() as Promise<T>;
}

interface State {
	settings: AppSettings;
	bundles: ItemBundle[];
}

/**
 * 会員モード用リポジトリ。サーバーの /api エンドポイント経由で、現在の世帯の
 * データを読み書きする。読み取りは GET /api/state を一度だけ取得してメモ化し、
 * 変更操作のたびに破棄する。
 */
export class ApiRepository implements Repository {
	#state: Promise<State> | null = null;

	#fetchState(): Promise<State> {
		if (!this.#state) this.#state = req<State>('/api/state');
		return this.#state;
	}
	#invalidate(): void {
		this.#state = null;
	}

	async refresh(): Promise<void> {
		await req('/api/refresh', { method: 'POST' });
		this.#invalidate();
	}

	async getSettings(): Promise<AppSettings> {
		return (await this.#fetchState()).settings;
	}
	async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
		const r = await req<AppSettings>('/api/settings', {
			method: 'PATCH',
			body: JSON.stringify(patch)
		});
		this.#invalidate();
		return r;
	}

	async listBundles(): Promise<ItemBundle[]> {
		return (await this.#fetchState()).bundles;
	}
	async getBundle(itemId: string): Promise<ItemBundle | null> {
		const { bundles } = await this.#fetchState();
		return bundles.find((b) => b.item.id === itemId) ?? null;
	}

	async listItems(): Promise<StockItem[]> {
		return (await this.#fetchState()).bundles.map((b) => b.item);
	}
	async getItem(id: string): Promise<StockItem | null> {
		return (await this.getBundle(id))?.item ?? null;
	}
	async createItem(input: StockItemInput): Promise<StockItem> {
		const r = await req<StockItem>('/api/items', { method: 'POST', body: JSON.stringify(input) });
		this.#invalidate();
		return r;
	}
	async updateItem(id: string, patch: Partial<StockItemInput>): Promise<StockItem> {
		const r = await req<StockItem>(`/api/items/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(patch)
		});
		this.#invalidate();
		return r;
	}
	async deleteItem(id: string): Promise<void> {
		await req<void>(`/api/items/${id}`, { method: 'DELETE' });
		this.#invalidate();
	}

	async listProductLinks(itemId: string): Promise<ProductLink[]> {
		return (await this.getBundle(itemId))?.productLinks ?? [];
	}
	async createProductLink(input: ProductLinkInput): Promise<ProductLink> {
		const r = await req<ProductLink>('/api/product-links', { method: 'POST', body: JSON.stringify(input) });
		this.#invalidate();
		return r;
	}
	async updateProductLink(id: string, patch: Partial<Pick<ProductLink, 'label' | 'url'>>): Promise<ProductLink> {
		const r = await req<ProductLink>(`/api/product-links/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
		this.#invalidate();
		return r;
	}
	async deleteProductLink(id: string): Promise<void> {
		await req<void>(`/api/product-links/${id}`, { method: 'DELETE' });
		this.#invalidate();
	}
	async moveProductLink(id: string, direction: 'up' | 'down'): Promise<void> {
		await req(`/api/product-links/${id}/move`, { method: 'POST', body: JSON.stringify({ direction }) });
		this.#invalidate();
	}

	async listPurchases(itemId: string): Promise<Purchase[]> {
		return (await this.getBundle(itemId))?.purchases ?? [];
	}
	async createPurchase(input: PurchaseInput): Promise<Purchase> {
		const r = await req<Purchase>('/api/purchases', { method: 'POST', body: JSON.stringify(input) });
		this.#invalidate();
		return r;
	}
	async updatePurchase(
		id: string,
		patch: Partial<Omit<Purchase, 'id' | 'itemId'>>
	): Promise<Purchase> {
		const r = await req<Purchase>(`/api/purchases/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(patch)
		});
		this.#invalidate();
		return r;
	}
	async deletePurchase(id: string): Promise<void> {
		await req<void>(`/api/purchases/${id}`, { method: 'DELETE' });
		this.#invalidate();
	}

	async listRanOutEvents(itemId: string): Promise<RanOutEvent[]> {
		return (await this.getBundle(itemId))?.ranOutEvents ?? [];
	}
	async createRanOutEvent(input: RanOutInput): Promise<RanOutEvent> {
		const r = await req<RanOutEvent>('/api/ranouts', { method: 'POST', body: JSON.stringify(input) });
		this.#invalidate();
		return r;
	}
	async deleteRanOutEvent(id: string): Promise<void> {
		await req<void>(`/api/ranouts/${id}`, { method: 'DELETE' });
		this.#invalidate();
	}

	async listAdjustments(itemId: string): Promise<RemainingAdjustment[]> {
		return (await this.getBundle(itemId))?.adjustments ?? [];
	}
	async createAdjustment(input: AdjustmentInput): Promise<RemainingAdjustment> {
		const r = await req<RemainingAdjustment>('/api/adjustments', {
			method: 'POST',
			body: JSON.stringify(input)
		});
		this.#invalidate();
		return r;
	}
	async deleteAdjustment(id: string): Promise<void> {
		await req<void>(`/api/adjustments/${id}`, { method: 'DELETE' });
		this.#invalidate();
	}

	async listSubscriptions(itemId: string): Promise<Subscription[]> {
		return (await this.getBundle(itemId))?.subscriptions ?? [];
	}
	async createSubscription(input: SubscriptionInput): Promise<Subscription> {
		const r = await req<Subscription>('/api/subscriptions', {
			method: 'POST',
			body: JSON.stringify(input)
		});
		this.#invalidate();
		return r;
	}
	async updateSubscription(
		id: string,
		patch: Partial<Omit<Subscription, 'id' | 'itemId'>>
	): Promise<Subscription> {
		const r = await req<Subscription>(`/api/subscriptions/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(patch)
		});
		this.#invalidate();
		return r;
	}
	async deleteSubscription(id: string): Promise<void> {
		await req<void>(`/api/subscriptions/${id}`, { method: 'DELETE' });
		this.#invalidate();
	}

	async exportAll(): Promise<Snapshot> {
		return req<Snapshot>('/api/state/export');
	}

	/** ゲストのスナップショットを現在の世帯へ取り込む。 */
	async importSnapshot(snapshot: Snapshot): Promise<{ items: number }> {
		const r = await req<{ items: number }>('/api/import', {
			method: 'POST',
			body: JSON.stringify(snapshot)
		});
		this.#invalidate();
		return r;
	}
}
