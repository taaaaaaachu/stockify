import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Db } from './db';
import * as stock from './stock';
import type { AgentContext } from './agentConnections';
import { canManageMembers } from '#lib/rbac.js';
import { buildDashboard, buildRow, shoppingList, type DashboardRow } from '#lib/domain/dashboard.js';
import { isAcceptableNextDelivery, nextDeliveryAfterSkip } from '#lib/domain/subscription.js';
import { dateInputToTimestamp, formatDaysUntil } from '#lib/format.js';
import { normalizeProductLinkInput } from '#lib/productLinks.js';

/**
 * エージェント向けの MCP サーバー(ADR 0012)。1リクエストごとに、認証済みの接続の
 * 世帯とロールで作る。中身は stock.ts の在庫操作を呼ぶだけで、画面向け API と同じ規則に従う。
 */

const INSTRUCTIONS = `Stockify は洗剤やトイレットペーパーなど消耗品の残量を、購入履歴から推定する在庫管理アプリです。
この接続で操作できるのは1つの世帯の在庫だけです。
- 日々の使用量は記録しません。記録するのは「買った(record_purchase)」「空になった(record_ranout)」「今これくらい残っている(adjust_remaining)」です。
- 内容量は品目の単位(ml・g・個など)での数値です。単位の変換はしません。
- 日付は YYYY-MM-DD(Asia/Tokyo)で渡します。省略すると今です。未来の日付は、定期便の次回予定日にしか使えません。
- 残量・枯渇予想日・購入推奨日は推定値です。status が restock / depleted の品目が買い物リストです。`;

const id = z.string().min(1);
const date = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.describe('YYYY-MM-DD(Asia/Tokyo)');
const nonNegative = z.number().finite().nonnegative();
const positive = z.number().finite().positive();

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

function ok(data: unknown): CallToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}
function fail(message: string): CallToolResult {
	return { isError: true, content: [{ type: 'text', text: message }] };
}

/** サーバーのローカル時刻(Asia/Tokyo)のオフセット付き ISO 8601。 */
export function toLocalIso(ms: number): string {
	const d = new Date(ms);
	const offset = -d.getTimezoneOffset();
	const local = new Date(ms + offset * 60_000).toISOString().slice(0, 19);
	const sign = offset >= 0 ? '+' : '-';
	const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
	const mm = String(Math.abs(offset) % 60).padStart(2, '0');
	return `${local}${sign}${hh}:${mm}`;
}
const iso = (ms: number | null) => (ms === null ? null : toLocalIso(ms));

/**
 * YYYY-MM-DD を時刻にする。画面と同じく、今日なら今、過去の日ならその日の 0:00。
 * 実在しない日付は null。
 */
export function parseDate(value: string | undefined, now: number): number | null {
	if (value === undefined) return now;
	const at = dateInputToTimestamp(value, new Date(now));
	const d = new Date(at);
	const roundTrip = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	return roundTrip === value ? at : null;
}

function rowView(row: DashboardRow) {
	const e = row.estimate;
	return {
		id: row.item.id,
		name: row.item.name,
		unit: row.item.unit,
		category: row.item.category,
		status: row.status,
		remaining: e.remainingClamped,
		ratePerDay: e.ratePerDay,
		depletionAt: iso(e.depletionAt),
		depletion: formatDaysUntil(row.daysUntilDepletion),
		recommendedPurchaseAt: iso(e.recommendedPurchaseAt),
		hasActiveSubscription: row.hasActiveSubscription,
		productUrl: row.defaultProductLink?.url ?? null
	};
}

