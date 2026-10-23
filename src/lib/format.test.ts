import { describe, it, expect } from 'vitest';
import {
	formatDate,
	formatNumber,
	formatQuantity,
	formatDaysUntil,
	formatDepletion,
	localDateInput,
	dateInputToTimestamp
} from './format';
import { MS_PER_DAY } from '#lib/domain/estimate.js';

describe('formatDate', () => {
	it('ローカル日付を YYYY/MM/DD にする', () => {
		const ms = new Date(2026, 6, 5).getTime(); // 2026/07/05 ローカル
		expect(formatDate(ms)).toBe('2026/07/05');
	});
	it('null は —', () => {
		expect(formatDate(null)).toBe('—');
	});
});

describe('formatNumber', () => {
	it('整数はそのまま', () => {
		expect(formatNumber(300)).toBe('300');
	});
	it('小数は最大1桁に丸める', () => {
		expect(formatNumber(12.34)).toBe('12.3');
	});
	it('丸めて整数になれば末尾ゼロを落とす', () => {
		expect(formatNumber(10.0)).toBe('10');
	});
	it('null は —', () => {
		expect(formatNumber(null)).toBe('—');
	});
});

describe('formatQuantity', () => {
	it('数値と単位を連結する', () => {
		expect(formatQuantity(123.4, 'ml')).toBe('123.4 ml');
	});
});

describe('formatDaysUntil', () => {
	it('正の日数は あとN日', () => {
		expect(formatDaysUntil(3)).toBe('あと3日');
	});
	it('0 は 本日', () => {
		expect(formatDaysUntil(0)).toBe('本日');
	});
	it('負は N日超過', () => {
		expect(formatDaysUntil(-2)).toBe('2日超過');
	});
	it('端数は丸める', () => {
		expect(formatDaysUntil(2.6)).toBe('あと3日');
	});
});

describe('formatDepletion', () => {
	it('枯渇予想日を今からの日数にする', () => {
		const now = Date.UTC(2026, 0, 1);
		expect(formatDepletion(now + 5 * MS_PER_DAY, now)).toBe('あと5日');
	});
	it('null は —', () => {
		expect(formatDepletion(null, 0)).toBe('—');
	});
});

describe('localDateInput', () => {
	it('ローカル日付を YYYY-MM-DD にする', () => {
		expect(localDateInput(new Date(2026, 6, 5, 21, 30))).toBe('2026-07-05');
	});
});

describe('dateInputToTimestamp', () => {
	it('当日を選んだら現在時刻(now)を返す', () => {
		const now = new Date(2026, 6, 5, 21, 0, 0);
		expect(dateInputToTimestamp('2026-07-05', now)).toBe(now.getTime());
	});
	it('過去日はその日のローカル0:00を返す', () => {
		const now = new Date(2026, 6, 5, 21, 0, 0);
		expect(dateInputToTimestamp('2026-07-01', now)).toBe(new Date(2026, 6, 1, 0, 0, 0).getTime());
	});
});
