import { describe, it, expect, beforeEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createDb, type Db } from './db';
import { households, users, memberships } from './db/schema';
import * as stock from './stock';
import { createMcpServer, parseDate, toLocalIso } from './mcp';
import type { AgentContext } from './agentConnections';
import { MS_PER_DAY } from '#lib/domain/estimate.js';

let db: Db;
const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime();
const owner: AgentContext = { connectionId: 'c1', userId: 'u', householdId: 'h1', role: 'owner' };
const member: AgentContext = { ...owner, role: 'member' };

beforeEach(() => {
	db = createDb(':memory:');
	migrate(db, { migrationsFolder: './drizzle' });
	db.insert(users).values({ id: 'u', username: 'u', passwordHash: 'x', createdAt: 0 }).run();
	db.insert(households).values([
		{ id: 'h1', name: '自宅', createdAt: 0 },
		{ id: 'h2', name: '別の家', createdAt: 0 }
	]).run();
	db.insert(memberships).values({ id: 'm1', userId: 'u', householdId: 'h1', role: 'owner', createdAt: 0 }).run();
});

/** 本物のクライアントで、HTTP を通さずにハンドラーへ繋ぐ。 */
async function connect(ctx: AgentContext = owner, clock: () => number = () => NOW) {
	const handler = createMcpHandler(() => createMcpServer(db, ctx, clock));
	const client = new Client({ name: 'test', version: '1' });
	await client.connect(new StreamableHTTPClientTransport(new URL('http://test/mcp'), { fetch: (input, init) => handler.fetch(new Request(input, init)) }));
	return {
		tools: async () => (await client.listTools()).tools,
		call: async (name: string, args: Record<string, unknown> = {}) => {
			const r = await client.callTool({ name, arguments: args });
			const text = (r.content as { type: string; text: string }[])[0].text;
			return { isError: r.isError === true, text, data: r.isError ? null : JSON.parse(text) };
		}
	};
}

describe('toLocalIso / parseDate', () => {
	it('オフセット付きのローカル時刻にする', () => {
		expect(toLocalIso(NOW)).toMatch(/^2026-10-25T12:00:00[+-]\d{2}:\d{2}$/);
	});
	it('今日は今、過去の日はその日の 0:00、実在しない日は null', () => {
		expect(parseDate(undefined, NOW)).toBe(NOW);
		expect(parseDate('2026-10-25', NOW)).toBe(NOW);
		expect(parseDate('2026-10-01', NOW)).toBe(new Date(2026, 9, 1).getTime());
		expect(parseDate('2026-02-30', NOW)).toBeNull();
	});
});

describe('ツール一覧', () => {
	it('世帯設定の変更は owner の接続にだけ出る', async () => {
		const names = (await (await connect(owner)).tools()).map((t) => t.name);
		expect(names).toContain('update_settings');
		expect(names).toContain('record_purchase');
		expect((await (await connect(member)).tools()).map((t) => t.name)).not.toContain('update_settings');
	});

	it('読み取りと削除は注釈で分かる', async () => {
		const tools = await (await connect()).tools();
		const byName = (n: string) => tools.find((t) => t.name === n)?.annotations;
		expect(byName('list_items')?.readOnlyHint).toBe(true);
		expect(byName('delete_item')?.destructiveHint).toBe(true);
		expect(byName('record_purchase')?.readOnlyHint).toBe(false);
	});
});

describe('在庫の操作', () => {
	it('品目を作って購入・使い切りを記録すると、一覧に推定が出る', async () => {
		const mcp = await connect();
		const item = (await mcp.call('create_item', { name: '食器用洗剤', unit: 'ml' })).data;
		expect((await mcp.call('record_purchase', { itemId: item.id, volume: 500, date: '2026-09-25' })).isError).toBe(false);
		expect((await mcp.call('record_ranout', { itemId: item.id, date: '2026-10-15' })).isError).toBe(false);
		expect((await mcp.call('record_purchase', { itemId: item.id, volume: 500 })).data.purchasedAt).toBe(toLocalIso(NOW));

		const list = (await mcp.call('list_items')).data;
		expect(list.defaultLeadTimeDays).toBe(7);
		expect(list.items[0]).toMatchObject({ name: '食器用洗剤', status: 'ok' });
		expect(list.items[0].remaining).toBeGreaterThan(0);
		expect(list.items[0].ratePerDay).toBeGreaterThan(0);
		expect(list.items[0].depletion).toMatch(/^あと\d+日$/);

		const detail = (await mcp.call('get_item', { itemId: item.id })).data;
		expect(detail.purchases).toHaveLength(2);
		expect(detail.ranouts).toHaveLength(1);
	});

	it('未来の日付や不正な日付の記録は拒否する', async () => {
		const mcp = await connect();
		const item = (await mcp.call('create_item', { name: 'a', unit: '個' })).data;
		expect((await mcp.call('record_purchase', { itemId: item.id, volume: 1, date: '2026-10-26' })).isError).toBe(true);
		expect((await mcp.call('adjust_remaining', { itemId: item.id, remaining: 1, date: '2026-13-01' })).isError).toBe(true);
		expect((await mcp.call('record_purchase', { itemId: item.id, volume: 0 })).isError).toBe(true);
	});

	it('別の世帯の品目には触れない', async () => {
		const other = stock.createItem(db, 'h2', { name: 'x', unit: '個', category: null, leadTimeDays: null, provisionalDaysToDeplete: null, trackingMode: 'estimated', lowStockThreshold: null })!;
		const mcp = await connect();
		expect((await mcp.call('get_item', { itemId: other.id })).text).toBe('品目が見つかりません。');
		expect((await mcp.call('delete_item', { itemId: other.id })).isError).toBe(true);
		expect(stock.getItem(db, 'h2', other.id)).not.toBeNull();
	});

	it('定期便: 追加・スキップ・一時停止中のスキップ拒否・次回日変更', async () => {
		const mcp = await connect();
		const item = (await mcp.call('create_item', { name: 'a', unit: '個' })).data;
		expect((await mcp.call('create_subscription', { itemId: item.id, intervalDays: 30, nextDeliveryDate: '2026-10-24', volumePerDelivery: 1 })).isError).toBe(true);
		const sub = (await mcp.call('create_subscription', { itemId: item.id, intervalDays: 30, nextDeliveryDate: '2026-11-01', volumePerDelivery: 1 })).data;
		const skipped = (await mcp.call('skip_subscription', { subscriptionId: sub.id })).data;
		expect(skipped.nextDeliveryAt).toBe(toLocalIso(new Date(2026, 10, 1).getTime() + 30 * MS_PER_DAY));
		await mcp.call('pause_subscription', { subscriptionId: sub.id });
		expect((await mcp.call('skip_subscription', { subscriptionId: sub.id })).isError).toBe(true);
		expect((await mcp.call('reschedule_subscription', { subscriptionId: sub.id, nextDeliveryDate: '2026-12-01' })).data.nextDeliveryAt).toBe(
			toLocalIso(new Date(2026, 11, 1).getTime())
		);
	});

	it('商品リンク: 同じ URL は重複エラー、http/https 以外は拒否', async () => {
		const mcp = await connect();
		const item = (await mcp.call('create_item', { name: 'a', unit: '個' })).data;
		expect((await mcp.call('add_product_link', { itemId: item.id, url: 'https://shop.example/a' })).isError).toBe(false);
		expect((await mcp.call('add_product_link', { itemId: item.id, url: 'https://shop.example/a' })).text).toContain('同じURL');
		expect((await mcp.call('add_product_link', { itemId: item.id, url: 'javascript:alert(1)' })).isError).toBe(true);
	});

	it('世帯設定を変更できる', async () => {
		const mcp = await connect();
		expect((await mcp.call('update_settings', { defaultLeadTimeDays: 3 })).data).toEqual({ defaultLeadTimeDays: 3 });
	});
});

