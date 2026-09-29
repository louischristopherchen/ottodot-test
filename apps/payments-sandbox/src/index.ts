import { env } from './config.js';
import { createSandboxApp } from './sandbox.js';

const app = createSandboxApp({
	apiKey: env.SANDBOX_API_KEY,
	latencyMs: env.SANDBOX_LATENCY_MS,
	slowLatencyMs: env.SANDBOX_SLOW_LATENCY_MS,
});

const server = app.listen(env.SANDBOX_PORT, env.SANDBOX_BIND_HOST, () => {
	console.log(`Payments sandbox listening on http://${env.SANDBOX_BIND_HOST}:${env.SANDBOX_PORT}`);
});

function shutdown(signal: string): void {
	console.log(`${signal} received, closing the payments sandbox`);
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
