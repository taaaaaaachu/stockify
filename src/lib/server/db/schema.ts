import { sqliteTable, text, integer, real, index, unique } from 'drizzle-orm/sqlite-core';

import type { InstanceRole, HouseholdRole } from '$lib/rbac';
export type { InstanceRole, HouseholdRole };

/** 会員ユーザー。ログインIDはユーザー名。 */
export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	/** 管理者リセット後、次回ログインでのパスワード変更を要求する。 */
	mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
	/** インスタンス全体のロール。ブートストラップした最初の1人が super_admin。 */
	instanceRole: text('instance_role').notNull().$type<InstanceRole>().default('user'),
	/**
	 * 購入リマインドを送る時刻(ローカル 0:00 からの分。15分刻み、0〜1439)。
	 * 既定 540 = 09:00。cron はこの時刻の 15 分スロットに該当したときだけ送る。
	 */
	notifyMinuteOfDay: integer('notify_minute_of_day').notNull().default(540),
	createdAt: integer('created_at').notNull()
});

/** セッション。id はセッショントークンの SHA-256 ハッシュ(平文はDBに残さない)。 */
export const sessions = sqliteTable('sessions', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: integer('expires_at').notNull()
});

/** パスワード検証の一時的な試行制限。値そのものは保存せず、目的別ハッシュを id に使う。 */
export const authAttempts = sqliteTable(
	'auth_attempts',
	{
		id: text('id').primaryKey(),
		scope: text('scope').notNull().$type<'user' | 'ip'>(),
		failedCount: integer('failed_count').notNull(),
		windowStartedAt: integer('window_started_at').notNull(),
		blockedUntil: integer('blocked_until'),
		updatedAt: integer('updated_at').notNull()
	},
	(t) => [index('auth_attempts_scope_updated_idx').on(t.scope, t.updatedAt)]
);

/** 世帯。在庫データを共有する単位(ADR 0003)。 */
export const households = sqliteTable('households', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	/** リードタイム既定値(全体既定は世帯ごとに持つ)。 */
	defaultLeadTimeDays: real('default_lead_time_days').notNull().default(7),
	createdAt: integer('created_at').notNull()
});

/** 所属。ユーザーと世帯の多対多。世帯内ロールを持つ。 */
export const memberships = sqliteTable(
	'memberships',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		householdId: text('household_id')
			.notNull()
			.references(() => households.id, { onDelete: 'cascade' }),
		role: text('role').notNull().$type<HouseholdRole>().default('member'),
		/** この世帯の購入リマインド通知を受け取るか。世帯ごとに個別にON/OFFできる。 */
		notifyEnabled: integer('notify_enabled', { mode: 'boolean' }).notNull().default(true),
		createdAt: integer('created_at').notNull()
	},
	(t) => [
		unique('memberships_user_household_uq').on(t.userId, t.householdId),
		index('memberships_user_idx').on(t.userId),
		index('memberships_household_idx').on(t.householdId)
	]
);

