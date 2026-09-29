import { createApp } from './app.js';
import { closeDatabase, connectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { installProcessGuards } from './config/process-guards.js';

await connectDatabase();

const server = createApp().listen(env.PORT, env.BIND_HOST, () => {
	logger.info('API listening', { host: env.BIND_HOST, port: env.PORT, env: env.NODE_ENV });
});

let shuttingDown = false;

installProcessGuards({
	shutdown: async (signal, exitCode = 0) => {
		if (shuttingDown) {
			return;
		}
		shuttingDown = true;
		logger.info('Shutting down API', { signal });
		// Stop accepting connections, let in-flight requests finish, then close the pool.
		const forceExit = setTimeout(() => process.exit(1), 8_000);
		forceExit.unref();
		server.close(async () => {
			await closeDatabase().catch(() => undefined);
			process.exit(exitCode);
		});
		server.closeIdleConnections();
	},
});
