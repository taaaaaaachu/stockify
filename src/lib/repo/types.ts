import type {
	Purchase,
	ProductLink,
	RanOutEvent,
	RemainingAdjustment,
	StockItem,
	Subscription,
	UsageEvent
} from '#lib/types.js';

/**
 * 会員がサーバーへ未送信の操作(ADR 0009)。送信時は API へそのまま再現する。
 */
export interface OutboxOp {
	/** 送信順(IndexedDB の自動採番)。 */
	seq: number;
	method: 'POST' | 'PATCH' | 'DELETE';
	path: string;
	body?: unknown;
	/** 操作した日時。サーバーの日付検証の基準になる。 */
	at: number;
	/** 送信を拒否されたときにユーザーへ示す操作名。 */
	label: string;
}

/** アプリ全体の設定。ゲストは 1 レコードをローカル保持する。 */
export interface AppSettings {
	/** 全体既定のリードタイム(余裕日数)。品目個別値が無いとき使う。 */
	defaultLeadTimeDays: number;
}

/** 新規ストック品目の入力(id はリポジトリが採番)。 */
export interface StockItemInput {
	name: string;
	unit: string;
	category: string | null;
	leadTimeDays: number | null;
	provisionalDaysToDeplete: number | null;
	trackingMode: StockItem['trackingMode'];
	lowStockThreshold: number | null;
}

/**
 * 品目の変更。推定 → 手動へ切り替えるときは currentRemaining(実残量)が必須で、
 * 切替と同時に残量補正として記録する(ADR 0013)。adjustmentId はその補正の ID(省略時は採番)。
 */
export type StockItemPatch = Partial<StockItemInput> & { currentRemaining?: number; adjustmentId?: string };

/** 推定 → 手動の切替で currentRemaining が無いときのエラー文言。 */
export const CURRENT_REMAINING_REQUIRED = '手動モードへ切り替えるには、今の残量(currentRemaining)が必要です。';
/** 推定モードの品目へ使用を記録しようとしたときのエラー文言。 */
export const USAGE_NOT_MANUAL = '使用は手動モードの品目にだけ記録できます。';

export interface ProductLinkInput {
	itemId: string;
	label: string;
	url: string;
}

/** 新規購入の入力(id は通常リポジトリが採番。定期便の遅延生成は決定的 ID を渡す)。 */
export interface PurchaseInput {
	id?: string;
	itemId: string;
	volume: number;
	price: number | null;
	purchasedAt: number;
	source: Purchase['source'];
}

/** 新規使い切りイベントの入力。 */
export interface RanOutInput {
	itemId: string;
	at: number;
}

/** 新規残量補正の入力。 */
export interface AdjustmentInput {
	itemId: string;
	at: number;
	remaining: number;
}

/** 新規使用イベントの入力。 */
export interface UsageInput {
	itemId: string;
	at: number;
	volume: number;
}

/** 新規定期便の入力。 */
export interface SubscriptionInput {
	itemId: string;
	intervalDays: number;
	nextDeliveryAt: number;
	volumePerDelivery: number;
	quantityPerDelivery: number;
	paused: boolean;
}

/** 1 品目とその配下データをまとめたバンドル。ダッシュボード集計や取り込みで使う。 */
export interface ItemBundle {
	item: StockItem;
	productLinks?: ProductLink[];
	purchases: Purchase[];
	ranOutEvents: RanOutEvent[];
	adjustments: RemainingAdjustment[];
	/** 使用イベント(手動モードの品目のみ)。旧データには無い。 */
	usageEvents?: UsageEvent[];
	subscriptions: Subscription[];
}

/** 全データのスナップショット(取り込み元・エクスポートで使う)。 */
export interface Snapshot {
	settings: AppSettings;
	items: StockItem[];
	productLinks?: ProductLink[];
	purchases: Purchase[];
	ranOutEvents: RanOutEvent[];
	adjustments: RemainingAdjustment[];
	usageEvents?: UsageEvent[];
	subscriptions: Subscription[];
}

/**
 * 在庫データの永続化を担う抽象。
 * ゲストは IndexedDB 実装、会員はサーバー API 実装で同じ UI を動かす。
 */
export interface Repository {
	/**
	 * 定期便の遅延生成を適用する(ADR 0002)。起動時に一度呼ぶ想定。
	 * ゲストはクライアントで生成、会員はサーバーへ委譲する。
	 */
	refresh(): Promise<void>;

	getSettings(): Promise<AppSettings>;
	updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;

	listItems(): Promise<StockItem[]>;
	getItem(id: string): Promise<StockItem | null>;
	createItem(input: StockItemInput): Promise<StockItem>;
	/** 推定 → 手動の切替で currentRemaining が無ければ CURRENT_REMAINING_REQUIRED で例外。 */
	updateItem(id: string, patch: StockItemPatch): Promise<StockItem>;
	/** 品目を削除する。配下の購入・使い切り・補正・使用・定期便もカスケード削除する。 */
	deleteItem(id: string): Promise<void>;

	listProductLinks(itemId: string): Promise<ProductLink[]>;
	createProductLink(input: ProductLinkInput): Promise<ProductLink>;
	updateProductLink(id: string, patch: Partial<Pick<ProductLink, 'label' | 'url'>>): Promise<ProductLink>;
	deleteProductLink(id: string): Promise<void>;
	moveProductLink(id: string, direction: 'up' | 'down'): Promise<void>;

	listPurchases(itemId: string): Promise<Purchase[]>;
	createPurchase(input: PurchaseInput): Promise<Purchase>;
	updatePurchase(
		id: string,
		patch: Partial<Omit<Purchase, 'id' | 'itemId'>>
	): Promise<Purchase>;
	deletePurchase(id: string): Promise<void>;

	listRanOutEvents(itemId: string): Promise<RanOutEvent[]>;
	createRanOutEvent(input: RanOutInput): Promise<RanOutEvent>;
	deleteRanOutEvent(id: string): Promise<void>;

	listAdjustments(itemId: string): Promise<RemainingAdjustment[]>;
	createAdjustment(input: AdjustmentInput): Promise<RemainingAdjustment>;
	deleteAdjustment(id: string): Promise<void>;

	/** 推定モードの品目なら USAGE_NOT_MANUAL で例外。 */
	createUsageEvent(input: UsageInput): Promise<UsageEvent>;
	deleteUsageEvent(id: string): Promise<void>;

	listSubscriptions(itemId: string): Promise<Subscription[]>;
	createSubscription(input: SubscriptionInput): Promise<Subscription>;
	updateSubscription(
		id: string,
		patch: Partial<Omit<Subscription, 'id' | 'itemId'>>
	): Promise<Subscription>;
	deleteSubscription(id: string): Promise<void>;

	/** 全品目のバンドル一覧(ダッシュボード用)。 */
	listBundles(): Promise<ItemBundle[]>;
	/** 1 品目のバンドル(詳細画面用)。無ければ null。 */
	getBundle(itemId: string): Promise<ItemBundle | null>;

	/** 全データのスナップショットを取り出す(取り込み元として使う)。 */
	exportAll(): Promise<Snapshot>;
}
