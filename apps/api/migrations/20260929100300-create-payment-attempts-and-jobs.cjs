'use strict';

/**
 * Payment attempts and the payment job outbox.
 *
 * A payment attempt row is written before the provider is called; its id is the
 * idempotency key sent to the provider, so a lost response can be looked up later.
 *
 * payment_jobs is a transactional outbox: the capture or void that follows a seat
 * decision is inserted in the same transaction as that decision, so the money
 * always ends up matching the seat even if the process dies right after commit.
 * The worker picks up anything the request did not finish.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		await queryInterface.createTable('payment_attempts', {
			id: {
				type: Sequelize.UUID,
				primaryKey: true,
				allowNull: false,
				defaultValue: Sequelize.literal('gen_random_uuid()'),
			},
			booking_id: {
				type: Sequelize.UUID,
				allowNull: false,
				references: { model: 'bookings', key: 'id' },
				onDelete: 'RESTRICT',
				onUpdate: 'CASCADE',
			},
			amount_cents: { type: Sequelize.INTEGER, allowNull: false },
			currency: { type: Sequelize.CHAR(3), allowNull: false },
			// A provider token, never a card number.
			payment_method: { type: Sequelize.STRING(64), allowNull: false },
			status: {
				type: Sequelize.ENUM('processing', 'authorized', 'declined', 'captured', 'voided', 'capture_failed'),
				allowNull: false,
			},
			provider_ref: { type: Sequelize.STRING(100), allowNull: true },
			failure_code: { type: Sequelize.STRING(64), allowNull: true },
			created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
			updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
		});
		await queryInterface.addIndex('payment_attempts', ['booking_id'], { name: 'payment_attempts_booking_id' });
		await queryInterface.addIndex('payment_attempts', ['status', 'updated_at'], {
			name: 'payment_attempts_status_updated_at',
		});
		await queryInterface.sequelize.query(
			'ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_amount_not_negative CHECK (amount_cents >= 0)',
		);

		await queryInterface.createTable('payment_jobs', {
			id: {
				type: Sequelize.UUID,
				primaryKey: true,
				allowNull: false,
				defaultValue: Sequelize.literal('gen_random_uuid()'),
			},
			payment_attempt_id: {
				type: Sequelize.UUID,
				allowNull: false,
				references: { model: 'payment_attempts', key: 'id' },
				onDelete: 'CASCADE',
				onUpdate: 'CASCADE',
			},
			kind: { type: Sequelize.ENUM('capture', 'void'), allowNull: false },
			status: { type: Sequelize.ENUM('pending', 'done', 'failed'), allowNull: false, defaultValue: 'pending' },
			attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
			run_after: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
			// Lease: while set in the future, another runner leaves the job alone.
			locked_until: { type: Sequelize.DATE, allowNull: true },
			last_error: { type: Sequelize.TEXT, allowNull: true },
			created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
			updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
		});
		await queryInterface.addIndex('payment_jobs', ['payment_attempt_id', 'kind'], {
			name: 'payment_jobs_attempt_kind_unique',
			unique: true,
		});
		await queryInterface.sequelize.query(
			"CREATE INDEX payment_jobs_due ON payment_jobs (run_after) WHERE status = 'pending'",
		);
	},

	async down(queryInterface) {
		await queryInterface.dropTable('payment_jobs');
		await queryInterface.dropTable('payment_attempts');
		await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_payment_jobs_kind');
		await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_payment_jobs_status');
		await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_payment_attempts_status');
	},
};
