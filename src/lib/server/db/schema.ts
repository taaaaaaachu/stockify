import { sqliteTable, text, integer, real, index, unique } from 'drizzle-orm/sqlite-core';

import type { InstanceRole, HouseholdRole } from '$lib/rbac';
export type { InstanceRole, HouseholdRole };

/** 会員ユーザー。ログインIDはユーザー名。 */
export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	/** インスタンス全体のロール。ブートストラップした最初の1人が super_admin。 */
	instanceRole: text('instance_role').notNull().$type<InstanceRole>().default('user'),
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
		createdAt: integer('created_at').notNull()
	},
	(t) => [
		unique('memberships_user_household_uq').on(t.userId, t.householdId),
		index('memberships_user_idx').on(t.userId),
		index('memberships_household_idx').on(t.householdId)
	]
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
export type HouseholdRow = typeof households.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;
export type StockItemRow = typeof stockItems.$inferSelect;
export type PurchaseRow = typeof purchases.$inferSelect;
export type RanoutRow = typeof ranouts.$inferSelect;
export type AdjustmentRow = typeof adjustments.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
