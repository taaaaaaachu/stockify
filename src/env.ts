import { defineEnvVars } from '@sveltejs/kit/env';

// 未設定・空文字のときの既定値はここで決める(未設定は空文字として渡ってくる)。
export const variables = defineEnvVars({
	// 通知評価 cron の共有シークレット。空なら cron エンドポイントは 503。
	CRON_SECRET: { schema: (input) => input ?? '' },
	// Web Push(VAPID)。鍵が空ならプッシュ機能は無効。
	VAPID_PUBLIC_KEY: { schema: (input) => input ?? '' },
	VAPID_PRIVATE_KEY: { schema: (input) => input ?? '' },
	VAPID_SUBJECT: { schema: (input) => input || 'mailto:admin@example.com' },
	// SQLite ファイルの場所。未指定ならリポジトリ直下の data/。
	DATABASE_PATH: { schema: (input) => input || './data/app.sqlite' }
});
