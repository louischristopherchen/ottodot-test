/**
 * PM2 processes for the trial-booking monorepo (production).
 *
 * Three Node processes run under PM2. The web app is a static bundle in
 * apps/web/dist that nginx serves from disk, so it has no entry here.
 *
 * On the server, from the deploy root (the DEPLOY_PATH repository variable):
 *   pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save
 *
 * Secrets never go in this file. Each app loads the root .env and then its own
 * apps/<app>/.env with dotenv (override: false), so anything set in `env` below
 * is already in process.env and wins over the files. That is used on purpose
 * for the ports and bind addresses: nginx and the deploy health check depend on
 * them, and pinning them here means a typo in a .env file cannot move the API
 * off loopback.
 *
 * Shutdown: PM2 sends SIGINT (not SIGTERM) and sends SIGKILL after
 * kill_timeout. 10s gives the API time to finish in-flight requests and the
 * worker time to finish the job it is running.
 *
 * One fork-mode instance each. Scaling out needs a review of in-process state
 * (rate-limit counters, the worker loop) first.
 */
const path = require('node:path');

const logFiles = (name) => ({
	out_file: path.join(__dirname, 'logs', `${name}-out.log`),
	error_file: path.join(__dirname, 'logs', `${name}-error.log`),
	merge_logs: true,
	time: true,
});

const base = {
	cwd: __dirname,
	exec_mode: 'fork',
	instances: 1,
	autorestart: true,
	watch: false,
	kill_timeout: 10000,
	// A process that dies within 10s counts as a failed start. Backoff keeps a
	// crash loop (for example Postgres down) from spinning the CPU.
	min_uptime: '10s',
	max_restarts: 10,
	exp_backoff_restart_delay: 200,
};

module.exports = {
	apps: [
		{
			...base,
			...logFiles('api'),
			name: 'trial-booking-api',
			script: 'apps/api/dist/index.js',
			max_memory_restart: '384M',
			env: {
				NODE_ENV: 'production',
				PORT: 4001,
				BIND_HOST: '127.0.0.1',
			},
		},
		{
			...base,
			...logFiles('worker'),
			name: 'trial-booking-worker',
			script: 'apps/api/dist/worker.js',
			max_memory_restart: '256M',
			env: {
				NODE_ENV: 'production',
			},
		},
		{
			...base,
			...logFiles('payments-sandbox'),
			name: 'trial-booking-payments-sandbox',
			script: 'apps/payments-sandbox/dist/index.js',
			max_memory_restart: '192M',
			env: {
				NODE_ENV: 'production',
				SANDBOX_PORT: 4002,
				SANDBOX_BIND_HOST: '127.0.0.1',
			},
		},
	],
};
