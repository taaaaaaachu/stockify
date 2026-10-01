import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { MemberRepository } from './member';
import { IndexedDbRepository } from './indexeddb';
import type { Snapshot } from './types';

const snapshot = (name: string): Snapshot => ({
	settings: { defaultLeadTimeDays: 5 },
	items: [
		{ id: 'i1', name, unit: 'ml', category: null, leadTimeDays: null, provisionalDaysToDeplete: 30 }
	],
	productLinks: [{ id: 'l1', itemId: 'i1', label: '', url: 'https://example.com/', position: 0 }],
	purchases: [{ id: 'p1', itemId: 'i1', volume: 500, price: null, purchasedAt: 1, source: 'manual' }],
	ranOutEvents: [],
	adjustments: [],
	subscriptions: []
});

/** サーバーの状態を持つ fetch モック。online=false で通信不可(TypeError)。 */
function fakeServer() {
	const server = { online: true, state: snapshot('サーバー洗剤'), calls: [] as string[] };
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		if (!server.online) throw new TypeError('Failed to fetch');
		const method = init?.method ?? 'GET';
		server.calls.push(`${method} ${url}`);
		if (url === '/api/state/export') return Response.json(server.state);
		if (url === '/api/refresh') return Response.json({ generatedPurchases: 0 });
		if (url === '/api/items' && method === 'POST') {
			const item = { id: 'i2', ...JSON.parse(String(init!.body)) };
			server.state = { ...server.state, items: [...server.state.items, item] };
			return Response.json(item, { status: 201 });
		}
		return Response.json({ message: '見つかりません' }, { status: 404 });
	});
	return server;
}

const itemInput = { name: '新品目', unit: '個', category: null, leadTimeDays: null, provisionalDaysToDeplete: null };

describe('MemberRepository', () => {
	beforeEach(() => {
		indexedDB = new IDBFactory();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('refresh でサーバーの全件をローカルへ取り込む', async () => {
		fakeServer();
		const repo = new MemberRepository('u1', 'h1');
		await repo.refresh();
		expect(repo.offline).toBe(false);
		const [bundle] = await repo.listBundles();
		expect(bundle.item.name).toBe('サーバー洗剤');
		expect(bundle.productLinks).toHaveLength(1);
		expect(bundle.purchases).toHaveLength(1);
		expect((await repo.getSettings()).defaultLeadTimeDays).toBe(5);
	});

	it('オフラインでは最後に同期したデータを読み、offline を立てる', async () => {
		const server = fakeServer();
		await new MemberRepository('u1', 'h1').refresh();

		server.online = false;
		const repo = new MemberRepository('u1', 'h1');
		await repo.refresh();
		expect(repo.offline).toBe(true);
		expect((await repo.listItems()).map((i) => i.name)).toEqual(['サーバー洗剤']);
	});

	it('オンラインに戻れば offline が解除される', async () => {
		const server = fakeServer();
		server.online = false;
		const repo = new MemberRepository('u1', 'h1');
		await repo.refresh();
		expect(repo.offline).toBe(true);
		server.online = true;
		await repo.refresh();
		expect(repo.offline).toBe(false);
	});

	it('書き込みはサーバーへ送り、結果を同期してローカルに反映する', async () => {
		const server = fakeServer();
		const repo = new MemberRepository('u1', 'h1');
		await repo.refresh();
		const created = await repo.createItem(itemInput);
		expect(created.id).toBe('i2');
		expect(server.calls).toContain('POST /api/items');
		expect((await repo.listItems()).map((i) => i.name).sort()).toEqual(['サーバー洗剤', '新品目'].sort());
	});

	it('オフラインの書き込みは分かるメッセージで失敗し、ローカルを変えない', async () => {
		const server = fakeServer();
		const repo = new MemberRepository('u1', 'h1');
		await repo.refresh();
		server.online = false;
		await expect(repo.createItem(itemInput)).rejects.toThrow('オフラインのため保存できません');
		expect(await repo.listItems()).toHaveLength(1);
	});

	it('サーバーのエラーはそのまま伝える', async () => {
		fakeServer();
		const repo = new MemberRepository('u1', 'h1');
		await expect(repo.deleteItem('none')).rejects.toThrow('見つかりません');
	});

	it('世帯ごとにローカル DB を分け、ゲストのデータとも混ざらない', async () => {
		const server = fakeServer();
		await new MemberRepository('u1', 'h1').refresh();
		server.state = snapshot('別世帯の品目');
		await new MemberRepository('u1', 'h2').refresh();

		server.online = false;
		expect((await new MemberRepository('u1', 'h1').listItems())[0].name).toBe('サーバー洗剤');
		expect((await new MemberRepository('u1', 'h2').listItems())[0].name).toBe('別世帯の品目');
		expect(await new IndexedDbRepository().listItems()).toEqual([]);
	});
});

describe('IndexedDbRepository.replaceAll', () => {
	beforeEach(() => {
		indexedDB = new IDBFactory();
	});

	it('既存データを消してスナップショットに置き換える', async () => {
		const repo = new IndexedDbRepository('stockify-m-test');
		await repo.createItem(itemInput);
		await repo.replaceAll(snapshot('置換後'));
		const all = await repo.exportAll();
		expect(all.items.map((i) => i.name)).toEqual(['置換後']);
		expect(all.purchases).toHaveLength(1);
		expect(all.settings.defaultLeadTimeDays).toBe(5);
	});
});