export function createMcpServer(db: Db, ctx: AgentContext, clock: () => number = Date.now): McpServer {
	const { householdId } = ctx;
	const server = new McpServer({ name: 'stockify', version: '1.0.0' }, { instructions: INSTRUCTIONS });

	/** 読み取りの前に定期便の遅延生成を済ませる(ADR 0002)。 */
	function dashboard(now: number) {
		stock.materializeDueSubscriptions(db, householdId, now);
		return buildDashboard(stock.listBundles(db, householdId), stock.getSettings(db, householdId), now);
	}
	/** 記録の日時。未来は受け付けない。 */
	function pastDate(value: string | undefined, now: number): number | null {
		const at = parseDate(value, now);
		return at !== null && at <= now ? at : null;
	}
	const BAD_DATE = '日付が不正です。YYYY-MM-DD で、今日以前の日付を指定してください。';
	const NO_ITEM = '品目が見つかりません。';

	// --- 読み取り ---

	server.registerTool(
		'list_items',
		{
			title: '在庫一覧',
			description: '全品目の推定残量・枯渇予想日・購入推奨日を、枯渇が近い順に返す。世帯のリードタイム既定値も返す。',
			annotations: READ
		},
		async () => {
			const now = clock();
			return ok({ defaultLeadTimeDays: stock.getSettings(db, householdId).defaultLeadTimeDays, items: dashboard(now).map(rowView) });
		}
	);

	server.registerTool(
		'get_shopping_list',
		{
			title: '買い物リスト',
			description: '購入推奨日に達した品目と、推定残量が尽きた品目を返す。',
			annotations: READ
		},
		async () => ok(shoppingList(dashboard(clock())).map(rowView))
	);

	server.registerTool(
		'get_item',
		{
			title: '品目の詳細',
			description: '品目の推定と、購入・使い切り・残量補正・定期便・商品リンクの履歴を返す。',
			inputSchema: z.object({ itemId: id }),
			annotations: READ
		},
		async ({ itemId }) => {
			const now = clock();
			stock.materializeDueSubscriptions(db, householdId, now);
			const bundle = stock.getBundle(db, householdId, itemId);
			if (!bundle) return fail(NO_ITEM);
			return ok({
				...rowView(buildRow(bundle, stock.getSettings(db, householdId), now)),
				leadTimeDays: bundle.item.leadTimeDays,
				provisionalDaysToDeplete: bundle.item.provisionalDaysToDeplete,
				purchases: bundle.purchases.map((p) => ({ id: p.id, volume: p.volume, price: p.price, purchasedAt: iso(p.purchasedAt), source: p.source })),
				ranouts: bundle.ranOutEvents.map((r) => ({ id: r.id, at: iso(r.at) })),
				adjustments: bundle.adjustments.map((a) => ({ id: a.id, remaining: a.remaining, at: iso(a.at) })),
				subscriptions: bundle.subscriptions.map((s) => ({ ...s, nextDeliveryAt: iso(s.nextDeliveryAt) })),
				productLinks: bundle.productLinks ?? []
			});
		}
	);

	// --- 品目 ---

	const itemFields = {
		category: z.string().nullable().optional().describe('カテゴリ・保管場所(例: キッチン)'),
		leadTimeDays: nonNegative.nullable().optional().describe('この品目のリードタイム(日)。null で世帯の既定値'),
		provisionalDaysToDeplete: positive.nullable().optional().describe('仮の値: 最初の購入分を約何日で使い切るか')
	};

	server.registerTool(
		'create_item',
		{
			title: '品目を追加',
			description: 'ストック品目を追加する。',
			inputSchema: z.object({ name: z.string().trim().min(1), unit: z.string().trim().min(1).describe('ml・g・個など'), ...itemFields }),
			annotations: WRITE
		},
		async (input) => {
			const item = stock.createItem(db, householdId, {
				name: input.name,
				unit: input.unit,
				category: input.category?.trim() || null,
				leadTimeDays: input.leadTimeDays ?? null,
				provisionalDaysToDeplete: input.provisionalDaysToDeplete ?? null
			});
			return item ? ok(item) : fail(NO_ITEM);
		}
	);

	server.registerTool(
		'update_item',
		{
			title: '品目を変更',
			description: '品目の名前・単位・カテゴリ・リードタイム・仮の値を変更する。渡した項目だけ変わる。',
			inputSchema: z.object({ itemId: id, name: z.string().trim().min(1).optional(), unit: z.string().trim().min(1).optional(), ...itemFields }),
			annotations: WRITE
		},
		async ({ itemId, category, ...rest }) => {
			const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
			if (category !== undefined) patch.category = category?.trim() || null;
			const item = stock.updateItem(db, householdId, itemId, patch);
			return item ? ok(item) : fail(NO_ITEM);
		}
	);

	server.registerTool(
		'delete_item',
		{
			title: '品目を削除',
			description: '品目と、その購入・使い切り・残量補正・定期便・商品リンクをすべて削除する。元に戻せない。',
			inputSchema: z.object({ itemId: id }),
			annotations: DESTRUCTIVE
		},
		async ({ itemId }) => (stock.deleteItem(db, householdId, itemId) ? ok({ deleted: itemId }) : fail(NO_ITEM))
	);

	// --- 購入・使い切り・残量補正 ---

	server.registerTool(
		'record_purchase',
		{
			title: '購入を記録',
			description: '品目を買ったことを記録する。',
			inputSchema: z.object({
				itemId: id,
				volume: positive.describe('買った内容量(品目の単位)。2本なら2本分の合計'),
				price: nonNegative.optional().describe('価格(円)'),
				date: date.optional()
			}),
			annotations: WRITE
		},
		async ({ itemId, volume, price, date }) => {
			const purchasedAt = pastDate(date, clock());
			if (purchasedAt === null) return fail(BAD_DATE);
			const p = stock.createPurchase(db, householdId, { itemId, volume, price: price ?? null, purchasedAt, source: 'manual' });
			return p ? ok({ ...p, purchasedAt: iso(p.purchasedAt) }) : fail(NO_ITEM);
		}
	);

	server.registerTool(
		'update_purchase',
		{
			title: '購入を変更',
			description: '記録済みの購入の内容量・価格・日付を変更する。',
			inputSchema: z.object({ purchaseId: id, volume: positive.optional(), price: nonNegative.nullable().optional(), date: date.optional() }),
			annotations: WRITE
		},
		async ({ purchaseId, volume, price, date }) => {
			const patch: { volume?: number; price?: number | null; purchasedAt?: number } = {};
			if (volume !== undefined) patch.volume = volume;
			if (price !== undefined) patch.price = price;
			if (date !== undefined) {
				const at = pastDate(date, clock());
				if (at === null) return fail(BAD_DATE);
				patch.purchasedAt = at;
			}
			const p = stock.updatePurchase(db, householdId, purchaseId, patch);
			return p ? ok({ ...p, purchasedAt: iso(p.purchasedAt) }) : fail('購入が見つかりません。');
		}
	);

	server.registerTool(
		'delete_purchase',
		{ title: '購入を削除', description: '記録済みの購入を削除する。', inputSchema: z.object({ purchaseId: id }), annotations: DESTRUCTIVE },
		async ({ purchaseId }) => (stock.deletePurchase(db, householdId, purchaseId) ? ok({ deleted: purchaseId }) : fail('購入が見つかりません。'))
	);

	server.registerTool(
		'record_ranout',
		{
			title: '空になったことを記録',
			description: '品目を使い切ったことを記録する。消費ペースの推定で最も確かな手がかりになる。',
			inputSchema: z.object({ itemId: id, date: date.optional() }),
			annotations: WRITE
		},
		async ({ itemId, date }) => {
			const at = pastDate(date, clock());
			if (at === null) return fail(BAD_DATE);
			const r = stock.createRanOutEvent(db, householdId, { itemId, at });
			return r ? ok({ ...r, at: iso(r.at) }) : fail(NO_ITEM);
		}
	);

	server.registerTool(
		'delete_ranout',
		{ title: '使い切りを削除', description: '記録済みの使い切りを削除する。', inputSchema: z.object({ ranoutId: id }), annotations: DESTRUCTIVE },
		async ({ ranoutId }) => (stock.deleteRanOutEvent(db, householdId, ranoutId) ? ok({ deleted: ranoutId }) : fail('使い切りが見つかりません。'))
	);

	server.registerTool(
		'adjust_remaining',
		{
			title: '残量を補正',
			description: '実際に残っている量を記録し、推定残量をその値に合わせる。',
			inputSchema: z.object({ itemId: id, remaining: nonNegative.describe('残っている量(品目の単位)'), date: date.optional() }),
			annotations: WRITE
		},
		async ({ itemId, remaining, date }) => {
			const at = pastDate(date, clock());
			if (at === null) return fail(BAD_DATE);
			const a = stock.createAdjustment(db, householdId, { itemId, at, remaining });
			return a ? ok({ ...a, at: iso(a.at) }) : fail(NO_ITEM);
		}
	);

	server.registerTool(
		'delete_adjustment',
		{ title: '残量補正を削除', description: '記録済みの残量補正を削除する。', inputSchema: z.object({ adjustmentId: id }), annotations: DESTRUCTIVE },
		async ({ adjustmentId }) =>
			stock.deleteAdjustment(db, householdId, adjustmentId) ? ok({ deleted: adjustmentId }) : fail('残量補正が見つかりません。')
	);

	// --- 定期便 ---

	const NO_SUB = '定期便が見つかりません。';
	const BAD_NEXT = '次回予定日は今日以降の YYYY-MM-DD で指定してください。';
	const subView = (s: { nextDeliveryAt: number }) => ({ ...s, nextDeliveryAt: iso(s.nextDeliveryAt) });
	function findSubscription(subscriptionId: string) {
		for (const b of stock.listBundles(db, householdId)) {
			const s = b.subscriptions.find((x) => x.id === subscriptionId);
			if (s) return s;
		}
		return null;
	}
	function nextDate(value: string, now: number): number | null {
		const at = parseDate(value, now);
		return at !== null && isAcceptableNextDelivery(at, now) ? at : null;
	}
	function updateSub(subscriptionId: string, patch: Parameters<typeof stock.updateSubscription>[3]) {
		const s = stock.updateSubscription(db, householdId, subscriptionId, patch);
		if (!s) return fail(NO_SUB);
		stock.materializeDueSubscriptions(db, householdId, clock());
		return ok(subView(s));
	}

	server.registerTool(
		'create_subscription',
		{
			title: '定期便を追加',
			description: '品目に繰り返し購入のスケジュールを追加する。予定日を過ぎた回は自動で購入として記録される。',
			inputSchema: z.object({
				itemId: id,
				intervalDays: positive.describe('配送間隔(日)'),
				nextDeliveryDate: date.describe('次回予定日 YYYY-MM-DD(今日以降)'),
				volumePerDelivery: positive.describe('1個あたりの内容量'),
				quantityPerDelivery: positive.optional().describe('1回あたりの個数(既定 1)')
			}),
			annotations: WRITE
		},
		async ({ itemId, intervalDays, nextDeliveryDate, volumePerDelivery, quantityPerDelivery }) => {
			const now = clock();
			const nextDeliveryAt = nextDate(nextDeliveryDate, now);
			if (nextDeliveryAt === null) return fail(BAD_NEXT);
			const s = stock.createSubscription(db, householdId, {
				itemId,
				intervalDays,
				nextDeliveryAt,
				volumePerDelivery,
				quantityPerDelivery: quantityPerDelivery ?? 1,
				paused: false
			});
			if (!s) return fail(NO_ITEM);
			stock.materializeDueSubscriptions(db, householdId, now);
			return ok(subView(s));
		}
	);

	server.registerTool(
		'update_subscription',
		{
			title: '定期便を変更',
			description: '定期便の間隔・内容量・個数を変更する。次回予定日は reschedule_subscription で変える。',
			inputSchema: z.object({ subscriptionId: id, intervalDays: positive.optional(), volumePerDelivery: positive.optional(), quantityPerDelivery: positive.optional() }),
			annotations: WRITE
		},
		async ({ subscriptionId, ...rest }) => updateSub(subscriptionId, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)))
	);

	server.registerTool(
		'skip_subscription',
		{
			title: '次回をスキップ',
			description: '定期便の次回配送を1回飛ばし、次回予定日を1間隔先へ送る。',
			inputSchema: z.object({ subscriptionId: id }),
			annotations: WRITE
		},
		async ({ subscriptionId }) => {
			const s = findSubscription(subscriptionId);
			if (!s) return fail(NO_SUB);
			if (s.paused) return fail('一時停止中の定期便はスキップできません。');
			return updateSub(subscriptionId, { nextDeliveryAt: nextDeliveryAfterSkip(s) });
		}
	);

	server.registerTool(
		'reschedule_subscription',
		{
			title: '次回日を変更',
			description: '定期便の次回予定日を変える。以降はその日から間隔どおりに刻む。',
			inputSchema: z.object({ subscriptionId: id, nextDeliveryDate: date.describe('今日以降') }),
			annotations: WRITE
		},
		async ({ subscriptionId, nextDeliveryDate }) => {
			const at = nextDate(nextDeliveryDate, clock());
			return at === null ? fail(BAD_NEXT) : updateSub(subscriptionId, { nextDeliveryAt: at });
		}
	);

	server.registerTool(
		'pause_subscription',
		{ title: '定期便を一時停止', description: '定期便を一時停止する。停止中は購入が記録されない。', inputSchema: z.object({ subscriptionId: id }), annotations: WRITE },
		async ({ subscriptionId }) => updateSub(subscriptionId, { paused: true })
	);

	server.registerTool(
		'resume_subscription',
		{
			title: '定期便を再開',
			description: '一時停止した定期便を再開する。次回予定日が過ぎていれば、その分の購入が記録される。',
			inputSchema: z.object({ subscriptionId: id }),
			annotations: WRITE
		},
		async ({ subscriptionId }) => updateSub(subscriptionId, { paused: false })
	);

	server.registerTool(
		'delete_subscription',
		{
			title: '定期便を解約',
			description: '定期便を削除する。これまでに記録された購入は残る。',
			inputSchema: z.object({ subscriptionId: id }),
			annotations: DESTRUCTIVE
		},
		async ({ subscriptionId }) => (stock.deleteSubscription(db, householdId, subscriptionId) ? ok({ deleted: subscriptionId }) : fail(NO_SUB))
	);

	// --- 商品リンク ---

	const NO_LINK = '商品リンクが見つかりません。';
	const BAD_LINK = '商品リンクの表示名またはURLが不正です(http/https)。';
	/** 同じ品目に同じ URL を登録すると stock.ts が例外を投げる。 */
	function duplicateSafe(run: () => CallToolResult): CallToolResult {
		try {
			return run();
		} catch (e) {
			if (e instanceof Error && e.message.includes('同じURL')) return fail(e.message);
			throw e;
		}
	}

	server.registerTool(
		'add_product_link',
		{
			title: '商品リンクを追加',
			description: '品目に購入先の商品ページの URL を追加する。最初のリンクが既定になる。',
			inputSchema: z.object({ itemId: id, url: z.string(), label: z.string().optional().describe('表示名。省略するとホスト名') }),
			annotations: WRITE
		},
		async ({ itemId, url, label }) => {
			const input = normalizeProductLinkInput({ url, label: label ?? '' });
			if (!input) return fail(BAD_LINK);
			return duplicateSafe(() => {
				const link = stock.createProductLink(db, householdId, { itemId, ...input });
				return link ? ok(link) : fail(NO_ITEM);
			});
		}
	);

	server.registerTool(
		'update_product_link',
		{
			title: '商品リンクを変更',
			description: '商品リンクの URL・表示名を変更する。',
			inputSchema: z.object({ linkId: id, url: z.string().optional(), label: z.string().optional() }),
			annotations: WRITE
		},
		async ({ linkId, url, label }) => {
			const current = stock.getProductLink(db, householdId, linkId);
			if (!current) return fail(NO_LINK);
			const input = normalizeProductLinkInput({ url: url ?? current.url, label: label ?? current.label });
			if (!input) return fail(BAD_LINK);
			return duplicateSafe(() => ok(stock.updateProductLink(db, householdId, linkId, input)));
		}
	);

	server.registerTool(
		'move_product_link',
		{
			title: '商品リンクを並べ替え',
			description: '商品リンクを1つ上(up)か下(down)へ動かす。一番上が既定のリンク。',
			inputSchema: z.object({ linkId: id, direction: z.enum(['up', 'down']) }),
			annotations: WRITE
		},
		async ({ linkId, direction }) => (stock.moveProductLink(db, householdId, linkId, direction) ? ok({ moved: linkId }) : fail(NO_LINK))
	);

	server.registerTool(
		'delete_product_link',
		{ title: '商品リンクを削除', description: '商品リンクを削除する。', inputSchema: z.object({ linkId: id }), annotations: DESTRUCTIVE },
		async ({ linkId }) => (stock.deleteProductLink(db, householdId, linkId) ? ok({ deleted: linkId }) : fail(NO_LINK))
	);

	// --- 世帯設定(owner が発行した接続だけ) ---

	if (canManageMembers(ctx.role)) {
		server.registerTool(
			'update_settings',
			{
				title: '世帯設定を変更',
				description: '世帯のリードタイム既定値(日)を変える。購入推奨日 = 枯渇予想日 − リードタイム。',
				inputSchema: z.object({ defaultLeadTimeDays: nonNegative }),
				annotations: WRITE
			},
			async ({ defaultLeadTimeDays }) => ok(stock.updateSettings(db, householdId, { defaultLeadTimeDays }))
		);
	}

	return server;
}
