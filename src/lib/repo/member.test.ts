import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { MemberRepository } from './member';
import { IndexedDbRepository } from './indexeddb';
import { classifyStatus } from './api';
import type { Snapshot } from './types';
import type { StockItem } from '#lib/types.js';

const item = (id: string, name: string): StockItem => ({
	id,
	name,
	unit: 'ml',
	category: null,
	leadTimeDays: null,
	provisionalDaysToDeplete: 30
});

const emptySnapshot = (): Snapshot => ({
	settings: { defaultLeadTimeDays: 5 },
	items: [],
	productLinks: [],
	purchases: [],
	ranOutEvents: [],
	adjustments: [],
	subscriptions: []
});

interface Sent {
	method: string;
	url: string;
	body: unknown;
	household: string | null;
	opAt: string | null;
}

/**
 * 品目だけを扱うサーバーの fetch モック。online=false で通信不可(TypeError)、
 * respond を設定すると操作の応答を差し替えられる。
 */
function fakeServer() {
	const server = {
		online: true,
		state: emptySnapshot(),
		sent: [] as Sent[],
		respond: null as null | ((s: Sent) => Response | null)
	};
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		if (!server.online) throw new TypeError('Failed to fetch');
		const headers = new Headers(init?.headers);
		const sent: Sent = {
			method: init?.method ?? 'GET',
			url,
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
			household: headers.get('x-stockify-household'),
			opAt: headers.get('x-stockify-op-at')
		};
		if (url === '/api/state/export') return Response.json(server.state);
		if (url === '/api/refresh') return Response.json({ generatedPurchases: 0 });
		server.sent.push(sent);
		const custom = server.respond?.(sent);
		if (custom) return custom;
		if (url === '/api/items' && sent.method === 'POST') {
			const body = sent.body as StockItem;
			if (!server.state.items.some((i) => i.id === body.id)) server.state.items.push(body);
			return Response.json(body, { status: 201 });
		}
		const m = /^\/api\/items\/(.+)$/.exec(url);
		if (m && sent.method === 'DELETE') {
			const before = server.state.items.length;
			server.state.items = server.state.items.filter((i) => i.id !== m[1]);
			return before === server.state.items.length
				? Response.json({ message: '品目が見つかりません。' }, { status: 404 })
				: new Response(null, { status: 204 });
		}
		return Response.json({ message: '未対応' }, { status: 400 });
	});
	return server;
}

const input = (name: string) => ({
	name,
	unit: '個',
	category: null,
	leadTimeDays: null,
	provisionalDaysToDeplete: null
});
const names = async (repo: MemberRepository) => (await repo.listItems()).map((i) => i.name).sort();

