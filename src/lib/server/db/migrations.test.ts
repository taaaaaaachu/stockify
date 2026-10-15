import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '../../../../scripts/migrate.js';

/** 先頭 n 本だけのマイグレーションフォルダを作る(古い版の DB を再現する)。 */
function firstMigrations(n: number): string {
	const dir = mkdtempSync(join(tmpdir(), 'mig-'));
	mkdirSync(join(dir, 'meta'));
	const journal = JSON.parse(readFileSync('./drizzle/meta/_journal.json', 'utf-8'));
	journal.entries = journal.entries.slice(0, n);
	writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify(journal));
	for (const e of journal.entries) cpSync(`./drizzle/${e.tag}.sql`, join(dir, `${e.tag}.sql`));
	return dir;
}

describe('applyMigrations', () => {
	it('users を作り直す 0008 を適用しても、users を参照するデータが消えない', () => {
		const sqlite = new Database(':memory:');
		applyMigrations(sqlite, firstMigrations(8));
		sqlite.exec(`
			insert into users(id, username, password_hash, instance_role, created_at, notify_minute_of_day, must_change_password)
				values ('u', 'alice', 'h', 'super_admin', 0, 600, 1), ('v', 'bob', 'h', 'user', 0, 540, 0);
			insert into households(id, name, created_at) values ('h', '自宅', 0);
			insert into sessions(id, user_id, expires_at) values ('s', 'u', 9);
			insert into memberships(id, user_id, household_id, role, created_at) values ('m1', 'u', 'h', 'owner', 0), ('m2', 'v', 'h', 'member', 0);
			insert into invites(id, code, household_id, created_by, created_at, used_by, used_at) values ('i', 'c', 'h', 'u', 0, 'v', 1);
			insert into ownership_transfers(id, household_id, current_owner_id, candidate_user_id, created_at) values ('t', 'h', 'u', 'v', 0);
			insert into push_subscriptions(id, user_id, endpoint, p256dh, auth, created_at) values ('p', 'u', 'https://push', 'k', 'a', 0);
		`);

		applyMigrations(sqlite);

		const count = (t: string) => (sqlite.prepare(`select count(*) c from ${t}`).get() as { c: number }).c;
		for (const t of ['sessions', 'memberships', 'ownership_transfers', 'push_subscriptions']) {
			expect(count(t), t).toBeGreaterThan(0);
		}
		expect(sqlite.prepare('select created_by, used_by from invites').get()).toEqual({ created_by: 'u', used_by: 'v' });
		expect(sqlite.prepare("select * from users where id = 'u'").get()).toEqual({
			id: 'u',
			username: 'alice',
			password_hash: 'h',
			instance_role: 'super_admin',
			created_at: 0,
			notify_minute_of_day: 600,
			must_change_password: 1
		});
		expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);

		// 作り直した users でも、参照の外部キー(CASCADE)は効いたまま。
		sqlite.exec("delete from users where id = 'v'");
		expect(count('memberships')).toBe(1);
	});
});
