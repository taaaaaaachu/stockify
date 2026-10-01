import type { OutboxOp, Snapshot } from './types';

/**
 * 会員の在庫 API クライアント(ADR 0009)。読み書きはローカル DB で行い、ここは
 * 未送信操作の送信と、同期用の全件取得だけを担う。世帯は Cookie の現在世帯に頼らず
 * ヘッダーで明示する(送信待ちの間に世帯を切り替えても取り違えないため)。
 */

/** 送信結果の扱い。 */
export type SendOutcome =
	/** 反映済み(または対象が既に無い)。outbox から消す。 */
	| { kind: 'done' }
	/** サーバーが内容を拒否した。outbox から消してユーザーに知らせる。 */
	| { kind: 'rejected'; message: string }
	/** 通信不可・サーバー障害。順序を守るため送信を止め、後で再送する。 */
	| { kind: 'retry' }
	/** 認証切れ。送信を止め、再ログイン後に再送する。 */
	| { kind: 'auth' };

/** HTTP ステータスから送信結果の扱いを決める。 */
export function classifyStatus(status: number): SendOutcome['kind'] {
	if (status >= 200 && status < 300) return 'done';
	// 他端末で削除済みなど、対象が無い操作は捨てる(削除優先)。
	if (status === 404) return 'done';
	if (status === 401 || status === 403) return 'auth';
	if (status === 408 || status === 425 || status === 429 || status >= 500) return 'retry';
	return 'rejected';
}

function request(householdId: string, method: string, path: string, body?: unknown, opAt?: number) {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'x-stockify-household': householdId
	};
	if (opAt !== undefined) headers['x-stockify-op-at'] = String(opAt);
	return fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** 未送信操作を 1 件送る。fetch 自体の失敗(通信不可)は retry として扱う。 */
export async function sendOp(householdId: string, op: OutboxOp): Promise<SendOutcome> {
	let res: Response;
	try {
		res = await request(householdId, op.method, op.path, op.body, op.at);
	} catch {
		return { kind: 'retry' };
	}
	const kind = classifyStatus(res.status);
	if (kind !== 'rejected') return { kind } as SendOutcome;
	const body = await res.json().catch(() => null);
	return { kind, message: body?.message ?? `サーバーが拒否しました (${res.status})` };
}

/** 同期用の呼び出しの失敗。kind で通信不可と認証切れを区別する。 */
export class SyncError extends Error {
	constructor(readonly kind: 'retry' | 'auth' | 'rejected', status: number) {
		super(`同期に失敗しました (${status})`);
	}
}

async function call<T>(householdId: string, method: string, path: string): Promise<T> {
	const res = await request(householdId, method, path);
	const kind = classifyStatus(res.status);
	if (!res.ok) throw new SyncError(kind === 'done' ? 'rejected' : kind, res.status);
	return res.json() as Promise<T>;
}

/** 定期便の遅延生成(ADR 0002)をサーバーで行う。 */
export const serverRefresh = (householdId: string) => call<unknown>(householdId, 'POST', '/api/refresh');

/** 世帯の全データ(同期の取り込み元)。 */
export const fetchSnapshot = (householdId: string) =>
	call<Snapshot>(householdId, 'GET', '/api/state/export');
