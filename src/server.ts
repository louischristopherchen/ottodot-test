import { createApp } from './app.ts';
import { DB_PATH } from './config.ts';
import { openDatabase } from './db/database.ts';
import { hasUpcomingClasses, isDatabaseEmpty, seedDemoData } from './db/seed.ts';
import { MockPaymentProvider } from './payments/mock-provider.ts';

const port = Number(process.env.PORT ?? 3000);

const db = openDatabase(DB_PATH);
if (isDatabaseEmpty(db)) {
  seedDemoData(db, new Date());
  console.log(`Seeded demo data into ${DB_PATH}`);
} else if (!hasUpcomingClasses(db, new Date())) {
  console.warn('All seeded classes are in the past. Run `npm run db:reset` for fresh demo data.');
}

const payments = new MockPaymentProvider({
  latencyMs: Number(process.env.MOCK_PAYMENT_LATENCY_MS ?? 800),
  slowLatencyMs: Number(process.env.MOCK_PAYMENT_SLOW_LATENCY_MS ?? 10_000),
});

createApp({ db, payments, now: () => new Date() }).listen(port, () => {
  console.log(`Trial booking demo running at http://localhost:${port}`);
});
