import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@rspack/cli';
import { rspack } from '@rspack/core';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const showDemoAccounts = process.env.SHOW_DEMO_ACCOUNTS ?? (isProduction ? 'false' : 'true');

export default defineConfig({
	context: dirname,
	mode: isProduction ? 'production' : 'development',
	entry: {
		main: './src/main.tsx',
	},
	output: {
		path: path.resolve(dirname, 'dist'),
		// Content hashes only in production builds: in the dev server they change on every
		// rebuild, and a hot CSS update then asks for a file name that no longer exists.
		filename: isProduction ? '[name].[contenthash].js' : '[name].js',
		chunkFilename: isProduction ? '[name].[contenthash].js' : '[name].js',
		cssFilename: isProduction ? '[name].[contenthash].css' : '[name].css',
		cssChunkFilename: isProduction ? '[name].[contenthash].css' : '[name].css',
		publicPath: '/',
		clean: true,
	},
	devtool: isProduction ? false : 'cheap-module-source-map',
	// Compile every route up front in the dev server. Compiling lazy routes on first visit
	// triggered a hot update in the middle of loading the page.
	lazyCompilation: false,
	resolve: {
		extensions: ['.ts', '.tsx', '.js'],
		alias: {
			'@': path.resolve(dirname, 'src'),
		},
	},
	experiments: {
		css: true,
	},
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				// Workspace packages are symlinks that resolve to their real path, so the raw TS in
				// packages/ui is matched here instead of being skipped as node_modules.
				include: [path.resolve(dirname, 'src'), path.resolve(dirname, '../../packages/ui/src')],
				loader: 'builtin:swc-loader',
				options: {
					jsc: {
						parser: {
							syntax: 'typescript',
							tsx: true,
						},
						transform: {
							react: {
								runtime: 'automatic',
								development: !isProduction,
							},
						},
						target: 'es2022',
					},
				},
				type: 'javascript/auto',
			},
			{
				test: /\.css$/,
				use: ['postcss-loader'],
				type: 'css',
			},
		],
	},
	plugins: [
		new rspack.HtmlRspackPlugin({
			template: './public/index.html',
			title: 'Trial booking',
		}),
		new rspack.DefinePlugin({
			'process.env.SHOW_DEMO_ACCOUNTS': JSON.stringify(showDemoAccounts),
		}),
	],
	devServer: {
		port: Number(process.env.WEB_PORT ?? 4000),
		historyApiFallback: true,
		hot: true,
		proxy: [
			{
				context: ['/api', '/health'],
				target: process.env.API_URL || 'http://127.0.0.1:4001',
				changeOrigin: true,
			},
		],
	},
	// React DOM alone is about 180 KiB minified, so the 244 KiB default always fires; this catches real growth.
	performance: {
		hints: isProduction ? 'warning' : false,
		maxEntrypointSize: 512 * 1024,
		maxAssetSize: 512 * 1024,
	},
});
