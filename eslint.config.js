import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

/**
 * ESLint flat config。Svelte 5(runesモード) + TypeScript。
 * svelte.config.js を持たない構成(SvelteKit設定は vite.config.ts にインライン)のため、
 * eslint-plugin-svelte には svelteConfig を渡していない。
 */
export default ts.config(
	{
		// 生成物・外部ファイルは対象外。
		ignores: [
			'.svelte-kit/',
			'build/',
			'node_modules/',
			'drizzle/',
			'static/',
			'package-lock.json'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		}
	},
	{
		// .svelte 内の <script lang="ts"> を TypeScript として解釈させる。
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser,
				extraFileExtensions: ['.svelte']
			}
		}
	},
	{
		// テストは fake-indexeddb を使うため、グローバル indexedDB への代入を許可する。
		files: ['**/*.test.ts', '**/*.spec.ts'],
		rules: {
			'no-global-assign': 'off'
		}
	},
	{
		// 今回の本番バグ(state_unsafe_mutation)の再発防止。
		// リアクティブな配列(bundle.adjustments 等)を [...] でコピーせず、
		// 破壊的メソッドで直接並べ替えると、描画中に状態を書き換えてしまう。
		// `x.y.sort()` の形(callee.object が MemberExpression)だけを禁止し、
		// `[...x.y].sort()` や ローカル配列 `arr.sort()` は許可する。
		files: ['**/*.svelte', '**/*.svelte.ts'],
		rules: {
			'no-restricted-syntax': [
				'error',
				{
					selector:
						"CallExpression[callee.type='MemberExpression'][callee.object.type='MemberExpression'][callee.property.name=/^(sort|reverse|splice|fill|copyWithin)$/]",
					message:
						'リアクティブ状態を描画中に破壊的変更する恐れがあります(state_unsafe_mutation)。まず [...arr] でコピーしてから並べ替えてください。'
				}
			]
		}
	}
);
