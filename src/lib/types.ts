/** エンティティ ID(UUID 文字列)。 */
export type ID = string;

/** ストック品目から購入先へ移動する商品リンク。 */
export interface ProductLink {
	id: ID;
	itemId: ID;
	/** 任意の表示名。空欄ならURLのホスト名を表示する。 */
	label: string;
	/** http/https の商品ページURL。 */
	url: string;
	/** 品目内の表示順。0 が既定リンク。 */
	position: number;
}

/**
 * ストック品目。在庫を管理したい対象そのもの(例: 食器用洗剤)。
 * 配下に購入・使い切り・残量補正がぶら下がり、そこから残量を推定する。
 */
export interface StockItem {
	id: ID;
	/** ユーザーが決めた名前(例: 食器用洗剤)。 */
	name: string;
	/** 表示専用の単位ラベル(ml/g/m/個 など)。計算では解釈しない。 */
	unit: string;
	/** カテゴリ/保管場所タグ(例: キッチン)。未設定は null。 */
	category: string | null;
	/**
	 * この品目固有のリードタイム(余裕日数)。null なら全体既定値を使う。
	 * 購入推奨日 = 枯渇予想日 − リードタイム。
	 */
	leadTimeDays: number | null;
	/**
	 * 仮の値: 初回購入の内容量を「約 N 日で使い切る」想定。
	 * 履歴が貯まる前のブートストラップ用。null なら未設定。
	 */
	provisionalDaysToDeplete: number | null;
}

/** 購入イベントの発生源。 */
export type PurchaseSource = 'manual' | 'subscription';

/**
 * 購入イベント。ストック品目に 1 回分の購入としてぶら下がる。
 * 残量・消費レート推定の元データはこの購入履歴のみ(日々の使用は記録しない)。
 */
export interface Purchase {
	id: ID;
	itemId: ID;
	/** その購入で手に入れた量(品目の単位での生の数値)。毎回異なってよい。 */
	volume: number;
	/** 価格(円)。任意。単価表示・支出把握に使い、残量計算には影響しない。 */
	price: number | null;
	/** 購入日時(epoch ミリ秒)。 */
	purchasedAt: number;
	/** 手動登録か、定期便からの自動生成か。 */
	source: PurchaseSource;
}

/**
 * 使い切りイベント(「空になった」)。任意。
 * その時点で残量が 0 になったことを表し、消費レート推定の最優先シグナルになる。
 */
export interface RanOutEvent {
	id: ID;
	itemId: ID;
	/** 空になった日時(epoch ミリ秒)。 */
	at: number;
}

/**
 * 残量補正(「今これくらい残っている」)。任意。
 * その時点の実測残量で推定の原点をリセットする。
 */
export interface RemainingAdjustment {
	id: ID;
	itemId: ID;
	/** 補正した日時(epoch ミリ秒)。 */
	at: number;
	/** その時点の実測残量(品目の単位)。 */
	remaining: number;
}

/**
 * 定期便(Amazon 非連携・アプリ内定義の繰り返し購入スケジュール)。
 */
export interface Subscription {
	id: ID;
	itemId: ID;
	/** 配送間隔(日数)。例: 60(2ヶ月ごと)。 */
	intervalDays: number;
	/** 次回予定日(epoch ミリ秒)。遅延生成の起点。 */
	nextDeliveryAt: number;
	/** 1 回あたりの内容量。 */
	volumePerDelivery: number;
	/** 1 回あたりの個数(内容量 × 個数 がその回の総量)。 */
	quantityPerDelivery: number;
	/** 一時停止中か。true の間は遅延生成しない。 */
	paused: boolean;
}
