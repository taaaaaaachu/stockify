import { db } from '#lib/server/db/index.js';
import * as stock from '#lib/server/stock.js';
import { requireHousehold } from '#lib/server/apiGuard.js';
import type { RequestHandler } from './$types';

/** 現在の世帯の設定とバンドル一覧をまとめて返す(会員モードの主要な読み取り)。 */
export const GET: RequestHandler = ({ locals }) => {
	const { householdId } = requireHousehold(locals);
	return Response.json({
		settings: stock.getSettings(db, householdId),
		bundles: stock.listBundles(db, householdId)
	});
};
