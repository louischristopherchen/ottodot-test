import { logger } from '../config/logger.js';
import { paymentJobsService } from '../modules/payments/payment-jobs.service.js';
import { expireUnpaidBookings, purgeExpiredRecords } from './maintenance.js';
import { reconcilePaymentAttempts } from './reconcile-payment-attempts.js';

/**
 * One pass of every background job. Each step is safe to run on several workers at
 * once: payment jobs are claimed with SKIP LOCKED and a lease, and the other steps
 * are conditional updates.
 */
export async function runJobsOnce(now = new Date()): Promise<void> {
	const steps: [string, () => Promise<unknown>][] = [
		['payment jobs', () => paymentJobsService.runDueJobs()],
		['reconcile payment attempts', () => reconcilePaymentAttempts(now)],
		['expire unpaid bookings', () => expireUnpaidBookings(now)],
		['purge expired records', () => purgeExpiredRecords(now)],
	];
	for (const [name, step] of steps) {
		try {
			const result = await step();
			if (typeof result === 'number' && result > 0) {
				logger.info(`Worker: ${name}`, { count: result });
			}
		} catch (error) {
			// One failing step must not stop the others; the next pass tries again.
			logger.error(`Worker step failed: ${name}`, { error });
		}
	}
}