describe('手動モード(ADR 0013)', () => {
	it('手動品目は使用で減り、閾値以下で low、推定値は null', async () => {
		const mcp = await connect();
		const item = (await mcp.call('create_item', { name: '電池', unit: '本', trackingMode: 'manual', lowStockThreshold: 2 })).data;
		expect(item).toMatchObject({ trackingMode: 'manual', lowStockThreshold: 2 });
		await mcp.call('record_purchase', { itemId: item.id, volume: 4, date: '2026-01-01' });
		const usage = (await mcp.call('record_usage', { itemId: item.id, volume: 3, at: '2026-10-01' })).data;
		expect(usage.at).toBe(toLocalIso(new Date(2026, 9, 1).getTime()));

		const [row] = (await mcp.call('list_items')).data.items;
		expect(row).toMatchObject({ trackingMode: 'manual', status: 'low', remaining: 1, ratePerDay: null, depletionAt: null, recommendedPurchaseAt: null });
		expect(row.lastEventAt).toBe(usage.at);
		expect((await mcp.call('get_shopping_list')).data).toEqual([]);
		expect((await mcp.call('get_item', { itemId: item.id })).data.usages).toHaveLength(1);

		expect((await mcp.call('delete_usage', { usageId: usage.id })).isError).toBe(false);
		expect((await mcp.call('list_items')).data.items[0]).toMatchObject({ remaining: 4, status: 'ok' });
	});

	it('推定モードの品目への使用記録はエラー', async () => {
		const mcp = await connect();
		const item = (await mcp.call('create_item', { name: '洗剤', unit: 'ml' })).data;
		const r = await mcp.call('record_usage', { itemId: item.id, volume: 1 });
		expect(r.isError).toBe(true);
		expect(r.text).toContain('手動モード');
	});

	it('推定 → 手動は currentRemaining 必須、渡すとアンカーになり、その後の購入・使用で増減', async () => {
		const mcp = await connect();
		const item = (await mcp.call('create_item', { name: '洗剤', unit: 'ml', provisionalDaysToDeplete: 30 })).data;
		await mcp.call('record_purchase', { itemId: item.id, volume: 300, date: '2026-10-01' });
		const bad = await mcp.call('update_item', { itemId: item.id, trackingMode: 'manual' });
		expect(bad.isError).toBe(true);
		expect(bad.text).toContain('currentRemaining');
		expect((await mcp.call('get_item', { itemId: item.id })).data.trackingMode).toBe('estimated');

		// 切替は 1 時間前に行ったことにする(同時刻だと add → sub → set の順で補正が後勝ちになるため)。
		const earlier = NOW - 60 * 60 * 1000;
		const switcher = await connect(owner, () => earlier);
		expect((await switcher.call('update_item', { itemId: item.id, trackingMode: 'manual', currentRemaining: 120 })).isError).toBe(false);
		const detail = (await mcp.call('get_item', { itemId: item.id })).data;
		expect(detail.adjustments).toEqual([expect.objectContaining({ remaining: 120, at: toLocalIso(earlier) })]);
		expect(detail.remaining).toBe(120);

		await mcp.call('record_purchase', { itemId: item.id, volume: 300 });
		await mcp.call('record_usage', { itemId: item.id, volume: 20 });
		expect((await mcp.call('get_item', { itemId: item.id })).data.remaining).toBe(400);

		// 手動 → 推定は currentRemaining なしでよい。
		expect((await mcp.call('update_item', { itemId: item.id, trackingMode: 'estimated' })).isError).toBe(false);
	});
});
