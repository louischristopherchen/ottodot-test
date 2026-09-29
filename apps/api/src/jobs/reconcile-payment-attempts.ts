import { Op } from 'sequelize';

import { sequelize } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { paymentProvider } from '../infra/payment-provider/index.js';
import { PaymentAttempt } from '../models/index.js';
import { paymentJobsService } from '../modules/payments/payment-jobs.service.js';

/**
 * Attempts still `processing` long after the request should have finished: the
 * provider call timed out, or the process died mid-request. Ask the provider what
 * happened, using the attempt id as the idempotency key.
 *
 * Seats are only granted while the parent is waiting for an answer, so an
 * authorization found here is always voided: the parent was told to try again.
 */
export async function reconcilePaymentAttempts(now = new Date(), limit = 50): Promise<number> {
	const cutoff = new Date(now.getTime() - env.RECONCILE_AFTER_SECONDS * 1000);
	const stuck = await PaymentAttempt.findAll({
		where: { status: 'processing', updatedAt: { [Op.lt]: cutoff } },
		order: [['updatedAt', 'ASC']],
		limit,
	});

	let reconciled = 0;
	for (const attempt of stuck) {
		let found;
		try {
			found = await paymentProvider().findAuthorization(attempt.id);
		} catch (error) {
			logger.warn('Reconciliation lookup failed, will retry', { paymentAttemptId: attempt.id, error });
			continue;
		}

		if (!found || found.status === 'declined') {
			await PaymentAttempt.update(
				{ status: 'declined', failureCode: found?.declineCode ?? attempt.failureCode ?? 'provider_unavailable' },
				{ where: { id: attempt.id, status: 'processing' } },
			);
			reconciled += 1;
			continue;
		}

		if (found.status === 'captured') {
			// Only our own capture job captures, and it only runs after a seat decision.
			logger.error('Found a captured payment with no seat decision; refund it by hand', {
				paymentAttemptId: attempt.id,
				providerRef: found.providerRef,
			});
			continue;
		}

		const voidJobId = await sequelize.transaction(async (transaction) => {
			const [updated] = await PaymentAttempt.update(
				{ status: found.status === 'voided' ? 'voided' : 'authorized', providerRef: found.providerRef },
				{ where: { id: attempt.id, status: 'processing' }, transaction },
			);
			if (updated === 0 || found.status === 'voided') {
				return null;
			}
			const job = await paymentJobsService.enqueue(attempt.id, 'void', transaction);
			return job.id;
		});
		if (voidJobId) {
			await paymentJobsService.runJob(voidJobId);
		}
		logger.info('Reconciled an unfinished payment attempt', { paymentAttemptId: attempt.id, found: found.status });
		reconciled += 1;
	}
	return reconciled;
}
