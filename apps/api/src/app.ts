import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { sequelize } from './config/database.js';
import { env } from './config/env.js';
import { helmetOptions } from './config/security-headers.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { globalLimiter } from './middleware/rate-limiter.js';
import { requestId } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';
import routes from './routes/index.js';

export function createApp(): express.Express {
	const app = express();

	app.set('trust proxy', env.TRUST_PROXY);
	app.disable('x-powered-by');

	app.use(requestId);
	app.use(requestLogger);
	app.use(helmet(helmetOptions));
	app.use(cors({ origin: env.corsOrigins, credentials: true }));
	app.use(express.json({ limit: '16kb' }));
	app.use(cookieParser());

	app.get('/health', (_req, res) => {
		res.json({ success: true, data: { status: 'ok' } });
	});

	app.get('/health/ready', async (_req, res) => {
		try {
			await sequelize.query('SELECT 1');
			res.json({ success: true, data: { status: 'ready' } });
		} catch {
			res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable' } });
		}
	});

	// API responses can hold personal data (rosters list parents' emails): never cache them.
	app.use('/api', (_req, res, next) => {
		res.setHeader('Cache-Control', 'no-store');
		next();
	});
	app.use('/api', globalLimiter, routes);
	app.use(notFoundHandler);
	app.use(errorHandler);

	return app;
}
