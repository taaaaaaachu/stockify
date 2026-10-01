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
	PurchaseInput,
	ProductLinkInput,
	RanOutInput,
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

const send = <T>(method: string, url: string, body?: unknown) =>
	req<T>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });

/**
 * 会員の在庫 API クライアント。現在の世帯への書き込みと、同期用の全件取得を担う
 * (読み取りはローカル DB から行う。ADR 0009)。
 */
export class ApiRepository {
	/** 定期便の遅延生成(ADR 0002)をサーバーで行う。 */
	async refresh(): Promise<void> {
		await send('POST', '/api/refresh');
	}
	/** 現在の世帯の全データ(同期の取り込み元)。 */
	exportAll = () => req<Snapshot>('/api/state/export');

	updateSettings = (patch: Partial<AppSettings>) => send<AppSettings>('PATCH', '/api/settings', patch);

	createItem = (input: StockItemInput) => send<StockItem>('POST', '/api/items', input);
	updateItem = (id: string, patch: Partial<StockItemInput>) =>
		send<StockItem>('PATCH', `/api/items/${id}`, patch);
	deleteItem = (id: string) => send<void>('DELETE', `/api/items/${id}`);

	createProductLink = (input: ProductLinkInput) => send<ProductLink>('POST', '/api/product-links', input);
	updateProductLink = (id: string, patch: Partial<Pick<ProductLink, 'label' | 'url'>>) =>
		send<ProductLink>('PATCH', `/api/product-links/${id}`, patch);
	deleteProductLink = (id: string) => send<void>('DELETE', `/api/product-links/${id}`);
	moveProductLink = async (id: string, direction: 'up' | 'down') => {
		await send('POST', `/api/product-links/${id}/move`, { direction });
	};

	createPurchase = (input: PurchaseInput) => send<Purchase>('POST', '/api/purchases', input);
	updatePurchase = (id: string, patch: Partial<Omit<Purchase, 'id' | 'itemId'>>) =>
		send<Purchase>('PATCH', `/api/purchases/${id}`, patch);
	deletePurchase = (id: string) => send<void>('DELETE', `/api/purchases/${id}`);

	createRanOutEvent = (input: RanOutInput) => send<RanOutEvent>('POST', '/api/ranouts', input);
	deleteRanOutEvent = (id: string) => send<void>('DELETE', `/api/ranouts/${id}`);

	createAdjustment = (input: AdjustmentInput) =>
		send<RemainingAdjustment>('POST', '/api/adjustments', input);
	deleteAdjustment = (id: string) => send<void>('DELETE', `/api/adjustments/${id}`);

	createSubscription = (input: SubscriptionInput) =>
		send<Subscription>('POST', '/api/subscriptions', input);
	updateSubscription = (id: string, patch: Partial<Omit<Subscription, 'id' | 'itemId'>>) =>
		send<Subscription>('PATCH', `/api/subscriptions/${id}`, patch);
	deleteSubscription = (id: string) => send<void>('DELETE', `/api/subscriptions/${id}`);
}