describe('MemberRepository', () => {
	beforeEach(() => {
		indexedDB = new IDBFactory();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('起動時にサーバーの全件をローカルへ取り込む', async () => {
		const server = fakeServer();
		server.state.items.push(item('i1', 'サーバー洗剤'));
		const repo = new MemberRepository('u1', 'h1');
		await repo.refresh();
		expect(repo.syncState).toBe('synced');
		expect(await names(repo)).toEqual(['サーバー洗剤']);
		expect((await repo.getSettings()).defaultLeadTimeDays).toBe(5);
	});

	it('書き込みはすぐローカルに反映し、同じ ID でサーバーへ送る(世帯と操作日時を明示)', async () => {
		const server = fakeServer();
		const repo = new MemberRepository('u1', 'h1');
		const created = await repo.createItem(input('新品目'));
		expect(await names(repo)).toEqual(['新品目']);
		await repo.sync();
		expect(repo.pending).toBe(0);
		expect(server.state.items.map((i) => i.id)).toEqual([created.id]);
		expect(server.sent[0]).toMatchObject({ method: 'POST', url: '/api/items', household: 'h1' });
		expect(Number(server.sent[0].opAt)).toBeGreaterThan(0);
	});

	it('オフラインの書き込みは保持し、通信が戻ったら順番どおりに送る', async () => {
		const server = fakeServer();
		server.online = false;
		const repo = new MemberRepository('u1', 'h1');
		const a = await repo.createItem(input('A'));
		await repo.createItem(input('B'));
		await repo.deleteItem(a.id);
		await repo.sync();
		expect(repo.syncState).toBe('offline');
		expect(repo.pending).toBe(3);
		expect(await names(repo)).toEqual(['B']);

		server.online = true;
		await repo.sync();
		expect(repo.syncState).toBe('synced');
		expect(repo.pending).toBe(0);
		expect(server.sent.map((s) => `${s.method} ${s.url}`)).toEqual([
			'POST /api/items',
			'POST /api/items',
			`DELETE /api/items/${a.id}`
		]);
		expect(server.state.items.map((i) => i.name)).toEqual(['B']);
		expect(await names(repo)).toEqual(['B']);
	});

	it('未送信がある間はサーバーの全件でローカルを上書きしない', async () => {
		const server = fakeServer();
		const repo = new MemberRepository('u1', 'h1');
		server.respond = () => new Response(null, { status: 503 });
		await repo.createItem(input('未送信'));
		await repo.sync();
		expect(repo.syncState).toBe('offline');
		expect(await names(repo)).toEqual(['未送信']);
	});

	it('サーバーに拒否された操作は破棄して知らせ、ローカルはサーバーに揃う', async () => {
		const server = fakeServer();
		server.state.items.push(item('i1', '既存'));
		const repo = new MemberRepository('u1', 'h1');
		await repo.refresh();
		server.respond = (s) =>
			s.method === 'POST' ? Response.json({ message: '品目名は必須です。' }, { status: 400 }) : null;
		await repo.createItem(input('拒否される'));
		await repo.sync();
		expect(repo.pending).toBe(0);
		expect(repo.rejected).toEqual(['品目「拒否される」の追加: 品目名は必須です。']);
		expect(await names(repo)).toEqual(['既存']);
	});

	it('他端末で削除済みの対象への操作(404)は黙って破棄する', async () => {
		const server = fakeServer();
		server.state.items.push(item('i1', '消される'));
		const repo = new MemberRepository('u1', 'h1');
		await repo.refresh();
		server.state.items = [];
		await repo.deleteItem('i1');
		await repo.sync();
		expect(repo.pending).toBe(0);
		expect(repo.rejected).toEqual([]);
		expect(repo.syncState).toBe('synced');
	});

	it('認証切れでは送信を止めて保持し、auth 状態にする', async () => {
		const server = fakeServer();
		const repo = new MemberRepository('u1', 'h1');
		server.respond = () => Response.json({ message: 'ログインが必要です。' }, { status: 401 });
		await repo.createItem(input('保持'));
		await repo.sync();
		expect(repo.syncState).toBe('auth');
		expect(repo.pending).toBe(1);

		server.respond = null;
		await repo.sync();
		expect(repo.pending).toBe(0);
		expect(server.state.items.map((i) => i.name)).toEqual(['保持']);
	});

	it('世帯ごとにローカル DB を分け、ゲストのデータとも混ざらない', async () => {
		const server = fakeServer();
		server.state.items = [item('i1', '世帯1の品目')];
		await new MemberRepository('u1', 'h1').refresh();
		server.state.items = [item('i2', '世帯2の品目')];
		await new MemberRepository('u1', 'h2').refresh();

		server.online = false;
		expect((await new MemberRepository('u1', 'h1').listItems())[0].name).toBe('世帯1の品目');
		expect((await new MemberRepository('u1', 'h2').listItems())[0].name).toBe('世帯2の品目');
		expect(await new IndexedDbRepository().listItems()).toEqual([]);
	});
});

describe('classifyStatus', () => {
	it('成功と 404 は完了、認証系は auth、障害系は retry、他の 4xx は拒否', () => {
		expect(classifyStatus(201)).toBe('done');
		expect(classifyStatus(204)).toBe('done');
		expect(classifyStatus(404)).toBe('done');
		expect(classifyStatus(401)).toBe('auth');
		expect(classifyStatus(403)).toBe('auth');
		for (const s of [408, 429, 500, 502, 530]) expect(classifyStatus(s)).toBe('retry');
		for (const s of [400, 409, 422]) expect(classifyStatus(s)).toBe('rejected');
	});
});

describe('IndexedDbRepository.replaceAll', () => {
	beforeEach(() => {
		indexedDB = new IDBFactory();
	});

	it('既存データを消してスナップショットに置き換える', async () => {
		const repo = new IndexedDbRepository('stockify-m-test');
		await repo.createItem(input('置換前'));
		const snapshot = emptySnapshot();
		snapshot.items = [item('i1', '置換後')];
		expect(await repo.replaceAll(snapshot)).toBe(true);
		expect((await repo.listItems()).map((i) => i.name)).toEqual(['置換後']);
		expect((await repo.getSettings()).defaultLeadTimeDays).toBe(5);
	});

	it('outbox が残っていれば置き換えない', async () => {
		const repo = new IndexedDbRepository('stockify-m-test');
		await repo.createItem(input('ローカル'));
		await repo.enqueue({ method: 'POST', path: '/api/items', at: 1, label: 'x' });
		expect(await repo.replaceAll(emptySnapshot())).toBe(false);
		expect((await repo.listItems()).map((i) => i.name)).toEqual(['ローカル']);
	});
});