/** owner交代の保留申請。世帯ごとに保留は1件だけ。 */
export const ownershipTransfers = sqliteTable(
	'ownership_transfers',
	{
		id: text('id').primaryKey(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.id, { onDelete: 'cascade' }),
			currentOwnerId: text('current_owner_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
			candidateUserId: text('candidate_user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdAt: integer('created_at').notNull()
	},
	(t) => [unique('ownership_transfers_household_uq').on(t.householdId), index('ownership_transfers_candidate_idx').on(t.candidateUserId)]
);

/** 招待コード。特定の世帯へメンバーを招く。単回使用。 */
export const invites = sqliteTable(
	'invites',
	{
		id: text('id').primaryKey(),
		code: text('code').notNull().unique(),
		/** 招く先の世帯。 */
		householdId: text('household_id')
			.notNull()
			.references(() => households.id, { onDelete: 'cascade' }),
		/** 発行者。削除されたら SET NULL(履歴は残す)。 */
		createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: integer('created_at').notNull(),
		/** 有効期限(epoch ミリ秒)。null なら無期限。 */
		expiresAt: integer('expires_at'),
		/** 使用者。未使用なら null。 */
		usedBy: text('used_by').references(() => users.id, { onDelete: 'set null' }),
		usedAt: integer('used_at'),
		/** 無効化日時。null なら未無効化。 */
		revokedAt: integer('revoked_at')
	},
	(t) => [index('invites_household_idx').on(t.householdId)]
);

/** ストック品目。世帯が所有する。 */
export const stockItems = sqliteTable(
	'stock_items',
	{
		id: text('id').primaryKey(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		unit: text('unit').notNull(),
		category: text('category'),
		leadTimeDays: real('lead_time_days'),
		provisionalDaysToDeplete: real('provisional_days_to_deplete')
	},
	(t) => [index('stock_items_household_idx').on(t.householdId)]
);

/** ストック品目から購入先へ移動する商品リンク。 */
export const productLinks = sqliteTable(
	'product_links',
	{
		id: text('id').primaryKey(),
		itemId: text('item_id')
			.notNull()
			.references(() => stockItems.id, { onDelete: 'cascade' }),
		label: text('label').notNull().default(''),
		url: text('url').notNull(),
		position: integer('position').notNull()
	},
	(t) => [index('product_links_item_idx').on(t.itemId), unique('product_links_item_url_uq').on(t.itemId, t.url)]
);

/** 購入イベント。 */
export const purchases = sqliteTable(
	'purchases',
	{
		id: text('id').primaryKey(),
		itemId: text('item_id')
			.notNull()
			.references(() => stockItems.id, { onDelete: 'cascade' }),
		volume: real('volume').notNull(),
		price: real('price'),
		purchasedAt: integer('purchased_at').notNull(),
		source: text('source').notNull().$type<'manual' | 'subscription'>().default('manual')
	},
	(t) => [index('purchases_item_idx').on(t.itemId)]
);

/** 使い切りイベント。 */
export const ranouts = sqliteTable(
	'ranouts',
	{
		id: text('id').primaryKey(),
		itemId: text('item_id')
			.notNull()
			.references(() => stockItems.id, { onDelete: 'cascade' }),
		at: integer('at').notNull()
	},
	(t) => [index('ranouts_item_idx').on(t.itemId)]
);

/** 残量補正。 */
export const adjustments = sqliteTable(
	'adjustments',
	{
		id: text('id').primaryKey(),
		itemId: text('item_id')
			.notNull()
			.references(() => stockItems.id, { onDelete: 'cascade' }),
		at: integer('at').notNull(),
		remaining: real('remaining').notNull()
	},
	(t) => [index('adjustments_item_idx').on(t.itemId)]
);

/** 定期便。 */
export const subscriptions = sqliteTable(
	'subscriptions',
	{
		id: text('id').primaryKey(),
		itemId: text('item_id')
			.notNull()
			.references(() => stockItems.id, { onDelete: 'cascade' }),
		intervalDays: real('interval_days').notNull(),
		nextDeliveryAt: integer('next_delivery_at').notNull(),
		volumePerDelivery: real('volume_per_delivery').notNull(),
		quantityPerDelivery: real('quantity_per_delivery').notNull().default(1),
		paused: integer('paused', { mode: 'boolean' }).notNull().default(false)
	},
	(t) => [index('subscriptions_item_idx').on(t.itemId)]
);

/**
 * Web Push の購読。ユーザーの端末(ブラウザ)ごとに 1 行。
 * endpoint をユニークにして同一端末の重複購読を防ぐ。
 */
export const pushSubscriptions = sqliteTable(
	'push_subscriptions',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		endpoint: text('endpoint').notNull().unique(),
		p256dh: text('p256dh').notNull(),
		auth: text('auth').notNull(),
		createdAt: integer('created_at').notNull(),
		/** 最後に通知を送った日時(epoch ミリ秒)。1日1回に間引くために使う。 */
		lastNotifiedAt: integer('last_notified_at')
	},
	(t) => [index('push_subscriptions_user_idx').on(t.userId)]
);

export type UserRow = typeof users.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type AuthAttemptRow = typeof authAttempts.$inferSelect;
export type HouseholdRow = typeof households.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;
export type OwnershipTransferRow = typeof ownershipTransfers.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;
export type StockItemRow = typeof stockItems.$inferSelect;
export type ProductLinkRow = typeof productLinks.$inferSelect;
export type PurchaseRow = typeof purchases.$inferSelect;
export type RanoutRow = typeof ranouts.$inferSelect;
export type AdjustmentRow = typeof adjustments.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
